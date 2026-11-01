# Full local search on Google Cloud Run, with Supabase fallback

This replaces the Supabase-candidates-plus-reranker setup. The Cloud Run service
uses the same `app/retrieval.py`, query enrichment, BM25, vector retrieval,
cross-encoder and composite scoring as local search. Its index artifacts are
copied from your local project and validated during build and startup. It does
not run PDF extraction or load patient documents.

The Next.js app tries this full search first when `KNOWLEDGE_SERVICE_URL` is set.
Timeouts, network failures, authentication errors, malformed responses and degraded
model execution fall back directly to Supabase. It does not call the old reranker
after full-search failure. A valid zero-result search is retained, matching the
local evidence threshold decision. If both backends fail, the app returns an error.

## Prepare the separate repository

From the main project root, run in PowerShell:

```powershell
python ml-service/export_cloud_search.py
```

The generated `cloud-search-export` folder is ready for a standalone GitHub repo:

```text
Dockerfile
.dockerignore
.gitattributes
requirements-cloud.txt
app/
  cloud_search.py
  retrieval.py
  schemas.py
data/
  passages.json
  embeddings.npy
  index_metadata.json
```

You may replace the contents of your existing separate reranker repository with
these files, preserving the folders. The new Dockerfile must be at that repo's
root, with `app/` and `data/` next to it. Remove the old root `server.py` and
`requirements.txt` from that separate repo to avoid confusion; the new image does
not use them. Do not copy credentials, `.env` files, Python environments, PDFs or
the main app's root Dockerfile.

The files in this export are copies. After changing local ingestion, run ingestion
and retrieval, rerun the export script, and push the new artifacts to rebuild the
service. Continue seeding Supabase separately when its fallback data changes.

## Deploy visually in Google Cloud Console

1. Use the Google Cloud project attached to your credits. Open Cloud Run and
   create a service named `cliniq-knowledge` from the separate GitHub repository,
   using Cloud Build and the root Dockerfile. Alternatively, update the existing
   `cliniq-reranker` service to use this new repository content and Dockerfile.
2. Set memory **2 GiB**, CPU **1**, maximum concurrent requests **1**, minimum
   instances **0**, maximum instances **1**, request-based billing, port **8080**
   and request timeout **20 seconds**. Enable public access so Heroku can reach
   the endpoint; the application's API key protects `/search`.
3. Under Variables & Secrets, reference your Secret Manager key as the environment
   variable **`KNOWLEDGE_SERVICE_API_KEY`**. Use a fresh shared secret and the
   correct version. Grant the runtime service account Secret Manager Secret
   Accessor access to it. The old variable `RERANK_SERVICE_API_KEY` does not satisfy
   this new service's startup requirement.
4. If configuring a startup probe, use HTTP GET `/health`, port 8080, period 10
   seconds, timeout 2 seconds and failure threshold 24. Cached models load during
   startup; the container does not download models at request time.
5. Deploy and open `https://YOUR_SERVICE_URL/health`. Expect `status: ready`,
   `index_ready: true`, both models loaded, 2032 passages for the current data,
   and a `passages_hash` matching `data/index_metadata.json`.

The first build downloads **both** models and may take several minutes. The
container uses Python 3.12 (required by the pinned NumPy version), one worker, one inference at a time and cross-encoder batches of
four. It will fail the build/startup if the index metadata does not match the
passages or vector dimensions; regenerate the local index rather than bypassing
that check. Git CRLF/LF conversion is accepted, while actual passage changes and
ID/vector mismatches are still rejected. The exported `.gitattributes` preserves
artifact bytes in future commits. Python package versions are pinned to the local environment used for
verification. If you change them, rerun the local/cloud comparison.

## Deploy and configure the main Heroku app

Deploy the updated main application through your normal Heroku workflow. In
Heroku Settings → Config Vars, add:

```text
KNOWLEDGE_SERVICE_URL=https://YOUR_FULL_SEARCH_CLOUD_RUN_URL
KNOWLEDGE_SERVICE_API_KEY=THE_SAME_SECRET_VALUE_USED_ON_CLOUD_RUN
KNOWLEDGE_SERVICE_TIMEOUT_MS=12000
```

Remove the three old `RERANK_SERVICE_*`/`RERANK_TIMEOUT_MS` settings after switching;
they are ignored while `KNOWLEDGE_SERVICE_URL` is configured. Keep Supabase's
credentials so fallback continues to work. Keep `LAB_EXTRACT_SERVICE_URL` and its
existing API key unchanged; the PDF extractor is independent. Do not replace the
PDF service URL with the knowledge service URL.

For localhost, set the same three knowledge settings in `.env.local` and restart
Next.js. To continue using the original local Python backend, leave
`KNOWLEDGE_SERVICE_URL` unset and do not configure Supabase in that local environment.

## Verify

Submit the same question again after refreshing the app. In the browser's Network
tab, inspect the response from `/api/knowledge-assistant/search`:

```json
{
  "engine": "cloud_python",
  "primary_fallback_used": false,
  "primary_service_status": "success",
  "reranking_executed": true
}
```

`primary_service_status` is included when `include_debug` is true (the default).
It can be `timeout`, `http_401`, `http_404`, `missing_api_key`, `invalid_response`,
`degraded_search` or `request_failed` on fallback. If `/health` returns only
`status` and `model`, you are still running the old reranker-only container.

To test fallback locally, temporarily set
`KNOWLEDGE_SERVICE_URL=http://127.0.0.1:1`, restart Next.js and search. Expect HTTP
200, `engine: supabase_pgvector`, `primary_fallback_used: true` and original
Supabase ordering. Restore the real URL afterward. A valid cloud zero-result
response does not trigger fallback; there may be no suitable guideline evidence.

## Memory, startup and costs

The real-model smoke test on the development machine returned the same ordered
passage IDs through the cloud wrapper and direct local search for the kidney
query. It measured about **724 MiB peak process working set**, about **18 seconds
startup**, and **4.4 seconds search**. These are development measurements, not
Cloud Run container guarantees. Linux/container/library behavior and query length
can change the peak. Check Cloud Run's memory metrics at the configured concurrency
before increasing traffic. Keeping the service at 2 GiB gives headroom; no models
are added to Heroku by this change.

Minimum instances zero allows scale-to-zero but cold starts can exceed the app's
12-second deadline, intentionally causing Supabase fallback. Submit again after
warmup. For a demo needing consistently warm behavior, temporarily keeping one
minimum instance avoids scale-to-zero cold starts but increases costs. Review
credit expiry and billing alerts; build, image storage and networking also cost
money. Alerts are not hard spending caps.

No cloud resources have been created by these code changes.

## Development checks

```powershell
node tests/knowledge-cloud-search.cjs
node tests/knowledge-rerank.cjs
python -m pytest ml-service/tests/test_cloud_search.py -q
npm.cmd run typecheck
python ml-service/verify_cloud_search.py
```

The last command loads the real locally cached models in offline mode and compares
the cloud wrapper's ordered passage IDs with direct local search. On Windows it
reports peak memory when `psutil` is installed. For full answer parity, use the same
artifacts, models, question, limits and thresholds, and deploy the same Next.js
short-answer code. Very close model scores can still differ across platforms.

References: [Cloud Run repository deployment](https://docs.cloud.google.com/run/docs/continuous-deployment),
[secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets),
[memory limits](https://docs.cloud.google.com/run/docs/configuring/services/memory-limits).
