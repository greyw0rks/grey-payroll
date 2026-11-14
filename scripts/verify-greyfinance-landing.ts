import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const origin = (process.argv[2] || 'http://127.0.0.1:4402').replace(/\/$/, '');
const label = process.argv[3] || 'local';
const browser = await chromium.launch({ headless: true, executablePath: process.env.SATS_CHROMIUM_PATH || '/home/greyw0rks/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome', args: ['--no-sandbox'] });
const results: unknown[] = [];
mkdirSync('docs/satfamily/screenshots', { recursive: true });
try {
  for (const width of [1440, 1024, 390, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors: string[] = [];
    const paymentRequests: string[] = [];
    const initialApiRequests: string[] = [];
    let landingOnly = true;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/') && landingOnly) initialApiRequests.push(new URL(request.url()).pathname); if (/\/api\/.*(?:\/pay|\/invoices)(?:\?|$)/.test(request.url()) && request.method() === 'POST') paymentRequests.push(new URL(request.url()).pathname); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    assert.match(await page.locator('h1').innerText(), /Good work\.\s*Clear spending\./);
    assert.deepEqual(initialApiRequests, [], 'The public landing page must not authenticate or contact a wallet automatically.');
    const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth, heading: document.querySelector('h1')!.getBoundingClientRect().width }));
    assert(sizes.page <= sizes.viewport + 1, `${width}px landing has no horizontal overflow.`);
    await page.screenshot({ path: `docs/satfamily/screenshots/greyfinance-landing-${label}-${width}.png`, fullPage: true });
    const reviewStep = page.getByRole('button', { name: /Give the go-ahead/ });
    await reviewStep.click();
    assert.equal(await reviewStep.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByText('Approved to pay', { exact: true }).count(), 1);
    const receiptStep = page.getByRole('button', { name: /Know it arrived/ });
    await receiptStep.focus(); await page.keyboard.press('Enter');
    assert.equal(await receiptStep.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByText('Recorded payment', { exact: true }).count(), 1);
    await page.locator('summary').filter({ hasText: 'Who controls the company wallet?' }).click();
    assert(await page.locator('details').filter({ hasText: 'Who controls the company wallet?' }).getAttribute('open') !== null);
    if (width <= 1100) {
      await page.getByRole('button', { name: 'Open product menu', exact: true }).click();
      await page.getByRole('navigation', { name: 'Mobile product navigation' }).getByRole('link', { name: 'FAQs', exact: true }).click();
      assert.equal(await page.locator('#landing-mobile-menu').count(), 0);
    }
    await page.getByRole('navigation', { name: 'Footer', exact: true }).getByRole('link', { name: 'Privacy', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, '/privacy');
    assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'Your data, clearly explained.');
    assert.equal(await page.getByRole('heading', { name: 'Your controls', exact: true }).count(), 1);
    landingOnly = false;
    await page.getByRole('link', { name: 'Open workspace', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, '/app');
    await page.locator('.loading-grid').waitFor({ state: 'hidden', timeout: 20000 });
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Workspace navigation' }).count(), 1);
    await page.getByRole('button', { name: 'GreyFinance home', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, '/');
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.goBack();
    assert.equal(new URL(page.url()).pathname, '/app');
    await page.getByRole('navigation', { name: 'Workspace navigation' }).waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(paymentRequests, [], 'Marketing navigation and receipt illustration must never execute a payment.');
    results.push({ width, sizes, stepSelection: true, keyboardStepSelection: true, faq: true, mobileMenu: width <= 1100, privacyRoute: true, workspaceRoute: true, homeAndBack: true, unexpectedPaymentRequests: 0, errors });
    await context.close();
  }
  writeFileSync(`docs/evidence/greyfinance-landing-${label}.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), origin, classification: 'Builder-controlled UI verification', results }, null, 2)}\n`);
  console.log(`GreyFinance landing passed at 1440, 1024, 390 and 360px: interactive workflow, FAQs, mobile menu, privacy, workspace routing and browser back. No payment calls or page errors.`);
} finally { await browser.close(); }
