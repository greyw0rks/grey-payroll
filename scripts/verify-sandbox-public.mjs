import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = 'https://grey-finance.vercel.app';
const products = [
  { name: 'GreyFinance', path: '/', directory: 'dist' },
  { name: 'SatsAcademy', path: '/academy/', directory: 'dist/academy' },
  { name: 'Bitcoin Sandbox', path: '/sandbox/', directory: 'dist/sandbox' }
];
const results = [];
for (const product of products) {
  const response = await fetch(origin + product.path, { signal: AbortSignal.timeout(20000) });
  assert(response.ok, `${product.name} must be publicly accessible.`);
  const html = await response.text();
  const expectedHtml = readFileSync(resolve(product.directory, 'index.html'), 'utf8');
  assert.equal(html.match(/<title>(.*?)<\/title>/)?.[1], expectedHtml.match(/<title>(.*?)<\/title>/)?.[1]);
  for (const [name, expected] of [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY'], ['referrer-policy', 'no-referrer']]) assert.equal(response.headers.get(name), expected);
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]);
  assert(assetPaths.length >= 2);
  const assets = [];
  for (const path of assetPaths) {
    assert(path.startsWith(product.path === '/' ? '/assets/' : product.path + 'assets/'));
    const assetResponse = await fetch(origin + path, { signal: AbortSignal.timeout(20000) });
    assert(assetResponse.ok, 'Published asset must exist.');
    assert.match(assetResponse.headers.get('cache-control') || '', /immutable/);
    const bytes = Buffer.from(await assetResponse.arrayBuffer());
    const local = readFileSync(resolve('dist', path.slice(1)));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, createHash('sha256').update(local).digest('hex'), 'Public asset must match the verified local build.');
    assets.push({ path, sha256: digest, bytes: bytes.length });
  }
  results.push({ product: product.name, path: product.path, status: response.status, assets, securityHeadersVerified: true });
}
const api = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(20000) })).json();
assert.equal(api.backend, 'convex');
const report = {
  status: 'passed', checkedAt: new Date().toISOString(), origin,
  deploymentId: 'dpl_BqFH4W6ncumbZkzPCLyiQNqWnj7h', implementationRevision: '0e2a6fb337598da3e44fc5fcb05965737397a003',
  classification: 'Read-only public deployment checks; no payment or independent adoption claim.',
  checks: ['All three product interfaces are publicly accessible', 'Published JavaScript and CSS match the verified local production build', 'Existing Finance and Academy routes are retained', 'Security headers and immutable assets are delivered', 'Same-origin API uses Convex'],
  products: results,
  sourceHashes: Object.fromEntries(['scripts/build-release.ts', 'vercel.json', 'scripts/verify-sandbox-public.mjs'].map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]))
};
writeFileSync('docs/evidence/sandbox-public-release.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: 'passed', products: results.map(item => item.product), checks: report.checks.length }));
