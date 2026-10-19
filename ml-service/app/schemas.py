from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator


class PassageMetadata(BaseModel):
    passage_id: str
    doc_id: str
    doc_title: str
    source_org: str
    year: int
    section: str
    page_number: int
    official_url: str
    content_type: str = "narrative"  # "recommendation" | "table" | "narrative" | "consensus"
    is_bibliography: bool = False


class Passage(BaseModel):
    id: str
    text: str
    metadata: PassageMetadata


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500, description="Natural language search query")
    limit: int = Field(default=5, ge=1, le=20, description="Requested number of relevant results")
    include_debug: bool = Field(default=True, description="Include intermediate ranking scores for verification")
    score_threshold: Optional[float] = Field(default=None, description="Optional custom reranker score threshold")

    @field_validator("query")
    @classmethod
    def clean_query(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("Query cannot be empty or whitespace only")
        return stripped


class PassageResult(BaseModel):
    passage_id: str
    doc_id: Optional[str] = None
    doc_title: str
    source_org: str
    year: int
    section: str
    page_number: int
    official_url: str
    content_type: str
    text: str
    read_article_link: str
    bm25_rank: Optional[int] = None
    semantic_rank: Optional[int] = None
    rrf_score: Optional[float] = None
    rerank_score: Optional[float] = None
    relevance_label: Optional[str] = None


class SearchResponse(BaseModel):
    query: str
    total_results: int
    results: List[PassageResult]
    semantic_retrieval_executed: bool
    reranking_executed: bool
    reranker_fallback_used: bool
    latency_ms: float
    message: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    models_loaded: Dict[str, bool]
    embedding_model: str
    reranker_model: str
    index_ready: bool
    total_passages: int
    total_documents: int
    device: str
    version: str = "1.0.0"
