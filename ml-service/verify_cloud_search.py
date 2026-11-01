"""Offline smoke test of the real models, cloud wrapper and local search parity."""
import json
import os
import sys
import time

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("KNOWLEDGE_SERVICE_API_KEY", "local-verification-only")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from fastapi.testclient import TestClient
from app import cloud_search


def peak_memory_mib():
    if sys.platform == "win32":
        try:
            import psutil
            return round(psutil.Process().memory_info().peak_wset / 1024**2, 1)
        except ImportError:
            return None
    import resource
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(peak / (1024**2 if sys.platform == "darwin" else 1024), 1)


if __name__ == "__main__":
    query = "Find guidance about diabetes and kidney disease."
    started = time.monotonic()
    with TestClient(cloud_search.app) as client:
        startup_seconds = time.monotonic() - started
        response = client.post("/search", json={"query": query, "limit": 5},
                               headers={"X-API-Key": os.environ["KNOWLEDGE_SERVICE_API_KEY"]})
        response.raise_for_status()
        cloud = response.json()
        local = cloud_search.engine.search(query, limit=5, mode="hybrid_rerank")
        assert [p["passage_id"] for p in cloud["results"]] == [p.passage_id for p in local.results]
        print(json.dumps({"local_cloud_ranking_matches": True,
                          "startup_seconds": round(startup_seconds, 2),
                          "cloud_search_ms": cloud["latency_ms"],
                          "peak_process_memory_mib": peak_memory_mib(),
                          "passages_hash": client.get("/health").json()["passages_hash"],
                          "results": [{"passage_id": p["passage_id"], "page": p["page_number"],
                                       "score": p["rerank_score"]} for p in cloud["results"]]}, indent=2))
