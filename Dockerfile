# ── Stage 1: Build Next.js ────────────────────────────────────────────────────
FROM node:20-slim AS nextjs-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Final image (Python + Node) ──────────────────────────────────────
FROM python:3.11-slim

# Install Node.js into the Python base image
RUN apt-get update && apt-get install -y \
    curl gnupg gcc g++ \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Install Python dependencies (CPU-only torch to keep image small) ──────────
COPY ml-service/requirements.txt ./ml-service/requirements.txt
RUN pip install --no-cache-dir \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r ml-service/requirements.txt

# ── Copy ML service source ────────────────────────────────────────────────────
COPY ml-service/ ./ml-service/

# ── Pre-cache Hugging Face Models into Docker Image ───────────────────────────
ENV HF_HOME=/root/.cache/huggingface
RUN python -c "from sentence_transformers import SentenceTransformer, CrossEncoder; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2'); CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"

# ── Copy built Next.js app from builder stage ─────────────────────────────────
COPY --from=nextjs-builder /app/.next ./.next
COPY --from=nextjs-builder /app/node_modules ./node_modules
COPY --from=nextjs-builder /app/public ./public
COPY package.json ./

# ── Startup script ─────────────────────────────────────────────────────────────
COPY start.sh ./start.sh
RUN chmod +x start.sh

EXPOSE 3000

CMD ["./start.sh"]
