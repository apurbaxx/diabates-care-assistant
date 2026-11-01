"""Cloud API and artifact validation without downloading or loading models."""
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import cloud_search as server


@pytest.fixture
def client(monkeypatch):
    def search(**kwargs):
        assert kwargs == {"query": "kidney disease", "limit": 3, "threshold": 1,
                          "include_debug": False, "mode": "hybrid_rerank"}
        return {"query": kwargs["query"], "results": [], "total_results": 0,
                "semantic_retrieval_executed": True, "reranking_executed": True,
                "reranker_fallback_used": False, "latency_ms": 1}
    monkeypatch.setenv("KNOWLEDGE_SERVICE_API_KEY", "test-key")
    monkeypatch.setattr(server, "engine", SimpleNamespace(search=search))
    return TestClient(server.app)


def test_same_local_pipeline_arguments_and_empty_results(client):
    response = client.post("/search", json={"query": "kidney disease", "limit": 3,
                           "score_threshold": 1, "include_debug": False}, headers={"X-API-Key": "test-key"})
    assert response.status_code == 200
    assert response.json()["results"] == []


def test_auth_and_readiness(client, monkeypatch):
    assert client.post("/search", json={"query": "kidney disease"}).status_code == 401
    monkeypatch.setattr(server, "engine", None)
    assert client.get("/health").status_code == 503
    assert client.post("/search", json={"query": "kidney disease"}, headers={"X-API-Key": "test-key"}).status_code == 503


def test_busy_and_exception_release(client, monkeypatch):
    server.inference_lock.acquire()
    try:
        assert client.post("/search", json={"query": "kidney disease"}, headers={"X-API-Key": "test-key"}).status_code == 503
    finally:
        server.inference_lock.release()
    def fail(**kwargs):
        raise RuntimeError("inference error")
    monkeypatch.setattr(server.engine, "search", fail)
    with pytest.raises(RuntimeError):
        client.post("/search", json={"query": "kidney disease"}, headers={"X-API-Key": "test-key"})
    assert not server.inference_lock.locked()


def artifacts(tmp_path):
    passages = [{"passage_id": "a"}, {"passage_id": "bibliography", "is_bibliography": True}, {"passage_id": "b"}]
    passage_bytes = json.dumps(passages, indent=2).encode()
    (tmp_path / "passages.json").write_bytes(passage_bytes)
    metadata = {"passages_hash": hashlib.sha256(passage_bytes).hexdigest(), "passage_ids": ["a", "b"],
                "total_indexed_passages": 2, "embedding_model": "sentence-transformers/all-MiniLM-L6-v2"}
    (tmp_path / "index_metadata.json").write_text(json.dumps(metadata))
    np.save(tmp_path / "embeddings.npy", np.zeros((2, 384), dtype=np.float32))
    return metadata


def test_artifact_validation(tmp_path):
    metadata = artifacts(tmp_path)
    server.validate_artifacts(tmp_path)
    metadata["passage_ids"] = ["b", "a"]
    (tmp_path / "index_metadata.json").write_text(json.dumps(metadata))
    with pytest.raises(RuntimeError, match="artifacts do not match"):
        server.validate_artifacts(tmp_path)


def test_stale_hash_rejected(tmp_path):
    artifacts(tmp_path)
    with (tmp_path / "passages.json").open("a") as f:
        f.write(" ")
    with pytest.raises(RuntimeError):
        server.validate_artifacts(tmp_path)


@pytest.mark.parametrize("original,checkout", [(b"\r\n", b"\n"), (b"\n", b"\r\n")])
def test_git_newline_conversion_is_allowed(tmp_path, original, checkout):
    metadata = artifacts(tmp_path)
    passage_path = tmp_path / "passages.json"
    raw = passage_path.read_bytes()
    metadata["passages_hash"] = hashlib.sha256(raw.replace(b"\n", original)).hexdigest()
    (tmp_path / "index_metadata.json").write_text(json.dumps(metadata))
    passage_path.write_bytes(raw.replace(b"\n", checkout))
    server.validate_artifacts(tmp_path)


def test_actual_content_change_is_rejected(tmp_path):
    artifacts(tmp_path)
    path = tmp_path / "passages.json"
    path.write_bytes(path.read_bytes().replace(b'"a"', b'"changed"'))
    with pytest.raises(RuntimeError, match="passages_hash"):
        server.validate_artifacts(tmp_path)


def test_nonfinite_vectors_rejected(tmp_path):
    artifacts(tmp_path)
    np.save(tmp_path / "embeddings.npy", np.full((2, 384), np.nan))
    with pytest.raises(RuntimeError):
        server.validate_artifacts(tmp_path)
