#!/bin/bash
set -e

echo ">>> Starting ML service on port 8000..."
cd /app/ml-service
uvicorn app.main:app --host 127.0.0.1 --port 8000 &
ML_PID=$!

echo ">>> Starting Next.js on port ${PORT:-3000}..."
cd /app
node_modules/.bin/next start -p ${PORT:-3000} &
NEXT_PID=$!

# If either process dies, kill the other and exit
wait -n $ML_PID $NEXT_PID
EXIT_CODE=$?

kill $ML_PID $NEXT_PID 2>/dev/null
exit $EXIT_CODE
