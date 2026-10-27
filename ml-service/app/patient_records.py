"""Ephemeral patient-text retrieval. Never reads or writes the guideline index."""
import math
import re
from datetime import date
from typing import Any

from pydantic import BaseModel, Field, model_validator


class PatientDocument(BaseModel):
    id: str = Field(min_length=1, max_length=250)
    patient_id: str = Field(min_length=1, max_length=200)
    date: date
    text: str = Field(min_length=1, max_length=20000)


class PatientSearchRequest(BaseModel):
    patient_id: str = Field(min_length=1, max_length=200)
    query: str = Field(min_length=1, max_length=500)
    documents: list[PatientDocument] = Field(max_length=200)
    limit: int = Field(default=4, ge=1, le=10)

    @model_validator(mode="after")
    def patient_isolation(self):
        if any(d.patient_id != self.patient_id for d in self.documents):
            raise ValueError("Every document must belong to the selected patient")
        if len({d.id for d in self.documents}) != len(self.documents):
            raise ValueError("Duplicate source identifiers")
        return self


def search_patient_documents(request: PatientSearchRequest, model_manager: Any = None) -> dict:
    """Rank only this request's documents; return IDs, never generated assertions."""
    documents = request.documents
    if not documents:
        return {"patient_id": request.patient_id, "results": [], "semantic_retrieval_executed": False}
    # Lexical overlap is a usable fallback when model weights are unavailable.
    stop = {"the", "and", "patient", "record", "notes", "show", "what", "does", "this", "documented"}
    terms = {t for t in re.findall(r"[a-z0-9]+", request.query.lower()) if len(t) > 2 and t not in stop}
    scores = [sum(t in d.text.lower() for t in terms) / max(1, len(terms)) for d in documents]
    semantic = False
    if model_manager is not None and getattr(model_manager, "embedding_loaded", False):
        try:
            # No caching/indexing of patient text: vectors live only in this call.
            vectors = model_manager.embedding_model.encode(
                [request.query] + [d.text for d in documents], normalize_embeddings=True
            )
            for i in range(len(documents)):
                cosine = float(sum(a * b for a, b in zip(vectors[0], vectors[i + 1])))
                if math.isfinite(cosine):
                    scores[i] += max(0.0, cosine)
            semantic = True
        except Exception:
            pass  # Do not log patient text or model exception content.
    ranked = sorted(range(len(documents)), key=lambda i: (scores[i], documents[i].date), reverse=True)
    # A similarity cutoff is a retrieval heuristic, not a medical confidence score.
    return {
        "patient_id": request.patient_id,
        "results": [{"id": documents[i].id} for i in ranked if scores[i] >= (0.3 if semantic else 0.001)][:request.limit],
        "semantic_retrieval_executed": semantic,
    }
