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

## SatsAcademy release

SatsAcademy is public at [grey-finance.vercel.app/academy](https://grey-finance.vercel.app/academy). Source revision `0cb796eab39c230202bc395b1034dabf46748516` was published to the existing personal repository. Its production deployment is [grey-finance-d2893yepy-greyw0rks-projects.vercel.app](https://grey-finance-d2893yepy-greyw0rks-projects.vercel.app).

The release adds separate Academy profile, progress, quiz, achievement and receiving-wallet tables to the existing Convex production deployment. Existing company tables and indexes were retained. Academy wallet credentials have a separate encryption scope and expose receiving operations only.

[Release checks](evidence/academy-release-checks.json) record 339 passing tests, production builds and typechecks, and 57 passing local browser checks. [Hosted wallet evidence](evidence/academy-convex-regtest.json) records 23 checks and an actual 10-sat private-regtest payment. The receiving wallet supplied the matching preimage before the practical badge was awarded. [Hosted browser acceptance](satsacademy/hosted-acceptance/2026-11-16/verification.json) covers eight direct routes, fonts, security headers, exact build assets and GreyFinance's Connect sign-in.

The temporary signed-NWC relay permission was removed after this Academy check. Its proxy and tunnel were stopped, and disposable wallet connections and sessions were removed. Recorded receipts remain. No mainnet payment, independent adoption or Devpost submission is claimed. Connect and GreyFinance video preview ports 4417–4420 remain closed at the user's request; final video rendering, export and submission URLs are the user's responsibility.
