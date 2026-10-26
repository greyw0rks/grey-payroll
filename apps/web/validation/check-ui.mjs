import { chromium } from '/home/greyw0rks/atlas/node_modules/playwright/index.mjs'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
const web = fileURLToPath(new URL('../', import.meta.url))
const dir = path.join(web, '.impeccable/review')
await mkdir(dir, { recursive: true })
const server = createServer(async (request, response) => {
  const url = request.url?.split('?')[0] || '/'
  const file = url === '/employer' || url === '/employee' ? path.join(dir, 'render', `${url.slice(1)}.html`) : url.startsWith('/fonts/') && !url.includes('..') ? path.join(web, 'public', url) : null
  if (!file) { response.writeHead(404); response.end(); return }
  try { const content = await readFile(file); response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'font/woff2'); response.end(content) }
  catch { response.writeHead(404); response.end() }
})
await new Promise(resolve => server.listen(3001, '127.0.0.1', resolve))
const browser = await chromium.launch({ executablePath: '/home/greyw0rks/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, env: { ...process.env, LD_LIBRARY_PATH: `/home/greyw0rks/chrome-libs/usr/lib/x86_64-linux-gnu:${process.env.LD_LIBRARY_PATH || ''}` }, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const reports = [], errors = []
try {
  const captures = [
    ['desktop', 'http://127.0.0.1:3001/employer', 1440, 1000],
    ['mobile', 'http://127.0.0.1:3001/employer', 390, 844],
    ['employee-desktop', 'http://127.0.0.1:3001/employee', 1440, 1000],
    ['employee-mobile', 'http://127.0.0.1:3001/employee', 390, 844],
    ['login-desktop', 'http://localhost:3000/sign-in', 1440, 1000],
    ['login-mobile', 'http://localhost:3000/sign-in', 390, 844],
    ['signup-desktop', 'http://localhost:3000/sign-up', 1440, 1000],
    ['signup-mobile', 'http://localhost:3000/sign-up', 390, 844],
  ]
  for (const [name, url, width, height] of process.argv.includes('--access-only') ? [] : captures) {
    console.log('Capturing', name)
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
    page.on('pageerror', error => errors.push({ name, error: error.message }))
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.evaluate(() => document.fonts.ready)
    if (url.includes(':3000')) await page.locator('input').first().waitFor({ timeout: 60000 })
    else assert.match(await page.locator('.company-name').innerText(), /Labtech.*by Grey/s)
    await page.evaluate(() => window.scrollTo(0, 0))
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(documentWidth <= width, `${name}: overflow ${documentWidth} > ${width}`)
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true })
    reports.push({ name, width, documentWidth, fixture: url.includes(':3001') })
    await page.close()
  }
  const httpContext = await browser.newContext()
  const staff = await httpContext.request.get('http://localhost:3000/api/employees')
  assert.equal(staff.status(), 401)
  const arc = await httpContext.request.get('http://localhost:3000/arc-module/app', { maxRedirects: 0 })
  assert.equal(arc.status(), 307)
  assert.match(arc.headers().location, /sign-in/)
  assert.equal(errors.length, 0, JSON.stringify(errors))
  await writeFile(path.join(dir, 'browser-results.json'), JSON.stringify({ passed: true, reports, errors, accessOnly: process.argv.includes('--access-only'), anonymousApiStatus: staff.status(), anonymousArcStatus: arc.status(), note: 'Dashboard screenshots use labelled synthetic fixtures. Auth screens and anonymous access checks use the actual Next.js application. The access-only mode reruns access assertions without repeating screenshots.' }, null, 2))
  console.log(JSON.stringify({ passed: true, reports }, null, 2))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
