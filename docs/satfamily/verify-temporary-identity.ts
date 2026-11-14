import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, ...(process.env.SATS_CHROMIUM_PATH ? { executablePath: process.env.SATS_CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const errors: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.SATS_QA_ORIGIN || 'http://127.0.0.1:4402/', { waitUntil: 'networkidle' });
  await page.locator('.loading-grid').waitFor({ state: 'hidden', timeout: 20000 });
  if (await page.locator('.treasury-card').isVisible()) {
    await page.getByRole('button', { name: 'Account and preview roles', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Try with a temporary Nostr identity', exact: true }).click();
  await page.getByText('Temporary Nostr identity', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create your workspace', exact: true }).click();
  const workspaceName = `GreyFinance browser check ${Date.now().toString(36)}`;
  await page.getByLabel('Company name', { exact: true }).fill(workspaceName);
  await page.getByLabel('Your name', { exact: true }).fill('Browser test owner');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.locator('.treasury-card').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'GreyFinance home', exact: true }).click();
  await page.locator('.temporary-identity-notice').waitFor();
  await page.locator('.treasury-card').waitFor();
  await page.locator('.workspace-switch').click();
  await page.getByText('You can own one company and join others.', { exact: true }).waitFor();
  if (await page.getByRole('button', { name: 'Create workspace', exact: true }).count()) throw new Error('An owner can still create another company from the workspace menu');
  await page.getByRole('button', { name: workspaceName, exact: true }).click();
  await page.locator('.treasury-card').waitFor();
  const result = await page.evaluate(async () => {
    const session = await (await fetch('/api/session')).json();
    const listing = await (await fetch('/api/satfamily/organizations')).json();
    const organization = listing.organizations[0];
    const snapshot = await (await fetch(`/api/satfamily/organizations/${organization.id}`)).json();
    return { pubkey: session.user.pubkey, demo: session.user.demo, organizationId: organization.id, organizationName: organization.name, role: snapshot.role, walletConnected: snapshot.wallet.connected, expenses: snapshot.expenses.length, localStorageKeys: Object.keys(localStorage), sessionStorageKeys: Object.keys(sessionStorage) };
  });
  if (result.demo || result.role !== 'owner' || result.walletConnected || result.organizationName !== workspaceName || result.expenses !== 0 || !/^[0-9a-f]{64}$/.test(result.pubkey) || result.localStorageKeys.length || result.sessionStorageKeys.length || errors.length) throw new Error(`Temporary identity check failed: ${JSON.stringify({ result, errors })}`);
  await mkdir(new URL('./screenshots/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL('./screenshots/greyfinance-temporary-identity-mobile.png', import.meta.url).pathname, fullPage: true });
  await writeFile(new URL('./temporary-identity-verification.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), origin: process.env.SATS_QA_ORIGIN || 'http://127.0.0.1:4402/', builderTest: true, navigationPreservesIdentity: true, additionalOwnedCompanyControl: false, companySwitchingAvailable: true, result, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, realSignedIdentity: true, realWorkspace: true, navigationPreservesIdentity: true, additionalOwnedCompanyControl: false, companySwitchingAvailable: true, walletConnected: false, browserKeyStorage: false, errors }));
  await context.close();
} finally { await browser.close(); }
