import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from '/home/greyw0rks/atlas/node_modules/playwright/index.mjs'
import { build } from '../../../arc-module/node_modules/esbuild/lib/main.js'

const web = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(path.join(web, 'package.json'))
const dir = path.join(web, '.impeccable/review/arc-treasury')
await mkdir(dir, { recursive: true })
const hooks = path.join(dir, 'wallet-fixture.tsx'), entry = path.join(dir, 'entry.tsx')
await writeFile(hooks, `import React from 'react';
export const useAccount=()=>({address:'0x1111111111111111111111111111111111111111',chainId:1});
export const useConnectModal=()=>({openConnectModal:()=>{}});
export const useSwitchChain=()=>({switchChainAsync:async value=>{window.fixtureCalls.push({switchChain:value.chainId});}});
export const useSignMessage=()=>({signMessageAsync:async value=>{window.fixtureCalls.push({signed:value});return '0x1234';}});
export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>;}`)
await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import {TreasuryWidget} from ${JSON.stringify(path.join(web, 'components/employer/TreasuryWidget.tsx'))};
window.fixtureCalls=[];window.fixtureLinked=false;window.fixtureOutage=false;
window.fetch=async(url,options={})=>{const body=options.body?JSON.parse(options.body):null;window.fixtureCalls.push({url,method:options.method||'GET',body});
if(options.method==='POST')return Response.json({nonce:'fixture-nonce',message:'Link Grey company treasury\\nCompany: fixture-company\\nChain: 5042002'});
if(options.method==='PATCH'){window.fixtureLinked=true;return Response.json({status:'linked'});}
if(window.fixtureOutage)return Response.json({status:'unavailable',balance:null,contractAddress:'0xabababababababababababababababababababab',walletAddress:'0x1111111111111111111111111111111111111111',error:'Fixture RPC unavailable'},{status:503});
return Response.json(window.fixtureLinked?{status:'verified',balance:'1230000000000000000',chainId:5042002,chainName:'Arc Testnet',explorerBase:'https://explorer.testnet.arc.io',contractAddress:'0xabababababababababababababababababababab',walletAddress:'0x1111111111111111111111111111111111111111'}:{status:'unconfigured',balance:null,chainId:5042002,chainName:'Arc Testnet',explorerBase:'https://explorer.testnet.arc.io',contractAddress:null,walletAddress:null});};
createRoot(document.getElementById('root')).render(<main style={{maxWidth:720,margin:'auto',padding:20}}><p>Isolated company treasury UI fixture · no wallet or chain transactions</p><TreasuryWidget/></main>);`)
await build({ entryPoints: [entry], outfile: path.join(dir, 'bundle.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_ARC_DEFAULT_CHAIN_ID': '"5042002"' }, alias: { wagmi: hooks, '@rainbow-me/rainbowkit': hooks, 'next/link': hooks, '@grey/config/arc': path.resolve(web, '../../packages/config/src/arc.ts'), '@/lib/arc-chain': path.resolve(web, 'lib/arc-chain.ts') } })
const css = await require('postcss')([require('tailwindcss')({ content: [path.join(web, 'components/**/*.tsx'), path.join(web, 'app/**/*.tsx')] })]).process(await readFile(path.join(web, 'app/globals.css'), 'utf8'), { from: path.join(web, 'app/globals.css') })
await writeFile(path.join(dir, 'style.css'), css.css)
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'
const server = createServer(async (request, response) => { try { const file = request.url === '/bundle.js' ? 'bundle.js' : request.url === '/style.css' ? 'style.css' : null; response.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html'); response.end(file ? await readFile(path.join(dir, file)) : html) } catch { response.statusCode = 500; response.end() } })
await new Promise(resolve => server.listen(3120, '127.0.0.1', resolve))
const browser = await chromium.launch({ executablePath: '/home/greyw0rks/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, env: { ...process.env, LD_LIBRARY_PATH: `/home/greyw0rks/chrome-libs/usr/lib/x86_64-linux-gnu:${process.env.LD_LIBRARY_PATH || ''}` }, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const errors = [], reports = []
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:3120')
    await page.getByLabel('Arc treasury contract').waitFor()
    async function capture(name) { const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth); assert.ok(documentWidth <= width, `Overflow at ${name}`); await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true }); reports.push({ name, width, documentWidth }) }
    await capture(`setup-${width}`)
    if (width === 390) {
      await page.getByLabel('Arc treasury contract').fill('0xabababababababababababababababababababab')
      await page.getByRole('button', { name: 'Sign to link treasury' }).click()
      await page.getByText('1.23 USDC', { exact: true }).waitFor()
      const calls = await page.evaluate(() => window.fixtureCalls)
      assert.ok(calls.some(call => call.switchChain === 5042002))
      assert.ok(calls.some(call => call.signed?.account === '0x1111111111111111111111111111111111111111'))
      assert.ok(calls.some(call => call.method === 'PATCH' && call.body.nonce === 'fixture-nonce'))
      await capture('linked-390')
      await page.evaluate(() => { window.fixtureOutage = true })
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await page.getByText('Balance unavailable', { exact: true }).waitFor()
      assert.equal(await page.getByText('1.23 USDC', { exact: true }).count(), 0)
      await capture('unavailable-390')
    }
    await page.close()
  }
  assert.equal(errors.length, 0, JSON.stringify(errors))
  const report = { passed: true, errors, reports, note: 'Actual TreasuryWidget with isolated account, signature and HTTP fixtures. This verifies UI state and layout, not a real wallet or payment. Server signature/RPC verification is covered by separate local-database tests.' }
  await writeFile(path.join(dir, 'browser-results.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
