import os
import sys
import logging
import asyncio
from contextlib import asynccontextmanager
from typing import Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, HTTPException, Security, Depends, status, Request
from fastapi.security.api_key import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import SearchRequest, SearchResponse, HealthResponse
from app.retrieval import ModelManager, GuidelineIndex, HybridSearchEngine
from app.patient_records import PatientSearchRequest, search_patient_documents
from app.lab_pdf import extract_pdf, MAX_BYTES

# Configure privacy-preserving logging (do NOT log query terms or patient data)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ml_service")

# Server-to-server authentication
API_KEY_NAME = "X-API-Key"
API_KEY = os.environ.get("ML_SERVICE_API_KEY", "cliniq-knowledge-internal-key")
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

# Global engine instances (loaded once during lifespan)
model_manager: Optional[ModelManager] = None
index: Optional[GuidelineIndex] = None
engine: Optional[HybridSearchEngine] = None


async def verify_api_key(header_key: Optional[str] = Security(api_key_header)):
    """Verifies server-to-server internal API key if configured."""
    # Allow local development if API key is not strictly enforced via env
    if not API_KEY or API_KEY == "cliniq-knowledge-internal-key":
        return header_key
    if header_key != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-API-Key header",
        )
    return header_key


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: loads embedding model, cross-encoder reranker, and passage index once at startup."""
    global model_manager, index, engine
    logger.info("Initializing Medical Guideline Knowledge Explorer ML Service...")
    
    model_manager = ModelManager.get_instance()
    model_manager.load_models()

    index = GuidelineIndex()
    try:
        index.build_and_save_index(model_manager, force=False)
        engine = HybridSearchEngine(index, model_manager)
        logger.info(f"Service ready. Indexed {len(index.searchable_passages)} clinical passages.")
    except Exception as e:
        logger.error(f"Failed to initialize guideline index: {e}", exc_info=True)
        # Keep app running so health endpoint can report degraded/error state

    yield
    logger.info("Shutting down ML Service.")


app = FastAPI(
    title="ClinIQ Medical Guideline Knowledge Explorer ML Service",
    description="Evidence discovery engine for diabetes clinical practice guidelines (ADA & RSSDI).",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow CORS for Next.js app communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Reports readiness, model loading state, and index availability."""
    global model_manager, index
    is_ready = bool(index and index.is_ready and engine is not None)
    models_ready = {
        "embedding": bool(model_manager and model_manager.embedding_loaded),
        "reranker": bool(model_manager and model_manager.reranker_loaded),
    }

    status_str = "ready" if is_ready and all(models_ready.values()) else ("degraded" if is_ready else "error")

    return HealthResponse(
        status=status_str,
        models_loaded=models_ready,
        embedding_model=model_manager.embedding_model_name if model_manager else "none",
        reranker_model=model_manager.reranker_model_name if model_manager else "none",
        index_ready=is_ready,
        total_passages=len(index.searchable_passages) if index and index.is_ready else 0,
        total_documents=len(set(p["doc_id"] for p in index.searchable_passages)) if index and index.is_ready else 0,
        device=model_manager.device if model_manager else "cpu",
        version="1.0.0",
    )


@app.post("/patient-record/search")
def search_patient_record(request: PatientSearchRequest, api_key: Optional[str] = Depends(verify_api_key)):
    # Independent request-scoped corpus. No PDF index access or patient persistence.
    return search_patient_documents(request, model_manager)


@app.post("/search", response_model=SearchResponse)
async def search_guidelines(
    request: SearchRequest,
    api_key: Optional[str] = Depends(verify_api_key),
):
    """Executes hybrid retrieval and cross-encoder reranking over clinical guidelines."""
    global engine
    if not engine or not index or not index.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Guideline search engine is not ready or currently re-indexing.",
        )

    try:
        # Note: Do not log sensitive patient data or specific queries in compliance with specs
        logger.info(f"Executing search request (requested limit={request.limit})")
        response = engine.search(
            query=request.query,
            limit=request.limit,
            threshold=request.score_threshold,
            include_debug=request.include_debug,
            mode="hybrid_rerank",
        )
        return response
    except Exception as e:
        logger.error(f"Error during search execution: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while retrieving guideline evidence: {str(e)}",
        )


# Limit concurrent PDF extractions to keep peak memory minimal on memory-constrained dynos
pdf_semaphore = asyncio.Semaphore(2)


@app.post("/extract-pdf")
@app.post("/labs/extract")
async def extract_laboratory_pdf(
    request: Request,
    api_key: Optional[str] = Depends(verify_api_key),
):
    """Layout-aware extraction endpoint for clinical laboratory report PDFs."""
    content_type = request.headers.get("content-type", "")

    if "multipart/form-data" in content_type:
        form = await request.form()
        file = form.get("file")
        if not file or not hasattr(file, "read"):
            raise HTTPException(status_code=400, detail="Provide a PDF file in the 'file' form field.")
        pdf_bytes = await file.read()
    else:
        pdf_bytes = await request.body()

    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="The uploaded PDF report is empty.")
    if len(pdf_bytes) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"PDF exceeds the maximum size limit of {MAX_BYTES // (1024 * 1024)} MB.",
        )

    async with pdf_semaphore:
        try:
            return extract_pdf(pdf_bytes)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except Exception as exc:
            logger.error(f"Error extracting PDF: {exc}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail="This PDF layout could not be extracted safely. Please upload a digitally generated report or paste text directly.",
            )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
