import asyncio
import json
import sys
from collections import deque
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import summary_translation as service


EXAMPLE_FIELDS = {
    "complaint": "Synthetic encounter Z-42: cough after gardening.",
    "observations": "Mock reading: HbA1c 6.7% and pulse 72 bpm.",
    "notes": "Training sample: Metformin 250 mg was documented.",
    "instructions": "Fictional follow-up on 2030-02-15 at 09:30.",
}


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setenv("CLINIQ_RUNTIME_MODE", "development")
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.setenv("SARVAM_TRANSLATION_ENABLED", "true")
    monkeypatch.setenv("SARVAM_API_KEY", "synthetic-test-key")
    monkeypatch.setenv("ML_SERVICE_API_KEY", "internal-test-key")
    monkeypatch.setattr(service, "retry_delay", lambda header, attempt: float(header or 0))
    monkeypatch.setattr(service, "requests", deque())
    monkeypatch.setattr(service, "outbound_requests", deque())
    monkeypatch.setattr(service, "provider_cooldown", 0.0)
    calls = []
    replies = []

    async def upstream(request):
        assert request.url == "https://api.sarvam.ai/translate"
        assert request.method == "POST"
        assert request.headers["api-subscription-key"] == "synthetic-test-key"
        payload = json.loads(request.content)
        calls.append(payload)
        if replies:
            reply = replies.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return reply
        return httpx.Response(200, json={"translated_text": payload["input"]})

    monkeypatch.setattr(service, "sarvam_client", lambda key: httpx.AsyncClient(
        base_url="https://api.sarvam.ai", headers={"api-subscription-key": key},
        transport=httpx.MockTransport(upstream),
    ))
    app = FastAPI()
    app.include_router(service.router)
    with TestClient(app) as client:
        def post(target="hi", fields=None, headers=None):
            return client.post("/visit-summary/translate",
                               json={"targetLanguage": target,
                                     "fields": EXAMPLE_FIELDS if fields is None else fields},
                               headers={"X-API-Key": "internal-test-key"} if headers is None else headers)
        yield post, calls, replies


@pytest.mark.parametrize("target,code", [
    ("hi", "hi-IN"), ("mr", "mr-IN"), ("gu", "gu-IN"), ("bn", "bn-IN"),
    ("ta", "ta-IN"), ("te", "te-IN"), ("kn", "kn-IN"), ("ml", "ml-IN"), ("pa", "pa-IN"),
])
def test_languages(api, target, code):
    post, calls, replies = api
    expected = {field: f"Mock {field}" for field in EXAMPLE_FIELDS}
    replies.extend(httpx.Response(200, json={"translated_text": value, "request_id": "mock",
                                            "source_language_code": "en-IN"})
                   for value in expected.values())
    assert post(target).json() == expected
    assert calls == [{
        "input": value, "source_language_code": "en-IN", "target_language_code": code,
        "model": "sarvam-translate:v1", "mode": "formal", "numerals_format": "international",
    } for value in EXAMPLE_FIELDS.values()]


def test_blanks(api):
    post, calls, _ = api
    fields = dict(complaint="", observations="  ", notes="\r\n", instructions="\t\u00a0\ufeff")
    assert post(fields=fields).json() == fields
    assert not calls


@pytest.mark.parametrize("payload", [{}, [], {"translated_text": ""}, {"translated_text": 2},
                                     {"translated_text": " "}, None])
def test_malformed_response_after_first_field(api, payload):
    post, calls, replies = api
    replies.extend([httpx.Response(200, json={"translated_text": "Mock"}),
                    httpx.Response(200, content="invalid JSON") if payload is None
                    else httpx.Response(200, json=payload)])
    response = post()
    assert response.status_code == 502
    assert response.json()["error"] == {"code": "invalid_translation_response", "retryable": False}
    assert response.json()["diagnostic"]["code"] == "SARVAM_PARSE_INVALID_TRANSLATION_RESPONSE"
    assert len(calls) == 2


@pytest.mark.parametrize("status", [400, 401, 403, 422])
def test_permanent_error(api, status):
    post, calls, replies = api
    replies.append(httpx.Response(status, text="private upstream detail"))
    response = post()
    assert response.status_code == 502
    assert response.json()["diagnostic"]["code"] == "SARVAM_HTTP_TRANSLATION_UNAVAILABLE"
    assert "private" not in response.text
    assert len(calls) == 1


