"""Authenticated development Visit Summary translation."""

import asyncio
import math
import logging
import os
import random
import re
import time
from collections import deque
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from hmac import compare_digest
from uuid import uuid4

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from grapheme import graphemes
from pydantic import BaseModel, ConfigDict, ValidationError
from starlette.requests import ClientDisconnect

router = APIRouter()
logger = logging.getLogger("summary_translation")
LANGUAGES = {
    "hi": "hi-IN", "mr": "mr-IN", "gu": "gu-IN", "bn": "bn-IN",
    "ta": "ta-IN", "te": "te-IN", "kn": "kn-IN", "ml": "ml-IN", "pa": "pa-IN",
}
# Match the editor's String.trim() whitespace for blank fields.
EDITOR_WHITESPACE = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
LIMIT = 2000
DEADLINE = 12
MAX_BODY_BYTES = 32768
slots = asyncio.Semaphore(3)
target_locks = {target: asyncio.Lock() for target in LANGUAGES.values()}
REQUEST_LIMIT = 12
OUTBOUND_LIMIT = 24
WINDOW = 60
MAX_RETRY_DELAY = 60
requests = deque()
outbound_requests = deque()
provider_cooldown = 0.0


class Fields(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    complaint: str
    observations: str
    notes: str
    instructions: str


class TranslationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    targetLanguage: str
    fields: Fields


class TranslationError(Exception):
    def __init__(self, status, code, retryable=False, retry_after=None, stage="fastapi"):
        self.status = status
        self.code = code
        self.retryable = retryable
        self.retry_after = retry_after
        self.stage = stage


def diagnostics_enabled():
    return (os.environ.get("CLINIQ_RUNTIME_MODE") == "development"
            and os.environ.get("NODE_ENV") != "production")


def error_response(status, code, retryable=False, retry_after=None, request_id=None, stage="fastapi"):
    headers = {"Cache-Control": "no-store"}
    payload = {"error": {"code": code, "retryable": retryable}}
    if request_id and diagnostics_enabled():
        diagnostic_code = f"{stage.upper()}_{code.upper()}"
        logger.warning("request_id=%s stage=%s status=%s code=%s retryable=%s",
                       request_id, stage, status, diagnostic_code, retryable)
        headers["X-Request-ID"] = request_id
        payload["diagnostic"] = {"requestId": request_id, "code": diagnostic_code}
    if retry_after is not None:
        headers["Retry-After"] = str(max(1, math.ceil(min(retry_after, MAX_RETRY_DELAY))))
    return JSONResponse(
        payload, status_code=status,
        headers=headers,
    )


def take_slot(history, limit, stage):
    now = time.monotonic()
    while history and history[0] <= now - WINDOW:
        history.popleft()
    if len(history) >= limit:
        raise TranslationError(429, "translation_rate_limited", True, history[0] + WINDOW - now, stage)
    history.append(now)


def chunks(text):
    """Yield (text, translate) pairs, preserving line and chunk separators."""
    clusters = list(graphemes(text))
    start = 0
    while start < len(clusters):
        end = start
        while end < len(clusters) and clusters[end].isspace():
            end += 1
        if end > start:
            yield "".join(clusters[start:end]), False
            start = end
            continue
        size = 0
        word = sentence = None
        while end < len(clusters):
            cluster = clusters[end]
            if cluster.isspace():
                if cluster != " " or end + 1 == len(clusters) or clusters[end + 1].isspace():
                    break
                word = end
                if clusters[end - 1] in (".", "!", "?"):
                    sentence = end
            if size + len(cluster) > LIMIT:
                end = sentence or word or end
                break
            size += len(cluster)
            end += 1
        if end == start:
            raise TranslationError(422, "translation_chunk_too_large", stage="chunk")
        yield "".join(clusters[start:end]), True
        start = end


def retry_delay(header, attempt):
    if header:
        try:
            seconds = float(header)
        except ValueError:
            try:
                timestamp = parsedate_to_datetime(header)
                if timestamp.tzinfo is None:
                    timestamp = timestamp.replace(tzinfo=timezone.utc)
                seconds = (timestamp - datetime.now(timezone.utc)).total_seconds()
            except (TypeError, ValueError, OverflowError):
                seconds = math.nan
        if math.isfinite(seconds):
            return max(0, seconds)
    return 0.25 * 2**attempt + random.uniform(0, 0.1)


async def translate_chunk(client, chunk, target, deadline):
    global provider_cooldown
    for attempt in range(3):
        remaining = provider_cooldown - time.monotonic()
        if remaining > 0:
            raise TranslationError(429, "translation_rate_limited", True, remaining, "sarvam_http")
        take_slot(outbound_requests, OUTBOUND_LIMIT, "outbound_limit")
        retry_after = None
        try:
            response = await client.post("/translate", json={
                "input": chunk,
                "source_language_code": "en-IN",
                "target_language_code": target,
                "model": "sarvam-translate:v1",
                "mode": "formal",
                "numerals_format": "international",
            })
        except httpx.ConnectTimeout:
            failure = TranslationError(504, "translation_timeout", True, stage="sarvam_http")
        except httpx.ConnectError:
            failure = TranslationError(502, "translation_unavailable", True, stage="sarvam_http")
        except httpx.TimeoutException:
            raise TranslationError(504, "translation_timeout", True, 3, stage="sarvam_http") from None
        except httpx.TransportError:
            raise TranslationError(502, "translation_unavailable", True, 3, stage="sarvam_http") from None
        else:
            if response.status_code == 200:
                try:
                    payload = response.json()
                except ValueError:
                    payload = None
                translated = payload.get("translated_text") if isinstance(payload, dict) else None
                if not isinstance(translated, str) or not translated.strip():
                    raise TranslationError(502, "invalid_translation_response", stage="sarvam_parse")
                try:
                    translated.encode("utf-8")
                except UnicodeEncodeError:
                    raise TranslationError(502, "invalid_translation_response", stage="sarvam_parse") from None
                return translated.strip()
            retry_after = response.headers.get("Retry-After")
            if response.status_code == 429:
                failure = TranslationError(429, "translation_rate_limited", True, stage="sarvam_http")
            else:
                transient = response.status_code in (500, 502, 503, 504)
                failure = TranslationError(502, "translation_unavailable", transient, stage="sarvam_http")
        delay = retry_delay(retry_after, attempt)
        if failure.status == 429 or (failure.retryable and retry_after):
            provider_cooldown = max(provider_cooldown, time.monotonic() + delay)
            failure.retry_after = delay
        if not failure.retryable or attempt == 2 or asyncio.get_running_loop().time() + delay >= deadline:
            raise failure
        await asyncio.sleep(delay)


def sarvam_client(key):
    return httpx.AsyncClient(
        base_url="https://api.sarvam.ai", headers={"api-subscription-key": key},
        timeout=httpx.Timeout(3, connect=2), follow_redirects=False, trust_env=False,
    )


async def translate_fields(fields, target, key):
    deadline = asyncio.get_running_loop().time() + DEADLINE
    async with target_locks[target], slots, sarvam_client(key) as client:
        output = {}
        for field, value in fields.items():
            if not value.strip(EDITOR_WHITESPACE):
                output[field] = value
                continue
            parts = []
            for part, needs_translation in chunks(value):
                if needs_translation:
                    part = await translate_chunk(client, part, target, deadline)
                parts.append(part)
            output[field] = "".join(parts)
        return output


@router.post("/visit-summary/translate")
async def translate_visit_summary(request: Request):
    request_id = request.headers.get("X-Request-ID", "")
    if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", request_id):
        request_id = str(uuid4())
    diagnostic = diagnostics_enabled()
    key = os.environ.get("SARVAM_API_KEY", "").strip()
    internal = os.environ.get("ML_SERVICE_API_KEY", "").strip()
    if (not diagnostic
            or os.environ.get("SARVAM_TRANSLATION_ENABLED") != "true" or not key
            or not internal or internal == "cliniq-knowledge-internal-key"):
        return error_response(503, "translation_disabled", request_id=request_id, stage="fastapi_config")
    if not compare_digest(request.headers.get("X-API-Key", "").encode(), internal.encode()):
        return error_response(401, "unauthorized", request_id=request_id, stage="fastapi_auth")
    body = bytearray()
    try:
        async for block in request.stream():
            if len(body) + len(block) > MAX_BODY_BYTES:
                return error_response(413, "request_too_large", request_id=request_id, stage="fastapi_validation")
            body.extend(block)
        data = TranslationRequest.model_validate_json(body)
    except (ValidationError, ClientDisconnect):
        return error_response(400, "invalid_translation_request", request_id=request_id, stage="fastapi_validation")
    target = LANGUAGES.get(data.targetLanguage)
    if target is None:
        return error_response(400, "invalid_translation_request", request_id=request_id, stage="fastapi_validation")
    fields = data.fields.model_dump()
    try:
        take_slot(requests, REQUEST_LIMIT, "request_limit")
        result = await asyncio.wait_for(translate_fields(fields, target, key), DEADLINE)
    except TranslationError as error:
        return error_response(error.status, error.code, error.retryable, error.retry_after,
                              request_id, error.stage)
    except asyncio.TimeoutError:
        return error_response(504, "translation_timeout", True, 3, request_id, "fastapi_timeout")
    except Exception:
        return error_response(502, "translation_unavailable", True, request_id=request_id)
    response_headers = {"Cache-Control": "no-store"}
    if diagnostic:
        response_headers["X-Request-ID"] = request_id
    return JSONResponse(result, headers=response_headers)
