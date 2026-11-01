"""API contract tests use a fake scorer; they never download model weights."""
import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location("reranker_server", Path(__file__).with_name("server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


@pytest.fixture
def client(monkeypatch):
    class Scorer:
        def predict(self, pairs, **kwargs):
            assert kwargs["batch_size"] == 4
            assert pairs[0][0] == "kidney disease"
            return [-1.0, 3.5]
    monkeypatch.setenv("RERANK_SERVICE_API_KEY", "test-key")
    monkeypatch.setattr(server, "model", Scorer())
    return TestClient(server.app)


def body():
    return {"query": "kidney disease", "limit": 2, "passages": [
        {"passage_id": name, "doc_title": "Guideline", "section": "Kidney", "text": "Evidence"}
        for name in ["a", "b"]]}


def test_ranking_and_threshold(client):
    response = client.post("/rerank", json=body(), headers={"X-API-Key": "test-key"})
    assert response.status_code == 200
    assert response.json()["results"] == [{"passage_id": "b", "score": 3.5}]


def test_authentication(client):
    assert client.post("/rerank", json=body()).status_code == 401


def test_bounded_input_and_duplicates(client):
    data = body()
    data["passages"] *= 31
    assert client.post("/rerank", json=data, headers={"X-API-Key": "test-key"}).status_code == 422
    data = body()
    data["passages"][1]["passage_id"] = "a"
    assert client.post("/rerank", json=data, headers={"X-API-Key": "test-key"}).status_code == 422


def test_busy_model_returns_retryable_error(client):
    server.inference_lock.acquire()
    try:
        assert client.post("/rerank", json=body(), headers={"X-API-Key": "test-key"}).status_code == 503
    finally:
        server.inference_lock.release()


def test_nonfinite_scores_and_lock_release(client, monkeypatch):
    monkeypatch.setattr(server.model, "predict", lambda *args, **kwargs: [float("nan"), 2])
    assert client.post("/rerank", json=body(), headers={"X-API-Key": "test-key"}).status_code == 503
    assert not server.inference_lock.locked()


def test_inference_exception_releases_lock(client, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("Inference failed")
    monkeypatch.setattr(server.model, "predict", fail)
    with pytest.raises(RuntimeError, match="Inference failed"):
        client.post("/rerank", json=body(), headers={"X-API-Key": "test-key"})
    assert not server.inference_lock.locked()
