import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { courseGuide } from '../../../server/academy.ts';

// These controlled zero-state API fixtures are for layout review only.
// Real wallet verification is tested against the actual service separately.
const destination = new URL('../../../docs/satsacademy/screenshots/', import.meta.url).pathname;
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ executablePath: '/home/greyw0rks/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: Array<{ viewport: number; page: string; overflow: boolean; errors: string[] }> = [];
for (const width of [1440, 390, 360]) {
  const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 1000 : 844 }, reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === '/api/session' ? { user: { id: 'demo-learner', pubkey: '00'.repeat(32), demo: true }, demoEnabled: true }
      : pathname === '/api/academy/progress' ? { lessons: [], badges: [], exercises: [], completedCount: 0 }
      : pathname === '/api/wallet' ? { connected: false }
      : pathname === '/api/academy/guide' ? courseGuide(JSON.parse(route.request().postData() || '{}').question || 'What are sats?', 'en')
      : { error: 'This layout-only preview does not execute wallet operations.' };
    await route.fulfill({ status: pathname === '/api/wallet/connect' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('http://127.0.0.1:4403/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${destination}dashboard-${width}.png`, fullPage: true });
  checks.push({ viewport: width, page: 'dashboard', overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), errors: [...errors] });
  for (const [name, label] of [['wallet', 'Wallet lab'], ['achievements', 'Achievements'], ['guide', 'Course guide']] as const) {
    if (width < 651) await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.getByRole('navigation').getByRole('button', { name: label, exact: true }).click();
    await page.screenshot({ path: `${destination}${name}-${width}.png`, fullPage: true });
    checks.push({ viewport: width, page: name, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), errors: [...errors] });
  }
  if (width < 651) await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'My learning', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Bitcoin, in everyday words' }).click();
  await page.screenshot({ path: `${destination}lesson-${width}.png`, fullPage: true });
  checks.push({ viewport: width, page: 'lesson', overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), errors: [...errors] });
  await page.getByRole('button', { name: 'Switch to Hausa' }).click();
  await page.screenshot({ path: `${destination}hausa-lesson-${width}.png`, fullPage: true });
  checks.push({ viewport: width, page: 'hausa-lesson', overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), errors: [...errors] });
  await page.close();
}
await browser.close();
await writeFile(`${destination}layout-checks.json`, JSON.stringify({ mode: 'layout-only-zero-state-fixtures', checks }, null, 2));
console.log(JSON.stringify(checks));
if (checks.some(check => check.overflow || check.errors.length)) process.exitCode = 1;
