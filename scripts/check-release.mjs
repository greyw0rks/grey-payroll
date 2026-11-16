import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const worker = process.argv.includes('--worker');
const detached = process.argv.includes('--detached');
const uiOnly = process.argv.includes('--ui');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = worker ? resolve(process.argv.at(-1)) : resolve(root, '.data', 'release-checks', stamp);
mkdirSync(directory, { recursive: true, mode: 0o700 });

if (detached && !worker) {
  const descriptor = openSync(resolve(directory, 'output.log'), 'a', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...(uiOnly ? ['--ui'] : []), '--worker', directory], { cwd: root, env: process.env, detached: true, stdio: ['ignore', descriptor, descriptor] });
  closeSync(descriptor);
  child.unref();
  console.log(JSON.stringify({ pid: child.pid, directory, statusFile: resolve(directory, 'status.json'), classification: 'Build and isolated automated tests only; no deployment or payment.' }));
  process.exit(0);
}

function sources() {
  const hashes = {};
  const collect = directory => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) collect(path);
      else if (/\.(?:ts|tsx|js|mjs|css|html|json)$/.test(item.name)) hashes[relative(root, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  for (const path of ['apps/satfamily/src', 'apps/satsacademy/src', 'packages/academy/src', 'packages/nwc-gate/src', 'convex', 'server']) {
    if (existsSync(resolve(root, path))) collect(resolve(root, path));
  }
  for (const path of ['package.json', 'pnpm-lock.yaml', 'vercel.json', 'scripts/build.ts', 'scripts/build-release.ts', 'scripts/test.ts', 'tsconfig.satsacademy.json', 'tsconfig.satfamily.json']) {
    hashes[path] = createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
  }
  return hashes;
}

const baseline = sources();
const report = { startedAt: new Date().toISOString(), status: 'running', phases: [], sourceHashes: baseline };
function persist() {
  writeFileSync(resolve(directory, 'status.json.tmp'), JSON.stringify(report, null, 2), { mode: 0o600 });
  renameSync(resolve(directory, 'status.json.tmp'), resolve(directory, 'status.json'));
}
persist();
for (const command of uiOnly ? ['verify:academy:ui'] : ['build:release', 'typecheck:convex', 'test']) {
  const phase = { command, status: 'running', startedAt: new Date().toISOString(), exitCode: null };
  report.phases.push(phase);
  persist();
  console.log(`Starting ${command}.`);
  const exitCode = await new Promise((done, reject) => {
    const child = spawn('pnpm', [command], { cwd: root, env: process.env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => done(code ?? (signal ? 143 : 1)));
  }).catch(error => { console.error('Verification command failed:', error.name); return 1; });
  phase.exitCode = exitCode;
  phase.finishedAt = new Date().toISOString();
  phase.status = exitCode === 0 ? 'passed' : 'failed';
  if (exitCode !== 0) {
    report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    persist();
    process.exit(exitCode);
  }
  persist();
}
report.sourceUnchanged = JSON.stringify(sources()) === JSON.stringify(baseline);
report.status = report.sourceUnchanged ? 'passed' : 'source-changed';
report.finishedAt = new Date().toISOString();
persist();
console.log(JSON.stringify({ status: report.status, phases: report.phases, statusFile: resolve(directory, 'status.json') }));
if (!report.sourceUnchanged) process.exitCode = 1;
