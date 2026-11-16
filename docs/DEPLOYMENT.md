# GreyFinance deployment

The Bitcoin company treasury repurposes the existing personal repository [greyw0rks/grey-payroll](https://github.com/greyw0rks/grey-payroll) and [grey-finance.vercel.app](https://grey-finance.vercel.app). This supersedes the earlier GreyLabs publishing target.

The previous application remains in Git history and the archive branch recorded in the release evidence. The original local `grey-payroll` directory, including its uncommitted Arc changes, is preserved. The Bitcoin release is prepared in `/home/greyw0rks/greyfinance-bitcoin-release`. Existing Clerk, Neon and Arc financial data is not migrated, relabeled or deleted.

## Hosting

The Vite/React interfaces run on the existing `grey-finance` Vercel project in `greyw0rks-projects`. The repository-root build uses `pnpm build:release` and publishes `dist`: GreyFinance at `/` and SatsAcademy at `/academy/`. `/api/*` requests are rewritten to `https://intent-curlew-185.convex.site/api/*`. Each product's direct navigation routes serve its own frontend; `/satsacademy/*` redirects to `/academy/*`.

Convex production is `intent-curlew-185`. The separate development deployment is `elegant-caribou-763` in Europe/Ireland. Convex stores memberships, spending reservations, hashed sessions, encrypted delegated wallet connections and verified receipts. Node actions use the NWC SDK against the company's wallet.

Set `GREY_APP_ORIGIN=https://grey-finance.vercel.app` in Convex production. Set an independent `GREY_WALLET_ENCRYPTION_KEY`, a validated `GREY_MAX_PAYMENT_SATS` and a narrowly scoped `GREY_NWC_RELAY_ALLOWLIST`. These are server settings; never put wallet connection strings or encryption keys in browser variables. Predictable preview accounts remain disabled in production.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm typecheck:academy
pnpm typecheck:convex
pnpm build:release
pnpm exec convex deploy
```

The Vercel configuration includes same-origin API requests, a restrictive content security policy, denied framing, no-referrer navigation and immutable build assets. The repository's private vulnerability reporting is enabled.

## Verification

The supplied local lab uses actual Bitcoin Core and LND on a private regtest network. These coins have no monetary value. The retained [first hosted proof](evidence/greyfinance-convex-regtest.json) and [local proof](evidence/satfamily-regtest.json) are historical builder tests; their timestamps, original origins and source hashes are preserved.

The existing public domain completed a fresh [hosted payment check](evidence/greyfinance-personal-convex-regtest.json): a 150-sat company expense and a 100-sat incoming payment through two private LND regtest wallets. The expense required independent approval; employee payment, generic-route bypass and duplicate payment attempts were rejected. Both receiving wallets verified the payment preimages. Convex retained receipts after the disposable wallet connections were removed.

The public landing page passed at 1440, 1024, 390 and 360px. Separate browser acceptance verified actual NIP-98 sign-in, all six workspace views, ledger exports, exact-name company deletion, retained identity and sign-out at 1440, 390 and 360px. See [release evidence](evidence/greyfinance-personal-release.json) for the exact code revisions, deployment IDs and checks.

Temporary `GREY_REGTEST_RELAY_HOST` permission has been removed. The two relay-only test tunnels and their proxy were stopped after acceptance. Production inspection found no connected test wallets, unresolved payment attempts or duplicate company owners. Independent adoption and mainnet settlement are not claimed.
