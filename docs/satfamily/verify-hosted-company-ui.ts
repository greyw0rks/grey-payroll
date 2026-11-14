import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page, type Request } from '@playwright/test';
import { verifyEvent, type Event } from 'nostr-tools';

// Builder-controlled acceptance of the published company UI. No wallet,
// invoice, expense, or payment mutation is permitted by this harness.
// Run from the repository root: pnpm exec tsx docs/satfamily/verify-hosted-company-ui.ts
// Optional release metadata: GREY_RELEASE_COMMIT and GREY_PRODUCTION_DEPLOYMENT.
const origin = 'https://grey-finance.vercel.app';
const releaseCommit = process.env.GREY_RELEASE_COMMIT?.trim() || null;
const productionDeployment = process.env.GREY_PRODUCTION_DEPLOYMENT?.trim() || null;
if (releaseCommit) assert(/^[a-f0-9]{40}$/.test(releaseCommit), 'GREY_RELEASE_COMMIT must be the full release commit SHA.');
if (productionDeployment) assert(/^dpl_[A-Za-z0-9]+$/.test(productionDeployment), 'GREY_PRODUCTION_DEPLOYMENT must be a Vercel deployment ID.');
const startedAt = new Date().toISOString();
const stamp = startedAt.replace(/[:.]/g, '-');
const evidenceDirectory = join('docs/satfamily/hosted-acceptance', `grey-finance.vercel.app-${stamp}`);
mkdirSync(evidenceDirectory, { recursive: true });
const results: Record<string, unknown>[] = [];
const pageErrors: string[] = [];
const forbiddenRequests: { method: string; path: string }[] = [];
const cleanupErrors: string[] = [];
const authChecks: Record<string, unknown>[] = [];
const pendingChecks: Promise<void>[] = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.SATS_CHROMIUM_PATH || '/home/greyw0rks/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome',
  args: ['--no-sandbox'],
});

type Company = { id: string; name: string; pubkey: string };
type Session = { user: null | { id: string; pubkey: string; demo: boolean }; demoEnabled: boolean };
type CompanyList = { organizations: { id: string; name: string; role: string }[] };

async function json<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async route => {
    const response = await fetch(route, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`GET ${route}: HTTP ${response.status}`);
    return response.json();
  }, path);
}

async function verifyAuthentication(request: Request, width: number) {
  const headers = await request.allHeaders();
  assert(headers.authorization?.startsWith('Nostr '), 'The public UI sends a signed NIP-98 login event.');
  const event = JSON.parse(Buffer.from(headers.authorization.slice(6), 'base64').toString('utf8')) as Event;
  const tag = (name: string) => event.tags.filter(item => item[0] === name);
  assert(verifyEvent(event), 'The temporary identity signs a cryptographically valid Nostr event.');
  assert.equal(event.kind, 27235);
  assert.equal(event.content, '');
  assert.equal(tag('u').length, 1);
  assert.equal(tag('u')[0][1], `${origin}/api/auth/nostr`);
  assert.equal(tag('method').length, 1);
  assert.equal(tag('method')[0][1], 'POST');
  assert.equal(tag('payload').length, 1);
  assert.equal(tag('payload')[0][1], createHash('sha256').update(request.postData() || '').digest('hex'));
  assert(Math.abs(event.created_at - Math.floor(Date.now() / 1000)) <= 60);
  authChecks.push({ width, signedNip98: true, signatureVerified: true, canonicalOriginBound: true, methodBound: true, payloadBound: true, recentEvent: true });
  // Do not persist authorization headers, signed events, public keys, or cookies.
}

async function instrument(context: BrowserContext, width: number) {
  await context.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method());
    if (mutation && (path.startsWith('/api/wallet') || /\/(invoices|expenses)(\/|$)/.test(path) || /\/(pay|reconcile)(\/|$)/.test(path))) {
      forbiddenRequests.push({ method: request.method(), path });
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"This UI acceptance run forbids wallet, invoice, expense and payment mutations."}' });
      return;
    }
    await route.continue();
  });
  context.on('page', page => {
    page.on('pageerror', error => pageErrors.push(`${width}px: ${error.name}: ${error.message}`));
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/nostr') {
        pendingChecks.push(verifyAuthentication(request, width));
      }
    });
  });
}

