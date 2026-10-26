# Grey — Company Payroll on Arc

Grey gives each employer a company workspace for staff, invitations, attendance, salaries and requests. Employees join through their employer’s invitation. The money layer uses Arc native USDC; employers approve treasury deposits, withdrawals and atomic payroll batches with their own wallets. AI can advise on requests but cannot authorize payments.

The company platform uses Next.js, Clerk and Neon PostgreSQL. The Arc payment engine and canonical GreyPayroll contract are in `arc-module/`, developed through Arc Studio. Arc Testnet (5042002) is available for rehearsals; production is configured mainnet-first for Arc Mainnet (5042). Mainnet deployment and transfers remain employer-wallet signatures and are never performed by a server or model.

## Run locally

```bash
pnpm install
pnpm db:generate
pnpm db:setup
pnpm arc:bundle
pnpm --filter @grey/web dev --hostname localhost --port 3000
```

Keep database, Clerk and optional AI credentials in ignored `apps/web/.env.local`. Configure `ARC_TESTNET_RPC_URL` for server reads. Employers link an Arc treasury with a company-bound, expiring wallet signature from the dashboard. The treasury API verifies the canonical runtime and reads the employer ledger at a finalized block. Employee balances use native USDC, with no token approvals.

## Verify

```bash
pnpm db:local
pnpm --filter @grey/web test
pnpm --filter @grey/web typecheck
```

The local PostgreSQL test cluster is isolated from Neon. Run `npm test`, `npm run lint` and `npm run build` in `arc-module/`; contract checks use its pinned Foundry build. Testnet deployment evidence must distinguish actual Arc transactions from local EVM fixtures.

For launch, use the [Arc Mainnet release runbook](docs/arc/MAINNET_RELEASE.md), the read-only `scripts/verify-arc-mainnet.mjs` verifier, and the production variable checklist in `docs/arc/production.env.example`. The video source is in `videos/grey-finance-launch/` and is designed for local HyperFrames review/render.

See [company dashboards](docs/COMPANY_DASHBOARDS.md), [Arc continuation](docs/arc/RESUME.md) and the [Studio project](https://studio.arc.io/app/1d863f81-947e-4800-af87-326ace25ef49).

Historical financial records retain their original amounts. Business salary/refund amounts use six-decimal accounting precision; new native Arc payments convert explicitly into eighteen-decimal units. Attendance and approval records do not prove a transfer. Paid status requires a matching successful onchain receipt.
