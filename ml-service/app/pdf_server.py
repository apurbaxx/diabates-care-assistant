"""Standalone, ultra-lightweight PDF extraction microservice.

Contains zero PyTorch, zero sentence-transformers, and zero guideline indexes.
Peak RAM is ~35MB, perfectly suited for running on a separate 512MB dyno or container.
"""
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, HTTPException, Security, Depends, Request
from fastapi.security.api_key import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware

try:
    from app.lab_pdf import extract_pdf, MAX_BYTES
except ImportError:
    from lab_pdf import extract_pdf, MAX_BYTES

API_KEY_NAME = "X-API-Key"
API_KEY = os.environ.get("ML_SERVICE_API_KEY", "cliniq-knowledge-internal-key")
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)


async def verify_api_key(header_key: Optional[str] = Security(api_key_header)):
    if not API_KEY or API_KEY == "cliniq-knowledge-internal-key":
        return header_key
    if header_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")
    return header_key


app = FastAPI(
    title="ClinIQ Dedicated Laboratory PDF Extraction Service",
    description="Lightweight layout-aware PDF extraction microservice without ML model overhead.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {
        "status": "ready",
        "service": "cliniq-pdf-extractor",
        "model_overhead": "0MB",
        "max_bytes": MAX_BYTES,
    }


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

    try:
        return extract_pdf(pdf_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"PDF extraction error: {str(exc)}",
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app.pdf_server:app", host="0.0.0.0", port=port, reload=False)
