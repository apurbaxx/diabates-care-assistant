# ClinIQ Medical Guideline Knowledge Explorer - ML Service

Evidence-based clinical guideline search and retrieval service for diabetes care. Indexes authorized clinical recommendations from the **American Diabetes Association (ADA) Standards of Care 2026** and the **Research Society for the Study of Diabetes in India (RSSDI) 2024 & 2022 Guidelines**.

## Architecture

- **Embedding Model**: `sentence-transformers/all-MiniLM-L6-v2` (384-dimensional dense vectors, normalized L2 cosine similarity).
- **Lexical Index**: BM25 Okapi (`rank_bm25`).
- **Fusion**: Reciprocal Rank Fusion (RRF with $k=60$).
- **Cross-Encoder Reranker**: `cross-encoder/ms-marco-MiniLM-L-6-v2`.
- **Thresholding**: Calibrated logit score threshold ($\ge -2.5$) for medical relevance filtering. Out-of-domain queries return zero passages with clear explanation.
- **Serving**: FastAPI + Uvicorn, models loaded once on startup via lifespan context manager.

---

## Local Setup & Quick Start

### 1. Create and Activate Virtual Environment
```bash
python -m venv venv
# On Windows PowerShell:
.\venv\Scripts\Activate.ps1
# On macOS/Linux:
source venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install -r ml-service/requirements.txt
```

### 3. Ingestion & Index Generation
```bash
# Extract text, structure passages, strip boilerplate, exclude bibliographies:
python ml-service/app/ingestion.py

# Generate dense embeddings (atomically saved) and initialize BM25 index:
python ml-service/app/retrieval.py
```

### 4. Start the Service
```bash
# Start FastAPI service on port 8000
python ml-service/app/main.py
# Or via uvicorn directly:
uvicorn app.main:app --app-dir ml-service --host 127.0.0.1 --port 8000
```

### 5. Check Service Health
```bash
curl http://127.0.0.1:8000/health
```

### 6. Run Search Tests & Benchmark Evaluation
```bash
# Run automated pytest suite
pytest ml-service/tests -v

# Run repeatable benchmark evaluation suite across the 10 standard queries
python ml-service/app/evaluation.py
```

---

## API Endpoints

### `GET /health`
Returns readiness, models status, index size, and hardware device.

### `POST /search`
Request body:
```json
{
  "query": "How frequently should HbA1c be measured?",
  "limit": 5,
  "include_debug": true
}
```

Response includes:
- `results`: Ranked passages with verbatim text, section, page number, verified source, official URL, and explicit `"READ the full article LINK: <url>"`.
- Intermediate debug scores (`bm25_rank`, `semantic_rank`, `rrf_score`, `rerank_score`).
- Pipeline flags: `semantic_retrieval_executed`, `reranking_executed`, `reranker_fallback_used`.
- Search latency in milliseconds.

---

## Production & Resource Requirements

- **RAM**: ~1.2 GB peak (embedding model ~250MB, cross-encoder ~250MB, PyTorch runtime & NumPy vector table ~600MB).
- **CPU**: Runs effectively on standard x86_64 CPU (sub-second query response time ~600-750ms).
- **Startup Time**: ~3-4 seconds on CPU (models loaded once at boot).
- **Environment Variables**:
  - `ML_SERVICE_API_KEY`: Secret internal header token for server-to-server auth.
  - `PORT`: Service port (default `8000`).
