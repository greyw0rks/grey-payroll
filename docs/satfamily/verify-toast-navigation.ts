import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:4402';
const directory = join('docs/satfamily/toast-navigation', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.SATS_CHROMIUM_PATH || '/home/greyw0rks/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome', args: ['--no-sandbox'] });
const results: Record<string, unknown>[] = [];
const pageErrors: string[] = [];
const paymentRequests: string[] = [];

try {
  for (const width of [1440, 390, 360]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(`${width}: ${error.message}`));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && (/\/(pay|invoices)(\/|$)/.test(path) || path === '/api/wallet/connect')) {
        paymentRequests.push(path);
        await route.abort();
        return;
      }
      await route.continue();
    });
    const cdp = await context.newCDPSession(page);
    // This experimental Chromium command is newer than the installed typings.
    const insetEmulation = cdp as unknown as { send(method: 'Emulation.setSafeAreaInsetsOverride', parameters: { insets: { top: number; right: number; bottom: number; left: number } }): Promise<unknown> };
    try {
      await page.goto(`${origin}/app`, { waitUntil: 'domcontentloaded' });
      await page.locator('.treasury-card').waitFor();
      const nav = page.getByRole('navigation', { name: 'Workspace navigation', exact: true });
      for (const safeAreaBottom of width === 1440 ? [0] : [0, 34]) {
        await insetEmulation.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, right: 0, bottom: safeAreaBottom, left: 0 } });
        await nav.getByRole('button', { name: 'Transactions', exact: true }).click();
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
        await downloaded;
        await page.locator('.toast:not(.error-toast)').waitFor();
        await page.evaluate(() => window.scrollTo(0, 0));
        const geometry = await page.evaluate(() => {
          const toast = document.querySelector('.toast')!;
          const nav = document.querySelector('.product-navigation')!;
          const toastRect = toast.getBoundingClientRect();
          const navRect = nav.getBoundingClientRect();
          const probe = document.createElement('div');
          probe.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
          document.body.append(probe);
          const measuredSafeAreaBottom = parseFloat(getComputedStyle(probe).paddingBottom);
          probe.remove();
          const target = nav.querySelector('button[aria-label="Budgets"]')!;
          const targetRect = target.getBoundingClientRect();
          const hit = document.elementFromPoint(targetRect.x + targetRect.width / 2, targetRect.y + targetRect.height / 2);
          return {
            measuredSafeAreaBottom,
            toastBottomCss: parseFloat(getComputedStyle(toast).bottom),
            toastTop: toastRect.top,
            toastBottom: toastRect.bottom,
            navTop: navRect.top,
            navBottom: navRect.bottom,
            navPosition: getComputedStyle(nav).position,
            navTargetUnobscured: hit !== null && target.contains(hit),
            viewport: innerWidth,
            document: document.documentElement.scrollWidth,
          };
        });
        assert.equal(geometry.measuredSafeAreaBottom, safeAreaBottom, 'Chromium really emulates the safe-area inset.');
        assert(geometry.document <= geometry.viewport + 1);
        assert(geometry.navTargetUnobscured, 'The visible toast does not cover the navigation target.');
        if (width < 761) {
          assert.equal(geometry.navPosition, 'fixed');
          assert.equal(geometry.toastBottomCss, 83 + safeAreaBottom);
          assert(geometry.navTop - geometry.toastBottom >= 15.5, 'A visible phone toast stays at least 16px above the navigation, including its safe area.');
        } else {
          assert.equal(geometry.toastBottomCss, 24, 'Desktop placement is unchanged.');
          assert(geometry.toastTop >= geometry.navBottom);
        }
        await nav.getByRole('button', { name: 'Budgets', exact: true }).click({ timeout: 1500 });
        assert.equal(await nav.getByRole('button', { name: 'Budgets', exact: true }).getAttribute('aria-current'), 'page');
        await page.locator('.toast:not(.error-toast)').waitFor();
        const screenshot = join(directory, `toast-${width}-safe-area-${safeAreaBottom}.png`);
        await page.screenshot({ path: screenshot });
        results.push({ width, safeAreaBottom, ...geometry, navigationWorksWhileToastVisible: true, screenshot });
      }
    } finally {
      await page.evaluate(async () => { await fetch('/api/session/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); });
      await context.close();
    }
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(paymentRequests, []);
  writeFileSync(join(directory, 'verification.json'), `${JSON.stringify({ checkedAt: new Date().toISOString(), origin, classification: 'Builder-controlled targeted local preview check of toast placement; actual Chromium safe-area emulation, CSV downloads and navigation. No wallet connections or payments.', stylesSha256: createHash('sha256').update(readFileSync('apps/satfamily/src/styles.css')).digest('hex'), appSha256: createHash('sha256').update(readFileSync('apps/satfamily/src/App.tsx')).digest('hex'), results, pageErrors, paymentRequests, passed: true }, null, 2)}\n`);
  console.log(`Toast/nav checks passed at 1440, 390 and 360px, including real 34px safe-area emulation: ${directory}/verification.json`);
} finally { await browser.close(); }
