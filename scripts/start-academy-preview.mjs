import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiPort = Number(process.env.SATS_API_PORT || 4407);
const webPort = Number(process.env.SATS_ACADEMY_PORT || 4403);
const data = resolve(process.env.SATS_DATA_DIR || '.data/academy-preview');
mkdirSync(data, { recursive: true, mode: 0o700 });
const environment = { ...process.env, SATS_API_PORT: String(apiPort), SATS_ACADEMY_PORT: String(webPort), SATS_API_ORIGIN: `http://127.0.0.1:${apiPort}`, SATS_DATA_DIR: data };

async function healthy(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
}
function launch(name, args) {
  const log = openSync(resolve(data, `${name}.log`), 'a', 0o600);
  try {
    const child = spawn('pnpm', ['exec', ...args], { cwd: root, env: environment, detached: true, stdio: ['ignore', log, log] });
    child.unref();
    return child.pid;
  } finally { closeSync(log); }
}

const api = `http://127.0.0.1:${apiPort}`;
const web = `http://127.0.0.1:${webPort}`;
const pids = {};
if (!await healthy(api + '/api/health')) pids.api = launch('api', ['tsx', 'server/index.ts']);
else {
  const health = await (await fetch(api + '/api/health')).json();
  if (health.academyWalletIsolated !== true) throw new Error('That API port belongs to an older workspace; choose another port.');
}
if (!await healthy(web + '/')) pids.web = launch('web', ['vite', resolve(root, 'apps/satsacademy'), '--config', resolve(root, 'apps/satsacademy/vite.config.ts')]);
for (let attempt = 0; attempt < 100; attempt++) {
  if (await healthy(api + '/api/health') && await healthy(web + '/')) {
    const runtime = { startedAt: new Date().toISOString(), api, web, pids, dataDirectory: data, classification: 'Local development preview; no video rendering or financial operation.' };
    writeFileSync(resolve(data, 'runtime.json'), JSON.stringify(runtime, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(runtime));
    process.exit(0);
  }
  await new Promise(done => setTimeout(done, 250));
}
throw new Error('The Academy preview did not become ready. Inspect the private preview logs.');
