import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// Only products that have completed their own acceptance checks enter a release.
const products = [
  { name: 'greyfinance', source: 'satfamily', base: '/', destination: '' }
];
const output = resolve('dist');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const product of products) {
  const status = await new Promise<number | null>((done, reject) => {
    const child = spawn('pnpm', ['build', '--', product.name], {
      stdio: 'inherit', env: { ...process.env, SATS_BUILD_BASE: product.base }
    });
    child.on('error', reject);
    child.on('exit', done);
  });
  if (status !== 0) process.exit(status || 1);
  cpSync(resolve('apps', product.source, 'dist'), resolve(output, product.destination), { recursive: true });
}
console.log('GreyFinance is ready in dist/. Other submissions have their own sites.');
