import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Page } from '@playwright/test';

// Real local builder tests use fresh signed identities and the running API.
// The two deliberate failure injections are separately identified in the report.
// No wallet is connected, no payment is sent, and no public relay is used.
const origin = (process.env.ACADEMY_UI_URL || 'http://127.0.0.1:4403').replace(/\/$/, '');
const target = new URL(origin);
assert(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Run this write-capable builder test against an isolated local API.');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = fileURLToPath(new URL(`../docs/satsacademy/visual-review/${stamp}/`, import.meta.url));
await mkdir(directory, { recursive: true });
const checks: Array<Record<string, unknown>> = [];
const captures: string[] = [];
const pageErrors: string[] = [];
const apiOrigins = new Set<string>();
const failedFonts: string[] = [];
let guideRequests = 0;
let fatalError: string | null = null;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 360, height: 844 }, reducedMotion: 'reduce' });
page.on('pageerror', error => pageErrors.push(error.message));
page.on('request', request => {
  const url = new URL(request.url());
  if (url.pathname.startsWith('/api/')) apiOrigins.add(url.origin);
  if (url.pathname === '/api/academy/guide') guideRequests++;
});
page.on('requestfailed', request => { if (/\.woff2?(?:\?|$)/.test(request.url())) failedFonts.push(request.url()); });

