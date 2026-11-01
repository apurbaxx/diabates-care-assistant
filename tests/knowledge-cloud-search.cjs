const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', js)(
    name => dependencies[name] || require(name), module, module.exports,
  );
  return module.exports;
}
const { callKnowledgeService } = load('lib/knowledge/python-service.ts');
const query = 'Find guidance about diabetes and kidney disease.';
const passage = { passage_id: 'kidney-p10', doc_title: 'Kidney guideline', source_org: 'ADA', year: 2026,
  section: 'Recommendation', page_number: 10, official_url: 'https://example.org',
  content_type: 'narrative', text: 'Clinical guideline evidence.', read_article_link: 'https://example.org', rerank_score: 5 };
const result = { query, results: [passage], total_results: 1, semantic_retrieval_executed: true,
  reranking_executed: true, reranker_fallback_used: false, latency_ms: 10 };
const ready = { status: 'ready', index_ready: true, models_loaded: { embedding: true, reranker: true } };

(async () => {
  const oldFetch = global.fetch;
  const oldEnv = { ...process.env };
  try {
    process.env.KNOWLEDGE_SERVICE_URL = 'https://full-search.example/';
    process.env.KNOWLEDGE_SERVICE_API_KEY = 'test-key';
    process.env.RERANK_SERVICE_URL = 'https://old-reranker.example';
    let supabaseCalls = 0;
    let supabaseAvailable = true;
    const dependencies = {
      '@/lib/supabase': {
        isSupabaseConfigured: () => supabaseAvailable,
        searchWithSupabase: async (_q, limit) => {
          supabaseCalls++;
          assert.equal(limit, 5);
          return { results: [{ ...passage, passage_id: 'fallback', rerank_score: null }] };
        },
        checkSupabaseHealth: async () => ({ status: 'ready', total_passages: 2032 }),
      },
      '@/lib/knowledge/python-service': { callKnowledgeService },
      '@/lib/knowledge/rerank': { rerankCandidates: () => { throw Error('Must not call old reranker'); } },
    };
    const { POST } = load('app/api/knowledge-assistant/search/route.ts', dependencies);
    const { GET } = load('app/api/knowledge-assistant/health/route.ts', dependencies);
    const request = (debug = true) => new Request('http://localhost/api/knowledge-assistant/search', {
      method: 'POST', body: JSON.stringify({ query, limit: 5, include_debug: debug }),
    });
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://full-search.example/search');
      assert.equal(options.headers['X-API-Key'], 'test-key');
      assert.equal(JSON.parse(options.body).query, query);
      return Response.json(result);
    };
    const primary = await (await POST(request())).json();
    assert.equal(primary.engine, 'cloud_python');
    assert.equal(primary.primary_fallback_used, false);
    assert.equal(primary.primary_service_status, 'success');
    assert.deepEqual(primary.results, result.results);
    assert.equal(supabaseCalls, 0);

    global.fetch = async () => Response.json({ ...result, results: [], total_results: 0 });
    assert.equal((await (await POST(request())).json()).engine, 'cloud_python');
    assert.equal(supabaseCalls, 0, 'Preserve valid local zero-result decisions');

    for (const [response, reason] of [
      [() => new Response('', { status: 401 }), 'http_401'],
      [() => new Response('', { status: 503 }), 'http_503'],
      [() => new Response('broken'), 'request_failed'],
      [() => Response.json({ results: [] }), 'invalid_response'],
      [() => Response.json({ ...result, results: [{ ...passage, passage_id: '' }] }), 'invalid_response'],
      [() => Response.json({ ...result, total_results: 2 }), 'invalid_response'],
      [() => Response.json({ ...result, query: 'different query' }), 'invalid_response'],
      [() => Response.json({ ...result, reranker_fallback_used: true }), 'degraded_search'],
    ]) {
      global.fetch = async () => response();
      const responseBody = await (await POST(request())).json();
      assert.equal(responseBody.engine, 'supabase_pgvector');
      assert.equal(responseBody.primary_fallback_used, true);
      assert.equal(responseBody.primary_service_status, reason);
      assert.equal(responseBody.results[0].passage_id, 'fallback');
    }
    global.fetch = async () => { throw Error('Unavailable'); };
    assert.equal((await (await POST(request())).json()).primary_service_status, 'request_failed');
    process.env.KNOWLEDGE_SERVICE_TIMEOUT_MS = '500';
    global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Error('Deadline')));
    });
    assert.equal((await (await POST(request())).json()).primary_service_status, 'timeout');

    delete process.env.KNOWLEDGE_SERVICE_API_KEY;
    global.fetch = async () => { throw Error('Must not fetch without a key'); };
    assert.equal((await (await POST(request())).json()).primary_service_status, 'missing_api_key');
    const hidden = await (await POST(request(false))).json();
    assert.equal(hidden.primary_service_status, undefined);
    supabaseAvailable = false;
    assert.equal((await POST(request())).status, 503);
    supabaseAvailable = true;

    process.env.KNOWLEDGE_SERVICE_API_KEY = 'test-key';
    global.fetch = async url => {
      assert.equal(url, 'https://full-search.example/health');
      return Response.json(ready);
    };
    assert.equal((await (await GET()).json()).engine, 'cloud_python');
    global.fetch = async () => Response.json({ status: 'ready', model: 'old-reranker' });
    const fallbackHealth = await (await GET()).json();
    assert.equal(fallbackHealth.engine, 'supabase_pgvector');
    assert.equal(fallbackHealth.primary_service_status, 'not_ready');
    supabaseAvailable = false;
    assert.equal((await GET()).status, 503);
    console.log('Full Python search routing, health, validation and Supabase fallback tests passed');
  } finally {
    global.fetch = oldFetch;
    for (const key of ['KNOWLEDGE_SERVICE_URL', 'KNOWLEDGE_SERVICE_API_KEY', 'KNOWLEDGE_SERVICE_TIMEOUT_MS', 'RERANK_SERVICE_URL']) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
