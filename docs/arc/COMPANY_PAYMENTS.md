# Company payments on Arc

Grey company accounts, employee invitations, attendance and requests remain in Clerk/Neon. Employers prepare payments from recorded, unpaid USDC attendance earnings and approved unpaid USDC refunds at `/arc-payroll`. Preparing a plan does not mark a record paid.

The server reserves each selected obligation and saves a fixed snapshot of the company treasury, employer wallet, recipient wallets, exact amounts and a random bytes32 run ID before the wallet opens. Obligations for the same wallet are combined. A batch may contain up to 200 source records and 50 recipient wallets. Business records retain six decimals; Arc native USDC uses eighteen. Monthly salary settings do not override a captured attendance amount.

Only the linked employer wallet can sign the fixed plan on Arc Testnet (5042002). The company workspace cannot change the plan's chain, treasury, recipients or run ID. The module checks contract runtime before signing and writes local recovery state before the wallet prompt. It retains the executor through signing/mining and preserves the company run ID afterward.

A submitted hash is an unverified recovery hint. The server records salary/refund settlement only after checking the transaction's successful finalized receipt, canonical block hash, canonical GreyPayroll runtime at the receipt block, and the exact employer/run-scoped `PayrollExecuted` and `PaymentSent` events against the fixed plan. Unrelated runs in a smart-account transaction are not assigned to this company plan. The verified hash may be a replacement hash.

Confirmation locks the plan and atomically creates salary releases using their original six-decimal amounts, writes refund settlement hashes, and records receipt block/hash and verification time. Repeated confirmation of the same hash is idempotent. Browser notifications only request another server read and never prove payment.

Employer and employee paid totals include verified Arc-linked salary records. Approved refunds remain “Approved · awaiting payment” until verified. Historical transfers remain historical records; their amounts and asset meaning are preserved. The earlier standalone testnet rehearsal cannot be assigned to a new company plan.

## Recovery

A timeout, missing finality or interrupted server write leaves the plan PREPARED and its source records reserved. Paste the original or confirmed replacement transaction hash into “Verify and record payment” on the same plan. Do not create another plan for these obligations or change the run ID to resolve uncertainty. Pending/unknown local runs and already executed runs block another company signing prompt. A reverted transaction or definite cancellation can be retried with the same plan/run ID.

There is no plan cancellation or reservation-release action in this milestone. Employee salary wallet changes are blocked while that employee has PREPARED obligations, except saving the same wallet address. Company plan snapshots remain fixed if company treasury settings subsequently change.

## Validation and actual account check

`apps/web/validation/arc-company-payments.test.ts` uses isolated local PostgreSQL and mocked RPC methods with canonical bytecode and ABI-encoded event fixtures. It checks company/auth/origin isolation, reservations/concurrency, exact amounts, historical preservation, canonical finalized evidence, atomic/idempotent recording, advisory hints, wallet guards and employee paid statuses. Module tests cover snapshot tampering and signing lifecycle. `apps/web/validation/check-company-payments-ui.mjs` checks actual components at 1440px/390px with explicitly synthetic HTTP data and a stub wallet frame. These fixtures never touch Neon and do not claim human wallet/browser verification.

The reviewed additive migration is `20261025180000_arc_payment_receipts`. `scripts/migrate-arc-neon.mjs` defaults to a read-only status check. `--apply` checks migration history/checksums, applies only known migrations, and saves counts/hashes of existing company records before and after. The expected currency-label rename is normalized for comparison without changing financial amounts. No company fixtures are created by this helper.

For the actual signed-in check, open the local company app, sign in as the employer, and link the existing testnet contract `0xb3bd28388099c84d33090b0e53330863b26567b9` to wallet `0xB9e3A2D811729C11F64313F59922Ab37Afa52010` using the dashboard's expiring signature challenge. This is a message signature, not a deposit. Verify the server's company binding and balance before preparing any company payment. Review the actual unpaid obligations and their test-USDC amount before asking for a payment signature; never manufacture attendance/refunds in Neon to make a demonstration. After a real company-plan payment, check both employer history and the recipient's employee view.

Public preview publication, mainnet spending and grant submission require separate authorization.