def test_transient_retries(api):
    post, calls, replies = api
    replies.extend([httpx.Response(429, headers={"Retry-After": "0"}), httpx.Response(500)])
    assert post().status_code == 200
    assert calls[0] == calls[1] == calls[2]
    assert len(calls) == 6


def test_rate_limit_outside_budget(api):
    post, calls, replies = api
    replies.append(httpx.Response(429, headers={"Retry-After": "120"}))
    response = post()
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"
    assert post().status_code == 429
    assert len(calls) == 1


def test_retry_after_parses_delta_and_http_date(monkeypatch):
    from datetime import datetime, timezone

    class FixedClock:
        @staticmethod
        def now(tz):
            return datetime(2026, 1, 1, tzinfo=timezone.utc)

    monkeypatch.setattr(service, "datetime", FixedClock)
    assert service.retry_delay("7", 0) == 7
    assert service.retry_delay("Thu, 01 Jan 2026 00:00:09 GMT", 0) == 9
    assert service.retry_delay("Wed, 31 Dec 2025 23:59:59 GMT", 0) == 0
    assert 0.25 <= service.retry_delay("invalid", 0) <= 0.35


def test_service_unavailable_respects_retry_after(api):
    post, calls, replies = api
    replies.append(httpx.Response(503, headers={"Retry-After": "20"}))
    response = post()
    assert response.status_code == 502
    assert response.headers["Retry-After"] == "20"
    assert post().status_code == 429
    assert len(calls) == 1


def test_timeouts_are_bounded(api):
    post, calls, replies = api
    replies.extend(httpx.ConnectTimeout("mock") for _ in range(3))
    assert post().status_code == 504
    assert len(calls) == 3


def test_overall_deadline_cancels_upstream(api, monkeypatch):
    post, _, _ = api

    async def slow_upstream(request):
        await asyncio.sleep(10)
        pytest.fail("The deadline should cancel the upstream request")

    monkeypatch.setattr(service, "DEADLINE", 0.05)
    monkeypatch.setattr(service, "sarvam_client", lambda key: httpx.AsyncClient(
        base_url="https://api.sarvam.ai", transport=httpx.MockTransport(slow_upstream),
    ))
    response = post()
    assert response.status_code == 504
    assert response.json()["error"]["retryable"] is True


def test_long_input_preserves_order_and_separators(api):
    post, calls, _ = api
    long_input = "  Synthetic section.\r\n" + "x" * 2001 + "  " + "word " * 470 + "\t\n"
    fields = {**EXAMPLE_FIELDS, "notes": long_input}
    assert post(fields=fields).json() == fields
    assert all(0 < len(call["input"]) <= 2000 for call in calls)
    assert any(len(call["input"]) == 2000 for call in calls)
    assert post(fields={**fields, "notes": "x" * 33000}).status_code == 413


def test_request_validation_and_auth(api, monkeypatch):
    post, calls, _ = api
    assert post(headers={}).status_code == 401
    assert post(headers={"X-API-Key": "incorrect"}).status_code == 401
    assert post(target="en").status_code == 400
    assert post(fields={**EXAMPLE_FIELDS, "history": "Synthetic extra"}).status_code == 400
    assert post(fields={**EXAMPLE_FIELDS, "notes": 5}).status_code == 400
    assert post(fields={key: value for key, value in EXAMPLE_FIELDS.items() if key != "notes"}).status_code == 400
    monkeypatch.setenv("ML_SERVICE_API_KEY", "cliniq-knowledge-internal-key")
    assert post().status_code == 503
    monkeypatch.setenv("ML_SERVICE_API_KEY", "internal-test-key")
    monkeypatch.delenv("SARVAM_TRANSLATION_ENABLED")
    assert post().status_code == 503
    assert not calls


@pytest.mark.parametrize("runtime,node_env", [
    ("production", ""), ("development", "production"), ("", ""),
])
def test_fastapi_production_and_default_gate(api, monkeypatch, caplog, runtime, node_env):
    post, calls, _ = api
    monkeypatch.setenv("CLINIQ_RUNTIME_MODE", runtime)
    monkeypatch.setenv("NODE_ENV", node_env)
    response = post(headers={"X-Request-ID": REQUEST_ID})
    assert response.status_code == 503
    assert "X-Request-ID" not in response.headers
    assert response.json() == {"error": {"code": "translation_disabled", "retryable": False}}
    assert not [record for record in caplog.records if record.name == "summary_translation"]
    assert not calls