function check(name: string, passed: boolean, details: Record<string, unknown> = {}, mode = 'actual-builder-test') {
  const value = { name, mode, passed, ...details };
  checks.push(value);
  console.log(JSON.stringify(value));
  assert(passed, name);
}
async function dismissToast() {
  const button = page.getByRole('button', { name: 'Dismiss notification', exact: true });
  if (await button.count()) await button.click();
}
async function capture(name: string) {
  await dismissToast();
  await page.screenshot({ path: `${directory}${name}.png`, fullPage: true });
  captures.push(`${name}.png`);
}
async function waitForSession(workingPage: Page = page) {
  await expect(workingPage.locator('.workspace-status')).not.toContainText('Opening your learning space', { timeout: 25000 });
}
async function selectQuizAnswers() {
  await page.locator('.lesson-stepper button').nth(3).click();
  for (const [index, choice] of [2, 0, 1].entries()) {
    await page.locator('.quiz-question').nth(index).locator('input').nth(choice).check();
  }
}
async function fontsLoaded() {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return {
      families: [...new Set(Array.from(document.fonts).filter(face => face.status === 'loaded').map(face => face.family))],
      body: getComputedStyle(document.body).fontFamily,
      heading: getComputedStyle(document.querySelector('h1')!).fontFamily,
      resources: performance.getEntriesByType('resource').filter(entry => /\.woff2?(?:\?|$)/.test(entry.name)).length,
    };
  });
}
try {
  await page.goto(`${origin}/app/lessons/bitcoin`, { waitUntil: 'networkidle' });
  await waitForSession();
  const initialSectionTitle = await page.locator('#lesson-section-title').innerText();
  await page.locator('.lesson-reader .reader-controls').getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.locator('#lesson-section-title')).toBeFocused();
  const heading = await page.locator('#lesson-section-title').evaluate(element => ({ top: element.getBoundingClientRect().top, text: element.textContent, viewport: innerHeight }));
  check('lesson-next-step-scroll-and-focus', heading.top >= 0 && heading.top < heading.viewport, { heading });
  await page.locator('.lesson-reader .reader-controls').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('#lesson-section-title')).toBeFocused();
  check('lesson-back-restores-section-focus', await page.locator('#lesson-section-title').innerText() === initialSectionTitle);
  await selectQuizAnswers();
  await page.getByRole('button', { name: 'Sign in & check answers', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByText('Set up Connect for this website', { exact: true }).click();
  const install = page.getByRole('link', { name: 'Install Connect on desktop Chrome, Brave, or Edge.', exact: true });
  check('connect-install-and-website-access-guidance', await install.getAttribute('href') === 'https://connect-wallet-vert.vercel.app/#install' && await page.getByRole('dialog').innerText().then(text => text.includes('Connections → Enable for current website')));
  let focusEscaped = false;
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press('Tab');
    if (!await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)))) focusEscaped = true;
  }
  check('modal-keyboard-containment', !focusEscaped, { backgroundInert: await page.locator('.page-shell').getAttribute('inert') !== null });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in & check answers', exact: true })).toBeFocused();
  check('escape-restores-trigger-focus', true);
  await page.getByRole('button', { name: 'Sign in & check answers', exact: true }).click();
  await page.getByRole('button', { name: 'Try a temporary identity', exact: true }).click();
  await page.getByRole('heading', { name: 'Make yourself at home.', exact: true }).waitFor({ timeout: 25000 });
  await expect(page.locator('#onboarding-name')).toBeFocused();
  check('account-to-onboarding-focus', true, { focusedId: 'onboarding-name' });
  await page.locator('#onboarding-name').fill('QA learner');
  await page.getByRole('button', { name: 'Make it my learning space', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.quest-card').first().click();
  await selectQuizAnswers();
  await page.getByRole('button', { name: 'Check my answers', exact: true }).click();
  await page.getByText('You’ve got it. Quest complete.', { exact: true }).waitFor({ timeout: 25000 });
  await expect(page.locator('.status-progress')).toContainText('1/3');
  check('real-signed-identity-quiz-completion', true);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.status-progress')).toContainText('1/3', { timeout: 25000 });
  await expect(page.locator('.identity-notice')).toContainText('Reloading lost your temporary signing key.');
  const temporaryMetadata = await page.evaluate(() => sessionStorage.getItem('satsacademy-temporary-identity'));
  check('progress-and-temporary-disclosure-survive-reload', Boolean(temporaryMetadata && /^[a-f0-9]{64}$/.test(temporaryMetadata)), { completedLessons: 1, metadata: 'public key only', lostSigningKeyWarning: true });
  await page.locator('.phone-nav').getByRole('button', { name: 'Badges', exact: true }).click();
  check('knowledge-check-never-awards-wallet-badge', await page.locator('.achievement-card.earned').count() === 1 && await page.locator('.badge-3.earned').count() === 0, { knowledgeBadges: 1, practicalBadge: false });
  await page.goBack();
  await expect(page.locator('.lesson-reader')).toBeVisible();
  check('browser-history-restores-lesson', new URL(page.url()).pathname.endsWith('/app/lessons/bitcoin'));

  await page.locator('.phone-nav').getByRole('button', { name: 'You', exact: true }).click();
  await page.locator('#profile-name').fill('W'.repeat(60));
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByText('Learning preferences saved.', { exact: true }).waitFor();
  for (const width of [360, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: width > 760 ? 960 : 844 });
    await page.goto(`${origin}/app`, { waitUntil: 'networkidle' });
    await expect(page.locator('.page-heading h1')).toContainText('W'.repeat(60), { timeout: 25000 });
    const sizes = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    check(`valid-60-character-name-wraps-${width}`, sizes.scrollWidth <= sizes.viewport, sizes);
  }
  await page.goto(`${origin}/app/profile`, { waitUntil: 'networkidle' });
  await waitForSession();
  await expect(page.locator('#profile-name')).toHaveValue('W'.repeat(60), { timeout: 25000 });
  await page.locator('#profile-name').fill('QA learner');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByText('Learning preferences saved.', { exact: true }).waitFor();

  for (const width of [360, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: width > 760 ? 960 : 844 });
    for (const [name, path] of [['landing', '/'], ['discover', '/app'], ['lesson', '/app/lessons/bitcoin'], ['wallet', '/app/wallet'], ['achievements', '/app/achievements'], ['guide', '/app/guide'], ['profile', '/app/profile']] as const) {
      await page.goto(origin + path, { waitUntil: 'networkidle' });
      if (name !== 'landing') await waitForSession();
      const layout = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, sidebar: Boolean(document.querySelector('.sidebar, .app-sidebar, nav[class*="sidebar"], aside nav')) }));
      check(`responsive-${name}-${width}`, layout.scrollWidth <= layout.viewport && !layout.sidebar, layout);
      const shouldCapture = width === 360 && ['discover', 'lesson', 'wallet'].includes(name) || width === 390 && ['achievements', 'profile'].includes(name) || width === 1440 && ['landing', 'discover'].includes(name);
      if (shouldCapture) await capture(`${name}-${width}`);
    }
    const fonts = await fontsLoaded();
    check(`local-fonts-loaded-${width}`, fonts.families.some(family => family.includes('Manrope')) && fonts.families.some(family => family.includes('Space Grotesk')) && fonts.body.includes('Manrope') && fonts.heading.includes('Space Grotesk') && fonts.resources > 0, fonts);
  }

  // The production academy path shares the API origin and preserves navigation.
  if (target.pathname === '/' || target.pathname === '') {
    await page.goto(`${origin}/academy/app/lessons/bitcoin`, { waitUntil: 'networkidle' });
    await waitForSession();
    await page.getByRole('button', { name: 'Back to your quests', exact: true }).click();
    check('academy-prefix-keeps-navigation-and-api-origin', new URL(page.url()).pathname === '/academy/app');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/app/lessons/lightning`, { waitUntil: 'networkidle' });
  await waitForSession();
  await page.getByRole('button', { name: 'Switch to Hausa', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ha');
  check('hausa-lesson-fits-390', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { translation: 'initial draft; native-speaker review pending' });
  await capture('hausa-lesson-390');
  await page.getByRole('button', { name: 'Canja zuwa English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto(`${origin}/app/guide`, { waitUntil: 'networkidle' });
  await waitForSession();
  await page.locator('#guide-question').fill('Why is my invoice still pending?');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await page.locator('.guide-message.guide').waitFor();
  check('real-course-guide-is-honestly-labeled', await page.locator('.guide-source').innerText().then(text => text.includes('not AI generated')));
  const requestsBefore = guideRequests;
  await page.locator('#guide-question').fill('nostr+walletconnect://training-example');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  check('synthetic-credential-blocked-before-request', guideRequests === requestsBefore && await page.locator('#guide-question').inputValue() === '', { additionalRequests: guideRequests - requestsBefore });

  await page.route('**/api/academy/guide', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Controlled network recovery check.' }) }));
  await page.locator('#guide-question').fill('Which wallet permissions do I need?');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await page.getByText('Controlled network recovery check.', { exact: true }).waitFor();
  await expect(page.locator('#guide-question')).toBeEnabled();
  check('guide-network-error-recovers-composer', true, {}, 'simulated-network-failure');
  await page.unroute('**/api/academy/guide');
  await page.locator('#guide-question').fill('Which wallet permissions do I need?');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(page.locator('.guide-message.guide')).toHaveCount(2);
  check('guide-retry-reaches-real-service', true);

  await page.route('**/api/session', route => route.abort('connectionfailed'));
  await page.goto(`${origin}/app`, { waitUntil: 'networkidle' });
  await expect(page.locator('.workspace-status')).toContainText('service unavailable', { timeout: 25000 });
  check('failed-session-keeps-lessons-readable', await page.locator('.quest-card').count() === 3, {}, 'simulated-network-failure');
  await page.unroute('**/api/session');
  await page.locator('.error-notice').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.status-progress')).toContainText('1/3', { timeout: 25000 });
  await expect(page.locator('.identity-notice')).toContainText('Reloading lost your temporary signing key.');
  check('service-retry-restores-saved-learning', true);
  check('same-origin-api-and-working-font-requests', [...apiOrigins].every(value => value === target.origin) && failedFonts.length === 0, { apiOrigins: [...apiOrigins], failedFontRequests: failedFonts.length });
  check('no-unhandled-browser-errors', pageErrors.length === 0, { pageErrors });

  // End the builder session without deleting its honest, local learning records.
  await page.goto(`${origin}/app/profile`, { waitUntil: 'networkidle' });
  await waitForSession();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('.workspace-status')).toContainText('Explore freely');
  check('sign-out-clears-temporary-metadata', await page.evaluate(() => sessionStorage.getItem('satsacademy-temporary-identity')) === null);
} catch (error) {
  fatalError = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
  console.error(fatalError);
} finally {
  await writeFile(`${directory}verification.json`, JSON.stringify({
    mode: 'actual-builder-test',
    createdAt: new Date().toISOString(),
    origin,
    notes: ['Fresh temporary Nostr identity and real local API; builder-controlled QA, not independent adoption.', 'Two explicitly labeled API failure injections test recovery.', 'No wallet connection or payment, no mainnet evidence, and no public-relay publishing.'],
    passed: fatalError === null && checks.every(value => value.passed === true),
    checks,
    captures,
    pageErrors,
    fatalError,
  }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ report: `${directory}verification.json`, checks: checks.length, captures: captures.length, passed: fatalError === null }));
}
