const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(id, ...args) {
  return resolve.call(this, id.startsWith('@/') ? path.resolve(__dirname, '../..', id.slice(2)) : id, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, f);
require.extensions['.css'] = m => { m.exports = {}; };

const originalLoad = Module._load;
Module._load = function(id, ...args) {
  if (id.includes('anthropic')) throw new Error('Short Answer must not load Anthropic');
  return originalLoad.call(this, id, ...args);
};
const { answerGuidelineQuestion: answer } = require('../../lib/knowledge/answer.ts');
const { ShortAnswer } = require('../../components/knowledge/ShortAnswer.tsx');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const base = {
  passage_id: 'p1', doc_title: 'RSSDI Guideline', page_number: 12,
  text: 'HbA1c reflects average blood glucose over the previous three months. HbA1c monitoring complements the assessment of glucose patterns over time.',
  rerank_score: 0.8, source_org: 'RSSDI', content_type: 'narrative',
};
const query = 'What does HbA1c monitoring reflect?';
const normalize = text => text.replace(/\s+/g, ' ').trim();
function trace(result, passages) {
  assert(result.answer.split(/\s+/).length <= 60);
  assert(result.sentences.length >= 1 && result.sentences.length <= 4);
  assert.equal(result.answer, result.sentences.map(s => s.text).join(' '));
  for (const sentence of result.sentences) {
    const p = passages.find(p => p.passage_id === sentence.passage_id);
    assert(normalize(p.text).includes(sentence.text), 'Each sentence is a verbatim source extract');
    assert.deepEqual(result.citations.find(c => c.passage_id === p.passage_id), {
      passage_id: p.passage_id, doc_title: p.doc_title, page_number: p.page_number,
    });
  }
}
(async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  const fetch = global.fetch;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = () => { throw new Error('Local summarization must not make network requests'); };
    const result = answer(query, [base]);
    assert.equal(result.insufficient_evidence, false);
    assert.equal(result.sentences.length, 2);
    trace(result, [base]);
    assert.deepEqual(answer(query, [base]), result, 'Selection is deterministic');
    assert.deepEqual(answer(query, [base, { ...base, passage_id: 'duplicate' }]), result);
    const unrelated = { ...base, passage_id: 'unrelated', text: 'Retinal screening identifies changes in the retinal blood vessels.', rerank_score: 100 };
    assert.deepEqual(answer(query, [base, unrelated]), result);
    assert(answer(query, []).insufficient_evidence);
    assert(answer('What are kidney screening intervals?', [base]).insufficient_evidence);
    assert(answer(query, [unrelated]).insufficient_evidence);
    for (const metadata of [{ doc_title: '' }, { doc_title: null }, { page_number: 0 }, { page_number: 1.5 }, { page_number: '12' }, { passage_id: '' }]) {
      assert(answer(query, [{ ...base, ...metadata }]).insufficient_evidence);
      assert.equal(answer(query, [{ ...base, ...metadata }, base]).citations.every(c => c.doc_title && Number.isInteger(c.page_number) && c.page_number > 0), true);
    }
    const stronger = { ...base, passage_id: 'stronger', doc_title: 'ADA Standards', page_number: 42, rerank_score: 5 };
    const weaker = { ...base, rerank_score: -5 };
    assert.equal(answer(query, [weaker, stronger]).citations[0].passage_id, 'stronger');
    const conflicting = { ...base, passage_id: 'conflict', text: 'HbA1c does not reflect average blood glucose over the previous three months.' };
    assert.match(answer(query, [base, conflicting]).answer, /conflicting/);
    const numeric = { ...base, passage_id: 'numeric', text: 'HbA1c monitoring is recommended every 3 months for glucose assessment.' };
    assert.match(answer(query, [numeric, { ...numeric, passage_id: 'different', text: numeric.text.replace('3', '6') }]).answer, /conflicting/);
    assert(answer('What dose should my patient take?', [base]).insufficient_evidence);
    assert(answer('HbA1c monitoring?', [{ ...base, text: 'HbA1c monitoring requires a dose of 10 mg daily.' }]).insufficient_evidence);
    const long = { ...base, text: 'HbA1c monitoring ' + 'source '.repeat(61) + 'ends.' };
    assert(answer(query, [long]).insufficient_evidence, 'Never truncate a long sentence or its qualifying context');
    const bounded = { ...base, text: ['alpha', 'beta', 'gamma', 'delta'].map(word => `HbA1c monitoring ${`${word} `.repeat(20)}ends.`).join(' ') };
    trace(answer(query, [bounded]), [bounded]);
    const response = { query, results: [base] };
    const html = renderToStaticMarkup(React.createElement(ShortAnswer, { response, passages: [base] }));
    assert.match(html, /RSSDI Guideline/);
    assert.match(html, /Page 12/);
    assert.match(html, /href="#guideline-evidence-p1"/);
    assert.match(html, /Evidence for sentence 1/);
    assert(!html.includes('unavailable'));
    assert.match(renderToStaticMarkup(React.createElement(ShortAnswer, { passages: [], loading: true })), /role="status"/);
    assert.match(renderToStaticMarkup(React.createElement(ShortAnswer, { response, passages: [] })), /Insufficient evidence/);
    assert.match(renderToStaticMarkup(React.createElement(ShortAnswer, { response, passages: [null] })), /You can still review the evidence/);
    // Both search backends keep their original results, request and ranking contract.
    let supabase = true;
    Module._load = function(id, ...args) {
      if (id === '@/lib/supabase') return {
        isSupabaseConfigured: () => supabase,
        searchWithSupabase: async (q, limit) => {
          assert.equal(q, query); assert.equal(limit, 5);
          return { results: [base], latency_ms: 10 };
        },
      };
      if (id.includes('anthropic')) throw new Error('Search must not load Anthropic');
      return originalLoad.call(this, id, ...args);
    };
    const { POST } = require('../../app/api/knowledge-assistant/search/route.ts');
    global.fetch = async (url, options) => {
      assert(url.endsWith('/search'));
      assert.deepEqual(JSON.parse(options.body), { query, limit: 5, include_debug: true });
      return new Response(JSON.stringify({ query, results: [base], total_results: 1, latency_ms: 10 }));
    };
    for (const engine of ['supabase_pgvector', 'local_python']) {
      supabase = engine === 'supabase_pgvector';
      const response = await POST(new Request('http://localhost/api/knowledge-assistant/search', {
        method: 'POST', body: JSON.stringify({ query, limit: 5 }),
      }));
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.engine, engine);
      assert.deepEqual(data.results, [base]);
      assert(!('evidence_token' in data));
    }
    console.log('PASS: no key/network/provider dependency, verbatim traceability, citations, scores, duplicates, irrelevant/invalid evidence, conflicts, word limit, safety, loading and non-blocking UI fallback');
  } finally {
    global.fetch = fetch;
    Module._load = originalLoad;
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
