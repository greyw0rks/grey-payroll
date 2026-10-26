# Grey company dashboard continuation

The user confirmed that Grey provides one payroll space per company, with employer and employee roles. A company header reads “Company name by Grey”. The employer creates employee invitations, employees join that employer only, leave requests reach their employer, and each employee checks in once per company-local calendar day. Arc payroll belongs inside the existing Grey employer dashboard.

## Backend configuration

The current web application uses Neon PostgreSQL and the existing Clerk application. Both connection checks succeeded on 2026-10-24. Neon already held the baseline Grey schema; the initial migration was marked as applied without replacing existing tables or company records. New Arc treasury-binding and historical-currency migrations were verified locally on October 25; this continuation has not applied them to Neon. Credentials live only in ignored `apps/web/.env.local`.

An isolated local PostgreSQL cluster is available for tests. It persists in ignored `.local-db/` and binds to `127.0.0.1:55432`. Start it with `pnpm db:local`; `pnpm db:setup` follows the configured `DATABASE_URL`, including Neon. The integration-test config reads the local cluster credentials directly and never loads the Neon connection.

## Surfaces and behavior

- `/dashboard`: company attendance, approved leave, outstanding invitations, requests, treasury and confirmed salary totals.
- `/home`: employee wallet, daily check-in, recorded earnings, confirmed salary, refunds and attendance.
- `/staff`: add an employee, generate a secure code and copy it before closing the form.
- `/register/employee`: verify an invitation and show the owning company before activating the account.
- `/sign-in` and `/sign-up`: themed Clerk account screens. New accounts choose employer or employee registration. Existing account routing checks database membership directly.
- `/arc-payroll`: employer dashboard integration. The company CSV contains only its active USDC employees with wallets. Amounts are human decimal strings; Arc parses them into its native eighteen-decimal units.
- `/arc-module/app` and bundled assets: server checks employer membership. Embedded draft/run/contract settings also include the company ID in their local storage scope.

Attendance never claims a salary transfer occurred. Historical “Paid” totals use existing `SalaryRelease` records; they are not proof of Arc settlement. Wallet values use Arc native USDC. Company treasury values require an employer-signed company binding, a canonical-runtime match and finalized employer-ledger reads. Unavailable balances are not displayed as zero.

## Running

Run `pnpm arc:bundle` once to prepare the embedded Arc assets, then `pnpm --filter @grey/web dev --hostname localhost --port 3000`. Web production builds include the Arc bundle automatically. Do not run a Next.js development server and production build against the same `.next` directory at the same time.

Run `pnpm --filter @grey/web test` while the local PostgreSQL cluster is running. The tests create and remove only their unique fixture records. Arc checks run with `npm test` and `npm run lint` inside `arc-module/`.

## Validation scope

Web tests cover company-scoped staff access, cross-company check-in and leave review rejection, single-use invitations, daily check-in races, exact refunds, own-wallet updates, company CSV exports, and dashboard rendering. Arc tests cover exact CSV import and company-local persistence alongside the existing payroll helpers.

On October 24, Neon/Clerk connection and anonymous-access checks passed. Fresh October 25 checks: all 29 company-platform tests passed against isolated local PostgreSQL/RPC fixtures, including company-bound wallet signatures, challenge replay/races, runtime identity and finalized reads. Existing treasury-widget captures cover four desktop/mobile setup/linked/unavailable states without overflow. Final web typecheck/build status is in docs/arc/RESUME.md. No Neon company records were changed by these checks.

Dashboard screenshots in `apps/web/.impeccable/review/` use labelled synthetic Labtech fixtures and stub account/wallet chrome. Login/signup captures and anonymous route checks use the actual Next.js app. These captures are UI evidence, not proof of a signed-in company session or payroll settlement. No external account was created for the review.

Actual Arc Testnet deployment and the user's deposit 0.10, payroll 0.01+0.02, withdrawal 0.01 and replay protection are independently verified. Final employer ledger is 0.06 USDC; finalized receipt/event evidence is in docs/arc/testnet/REHEARSAL.md. This does not claim a signed-in company binding or importing settlement into Neon. Web typecheck and production build including the embedded module passed. No public app deployment or code publication was performed.
