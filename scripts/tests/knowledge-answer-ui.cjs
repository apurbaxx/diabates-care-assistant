const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.addInitScript(() => localStorage.setItem('cliniq:knowledge-assistant-tour:v1', JSON.stringify({ outcome: 'completed' })));
    await page.route('**/api/knowledge-assistant/health', route => route.fulfill({ json: { status: 'ready', total_passages: 3, total_documents: 2 } }));
    let finishSearch;
    const pending = new Promise(resolve => { finishSearch = resolve; });
    const base = { passage_id: 'first', doc_title: 'RSSDI Guideline', page_number: 12, text: 'Retinal screening identifies changes in the retinal blood vessels.', source_org: 'RSSDI', year: 2022, content_type: 'narrative', section: '', official_url: '', read_article_link: '' };
    const results = [base, { ...base, passage_id: 'second' }, {
      ...base, passage_id: 'third', doc_title: 'ADA Standards', page_number: 42, source_org: 'ADA',
      text: 'HbA1c reflects average blood glucose over the previous three months. HbA1c monitoring complements the assessment of glucose patterns over time.',
    }];
    await page.route('**/api/knowledge-assistant/search', async route => {
      assert.deepEqual(route.request().postDataJSON(), { query: 'What does HbA1c monitoring reflect?', limit: 5 });
      await pending;
      await route.fulfill({ json: { query: 'What does HbA1c monitoring reflect?', results, total_results: 3, latency_ms: 10 } });
    });
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:3100'}/knowledge-assistant`);
    // Accommodate tour persistence formats without depending on them for this test.
    const skip = page.getByRole('button', { name: 'Skip tour', exact: true }).first();
    if (await skip.isVisible()) await skip.click();
    await page.getByLabel('Ask a clinical question').fill('What does HbA1c monitoring reflect?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const short = page.getByRole('region', { name: 'Short Answer', exact: true });
    await short.getByRole('status').waitFor();
    finishSearch();
    await short.getByText(/HbA1c reflects average/).waitFor();
    assert.equal(await page.locator('article').count(), 2);
    await short.getByRole('link', { name: '[1] ADA Standards · Page 42', exact: true }).click();
    await page.locator('#guideline-evidence-third').waitFor();
    assert.equal(await page.locator('article').count(), 3);
    assert.match(await page.getByRole('complementary', { name: 'Passage details' }).innerText(), /ADA Standards/);
    await page.getByRole('button', { name: 'RSSDI Guidelines', exact: true }).click();
    await short.getByText('Insufficient evidence', { exact: true }).waitFor();
    assert.equal(await page.locator('article').count(), 2);
    await page.getByRole('button', { name: 'ADA Standards', exact: true }).click();
    await short.getByText(/HbA1c reflects average/).waitFor();
    assert.equal(await page.locator('article').count(), 1);
    assert(!requests.some(url => /knowledge-assistant\/answer|anthropic\.com|openai\.com|generativelanguage\.googleapis\.com/.test(url)));
    assert.deepEqual(errors, []);
    console.log('PASS: browser loading, local answer without tokens, citations reveal hidden evidence, source filters, evidence preservation and no answer/provider requests');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
