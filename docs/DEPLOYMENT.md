# GreyFinance deployment

The Bitcoin company treasury repurposes the existing personal repository [greyw0rks/grey-payroll](https://github.com/greyw0rks/grey-payroll) and [grey-finance.vercel.app](https://grey-finance.vercel.app). This supersedes the earlier GreyLabs publishing target.

The previous application remains in Git history and the archive branch recorded in the release evidence. The original local `grey-payroll` directory, including its uncommitted Arc changes, is preserved. The Bitcoin release is prepared in `/home/greyw0rks/greyfinance-bitcoin-release`. Existing Clerk, Neon and Arc financial data is not migrated, relabeled or deleted.

## Hosting

The Vite/React interface runs on the existing `grey-finance` Vercel project in `greyw0rks-projects`. Its build starts at the repository root, uses `pnpm build -- greyfinance`, and publishes `apps/satfamily/dist`. `/api/*` requests are rewritten to `https://intent-curlew-185.convex.site/api/*`; other product routes serve the frontend.

Convex production is `intent-curlew-185`. The separate development deployment is `elegant-caribou-763` in Europe/Ireland. Convex stores memberships, spending reservations, hashed sessions, encrypted delegated wallet connections and verified receipts. Node actions use the NWC SDK against the company's wallet.

Set `GREY_APP_ORIGIN=https://grey-finance.vercel.app` in Convex production. Set an independent `GREY_WALLET_ENCRYPTION_KEY`, a validated `GREY_MAX_PAYMENT_SATS` and a narrowly scoped `GREY_NWC_RELAY_ALLOWLIST`. These are server settings; never put wallet connection strings or encryption keys in browser variables. Predictable preview accounts remain disabled in production.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build -- greyfinance
pnpm exec convex deploy
```

The Vercel configuration includes same-origin API requests, a restrictive content security policy, denied framing, no-referrer navigation and immutable build assets. The repository's private vulnerability reporting is enabled.

## Verification

The supplied local lab uses actual Bitcoin Core and LND on a private regtest network. These coins have no monetary value. The retained [first hosted proof](evidence/greyfinance-convex-regtest.json) and [local proof](evidence/satfamily-regtest.json) are historical builder tests; their timestamps, original origins and source hashes are preserved.

The new deployment ID, exact source revision, domain checks and updated acceptance evidence are recorded after release validation. Any temporary regtest relay permission is removed after hosted tests, and the disposable test wallet connections are disconnected. Independent adoption and mainnet settlement are not claimed.
