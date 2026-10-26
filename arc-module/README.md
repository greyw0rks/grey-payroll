# Grey Payroll — Arc Module

Employer-approved USDC batch payroll on Arc chain. Connect a wallet, fund your isolated contract balance, prepare a recipient list, review exact amounts, and execute an atomic payout — all in a single wallet-signed transaction. Receipt reconciliation verifies every PaymentSent event against the submission snapshot before marking a run confirmed. Built through Arc Studio as Grey’s Arc payment engine and embedded in the company dashboard.

Built with [Arc Studio](https://studio.arc.io)

---

## Tech Stack

- **Smart contract:** Solidity 0.8.28, EVM Cancun — `contracts/GreyPayroll.sol`
- **Frontend:** Vite + React 18 + TypeScript
- **Account entry:** Clerk React, using the existing Grey Clerk application
- **Landing and motion:** Three.js + Framer Motion, with self-hosted Grey fonts
- **Onchain:** wagmi v2, viem, ConnectKit
- **Chain:** Arc Testnet (chain ID 5042002) and Arc Mainnet (chain ID 5042)
- **Token:** Native USDC (Arc's gas token, 18 decimals)

---

## Development

### Prerequisites

- Node.js 22 and npm — use the checked-in `package-lock.json` for this standalone export
- [Foundry](https://book.getfoundry.sh/getting-started/installation) — contract build and test

### Install

```bash
npm ci
```

### Run (development)

```bash
npm run dev
# App available at http://localhost:5173
```

### Environment Variables

| Variable | Purpose | Required outside Arc Studio |
|----------|---------|---------------------------|
| `RPC_PROXY_BASE_URL` | Arc Studio RPC proxy base URL | Optional (falls back to public Arc RPC) |
| `RPC_PROXY_TOKEN` | Arc Studio RPC proxy token | Optional |
| `RPC_PROXY_CHAINS` | Comma-separated Compass chain keys | Optional |
| `VITE_CLERK_PUBLISHABLE_KEY` | Publishable key for the existing Grey Clerk application | Required for account login/signup |

Copy `.env.example` to `.env.local` and set the Clerk publishable key. Never add a Clerk secret key to a browser environment variable. Without a publishable key, account pages show a configuration state and the wallet-only workspace remains available. With a key, `/app` requires a Clerk session before loading the wallet workspace. The contract address is entered at runtime in the app's "Connect Contract" screen.

### Frontend routes

- `/`: Grey landing page, interactive payroll illustration, workflow preview and FAQs.
- `/login` and `/signup`: real Clerk account components; successful account entry returns to `/app`.
- `/app` (and `/payroll`): employer wallet workspace, with Arc Testnet selected by default.

The landing and account UI were authored locally during the frontend continuation. The original payroll module and contract came from Arc Studio. Local design changes do not constitute new hosted Studio build evidence.

The Three.js scene is illustrative, pauses offscreen and in hidden tabs, and uses a static rendering for reduced motion. Devices without WebGL receive a readable fallback. No sample payment in the landing page represents a real settlement.

`validation/workspace-ui.tsx` and `.impeccable/review/workspace-harness.html` provide a development-only isolated wallet UI capture. They are excluded from the production entry and do not bypass the production account flow.

### Contract Build

```bash
npm run contracts:build
# Output: contracts/out/GreyPayroll.sol/GreyPayroll.json
```

### Contract Tests

```bash
npm run contracts:test
# 84 tests pass
```

### Production Build

```bash
npm run build
# Output: dist/
```

### Type Check + Lint

```bash
npm run check
```

---

## Contract Deployment

Deploy `GreyPayroll.sol` from your own wallet using Foundry. No admin key or relayer is needed — the contract is entirely self-service.

**Arc Testnet (no real funds):**

```bash
forge create contracts/GreyPayroll.sol:GreyPayroll \
  --rpc-url https://rpc.testnet.arc.io \
  --private-key $PRIVATE_KEY \
  --broadcast
```

**Arc Mainnet (real funds — review code independently first):**

```bash
forge create contracts/GreyPayroll.sol:GreyPayroll \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $PRIVATE_KEY \
  --broadcast
```

After deploying, copy the `Deployed to: 0x...` address from the output and paste it into the app's **Connect Contract** field.

See `BUILD_LOG.md` for the full step-by-step deployment and first-run instructions.

---

## Usage

1. Connect your employer wallet and select Arc Testnet or Arc Mainnet.
2. Enter the deployed `GreyPayroll` contract address.
3. **Fund Balance tab:** Deposit USDC into your employer ledger.
4. **Prepare Run tab:** Add recipients with exact USDC amounts.
5. Review the final recipient table and tick the confirmation checkbox.
6. Click **Execute Payroll** and confirm in your wallet.
7. View the transaction on the Arc explorer. Export a CSV from **History**.

---

## Security

- Each employer has an isolated funded ledger. No administrator or third party can access your funds.
- Payroll runs are atomic — any failed transfer reverts the entire run and preserves your balance.
- Run IDs are employer-scoped — replay protection prevents duplicate payouts.
- See `docs/security-review.md` for the full review report (max preset, 84 unit tests, 4 invariants).

> This review covers Arc Studio's internal rule corpus. It is not a substitute for a paid third-party audit before running production payroll at scale.
