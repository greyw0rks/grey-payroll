import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = new URL('./screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.SATS_CHROMIUM_PATH ? { executablePath: process.env.SATS_CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const results: Record<string, unknown>[] = [];
const errors: string[] = [];
try {
  const cases = [['desktop', 1440, 1000], ['mobile', 390, 844], ['small-phone', 360, 800]] as const;
  for (const [name, width, height] of cases.filter(([name]) => !process.env.SATS_QA_VIEW || process.env.SATS_QA_VIEW === name)) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    await page.goto('http://127.0.0.1:4402/', { waitUntil: 'networkidle' });
    await page.locator('.treasury-card').waitFor({ timeout: 20000 });
    await page.screenshot({ path: new URL(`greyfinance-${name}-overview.png`, output).pathname, fullPage: true });
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, body: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
    if (overflow.overflow) throw new Error(`${name} has horizontal overflow: ${JSON.stringify(overflow)}`);
    if (process.env.SATS_QA_LAYOUT_ONLY === '1') { results.push({ name, width, height, overflow, tested: ['overview', 'horizontal overflow'], layoutOnly: true }); await context.close(); continue; }
    await page.getByRole('button', { name: 'New request', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByLabel('What is this expense for?').fill('Interface review sample');
    await page.getByRole('button', { name: 'Real Lightning invoice', exact: true }).click();
    await page.getByLabel('Lightning invoice', { exact: true }).fill('invalid');
    await page.screenshot({ path: new URL(`greyfinance-${name}-request.png`, output).pathname, fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Requests', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search expense requests' }).fill('unmatched-search-example');
    await page.getByRole('heading', { name: 'No matching requests', exact: true }).waitFor();
    await page.getByRole('searchbox', { name: 'Search expense requests' }).fill('');
    await page.screenshot({ path: new URL(`greyfinance-${name}-requests.png`, output).pathname, fullPage: true });
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    await page.getByRole('button', { name: 'Add member', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByLabel('Nostr public key', { exact: true }).fill('a'.repeat(64));
    await page.screenshot({ path: new URL(`greyfinance-${name}-member.png`, output).pathname, fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /Manage connection|Connect wallet/, exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: 'Use Lightning test wallet', exact: true }).waitFor();
    await page.screenshot({ path: new URL(`greyfinance-${name}-wallet.png`, output).pathname, fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Account and preview roles', exact: true }).click();
    await page.getByRole('button', { name: 'Employee', exact: true }).click();
    await page.getByText('Previewing Employee access', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByText('Your monthly spending limit', { exact: true }).waitFor();
    await page.screenshot({ path: new URL(`greyfinance-${name}-employee.png`, output).pathname, fullPage: true });
    const roleSnapshot = await page.evaluate(async () => { const response = await fetch('/api/satfamily/organizations/preview-baobab'); const body = await response.json(); return { role: body.role, ownExpensesOnly: body.expenses.every((expense: { requester_id: string }) => expense.requester_id === body.currentUser.id), treasuryBalanceHidden: body.wallet.balanceSats === undefined, otherMemberLimitsHidden: body.members.length === 1, incomingHidden: body.incoming.length === 0 }; });
    if (roleSnapshot.role !== 'employee' || !roleSnapshot.ownExpensesOnly || !roleSnapshot.treasuryBalanceHidden || !roleSnapshot.otherMemberLimitsHidden || !roleSnapshot.incomingHidden) throw new Error(`${name}: employee visibility checks failed`);
    results.push({ name, width, height, overflow, roleSnapshot, tested: ['overview', 'expense form', 'keyboard Escape', 'request search', 'team member form', 'wallet lab entry', 'employee role'] });
    await context.close();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(new URL(`./ui-verification${process.env.SATS_QA_VIEW ? `-${process.env.SATS_QA_VIEW}` : ''}.json`, import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), product: 'GreyFinance', results, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, cases: results.length, errors, output: output.pathname }));
} finally { await browser.close(); }
