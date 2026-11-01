"""CPU-only guideline reranker. No embedding model, PDFs or local index loaded."""
import hmac
import math
import os
from contextlib import asynccontextmanager
from threading import Lock

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
model = None
inference_lock = Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    if not os.environ.get("RERANK_SERVICE_API_KEY"):
        raise RuntimeError("RERANK_SERVICE_API_KEY must be configured")
    import torch
    from sentence_transformers import CrossEncoder
    torch.set_num_threads(1)
    model = CrossEncoder(MODEL_NAME, device="cpu", max_length=512)
    yield
    model = None


app = FastAPI(title="ClinIQ guideline reranker", lifespan=lifespan)


class Passage(BaseModel):
    passage_id: str = Field(min_length=1, max_length=250)
    doc_title: str = Field(max_length=1000)
    section: str = Field(max_length=1000)
    text: str = Field(min_length=1, max_length=12000)


class RerankRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    passages: list[Passage] = Field(min_length=1, max_length=60)
    limit: int = Field(default=5, ge=1, le=20)
    score_threshold: float = Field(default=0, allow_inf_nan=False)


@app.get("/health")
def health():
    if model is None:
        raise HTTPException(503, "Model not ready")
    return {"status": "ready", "model": MODEL_NAME}


@app.post("/rerank")
def rerank(body: RerankRequest, x_api_key: str = Header(default="")):
    expected = os.environ.get("RERANK_SERVICE_API_KEY", "")
    if not expected or not hmac.compare_digest(x_api_key.encode(), expected.encode()):
        raise HTTPException(401, "Invalid API key")
    if model is None:
        raise HTTPException(503, "Model not ready")
    if len({p.passage_id for p in body.passages}) != len(body.passages):
        raise HTTPException(422, "Passage IDs must be unique")
    # A disconnected caller must not cause overlapping inference in this process.
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(503, "Reranker busy")
    try:
        pairs = [(body.query, f"[{p.doc_title} - {p.section}] {p.text}") for p in body.passages]
        scores = model.predict(pairs, batch_size=4, show_progress_bar=False)
        if len(scores) != len(body.passages) or any(not math.isfinite(float(s)) for s in scores):
            raise HTTPException(503, "Invalid model scores")
        results = [{"passage_id": p.passage_id, "score": float(score)}
                   for p, score in zip(body.passages, scores)
                   if float(score) >= body.score_threshold]
        results.sort(key=lambda result: result["score"], reverse=True)
        return {"results": results[:body.limit], "model": MODEL_NAME}
    finally:
        inference_lock.release()
