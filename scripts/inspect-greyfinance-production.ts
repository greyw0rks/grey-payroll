import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const run = promisify(execFile);
const cli = resolve('node_modules/.bin/convex');
type Row = Record<string, unknown>;

// Operator-only, read-only inspection. Never print records, credentials or identities.
async function read(table: string): Promise<Row[]> {
  const args = ['data', table, '--prod', '--format', 'json', '--limit', '1000'];
  const { stdout } = await run(cli, args, { timeout: 30_000, maxBuffer: 4_000_000 });
  // The Convex CLI exits successfully and writes its empty-table notice to stderr.
  if (!stdout.trim()) return [];
  const rows: unknown = JSON.parse(stdout);
  if (!Array.isArray(rows) || rows.length >= 1000) throw new Error('Inspection requires complete table results.');
  return rows as Row[];
}

try {
  const [organizations, connections, expenses, payments] = await Promise.all([
    read('organizations'), read('walletConnections'), read('expenses'), read('walletPayments')
  ]);
  const owners = new Map<string, number>();
  for (const organization of organizations) {
    if (typeof organization.ownerPubkey !== 'string') throw new Error('Organization owner is invalid.');
    owners.set(organization.ownerPubkey, (owners.get(organization.ownerPubkey) || 0) + 1);
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    backend: 'convex',
    readOnly: true,
    completeResults: true,
    organizations: organizations.length,
    ownersWithMultipleCompanies: [...owners.values()].filter(count => count > 1).length,
    walletConnections: connections.length,
    regtestConnections: connections.filter(row => row.network === 'regtest').length,
    companyPaymentsUnresolved: expenses.filter(row => row.status === 'paying' || row.status === 'unknown').length,
    genericPaymentsUnresolved: payments.filter(row => row.state === 'paying' || row.state === 'unknown').length
  }, null, 2));
} catch {
  // CLI failures can contain private output. The operator can investigate separately.
  console.error('Production inspection could not complete. No records or credentials were printed.');
  process.exitCode = 1;
}
