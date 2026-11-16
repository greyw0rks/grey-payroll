import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { courseGuide } from '../../../server/academy.ts';

// Layout-only fixtures: these checks do not authenticate real users or execute payments.
// Wallet acceptance and signed-identity security are verified separately by root.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = new URL('../../../docs/satsacademy/visual-review/' + stamp + '/', import.meta.url).pathname;
await mkdir(destination, { recursive: true });
const origin = (process.env.ACADEMY_VISUAL_URL || 'http://127.0.0.1:4403/academy').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: Array<{ viewport: number; page: string; language: string; overflow: boolean; errors: string[] }> = [];
for (const width of [1440, 1024, 390, 360]) {
  const page = await browser.newPage({ viewport: { width, height: width > 760 ? 960 : 844 }, reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let language = 'en';
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let body: unknown;
    let status = 200;
    if (pathname === '/api/session') body = { user: { id: 'layout-learner', pubkey: '00'.repeat(32), demo: false }, demoEnabled: false };
    else if (pathname === '/api/config') body = { demoEnabled: false, lightningLabReady: false, backend: 'layout-fixture' };
    else if (pathname === '/api/academy/progress') body = { lessons: [], badges: [], exercises: [], completedCount: 0 };
    else if (pathname === '/api/academy/profile') {
      if (route.request().method() === 'PATCH') language = JSON.parse(route.request().postData() || '{}').language || language;
      body = { displayName: 'Layout learner', language, onboardingComplete: true };
    } else if (pathname === '/api/academy/wallet') body = { connected: false };
    else if (pathname === '/api/academy/guide') {
      const input = JSON.parse(route.request().postData() || '{}');
      body = courseGuide(input.question || 'What are sats?', input.language || 'en');
    } else {
      status = 503;
      body = { message: 'This layout fixture does not authenticate or execute wallet operations.' };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  for (const [name, path] of [['landing', '/'], ['discover', '/app'], ['lesson', '/app/lessons/bitcoin'], ['wallet', '/app/wallet'], ['achievements', '/app/achievements'], ['guide', '/app/guide'], ['profile', '/app/profile']] as const) {
    await page.goto(origin + path, { waitUntil: 'networkidle' });
    await page.screenshot({ path: destination + name + '-' + width + '.png', fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    checks.push({ viewport: width, page: name, language: 'en', overflow, errors: [...errors] });
  }
  await page.goto(origin + '/app/lessons/lightning', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Switch to Hausa', exact: true }).click();
  await page.screenshot({ path: destination + 'hausa-lesson-' + width + '.png', fullPage: true });
  checks.push({ viewport: width, page: 'lesson', language: 'ha', overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), errors: [...errors] });
  await page.close();
}
await browser.close();
const report = { mode: 'layout-only-zero-state-fixtures', createdAt: new Date().toISOString(), url: origin, checks };
await writeFile(destination + 'verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: destination + 'verification.json', checks }));
if (checks.some(check => check.overflow || check.errors.length)) process.exitCode = 1;
