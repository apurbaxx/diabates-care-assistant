import os
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["ready", "degraded"]
    assert data["index_ready"] is True
    assert data["total_passages"] > 2000
    assert data["embedding_model"] == "sentence-transformers/all-MiniLM-L6-v2"
    assert data["reranker_model"] == "cross-encoder/ms-marco-MiniLM-L-6-v2"


def test_search_endpoint_valid(client):
    payload = {
        "query": "Find guidance about diabetes and kidney disease.",
        "limit": 3,
        "include_debug": True,
    }
    response = client.post("/search", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["total_results"] > 0
    assert data["semantic_retrieval_executed"] is True
    assert data["reranking_executed"] is True
    assert len(data["results"]) <= 3
    first = data["results"][0]
    assert "READ the full article LINK:" in first["read_article_link"]
    assert first["official_url"].startswith("http")


def test_search_endpoint_empty_query(client):
    payload = {"query": "   ", "limit": 5}
    response = client.post("/search", json=payload)
    assert response.status_code == 422


def test_search_endpoint_irrelevant_query(client):
    payload = {"query": "How to fix a broken iPhone screen?", "limit": 5}
    response = client.post("/search", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["total_results"] == 0
    assert "No relevant medical guideline passages" in data["message"]
