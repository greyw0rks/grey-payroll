import assert from 'node:assert/strict';
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const origin = 'http://127.0.0.1:4402';
const browser = await chromium.launch({ headless: true, executablePath: process.env.SATS_CHROMIUM_PATH || '/home/greyw0rks/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome', args: ['--no-sandbox'] });
const results: Record<string, unknown>[] = [];
const errors: string[] = [];
const payments: string[] = [];
mkdirSync('docs/satfamily/screenshots', { recursive: true });

function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function verifyObsoleteInitialization(page: Page) {
  const firstHeld = deferred(); const releaseFirst = deferred();
  let sessionReads = 0; let previewPosts = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/demo/session' && request.method() === 'POST') previewPosts++; });
  await page.route(`${origin}/api/session`, async route => {
    if (++sessionReads !== 1) { await route.continue(); return; }
    firstHeld.release();
    await releaseFirst.promise;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, demoEnabled: true }) });
  });
  try {
    await page.goto(`${origin}/app`, { waitUntil: 'domcontentloaded' });
    await firstHeld.promise;
    await page.getByRole('button', { name: 'GreyFinance home', exact: true }).click();
    await page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Open workspace', exact: true }).click();
    await page.locator('.treasury-card').waitFor();
    await signOut(page);
    const postsBeforeRelease = previewPosts;
    releaseFirst.release();
    await page.waitForLoadState('networkidle');
    assert.equal(previewPosts, postsBeforeRelease, 'An obsolete initial session response cannot start another preview sign-in.');
    assert.equal(await page.locator('.treasury-card').count(), 0);
    assert.equal(await page.evaluate(async () => (await (await fetch('/api/session')).json()).user), null);
  } finally { releaseFirst.release(); await page.unroute(`${origin}/api/session`); }
}
async function goSettings(page: Page) { await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Settings', exact: true }).click(); }
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account and preview roles', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Try with a temporary Nostr identity', exact: true }).waitFor();
}
async function createCompany(page: Page, name: string) {
  await page.goto(`${origin}/app`, { waitUntil: 'networkidle' });
  await page.locator('.loading-grid').waitFor({ state: 'hidden' });
  await page.locator('.treasury-card').waitFor();
  await signOut(page);
  await page.getByRole('button', { name: 'Try with a temporary Nostr identity', exact: true }).click();
  await page.getByRole('button', { name: 'Create your workspace', exact: true }).click();
  await page.getByLabel('Company name', { exact: true }).fill(name);
  await page.getByLabel('Your name', { exact: true }).fill('Local deletion test owner');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.locator('.treasury-card').waitFor();
  return page.evaluate(async () => {
    const session = await (await fetch('/api/session')).json();
    const list = await (await fetch('/api/satfamily/organizations')).json();
    const item = list.organizations[0];
    const snapshot = await (await fetch(`/api/satfamily/organizations/${item.id}`)).json();
    if (session.user.demo || snapshot.preview || snapshot.role !== 'owner' || snapshot.wallet.connected) throw new Error('A disposable non-preview owner company without a wallet is required.');
    return { pubkey: session.user.pubkey as string, id: item.id as string, name: item.name as string };
  });
}
async function cleanupCompany(page: Page, company?: { id: string; name: string }) {
  if (!company) return;
  await page.evaluate(async ({ id, name }) => {
    const url = `/api/satfamily/organizations/${id}`;
    const response = await fetch(url);
    if (response.status === 404 || response.status === 403) return;
    if (!response.ok) throw new Error('Could not verify disposable-company cleanup.');
    const snapshot = await response.json();
    if (snapshot.role !== 'owner' || snapshot.preview || snapshot.organization.name !== name || !name.startsWith('GreyFinance deletion QA ')) throw new Error('Cleanup refused for a non-disposable company.');
    const deleted = await fetch(url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: name }) });
    if (!deleted.ok) throw new Error('Disposable company cleanup failed.');
  }, company);
}

