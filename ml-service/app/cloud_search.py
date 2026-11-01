"""Cloud Run entry point using exactly the local guideline retrieval pipeline."""
import hashlib
import hmac
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, Header, HTTPException

from app.schemas import SearchRequest, SearchResponse

engine = None
model_manager = None
index = None
inference_lock = Lock()


def validate_artifacts(data_dir: Path):
    """Reject stale/reordered artifacts rather than silently rebuilding at startup."""
    import numpy as np
    passages_path = data_dir / "passages.json"
    passage_bytes = passages_path.read_bytes()
    passages = json.loads(passage_bytes.decode("utf-8"))
    metadata = json.loads((data_dir / "index_metadata.json").read_text(encoding="utf-8"))
    ids = [p["passage_id"] for p in passages if not p.get("is_bibliography", False)]
    embeddings = np.load(data_dir / "embeddings.npy", mmap_mode="r", allow_pickle=False)
    # Git may convert CRLF to LF between Windows ingestion and a Linux build.
    # Accept only that byte transformation; actual content changes still fail.
    lf_bytes = passage_bytes.replace(b"\r\n", b"\n")
    compatible_hashes = {hashlib.sha256(raw).hexdigest() for raw in
                         (passage_bytes, lf_bytes, lf_bytes.replace(b"\n", b"\r\n"))}
    errors = []
    if metadata.get("passages_hash") not in compatible_hashes:
        errors.append("passages_hash (passage content changed)")
    if not ids or metadata.get("passage_ids") != ids:
        errors.append("passage_ids (missing or reordered passages)")
    if metadata.get("total_indexed_passages") != len(ids):
        errors.append("total_indexed_passages")
    if metadata.get("embedding_model") != "sentence-transformers/all-MiniLM-L6-v2":
        errors.append("embedding_model")
    if embeddings.shape != (len(ids), 384):
        errors.append("embedding dimensions/count")
    if not np.isfinite(embeddings).all():
        errors.append("nonfinite embeddings")
    if errors:
        raise RuntimeError("Guideline artifacts do not match: " + ", ".join(errors)
                           + ". Run ingestion and retrieval locally before deploying.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine, model_manager, index
    if not os.environ.get("KNOWLEDGE_SERVICE_API_KEY"):
        raise RuntimeError("KNOWLEDGE_SERVICE_API_KEY must be configured")
    import torch
    from app.retrieval import ModelManager, GuidelineIndex, HybridSearchEngine, DATA_DIR
    torch.set_num_threads(1)
    validate_artifacts(Path(DATA_DIR))
    model_manager = ModelManager.get_instance()
    model_manager.load_models()
    if not model_manager.embedding_loaded or not model_manager.reranker_loaded:
        raise RuntimeError("Both embedding and reranker models must load successfully")
    index = GuidelineIndex()
    index.load_index()
    if not index.is_ready:
        raise RuntimeError("Guideline index is not ready")
    engine = HybridSearchEngine(index, model_manager)
    yield
    engine = index = model_manager = None


app = FastAPI(title="ClinIQ full guideline search", lifespan=lifespan)


@app.get("/health")
def health():
    if engine is None or index is None or not index.is_ready:
        raise HTTPException(503, "Guideline search is not ready")
    return {"status": "ready", "index_ready": True,
            "models_loaded": {"embedding": model_manager.embedding_loaded, "reranker": model_manager.reranker_loaded},
            "embedding_model": model_manager.embedding_model_name,
            "reranker_model": model_manager.reranker_model_name,
            "total_passages": len(index.searchable_passages),
            "total_documents": len({p["doc_id"] for p in index.searchable_passages}),
            "passages_hash": index.metadata["passages_hash"], "device": "cpu", "version": "1.0.0"}


@app.post("/search", response_model=SearchResponse)
def search(body: SearchRequest, x_api_key: str = Header(default="")):
    key = os.environ.get("KNOWLEDGE_SERVICE_API_KEY", "")
    if not key or not hmac.compare_digest(x_api_key.encode(), key.encode()):
        raise HTTPException(401, "Invalid API key")
    if engine is None:
        raise HTTPException(503, "Guideline search is not ready")
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(503, "Search is busy")
    try:
        return engine.search(query=body.query, limit=body.limit, threshold=body.score_threshold,
                             include_debug=body.include_debug, mode="hybrid_rerank")
    finally:
        inference_lock.release()
