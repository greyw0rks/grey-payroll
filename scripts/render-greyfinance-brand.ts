import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const sora = readFileSync('node_modules/@fontsource-variable/sora/files/sora-latin-wght-normal.woff2').toString('base64');
const inter = readFileSync('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2').toString('base64');
const mark = '<svg width="40" height="40" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#16181c"/><path d="M45 18H29C21.268 18 15 24.268 15 32s6.268 14 14 14h16V32H33" fill="none" stroke="#3ddc84" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const browser = await chromium.launch({ headless: true, executablePath: process.env.SATS_CHROMIUM_PATH || '/home/greyw0rks/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face{font-family:Sora;src:url(data:font/woff2;base64,${sora}) format('woff2');font-weight:100 900}
    @font-face{font-family:Inter;src:url(data:font/woff2;base64,${inter}) format('woff2');font-weight:100 900}
    *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#f4f3ee;color:#16181c;font-family:Inter,sans-serif;padding:52px 58px;overflow:hidden}
    header{display:flex;align-items:center;gap:12px}header strong{font:600 30px Sora;letter-spacing:-1.8px}header small{font-size:15px;color:#64695f}
    main{display:grid;grid-template-columns:1.1fr 1fr;gap:55px;align-items:center;margin-top:48px}p{margin:0}.eyebrow{font-size:12px;color:#245c36;letter-spacing:1.5px;text-transform:uppercase;font-weight:650}
    h1{font:500 66px/1.11 Sora;letter-spacing:-4.8px;margin:20px 0 24px}h1 span{color:#686e62}.description{font-size:19px;line-height:1.65;max-width:440px;color:#5c6258}
    .scene{position:relative;height:338px}.back{position:absolute;inset:27px 6px 0 22px;border-radius:22px;transform:rotate(-6deg);background:#16181c}.card{position:absolute;inset:4px 22px 23px 0;border-radius:22px;padding:29px 32px;background:#3ddc84;transform:rotate(-6deg)}
    .card-title{display:flex;align-items:center;justify-content:space-between;font-size:11px;letter-spacing:1px;font-weight:650}.card-title strong{font:600 24px Sora;letter-spacing:-1px}.rows{display:grid;gap:0;margin-top:24px}.row{display:flex;align-items:center;gap:12px;border-top:1px solid #16181c38;padding:16px 0;font-size:15px}.row>span{width:28px;height:28px;border-radius:50%;background:#16181c;color:#3ddc84;display:grid;place-items:center;font-size:12px}.row strong{display:block;font-size:13px}.row small{display:block;font-size:11px;margin-top:5px;opacity:.75}.card-note{font-size:9px;opacity:.7;margin-top:4px}
    footer{position:absolute;left:58px;right:58px;bottom:38px;border-top:1px solid #d7dcd1;display:flex;align-items:center;justify-content:space-between;padding-top:19px;font-size:12px;color:#64695f}footer span{color:#245c36;font-weight:600}
  </style></head><body><header>${mark}<strong>grey</strong><small>/ finance</small></header><main><div><p class="eyebrow">Bitcoin treasury for teams</p><h1>Good work.<br><span>Clear spending.</span></h1><p class="description">Team requests, approvals, and verified receipts in one clear workspace.</p></div><div class="scene"><div class="back"></div><div class="card"><div class="card-title"><strong>grey</strong><span>TEAM TREASURY</span></div><div class="rows"><div class="row"><span>1</span><div><strong>Make the request</strong><small>Purpose, amount, and invoice</small></div></div><div class="row"><span>2</span><div><strong>Independent approval</strong><small>A teammate reviews the spending</small></div></div><div class="row"><span>✓</span><div><strong>A checkable receipt</strong><small>Wallet-verified payment proof</small></div></div></div><p class="card-note">Workflow illustration</p></div></div></main><footer><span>Company-controlled Lightning wallets · Open source</span><p>grey-finance.vercel.app</p></footer></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync('apps/satfamily/public/brand', { recursive: true });
  await page.screenshot({ path: 'apps/satfamily/public/brand/grey-finance-social.png' });
  console.log('Rendered the GreyFinance social image at 1200 × 630.');
} finally { await browser.close(); }
