FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 HF_HOME=/opt/models TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
COPY requirements-cloud.txt ./requirements.txt
RUN pip install --no-cache-dir torch==2.14.1+cpu --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt && pip check
RUN python -c "from sentence_transformers import SentenceTransformer, CrossEncoder; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2'); CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
COPY app/retrieval.py app/schemas.py app/cloud_search.py ./app/
COPY data/passages.json data/embeddings.npy data/index_metadata.json ./data/
RUN python -c "from pathlib import Path; from app.cloud_search import validate_artifacts; validate_artifacts(Path('data'))"
CMD ["sh", "-c", "exec uvicorn app.cloud_search:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --no-access-log"]
