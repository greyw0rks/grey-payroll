import './env.ts';
import { db } from './store.ts';
import { createSandboxRunnerApp } from './sandbox-runner-app.ts';

const app = createSandboxRunnerApp(db, { secret: process.env.SANDBOX_RUNNER_SECRET || '' });
const port = Number(process.env.SANDBOX_RUNNER_PORT || process.env.PORT || 4416);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a valid runner port.');
const host = process.env.SANDBOX_RUNNER_HOST || '127.0.0.1';
if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('Choose a supported runner bind address.');
const server = app.listen(port, host, () => console.log(`Bitcoin Sandbox runner ready on ${host}:${port}. Only signed regtest operations are accepted.`));
const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', stop); process.on('SIGINT', stop);