try {
  for (const width of [1440, 390, 360]) {
    const context = await browser.newContext({ viewport: { width, height: width > 1000 ? 1000 : 844 }, reducedMotion: 'reduce' });
    const peerContext = await browser.newContext({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); const peerPage = await peerContext.newPage();
    for (const current of [page, peerPage]) {
      current.on('pageerror', error => errors.push(`${width}: ${error.message}`));
      current.on('request', request => { if (request.method() === 'POST' && /\/(pay|invoices)(\/|$)/.test(new URL(request.url()).pathname)) payments.push(new URL(request.url()).pathname); });
    }
    const resumeDeletion = deferred();
    let company: { id: string; name: string; pubkey: string } | undefined;
    let peerCompany: { id: string; name: string; pubkey: string } | undefined;
    const suffix = Date.now().toString(36);
    try {
      if (width === 1440) {
        await verifyObsoleteInitialization(page);
        await page.goto(`${origin}/app`, { waitUntil: 'networkidle' });
        await page.locator('.treasury-card').waitFor();
        await goSettings(page);
        assert.equal(await page.getByRole('button', { name: 'Delete company', exact: true }).count(), 0, 'Preview owners do not see deletion.');
        for (const role of ['Finance', 'Employee']) {
          await page.getByRole('button', { name: 'Account and preview roles', exact: true }).click();
          await page.getByRole('button', { name: role, exact: true }).click();
          await page.getByText(`Previewing ${role} access`, { exact: true }).waitFor();
          await goSettings(page);
          assert.equal(await page.getByRole('button', { name: 'Delete company', exact: true }).count(), 0, `${role} cannot see deletion.`);
        }
      }
      const name = `GreyFinance deletion QA ${width} ${suffix}${width === 360 ? ' long company name for a narrow phone screen' : ''}`.slice(0, 80);
      company = await createCompany(page, name);
      if (width < 1000) {
        peerCompany = await createCompany(peerPage, `GreyFinance deletion QA peer ${width} ${suffix}`);
        await peerPage.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Team', exact: true }).click();
        await peerPage.getByRole('button', { name: 'Add member', exact: true }).click();
        await peerPage.getByLabel('Team member name', { exact: true }).fill('Local viewer test member');
        await peerPage.getByLabel('Nostr public key', { exact: true }).fill(company.pubkey);
        await peerPage.getByLabel('Workspace role').selectOption('viewer');
        await peerPage.getByRole('button', { name: 'Add member access', exact: true }).click();
        await peerPage.getByRole('dialog').waitFor({ state: 'hidden' });
      }
      await goSettings(page);
      const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      assert(size.document <= size.viewport + 1, `${width}px Settings has no horizontal overflow.`);
      await page.getByRole('button', { name: 'Delete company', exact: true }).click();
      let dialog = page.getByRole('dialog');
      const submit = () => dialog.getByRole('button', { name: 'Permanently delete company', exact: true });
      assert(await submit().isDisabled());
      await page.getByLabel('Confirm company name', { exact: true }).fill(name.toLowerCase());
      assert(await submit().isDisabled(), 'Confirmation must match case and the complete current company name.');
      await page.getByLabel('Confirm company name', { exact: true }).fill(name);
      assert(await submit().isEnabled());
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press('Tab');
        assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Keyboard focus stays in the deletion dialog.');
      }
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Delete company', exact: true }).click();
      dialog = page.getByRole('dialog');
      assert.equal(await page.getByLabel('Confirm company name', { exact: true }).inputValue(), '');
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Export ledger', exact: true }).click();
      assert.equal((await download).suggestedFilename(), 'greyfinance-ledger.csv');
      await dialog.getByText('Ledger download started.', { exact: true }).waitFor();
      assert.equal(await page.locator('.toast').count(), 0, 'Export feedback stays inside the dialog and cannot cover phone actions.');
      let attempts = 0;
      const target = `${origin}/api/satfamily/organizations/${company.id}`;
      await page.route(target, async route => {
        if (route.request().method() !== 'DELETE') { await route.continue(); return; }
        attempts++;
        if (attempts === 1) {
          await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'PAYMENTS_UNRESOLVED', message: 'A payment result is uncertain. Check the payment before deleting this company.' }) });
          return;
        }
        await resumeDeletion.promise;
        await route.continue();
      });
      await page.getByLabel('Confirm company name', { exact: true }).fill(name);
      await submit().click();
      await dialog.locator('#delete-company-error').waitFor();
      assert.equal(await page.getByLabel('Confirm company name', { exact: true }).inputValue(), name);
      assert(await submit().isEnabled());
      assert.equal(attempts, 1);
      const dialogSize = await dialog.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
      assert(dialogSize.content <= dialogSize.width + 1, `${width}px deletion dialog has no horizontal overflow.`);
      await dialog.screenshot({ path: `docs/satfamily/screenshots/greyfinance-delete-dialog-${width}.png` });
      await submit().click();
      await dialog.getByRole('button', { name: 'Deleting company…', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await dialog.count(), 1, 'An in-progress deletion cannot be dismissed.');
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
      assert.equal(await dialog.count(), 1);
      assert(await dialog.getByRole('button', { name: 'Keep company', exact: true }).isDisabled());
      resumeDeletion.release();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByText('Company deleted. Your wallet funds remain with your wallet provider.', { exact: true }).waitFor();
      const retained = await page.evaluate(async () => {
        const session = await (await fetch('/api/session')).json();
        const list = await (await fetch('/api/satfamily/organizations')).json();
        return { pubkey: session.user.pubkey, demo: session.user.demo, organizations: list.organizations.map((org: { id: string; role: string }) => ({ id: org.id, role: org.role })), storageKeys: [...Object.keys(localStorage), ...Object.keys(sessionStorage)] };
      });
      assert.equal(retained.pubkey, company.pubkey); assert.equal(retained.demo, false); assert.deepEqual(retained.storageKeys, []);
      assert(!retained.organizations.some((org: { id: string }) => org.id === company!.id));
      await page.getByText('Temporary Nostr identity', { exact: true }).waitFor();
      if (peerCompany) {
        await page.locator('.workspace-name').filter({ hasText: peerCompany.name }).waitFor();
        assert.equal(retained.organizations[0].id, peerCompany.id);
        await goSettings(page);
        assert.equal(await page.getByRole('button', { name: 'Delete company', exact: true }).count(), 0, 'Remaining Viewer membership cannot delete its company.');
      } else {
        await page.getByRole('button', { name: 'Create your workspace', exact: true }).waitFor();
        assert.equal(retained.organizations.length, 0);
      }
      results.push({ width, settingsNoOverflow: true, dialogNoOverflow: true, exactNameRequired: true, exportWorks: true, cancelSendsNoDeletion: true, synthetic409PreservesInputAndCompany: true, busyDismissBlocked: true, disposableLocalCompanyDeleted: true, identityPreserved: true, noBrowserKeyStorage: true, remainingMembershipSelected: Boolean(peerCompany), viewerDeletionHidden: Boolean(peerCompany), createCompanyState: !peerCompany, attempts });
      console.log(`${width}px deletion flow passed.`);
      await page.unroute(target);
    } finally {
      resumeDeletion.release();
      await page.unrouteAll({ behavior: 'wait' });
      await cleanupCompany(page, company);
      await cleanupCompany(peerPage, peerCompany);
      for (const current of [page, peerPage]) if (new URL(current.url()).origin === origin) await current.evaluate(async () => { await fetch('/api/session/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); });
      await context.close(); await peerContext.close();
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(payments, []);
  writeFileSync('docs/satfamily/deletion-ui-verification.json', `${JSON.stringify({ checkedAt: new Date().toISOString(), origin, classification: 'Builder-controlled local UI verification; disposable companies, no wallet connections or payments. The 409 and obsolete initial-session responses are explicit browser fixtures.', obsoleteInitializationCannotRestorePreview: true, previewFinanceEmployeeDeletionHidden: true, results, errors, paymentCalls: payments.length }, null, 2)}\n`);
  console.log('GreyFinance deletion UI passed at 1440, 390 and 360px. Exact confirmation, export, rejection recovery, busy guards, real local deletion and identity/membership retention verified. No payments.');
} finally { await browser.close(); }
