# Grey — Crypto Payroll Platform

## Architecture

pnpm monorepo with Turborepo:

- `apps/web` — Next.js 15 App Router, wagmi + RainbowKit, Tailwind (employer + employee web)
- `apps/mobile` — Expo / React Native (iOS + Android: employee check-in, employer dashboard)
- `apps/desktop` — Electron + Vite + React (Windows + macOS: employer desktop app)
- `apps/contracts` — Foundry (Solidity 0.8.24), 4 contracts
- `packages/db` — Prisma schema + singleton client (`@grey/db`)
- `packages/config` — chain configs, token addresses, ABIs, constants (`@grey/config`)
- `packages/utils` — shared utilities (`@grey/utils`)
- `workers/salary-release` — BullMQ daily payroll trigger
- `workers/treasury-monitor` — BullMQ 4-hour balance alert
- `workers/attendance-reset` — BullMQ midnight attendance marker

## Primary Chain

**Celo Sepolia** (testnet, chain ID **11142220**) for dev. Celo mainnet (42220) for prod.
USDC (6 decimals) is the primary payroll token; cUSD (18 decimals) is secondary.
RPC: `https://celo-sepolia.drpc.org` · Explorer: `https://sepolia.celoscan.io`

## Platform targets

| Platform | App | Who |
|---|---|---|
| Web (browser) | `apps/web` | Employers + Employees |
| iOS + Android | `apps/mobile` | Employers + Employees |
| Windows + macOS | `apps/desktop` | Employers only |

## Commands

```bash
# Install
pnpm install

# Dev (all apps)
pnpm dev

# Contracts
cd apps/contracts
forge build
forge test
forge script script/Deploy.s.sol --rpc-url alfajores --broadcast --verify

# DB
cd packages/db
pnpm db:migrate:dev   # create migration
pnpm db:generate      # generate Prisma client after schema changes

# Web only
cd apps/web
pnpm dev
```

## Key Design Decisions

- All monetary amounts stored as `String` in the DB (wei representation to avoid float precision loss)
- Check-in idempotency: `CheckIn` unique on `(employeeId, date)` — salary release worker checks this before sending a tx
- `PayrollTreasury.releaseDaily` uses a `uint256 dateKey` (YYYYMMDD) + employee address as idempotency guard on-chain
- Clerk is the auth provider — email/social login, role stored in `publicMetadata.role` (`'employer'` | `'employee'`)
- Buffer enforcement: treasury cannot be withdrawn below `sum(monthlyRate * 2)` for all active employees
- Claude AI (`claude-sonnet-4-6`) parses employment documents at `/api/documents/parse` — always returns to employer for review before invite code is generated

## Env Vars

See `.env.example` for the full list. Required for local dev:
- `DATABASE_URL` — PostgreSQL connection string
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — from Clerk dashboard
- `CLERK_SECRET_KEY` — from Clerk dashboard
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` — from cloud.walletconnect.com
- `ANTHROPIC_API_KEY` — for document parsing
- `REDIS_URL` — for BullMQ workers
- `PINATA_JWT` — for IPFS uploads