async function noOverflow(page: Page, width: number, stage: string) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert.equal(size.viewport, width);
  assert(size.content <= size.viewport + 1, `${width}px ${stage} has no horizontal overflow.`);
}

async function noBrowserSecretStorage(page: Page, context: BrowserContext) {
  const storage = await page.evaluate(async () => ({
    localKeys: Object.keys(localStorage),
    sessionKeys: Object.keys(sessionStorage),
    indexedDbCount: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).length : null,
    visibleCookieNames: document.cookie.split(';').map(item => item.trim().split('=')[0]).filter(Boolean),
  }));
  assert.deepEqual(storage.localKeys, []);
  assert.deepEqual(storage.sessionKeys, []);
  if (storage.indexedDbCount !== null) assert.equal(storage.indexedDbCount, 0);
  assert.deepEqual(storage.visibleCookieNames, []);
  const cookies = await context.cookies(origin);
  assert(cookies.every(cookie => cookie.name === 'sats_session'), 'The fresh context contains only the server session cookie.');
  for (const cookie of cookies) {
    assert(cookie.httpOnly && cookie.secure && cookie.sameSite === 'Lax', 'The session uses HttpOnly, Secure, SameSite=Lax.');
  }
  return { localStorageEmpty: true, sessionStorageEmpty: true, indexedDbEmpty: storage.indexedDbCount === 0, javascriptVisibleCookiesEmpty: true, secureHttpOnlySession: cookies.length === 1 };
}

async function navigationGeometry(page: Page, width: number) {
  const nav = page.getByRole('navigation', { name: 'Workspace navigation', exact: true });
  assert.equal(await page.locator('aside, .sidebar').count(), 0, 'Workspace navigation has no sidebar.');
  const geometry = await nav.evaluate(element => {
    const parent = element.closest('.product-navigation')!;
    const rect = parent.getBoundingClientRect();
    return {
      position: getComputedStyle(parent).position,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height),
      viewportHeight: innerHeight,
      buttons: [...element.querySelectorAll('button')].map(button => {
        const item = button.getBoundingClientRect();
        return { label: button.getAttribute('aria-label'), x: Math.round(item.x), y: Math.round(item.y), width: Math.round(item.width), height: Math.round(item.height) };
      }),
    };
  });
  assert.equal(geometry.buttons.length, 6);
  assert(geometry.buttons.every(button => button.width >= 44 && button.height >= 44), 'Navigation offers at least 44px touch targets.');
  assert(new Set(geometry.buttons.map(button => button.y)).size === 1, 'All workspace navigation buttons occupy one horizontal row.');
  if (width < 761) {
    assert.equal(geometry.position, 'fixed');
    assert(Math.abs(geometry.bottom - geometry.viewportHeight) <= 1, 'Phone navigation stays at the bottom of the viewport.');
  } else assert(geometry.top >= 0 && geometry.bottom < geometry.viewportHeight / 2, 'Desktop navigation sits horizontally above the workspace.');
  return geometry;
}

async function exportLedger(page: Page, button: ReturnType<Page['getByRole']>, name: string) {
  const downloadPromise = page.waitForEvent('download');
  await button.click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'greyfinance-ledger.csv');
  const filename = join(evidenceDirectory, name);
  await download.saveAs(filename);
  const csv = readFileSync(filename, 'utf8');
  assert.equal(csv.trim(), 'Date,Direction,Reference,Amount sats,Status,Sample,Settlement time,Payment preimage,Wallet connection fingerprint', 'The disposable company exports an empty ledger with the correct columns.');
  return { filename, sha256: createHash('sha256').update(csv).digest('hex'), rows: 0 };
}

async function cleanDisposableCompany(page: Page, company?: Company) {
  if (!company) return;
  await page.evaluate(async ({ id, name }) => {
    const path = `/api/satfamily/organizations/${encodeURIComponent(id)}`;
    const existing = await fetch(path);
    if (existing.status === 404 || existing.status === 403 || existing.status === 401) return;
    if (!existing.ok) throw new Error(`Disposable company lookup failed: HTTP ${existing.status}`);
    const snapshot = await existing.json();
    if (snapshot.preview || snapshot.role !== 'owner' || snapshot.wallet.connected || snapshot.organization.name !== name || !name.startsWith('GreyFinance hosted UI QA ')) throw new Error('Cleanup refused for an unexpected or wallet-connected company.');
    const deleted = await fetch(path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: name }) });
    if (!deleted.ok) throw new Error(`Disposable company cleanup failed: HTTP ${deleted.status}`);
  }, company);
}

