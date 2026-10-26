import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from '/home/greyw0rks/atlas/node_modules/playwright/index.mjs'
import { build } from '../../../arc-module/node_modules/esbuild/lib/main.js'
const web = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(path.join(web, 'package.json'))
const dir = path.join(web, '.impeccable/review/company-payments')
await mkdir(dir, { recursive: true })
const entry = path.join(dir, 'entry.tsx')
await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';
import {CompanyPayments} from ${JSON.stringify(path.join(web, 'components/employer/CompanyPayments.tsx'))};
import Salary from ${JSON.stringify(path.join(web, 'app/(employee)/salary/page.tsx'))};
import Requests from ${JSON.stringify(path.join(web, 'app/(employee)/my-requests/page.tsx'))};
const mode=new URLSearchParams(location.search).get('mode')||'ready';
const hash='0x'+'45'.repeat(32);
const source={id:'salary-source',kind:'SALARY',employeeId:'ada',name:'Ada Example',recipient:'0x'+'31'.repeat(20),amountBusiness:'12345678',description:'Attendance 2026-10-25'};
const plan={id:'fixture-plan',companyId:'fixture-company',chainId:5042002,contractAddress:'0x'+'ab'.repeat(20),employerWallet:'0x'+'ef'.repeat(20),runId:'0x'+'67'.repeat(32),status:mode==='paid'?'CONFIRMED':'PREPARED',createdAt:'2026-10-25T00:00:00Z',verifiedAt:mode==='paid'?'2026-10-25T00:00:00Z':null,totalNative:'12345678000000000000',recipients:[{address:source.recipient,amountNative:'12345678000000000000',amountStr:'12.345678'}],items:[source],txHash:mode==='paid'?hash:null,submittedTxHash:null};
window.fixtureData={sources:mode==='ready'?[source]:[],plans:mode==='ready'||mode==='empty'?[]:[plan]};window.fixtureVerify=false;window.fixtureCalls=[];
window.fetch=async(url,options={})=>{window.fixtureCalls.push({url,method:options.method||'GET'});
if(url==='/api/employees/me')return Response.json({id:'ada',firstName:'Ada',monthlySalary:'1200000000',dailyRate:'54545454',currency:'USDC',paidSalaryThisMonth:'12345678',employer:{workingDaysPerMonth:22},checkIns:[],advanceRequests:[],leaveRequests:[],refundRequests:[{id:'awaiting',amount:'20000',category:'Transport',description:'Approved fixture',status:'APPROVED',paymentStatus:'AWAITING_PAYMENT',createdAt:'2026-10-25'},{id:'paid',amount:'10000',category:'Meals',description:'Verified fixture',status:'APPROVED',paymentStatus:'PAID',createdAt:'2026-10-24'},{id:'old',amount:'10000',category:'Equipment',description:'Historical fixture',status:'APPROVED',paymentStatus:'HISTORICAL',createdAt:'2026-10-23'}]});
if(url.endsWith('/confirm')){if(!window.fixtureVerify)return Response.json({error:'Awaiting finality. Keep the original hash.'},{status:202});plan.status='CONFIRMED';plan.txHash=hash;window.fixtureData.plans=[plan];return Response.json(plan);}
if(options.method==='POST'){window.fixtureData={sources:[],plans:[plan]};return Response.json(plan,{status:201});}
return Response.json(window.fixtureData);};
createRoot(document.getElementById('root')).render(<main className="dashboard-stack" style={{maxWidth:1100,margin:'auto',padding:24}}><p>Visual inspection · synthetic company fixtures · wallet frame stubbed</p>{mode==='salary'?<Salary/>:mode==='requests'?<Requests/>:<CompanyPayments initial={window.fixtureData} treasuryLinked={mode!=='empty'}/>}</main>);`)
await build({ entryPoints: [entry], outfile: path.join(dir, 'bundle.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@': web } })
const css = await require('postcss')([require('tailwindcss')({ content: [path.join(web, 'components/**/*.tsx'), path.join(web, 'app/**/*.tsx')] })]).process(await readFile(path.join(web, 'app/globals.css'), 'utf8'), { from: path.join(web, 'app/globals.css') })
await writeFile(path.join(dir, 'style.css'), css.css)
const html = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'
const server = createServer(async (request, response) => { try { if (request.url.startsWith('/arc-module/')) { response.setHeader('Content-Type','text/html'); response.end('<p>Wallet workspace stub for company UI inspection.</p>'); return } const file = request.url === '/bundle.js' ? 'bundle.js' : request.url === '/style.css' ? 'style.css' : null; response.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html'); response.end(file ? await readFile(path.join(dir, file)) : html) } catch { response.statusCode = 500; response.end() } })
await new Promise(resolve => server.listen(3121, '127.0.0.1', resolve))
const browser = await chromium.launch({ executablePath: '/home/greyw0rks/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, env: { ...process.env, LD_LIBRARY_PATH: `/home/greyw0rks/chrome-libs/usr/lib/x86_64-linux-gnu:${process.env.LD_LIBRARY_PATH || ''}` }, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const errors = [], reports = []
try {
  for (const width of [1440, 390]) for (const mode of ['empty', 'ready', 'prepared', 'paid', 'salary', 'requests']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:3121/?mode=${mode}`)
    if (mode === 'salary') await page.getByText('Paid on Arc this month', {exact:true}).waitFor()
    else if (mode === 'requests') { await page.getByText('Approved · awaiting payment', {exact:true}).waitFor(); await page.getByText('Paid on Arc', {exact:true}).waitFor(); await page.getByText('Historical payment', {exact:true}).waitFor() }
    else await page.getByRole('heading', {name:'Ready for payment'}).waitFor()
    if (mode === 'ready') {
      await page.getByRole('checkbox').check(); await page.getByRole('button',{name:'Prepare 1 selected payment',exact:true}).click()
      await page.getByRole('heading',{name:'Review and verify payment'}).waitFor()
      assert.equal(await page.getByRole('checkbox').count(),0)
    }
    if (mode === 'prepared') {
      await page.getByText('Wallet, treasury and run ID',{exact:true}).click()
      await page.getByLabel('Payment transaction hash').fill('0x'+'45'.repeat(32))
      await page.getByRole('button',{name:'Verify and record payment'}).click()
      await page.getByRole('alert').waitFor()
      assert.equal(await page.getByText('Paid on Arc',{exact:true}).count(),0)
      // A matching notification from the actual frame only triggers a server read;
      // the server still returns PREPARED and the UI must remain unpaid.
      await page.evaluate(()=>{const iframe=document.querySelector('iframe');window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:iframe.contentWindow,data:{type:'grey-company-payment-recorded',planId:'fixture-plan'}}))})
      await page.getByText('Company payment records refreshed.',{exact:true}).waitFor()
      assert.equal(await page.getByText('Paid on Arc',{exact:true}).count(),0)
    }
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(documentWidth <= width, `Overflow at ${mode}-${width}`)
    await page.screenshot({path:path.join(dir,`${mode}-${width}.png`),fullPage:true})
    reports.push({mode,width,documentWidth})
    if (mode === 'prepared') {
      await page.evaluate(()=>{window.fixtureVerify=true})
      await page.getByRole('button',{name:'Verify and record payment'}).click()
      await page.getByRole('heading',{name:'Verified company payment'}).waitFor()
      assert.equal(await page.locator('iframe').count(),0)
      assert.match(await page.getByRole('link',{name:'View verified receipt'}).getAttribute('href'),/^https:\/\/explorer.testnet.arc.io\/tx\/0x/)
    }
    await page.close()
  }
  assert.equal(errors.length,0,JSON.stringify(errors))
  const report={passed:true,errors,reports,note:'Actual company payment and employee components with synthetic HTTP data and a stub wallet frame. Browser messages cannot mark a plan paid. This is UI evidence; finalized receipt recording is covered by separate isolated PostgreSQL/RPC tests.'}
  await writeFile(path.join(dir,'browser-results.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
} finally {await browser.close();await new Promise(resolve=>server.close(resolve))}
