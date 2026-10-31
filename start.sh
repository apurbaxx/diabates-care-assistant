#!/bin/bash
set -e

# If Supabase is configured:
if [ -n "$SUPABASE_URL" ]; then
    echo ">>> ======================================================="
    echo ">>> [SUPABASE PGVECTOR DETECTED]"
    echo ">>> Offloading vector search & storage to Supabase."
    echo ">>> Starting PDF extraction microservice on port 8000..."
    echo ">>> Starting Next.js on port ${PORT:-3000}..."
    echo ">>> ======================================================="
    cd /app/ml-service
    python -m uvicorn app.pdf_server:app --host 127.0.0.1 --port 8000 &
    ML_PID=$!
    cd /app
    node_modules/.bin/next start -p ${PORT:-3000} &
    NEXT_PID=$!
    wait -n $ML_PID $NEXT_PID
    EXIT_CODE=$?
    kill $ML_PID $NEXT_PID 2>/dev/null
    exit $EXIT_CODE
fi

# Fallback: Start both local Python ML service and Next.js
echo ">>> [LOCAL FALLBACK MODE] SUPABASE_URL not detected."
echo ">>> Starting local Python ML service on port 8000..."
cd /app/ml-service
uvicorn app.main:app --host 0.0.0.0 --port 8000 &
ML_PID=$!

echo ">>> Starting Next.js on port ${PORT:-3000}..."
cd /app
node_modules/.bin/next start -p ${PORT:-3000} &
NEXT_PID=$!

wait -n $ML_PID $NEXT_PID
EXIT_CODE=$?

kill $ML_PID $NEXT_PID 2>/dev/null
exit $EXIT_CODE
