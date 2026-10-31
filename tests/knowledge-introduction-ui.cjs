const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
const key = 'cliniq:knowledge-introduction:v1';
const expected = fs.readFileSync('files_needed_for_rag.txt', 'utf8').split(/\r?\n/).flatMap(line => {
  const match = line.match(/^(.*?)\s*:\s*(https?:\/\/\S+)\s*$/);
  return match ? [{ title: match[1].replace(/^\d+\.\s*/, '').trim().replace(/-/g, ' '), url: new URL(match[2]).href }] : [];
});

(async () => {
  fs.mkdirSync('test-results', { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    let searches = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/knowledge-assistant/search')) searches++; });
    await page.addInitScript(() => localStorage.setItem('cliniq:welcome:v1', JSON.stringify({ name: 'Test', completed: true })));
    await page.route('**/api/knowledge-assistant/health', route => route.fulfill({ status: 503, body: '{}' }));
    const heading = page.getByRole('heading', { name: /Search diabetes/ });
    const intro = page.getByRole('dialog', { name: /Search diabetes/ });
    await page.goto(`${base}/knowledge-assistant`);
    await page.getByRole('status', { name: 'Loading ClinIQ' }).waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await heading.waitFor();
    assert(await heading.evaluate(el => el === document.activeElement));
    assert.match(await intro.innerText(), /Knowledge Explorer retrieves answers from the ADA and RSSDI PDF documents/);
    assert.equal(await page.getByRole('heading', { name: 'Welcome to Knowledge Assistant' }).count(), 0);
    await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running'));
    await page.screenshot({ path: 'test-results/knowledge-introduction-desktop.png' });
    await intro.locator('summary').click();
    assert.equal(await intro.getByRole('link').count(), expected.length);
    for (const source of expected) {
      const link = intro.getByRole('link').filter({ hasText: source.title });
      assert.equal(await link.getAttribute('href'), source.url);
      assert.equal(await link.getAttribute('target'), '_blank');
    }
    assert.equal(await page.evaluate(k => localStorage.getItem(k), key), null);
    await page.reload();
    await heading.waitFor();
    await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome to Knowledge Assistant' }).waitFor();
    assert.equal(await page.evaluate(k => localStorage.getItem(k), key), 'completed');
    await page.getByRole('button', { name: 'Skip tour', exact: true }).first().click();
    await page.reload();
    await page.getByRole('status', { name: 'Loading ClinIQ' }).waitFor({ state: 'hidden' });
    assert.equal(await heading.count(), 0);
    assert.equal(await page.getByRole('dialog').count(), 0);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.addInitScript(() => {
      localStorage.setItem('cliniq:welcome:v1', JSON.stringify({ name: 'Test', completed: true }));
      localStorage.setItem('cliniq:knowledge-assistant-tour:v1', 'seen');
    });
    await mobile.route('**/api/knowledge-assistant/health', route => route.fulfill({ status: 503, body: '{}' }));
    await mobile.goto(`${base}/knowledge-assistant`);
    const mobileIntro = mobile.getByRole('dialog', { name: /Search diabetes/ });
    await mobileIntro.waitFor();
    await mobile.screenshot({ path: 'test-results/knowledge-introduction-mobile.png' });
    await mobileIntro.locator('summary').click();
    assert(await mobileIntro.evaluate(el => el.scrollWidth <= el.clientWidth), 'Expanded sources fit mobile viewport');
    assert(await mobileIntro.evaluate(el => getComputedStyle(el).animationName === 'none'));
    await mobile.getByRole('button', { name: 'Start exploring', exact: true }).click();
    await mobileIntro.waitFor({ state: 'hidden' });
    assert.equal(await mobile.getByRole('dialog').count(), 0, 'Completed tour is not relaunched');
    assert.equal(searches, 0, 'Introduction never submits a search');
    assert.deepEqual(errors, []);
    console.log(`PASS: first-visit introduction, loader order, all ${expected.length} manifest titles/links, unfinished reload, persistence, tour sequencing, completed-tour isolation, mobile sources and reduced motion.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
