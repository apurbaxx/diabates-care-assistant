const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const ARTICLE_URL = 'https://www.rssdi.in/newwebsite/pdfdata/rssdiGuidelines/2022/rssdi-clinical-practice-recommendations-2022.pdf';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(30000);
    await page.addInitScript(() => {
      localStorage.setItem('cliniq:workspace-tour:v1', 'seen');
      // Acknowledgements saved by older versions must not bypass the warning.
      localStorage.setItem('cliniq-knowledge-disclaimer-v1', 'true');
    });
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    let mode = 'local_python';
    await page.route('**/api/knowledge-assistant/search', async route => {
      requests.push(route.request().postDataJSON());
      if (mode === 'error') {
        await route.fulfill({ status: 503, json: { message: 'Search unavailable. Please try again.' } });
        return;
      }
      const passage = {
        passage_id: 'top', source_org: 'ADA', year: 2026, doc_title: 'Research source',
        section: 'Glucose monitoring', page_number: 42, text: `Top passage from ${mode}.`,
        content_type: 'paragraph',
        official_url: ARTICLE_URL,
        read_article_link: mode === 'local_python' ? `READ the full article LINK: ${ARTICLE_URL}` : ARTICLE_URL,
      };
      // Include an extra result to verify the panel always renders just the top answer.
      await route.fulfill({ json: { query: requests.at(-1).query, engine: mode,
        results: mode === 'empty' ? [] : [passage, { ...passage, passage_id: 'second', text: 'Second answer must stay hidden.' }] } });
    });
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:3100');
    await page.getByRole('heading', { name: 'Doctor workspace' }).waitFor();
    await page.getByRole('link', { name: 'View', exact: true }).first().click();
    const panel = page.getByRole('complementary', { name: 'Knowledge assistant' });
    await panel.waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Reference information' }).count(), 0);
    await panel.getByRole('button', { name: 'Ask a question', exact: true }).click();
    const warning = page.getByRole('dialog', { name: 'For general knowledge only' });
    await warning.waitFor();
    assert.match(await warning.innerText(), /ADA and RSSDI research papers/);
    assert.match(await warning.innerText(), /not tailored to this patient/);
    assert.equal(requests.length, 0);
    await page.keyboard.press('Escape');
    await warning.waitFor({ state: 'hidden' });
    assert.equal(await panel.locator('textarea').count(), 0);
    await panel.getByRole('button', { name: 'Ask a question', exact: true }).click();
    await warning.getByRole('button', { name: 'I understand — continue' }).click();
    const input = panel.getByLabel('Ask a general diabetes question');
    await input.fill('What is Time in Range?');
    await panel.getByRole('button', { name: 'Ask knowledge assistant', exact: true }).click();
    await panel.getByText('Top passage from local_python.', { exact: true }).waitFor();
    assert.deepEqual(requests[0], { query: 'What is Time in Range?', limit: 1 });
    assert.equal(await panel.getByText('Second answer must stay hidden.', { exact: true }).count(), 0);
    assert.equal(await panel.getByRole('link', { name: 'Read source' }).getAttribute('href'), ARTICLE_URL);

    mode = 'supabase_pgvector';
    await input.fill('How is glucose monitored?');
    await panel.getByRole('button', { name: 'Ask knowledge assistant', exact: true }).click();
    await panel.getByText('Top passage from supabase_pgvector.', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('link', { name: 'Read source' }).getAttribute('href'), ARTICLE_URL);
    assert.equal(await panel.locator('.knowledge-answer').count(), 1);
    assert.equal(await panel.getByText('Top passage from local_python.', { exact: true }).count(), 0);
    await panel.screenshot({ path: 'test-results/patient-knowledge-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobilePanel = await panel.boundingBox();
    assert(mobilePanel.x >= 0 && mobilePanel.x + mobilePanel.width <= 391, 'Knowledge panel fits the mobile viewport');
    assert(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), 'Knowledge panel contents do not overflow');
    await panel.screenshot({ path: 'test-results/patient-knowledge-mobile.png' });

    mode = 'empty';
    await panel.getByRole('button', { name: 'Ask knowledge assistant', exact: true }).click();
    await panel.getByText('No matching research found. Try rephrasing your question.').waitFor();
    assert.equal(await panel.locator('.knowledge-answer').count(), 0);
    mode = 'error';
    await panel.getByRole('button', { name: 'Ask knowledge assistant', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: 'Search unavailable' }).waitFor();
    await page.reload();
    await panel.getByRole('button', { name: 'Ask a question', exact: true }).click();
    await warning.waitFor();
    assert.equal(await panel.locator('textarea').count(), 0);
    await warning.getByRole('button', { name: 'I understand — continue' }).click();
    await input.waitFor();
    assert.equal(await warning.count(), 0);

    // The full explorer uses the extracted helper too; keep its existing search contract.
    mode = 'local_python';
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route('**/api/knowledge-assistant/health', route => route.fulfill({ json: {
      status: 'ready', total_passages: 2, total_documents: 1, embedding_model: 'test', reranker_model: 'test',
    } }));
    await page.goto(new URL('/knowledge-assistant', page.url()).href);
    await page.getByPlaceholder('Ask a clinical question').fill('What is Time in Range?');
    await page.locator('button[title="Search guidelines"]').click();
    await page.getByText('Top passage from local_python.', { exact: true }).first().waitFor();
    assert.deepEqual(requests.at(-1), { query: 'What is Time in Range?', limit: 5 });
    assert.deepEqual(errors, []);
    console.log('PASS: warning on every opening, dismissal, legacy acknowledgement ignored, top answer only, shared API request, local/Supabase response rendering, empty/error states, mobile panel layout, and full explorer regression (mocked search responses).');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
