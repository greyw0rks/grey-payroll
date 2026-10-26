# Grey Finance — Arc Mainnet release

This runbook is the source of truth for the public launch. Arc Mainnet is chain `5042`, uses native USDC with 18 decimals, and is served by `https://rpc.mainnet.arc.io`. The explorer is `https://explorer.arc.io`.

## Current state

- Contract/frontend tests and both production builds pass.
- The exact canonical runtime hash is `0xb219b4c8f0374fef7421d4cebb32c81dbd6dbbf44869d7569dad4209f8eeae9d`.
- The browser wallet deployment flow estimates fees, checks balance and live chain/account state, waits for a bounded receipt, and verifies the deployed runtime before attaching it.
- The launch video is checked and truthfully says “mainnet-ready” until the deployment verifier passes.
- `mainnet/release-evidence.json` remains pending until the human wallet deployment is independently verified.

## 1. Re-run the release gate

```bash
rtk pnpm --dir arc-module test
rtk pnpm --dir arc-module typecheck
rtk pnpm --dir arc-module build
rtk pnpm --filter @grey/web test
rtk pnpm --filter @grey/web typecheck
rtk pnpm --filter @grey/web build
```

## 2. Open the wallet deployment UI

Run the standalone module with a mainnet-first default:

```bash
rtk env VITE_ARC_DEFAULT_CHAIN_ID=5042 pnpm --dir arc-module dev --host 0.0.0.0 --port 4173
```

Open `http://localhost:4173/app`, connect the employer wallet, confirm the banner says `Arc Mainnet · Native USDC · Chain ID 5042`, and independently review the contract source before signing. The wallet must contain enough native USDC for the deployment gas estimate. The application never requests a private key.

Click **Deploy GreyPayroll to Arc Mainnet** once. Preserve both values shown after confirmation:

- contract address;
- deployment transaction hash.

If the UI says the outcome is unknown, do not deploy again. Follow the shown transaction link and reconcile the original hash first.

## 3. Independently verify the deployment

The verifier is read-only and refuses the wrong chain, an unfinalized/reverted receipt, a non-canonical block, a mismatched receipt address, a non-CREATE transaction, changed creation/runtime bytecode, or an unexpected contract interface.

```bash
rtk proxy node scripts/verify-arc-mainnet.mjs <contract-address> <deployment-transaction-hash>
```

On success it writes:

- `mainnet/deployment-verification.json`;
- an updated `mainnet/release-evidence.json` with `status: deployment-verified`.

Do not announce an address or transaction as the Grey Finance mainnet deployment until this command passes.

## 4. Configure production

Use `production.env.example` as the Vercel variable checklist. Production must set `NEXT_PUBLIC_ARC_DEFAULT_CHAIN_ID=5042`; Testnet remains selectable. Keep `DATABASE_URL`, `CLERK_SECRET_KEY`, API keys and service credentials in Vercel environment variables only.

After the public URL exists, add it to Clerk's allowed origins and redirect URLs. Then verify sign-in, employer dashboard, employee profile, the embedded Arc module, wallet connection, Mainnet selection, and read-only contract attachment on the deployed origin.

## 5. Public proof and video

Once the verifier passes, replace only the video's explicit `MAINNET READY` placeholders with the verified address and transaction. Keep the exact Testnet rehearsal claims as Testnet evidence. Start the checked HyperFrames preview and review it locally before rendering/exporting.

A real mainnet payout is a separate human-signed action. Record its exact recipient/amount plan before signing, preserve the original run ID through any uncertainty, and verify the finalized receipt/events before adding a payout transaction to the release manifest.