def test_endpoint_and_outbound_limits(api, monkeypatch):
    post, calls, _ = api
    monkeypatch.setattr(service, "REQUEST_LIMIT", 2)
    monkeypatch.setattr(service, "OUTBOUND_LIMIT", 1)
    response = post()
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"
    assert post().status_code == 429
    assert post().status_code == 429
    assert len(calls) == 1
    assert len(service.requests) == 2


@pytest.mark.parametrize("failure,status", [(httpx.ReadTimeout, 504), (httpx.WriteError, 502)])
def test_ambiguous_failure_does_not_cache_text_across_requests(api, failure, status):
    post, calls, replies = api
    replies.extend([httpx.Response(200, json={"translated_text": "Mock"}), failure("ambiguous")])
    response = post()
    assert response.status_code == status
    assert response.headers["Retry-After"] == "3"
    assert len(calls) == 2
    assert post().json() == EXAMPLE_FIELDS
    assert len(calls) == 6
    assert calls[0] == calls[2]
    assert calls[1] == calls[3]


@pytest.mark.parametrize("cluster", ["e\u0301", "👩🏾‍⚕️", "🇮🇳", "क्ष", " \u0301"])
def test_unicode_cluster_and_separator_boundaries(cluster):
    prefix = "a" * 1999
    separator = "  \r\n\t"
    source = prefix + cluster + "end" + separator + "tail"
    assert list(service.chunks(source)) == [
        (prefix, True), (cluster + "end", True), (separator, False), ("tail", True),
    ]


def test_reject_one_cluster_over_the_limit():
    with pytest.raises(service.TranslationError) as error:
        list(service.chunks("a" + "\u0301" * 2000))
    assert error.value.status == 422


REQUEST_ID = "12345678-1234-4abc-8def-123456789abc"


def test_diagnostic_correlation_and_redaction(api, monkeypatch, caplog):
    post, calls, replies = api
    auth = {"X-Request-ID": REQUEST_ID, "X-API-Key": "internal-test-key"}
    assert post(headers=auth).headers["X-Request-ID"] == REQUEST_ID
    calls.clear()
    denied = post(headers={**auth, "X-API-Key": "synthetic-invalid-token"})
    invalid_fields = post(headers=auth, fields={**EXAMPLE_FIELDS, "extra": "synthetic-private-extra"})
    invalid = post(target="synthetic-invalid-target", headers=auth)
    assert not calls
    replies.extend([
        httpx.Response(200, json={"translated_text": "synthetic-translated-text"}),
        httpx.Response(200, text="synthetic-provider-body"),
    ])
    parse = post(headers=auth)
    monkeypatch.delenv("SARVAM_API_KEY")
    config = post(headers=auth)
    for response, stage, code in [
        (denied, "fastapi_auth", "FASTAPI_AUTH_UNAUTHORIZED"),
        (invalid_fields, "fastapi_validation", "FASTAPI_VALIDATION_INVALID_TRANSLATION_REQUEST"),
        (invalid, "fastapi_validation", "FASTAPI_VALIDATION_INVALID_TRANSLATION_REQUEST"),
        (parse, "sarvam_parse", "SARVAM_PARSE_INVALID_TRANSLATION_RESPONSE"),
        (config, "fastapi_config", "FASTAPI_CONFIG_TRANSLATION_DISABLED"),
    ]:
        assert response.headers["X-Request-ID"] == REQUEST_ID
        assert response.json()["diagnostic"] == {"requestId": REQUEST_ID, "code": code}
        assert (f"request_id={REQUEST_ID} stage={stage} status={response.status_code} "
                f"code={code} retryable=False") in [
                    record.getMessage() for record in caplog.records if record.name == "summary_translation"
                ]
    invalid_id = post(headers={**auth, "X-Request-ID": "synthetic-invalid-token"})
    assert invalid_id.headers["X-Request-ID"] != REQUEST_ID
    assert invalid_id.headers["X-Request-ID"] == invalid_id.json()["diagnostic"]["requestId"]
    outputs = caplog.text + "".join(response.text for response in (denied, invalid_fields, invalid, parse, config, invalid_id))
    for secret in ("internal-test-key", "synthetic-test-key", "synthetic-invalid-token",
                   "synthetic-private-extra", "synthetic-invalid-target", "synthetic-translated-text",
                   "synthetic-provider-body", *EXAMPLE_FIELDS.values()):
        assert secret not in outputs
