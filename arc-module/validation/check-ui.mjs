import { chromium } from '/home/greyw0rks/atlas/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const dir = '/home/greyw0rks/grey-payroll/arc-module/.impeccable/review'
await mkdir(dir, { recursive: true })
const browser = await chromium.launch({ executablePath: '/home/greyw0rks/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const reports = []
const errors = []
async function capture(name, path, width, height) {
  console.log('Inspecting', name)
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push({ name, message: e.message }))
  await page.goto(`http://127.0.0.1:${path === '/app' ? '5178' : '5180'}${path === '/app' ? '/.impeccable/review/workspace-harness.html' : path}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.evaluate(() => document.fonts.ready)
  if (path === '/') {
    await page.getByRole('heading', { name: /Good work/ }).waitFor({ timeout: 60000 })
    await page.waitForTimeout(4200)
    await page.getByRole('button', { name: /Make it ready/ }).click()
    await page.getByText('Ready for funding', { exact: true }).waitFor()
    await page.getByRole('button', { name: /Bring your team/ }).click()
    const question = page.locator('summary').first()
    await question.click()
    assert.equal(await page.locator('details').first().evaluate(el => el.open), true)
    await question.click()
  } else if (path === '/app') {
    await page.getByText('Connect your employer wallet to get started.').waitFor({ timeout: 90000 })
    assert.equal(await page.getByRole('combobox', { name: 'Select Arc network' }).inputValue(), '5042002')
  } else {
    await page.locator('.cl-formFieldInput').first().waitFor({ timeout: 60000 })
    assert.equal(await page.getByText('Account access is being configured.').count(), 0)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, canvas: !!document.querySelector('canvas'), headings: [...document.querySelectorAll('h1,h2')].map(e => e.textContent) }))
  assert.ok(dimensions.document <= dimensions.viewport, `${name}: horizontal overflow ${dimensions.document} > ${dimensions.viewport}`)
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
  reports.push({ name, path, ...dimensions })
  await page.close()
}
try {
  if (process.argv.includes('--workspace-only')) {
    await capture('workspace-mobile', '/app', 390, 844)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log(JSON.stringify({ passed: true, reports, errors }, null, 2))
    await browser.close()
    process.exit(0)
  }
  await capture('desktop', '/', 1440, 1000)
  await capture('mobile', '/', 390, 844)
  await capture('login-desktop', '/login', 1440, 1000)
  await capture('login-mobile', '/login', 390, 844)
  await capture('signup-desktop', '/signup', 1440, 1000)
  await capture('signup-mobile', '/signup', 390, 844)
  await capture('workspace-mobile', '/app', 390, 844)
  const fallback = await browser.newPage({ viewport: { width: 320, height: 800 }, reducedMotion: 'reduce' })
  fallback.on('pageerror', e => errors.push({ name: 'fallback', message: e.message }))
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl' || type === 'webgl2' ? null : original.call(this, type, ...args) }
  })
  await fallback.goto('http://127.0.0.1:5180', { waitUntil: 'domcontentloaded' })
  await fallback.locator('.scene-fallback').waitFor()
  assert.equal(await fallback.getByRole('button', { name: 'Replay payroll illustration' }).count(), 0)
  assert.equal(await fallback.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await fallback.getByRole('link', { name: 'Start with Grey' }).click()
  await fallback.waitForURL('**/signup')
  await fallback.locator('.cl-formFieldInput').first().waitFor({ timeout: 60000 })
  await fallback.getByRole('link', { name: /^(Sign in|Log in)$/ }).first().click()
  await fallback.waitForURL('**/login')
  await fallback.goto('http://127.0.0.1:5180/app', { waitUntil: 'domcontentloaded' })
  await fallback.waitForURL('**/login**', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(async e => { console.log('Workspace access diagnostic', fallback.url(), await fallback.locator('body').innerText(), errors); throw e })
  await fallback.locator('.cl-formFieldInput').first().waitFor({ timeout: 60000 })
  reports.push({ name: 'fallback-and-navigation', width: 320, reducedMotion: true, webglUnavailable: true, result: 'passed' })
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log(JSON.stringify({ passed: true, reports, errors }, null, 2))
  await writeFile(`${dir}/browser-results.json`, JSON.stringify({ passed: true, reports, errors }, null, 2))
} finally { await browser.close() }