let failure: string | undefined;
try {
  for (const width of [1440, 390, 360]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 }, reducedMotion: 'reduce', acceptDownloads: true });
    await instrument(context, width);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    let company: Company | undefined;
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Good work. Clear spending.', exact: true }).waitFor();
      assert.equal(await page.title(), 'GreyFinance · Bitcoin treasury for teams');
      const health = await json<{ ok: boolean; product: string; backend: string }>(page, '/api/health');
      assert(health.ok && health.product === 'GreyFinance' && health.backend === 'convex');
      await noOverflow(page, width, 'landing');
      await page.screenshot({ path: join(evidenceDirectory, `landing-${width}.png`) });
      await page.getByRole('navigation', { name: 'Account', exact: true }).getByRole('link', { name: 'Open workspace', exact: true }).click();
      await page.waitForURL(`${origin}/app`);
      await page.getByRole('button', { name: 'Try with a temporary Nostr identity', exact: true }).waitFor();
      assert.equal((await json<Session>(page, '/api/session')).user, null);
      assert.equal(await page.getByRole('button', { name: 'Open preview workspace', exact: true }).count(), 0);
      await noOverflow(page, width, 'signed-out workspace');
      await page.getByRole('button', { name: 'Try with a temporary Nostr identity', exact: true }).click();
      await page.getByRole('button', { name: 'Create your workspace', exact: true }).waitFor();
      await page.getByText('Temporary Nostr identity', { exact: true }).waitFor();
      const signedIn = await json<Session>(page, '/api/session');
      assert(signedIn.user && !signedIn.user.demo && !signedIn.demoEnabled, 'Hosted sign-in is genuine and is not a preview persona.');
      const initialList = await json<CompanyList>(page, '/api/satfamily/organizations');
      assert.deepEqual(initialList.organizations, [], 'A new temporary identity starts with no companies.');
      const storage = await noBrowserSecretStorage(page, context);
      assert(storage.secureHttpOnlySession);
      const name = `GreyFinance hosted UI QA ${width} ${stamp}`.slice(0, 80);
      await page.getByRole('button', { name: 'Create your workspace', exact: true }).click();
      await page.getByLabel('Company name', { exact: true }).fill(name);
      await page.getByLabel('Your name', { exact: true }).fill('Builder UI acceptance owner');
      await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
      await page.locator('.treasury-card').waitFor();
      const companyList = await json<CompanyList>(page, '/api/satfamily/organizations');
      assert.equal(companyList.organizations.length, 1);
      const current = companyList.organizations[0];
      assert.equal(current.name, name);
      company = { id: current.id, name, pubkey: signedIn.user.pubkey };
      const snapshot = await json<{ role: string; preview: boolean; wallet: { connected: boolean }; expenses: unknown[]; incoming: unknown[] }>(page, `/api/satfamily/organizations/${company.id}`);
      assert.equal(snapshot.role, 'owner');
      assert.equal(snapshot.preview, false);
      assert.equal(snapshot.wallet.connected, false);
      assert.deepEqual(snapshot.expenses, []);
      assert.deepEqual(snapshot.incoming, []);
      const navigation = await navigationGeometry(page, width);
      await noOverflow(page, width, 'company overview');
      await page.screenshot({ path: join(evidenceDirectory, `workspace-${width}.png`) });
      const nav = page.getByRole('navigation', { name: 'Workspace navigation', exact: true });
      for (const label of ['Requests', 'Transactions', 'Team', 'Budgets', 'Settings', 'Overview']) {
        const item = nav.getByRole('button', { name: label, exact: true });
        await item.click();
        assert.equal(await item.getAttribute('aria-current'), 'page');
        await noOverflow(page, width, label);
      }
      await nav.getByRole('button', { name: 'Settings', exact: true }).click();
      const settingsExport = await exportLedger(page, page.locator('.company-delete-actions').getByRole('button', { name: 'Export ledger', exact: true }), `settings-ledger-${width}.csv`);
      let exportToastNavigation: Record<string, unknown> | null = null;
      if (width < 761) {
        await page.locator('.toast:not(.error-toast)').getByText('Ledger exported', { exact: true }).waitFor();
        const geometry = await page.evaluate(() => {
          const toast = document.querySelector('.toast:not(.error-toast)')!;
          const navigation = document.querySelector('.product-navigation')!;
          const toastRect = toast.getBoundingClientRect();
          const navRect = navigation.getBoundingClientRect();
          const target = navigation.querySelector('button[aria-label="Settings"]')!;
          const targetRect = target.getBoundingClientRect();
          const hit = document.elementFromPoint(targetRect.x + targetRect.width / 2, targetRect.y + targetRect.height / 2);
          return { toastBottom: toastRect.bottom, navTop: navRect.top, gap: navRect.top - toastRect.bottom, settingsTargetUnobscured: hit !== null && target.contains(hit) };
        });
        assert(geometry.toastBottom < geometry.navTop, 'The phone export toast sits fully above the persistent navigation.');
        assert(geometry.settingsTargetUnobscured, 'The visible export toast does not obscure the Settings navigation button.');
        await nav.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 1500 });
        await page.locator('.toast:not(.error-toast)').getByText('Ledger exported', { exact: true }).waitFor();
        assert.equal(await nav.getByRole('button', { name: 'Settings', exact: true }).getAttribute('aria-current'), 'page');
        const screenshot = join(evidenceDirectory, `export-toast-${width}.png`);
        await page.screenshot({ path: screenshot });
        exportToastNavigation = { ...geometry, navigationWorksWhileToastVisible: true, screenshot };
      }
      await page.getByRole('button', { name: 'Delete company', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const submit = dialog.getByRole('button', { name: 'Permanently delete company', exact: true });
      assert(await submit.isDisabled());
      await page.getByLabel('Confirm company name', { exact: true }).fill(name.toLowerCase());
      assert(await submit.isDisabled(), 'Deletion requires an exact case-sensitive current company name.');
      await page.getByLabel('Confirm company name', { exact: true }).fill(name);
      assert(await submit.isEnabled());
      await dialog.getByRole('button', { name: 'Keep company', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal((await json<CompanyList>(page, '/api/satfamily/organizations')).organizations.length, 1, 'Cancel preserves the company.');
      await page.getByRole('button', { name: 'Delete company', exact: true }).click();
      assert.equal(await page.getByLabel('Confirm company name', { exact: true }).inputValue(), '');
      const dialogExport = await exportLedger(page, dialog.getByRole('button', { name: 'Export ledger', exact: true }), `dialog-ledger-${width}.csv`);
      await dialog.getByText('Ledger download started.', { exact: true }).waitFor();
      assert.equal(await page.locator('.toast').count(), 0, 'Export feedback cannot cover the phone deletion action.');
      await page.getByLabel('Confirm company name', { exact: true }).fill(name);
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press('Tab');
        assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Deletion dialog contains keyboard focus.');
      }
      const dimensions = await dialog.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
      assert(dimensions.content <= dimensions.width + 1, 'Deletion dialog has no horizontal overflow.');
      await noOverflow(page, width, 'deletion dialog');
      await dialog.screenshot({ path: join(evidenceDirectory, `delete-dialog-${width}.png`) });
      const deleteResponsePromise = page.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname === `/api/satfamily/organizations/${company!.id}`);
      await submit.click();
      const deletionResponse = await deleteResponsePromise;
      assert.equal(deletionResponse.status(), 200, 'The actual hosted backend deletes the disposable company.');
      const deletion = await deletionResponse.json();
      assert.equal(deletion.deleted, true);
      assert.equal(deletion.deletedOrganizationId, company.id);
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Create your workspace', exact: true }).waitFor();
      await page.getByText('Temporary Nostr identity', { exact: true }).waitFor();
      const retained = await json<Session>(page, '/api/session');
      assert.equal(retained.user?.pubkey, company.pubkey, 'Deletion retains the same signed-in identity.');
      assert.equal(retained.user?.demo, false);
      assert.deepEqual((await json<CompanyList>(page, '/api/satfamily/organizations')).organizations, []);
      const missing = await page.evaluate(async id => (await fetch(`/api/satfamily/organizations/${id}`)).status, company.id);
      assert([403, 404].includes(missing), 'Deleted-company records are unavailable.');
      await noBrowserSecretStorage(page, context);
      await page.screenshot({ path: join(evidenceDirectory, `company-deleted-${width}.png`) });
      await page.getByRole('button', { name: 'GreyFinance home', exact: true }).click();
      await page.waitForURL(`${origin}/`);
      await page.getByRole('heading', { name: 'Good work. Clear spending.', exact: true }).waitFor();
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await page.waitForURL(`${origin}/app`);
      await page.getByRole('button', { name: 'Create your workspace', exact: true }).waitFor();
      await page.getByText('Temporary Nostr identity', { exact: true }).waitFor();
      assert.equal((await json<Session>(page, '/api/session')).user?.pubkey, company.pubkey);
      await page.getByRole('button', { name: 'Account and preview roles', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('button', { name: 'Try with a temporary Nostr identity', exact: true }).waitFor();
      assert.equal(await page.getByText('Temporary Nostr identity', { exact: true }).count(), 0, 'Sign-out clears the in-memory temporary identity notice.');
      assert.equal((await json<Session>(page, '/api/session')).user, null);
      assert.equal((await context.cookies(origin)).length, 0, 'Sign-out removes the session cookie.');
      await noBrowserSecretStorage(page, context);
      await page.getByRole('button', { name: 'GreyFinance home', exact: true }).click();
      await page.getByRole('navigation', { name: 'Account', exact: true }).getByRole('link', { name: 'Open workspace', exact: true }).click();
      await page.getByRole('button', { name: 'Try with a temporary Nostr identity', exact: true }).waitFor();
      assert.equal((await json<Session>(page, '/api/session')).user, null);
      await noOverflow(page, width, 'signed-out return');
      results.push({ width, height: width === 1440 ? 1000 : 844, convexBackend: true, landingToWorkspace: true, genuineTemporaryNostrIdentity: true, disposableCompanyCreatedWithoutWallet: true, horizontalDesktopOrBottomPhoneNavigation: navigation, noHorizontalOverflow: true, allSixNavigationViewsWork: true, settingsExport, exportToastNavigation, dialogExport, exactNameConfirmationRequired: true, cancellationPreservesCompany: true, keyboardFocusContained: true, hostedDeletionConfirmed: true, retainedSameSignedInIdentity: true, retainedTemporaryIdentityAfterHomeAndBack: true, signOutClearsIdentityAndCookie: true, signedOutHomeReturn: true, browserStorage: storage, screenshotsDirectory: evidenceDirectory });
      console.log(`${width}px hosted company UI passed: signed Nostr login, create, export, exact-name delete, routing and sign-out.`);
    } finally {
      try {
        if (new URL(page.url()).origin === origin) {
          await cleanDisposableCompany(page, company);
          await page.evaluate(async () => {
            await fetch('/api/session/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          });
        }
      } catch (error) { cleanupErrors.push(`${width}px: ${error instanceof Error ? error.message : 'Disposable company cleanup failed.'}`); }
      await context.close();
    }
  }
  await Promise.all(pendingChecks);
  assert.equal(authChecks.length, 3, 'Each viewport performs one genuine temporary Nostr sign-in.');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(forbiddenRequests, []);
  assert.deepEqual(cleanupErrors, []);
} catch (error) {
  failure = error instanceof Error ? `${error.name}: ${error.message}` : 'Hosted UI acceptance failed.';
  throw error;
} finally {
  await browser.close();
  const evidence = {
    startedAt,
    checkedAt: new Date().toISOString(),
    origin,
    classification: 'Builder-controlled hosted UI acceptance using genuine temporary Nostr identities and disposable companies. No independent adoption claim. No wallets connected, invoices created, expenses submitted or payments requested. No synthetic authentication, company or deletion responses.',
    releaseCommit,
    productionDeployment,
    releaseMetadataSource: 'Optional runner-provided environment values; null means not supplied.',
    results,
    authChecks,
    pageErrors,
    forbiddenWalletOrPaymentRequests: forbiddenRequests,
    paymentCalls: forbiddenRequests.filter(request => /\/(pay|invoices)(\/|$)/.test(request.path)).length,
    cleanupErrors,
    passed: !failure && results.length === 3 && pageErrors.length === 0 && forbiddenRequests.length === 0 && cleanupErrors.length === 0,
    ...(failure ? { failure } : {}),
  };
  const path = join(evidenceDirectory, 'verification.json');
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Hosted UI evidence: ${path}`);
}
