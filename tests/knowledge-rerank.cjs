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

const { rerankCandidates } = load('lib/knowledge/rerank.ts');
const passage = id => ({ passage_id: id, doc_title: 'Kidney guideline', section: 'Recommendations',
  text: 'Clinical guidance for chronic kidney disease.', official_url: 'https://example.org/source',
  read_article_link: 'https://example.org/source', page_number: 10, source_org: 'ADA', year: 2026,
  content_type: 'narrative', rerank_score: null });
const candidates = [passage('a'), passage('b'), {
  ...passage('notice'), text: 'Suggested citation: Copyright notice.',
}];

(async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  try {
    delete process.env.RERANK_SERVICE_URL;
    let calls = 0;
    global.fetch = async () => { calls++; throw Error('Unexpected request'); };
    assert.deepEqual((await rerankCandidates('kidney', candidates, 2)).results, candidates.slice(0, 2));
    assert.equal(calls, 0);
    process.env.RERANK_SERVICE_URL = 'https://rerank.example/';
    delete process.env.RERANK_SERVICE_API_KEY;
    assert.equal((await rerankCandidates('kidney', candidates, 2)).reranker_fallback_used, true);
    assert.equal(calls, 0);
    process.env.RERANK_SERVICE_API_KEY = 'test-key';
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://rerank.example/rerank');
      assert.equal(options.headers['X-API-Key'], 'test-key');
      assert.deepEqual(JSON.parse(options.body).passages.map(p => p.passage_id), ['a', 'b']);
      return Response.json({ results: [{ passage_id: 'b', score: 3, text: 'Injected text' }] });
    };
    const success = await rerankCandidates('kidney', candidates, 2);
    assert.equal(success.reranking_executed, true);
    assert.equal(success.reranker_status, 'success');
    assert.equal(success.results[0].text, candidates[1].text);
    assert.equal(success.results[0].official_url, candidates[1].official_url);
    assert.equal(success.results[0].passage_id, 'b');

    for (const response of [
      () => new Response('', { status: 503 }),
      () => new Response('invalid JSON'),
      () => Response.json({ results: [] }),
      () => Response.json({ results: [{ passage_id: 'unknown', score: 4 }] }),
      () => Response.json({ results: [{ passage_id: 'b', score: '4' }] }),
      () => Response.json({ results: [{ passage_id: 'b', score: 4 }, { passage_id: 'b', score: 3 }] }),
    ]) {
      global.fetch = async () => response();
      const fallback = await rerankCandidates('kidney', candidates, 2);
      assert.deepEqual(fallback.results, candidates.slice(0, 2));
      assert.equal(fallback.reranking_executed, false);
      assert.equal(fallback.reranker_fallback_used, true);
    }
    global.fetch = async () => { throw Error('Network failure'); };
    assert.equal((await rerankCandidates('kidney', candidates, 2)).reranker_status, 'request_failed');
    global.fetch = async () => new Response('', { status: 401 });
    assert.equal((await rerankCandidates('kidney', candidates, 2)).reranker_status, 'http_401');
    global.fetch = async () => Response.json({ results: [] });
    assert.equal((await rerankCandidates('kidney', candidates, 2)).reranker_status, 'no_relevant_results');
    process.env.RERANK_TIMEOUT_MS = '500';
    global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Error('Timeout')));
    });
    assert.equal((await rerankCandidates('kidney', candidates, 2)).reranker_status, 'timeout');

    let candidateCount;
    const { POST } = load('app/api/knowledge-assistant/search/route.ts', {
      '@/lib/supabase': { isSupabaseConfigured: () => true,
        searchWithSupabase: async (_query, count) => { candidateCount = count; return { results: candidates }; } },
      '@/lib/knowledge/rerank': { rerankCandidates },
      '@/lib/knowledge/python-service': { callKnowledgeService: async () => ({ status: 'not_configured' }) },
    });
    const request = () => new Request('http://localhost/api/knowledge-assistant/search', {
      method: 'POST', body: JSON.stringify({ query: 'kidney disease', limit: 2 }),
    });
    global.fetch = async () => { throw Error('Cloud Run down'); };
    const fallbackResponse = await POST(request());
    assert.equal(fallbackResponse.status, 200);
    const fallback = await fallbackResponse.json();
    assert.equal(candidateCount, 50);
    assert.equal(fallback.engine, 'supabase_pgvector');
    assert.equal(fallback.reranker_fallback_used, true);
    assert.equal(fallback.reranker_status, 'request_failed');
    assert.deepEqual(fallback.results, candidates.slice(0, 2));
    global.fetch = async () => Response.json({ results: [{ passage_id: 'b', score: 3 }] });
    const reranked = await (await POST(request())).json();
    assert.equal(reranked.engine, 'supabase_pgvector_rerank');
    assert.equal(reranked.results[0].passage_id, 'b');
    assert.equal(reranked.reranking_executed, true);
    console.log('Reranking and route fallback tests passed');
  } finally {
    global.fetch = originalFetch;
    for (const key of ['RERANK_SERVICE_URL', 'RERANK_SERVICE_API_KEY', 'RERANK_TIMEOUT_MS']) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
