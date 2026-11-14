# GreyFinance security notes

## Assets and trust boundaries

The assets are the company wallet’s delegated permissions, authenticated membership, approval state, budget reservations, and payment records. The browser is not trusted to assign a role, mark a payment paid, select another tenant’s wallet, or release a payment reservation.

The company’s wallet provider is trusted to expose authentic wallet operations through NWC. The application verifies the resulting Lightning proof: the payment preimage must hash to the invoice payment hash. The source NWC account/connection fingerprint is `SHA-256("nwc:" + servicePubkey + ":" + clientPubkey)`. It is persisted with the receipt and compared when reconciling an uncertain payment, so two accounts on the same service cannot be confused.

The server holds the delegated spending connection when spending is enabled. A compromised server or provider remains a material risk. Application approval controls do not replace provider-enforced spending limits or multisignature authorization.

## Controls

- Authenticated workspace membership and role checks apply to every company route.
- One owned company is allowed per Nostr identity; membership in other companies remains available. Legacy accounts with multiple owned companies cannot perform treasury operations until distinct company wallet bindings are supported. Existing records are preserved.
- A live identity cannot access the demo workspace. A live organization cannot borrow the local shared treasury.
- Employees receive only their own expense records and allowance. Incoming company records, treasury balance, other member limits, and workspace audit records are withheld.
- Owner removal/demotion is blocked. Removed members lose access, and their unattempted expense cannot be approved or paid.
- A requester cannot approve or pay their own request, even when they have an owner or finance role.
- Invoice parsing rejects invalid, expired, amountless, duplicate, fractional-sat, and policy-exceeding requests through the shared proven parser and server input validation.
- Approval and reservation happen in one database transition. The local lab uses SQLite `BEGIN IMMEDIATE`; the chosen production backend uses Convex mutations. Outstanding reservations continue to count after a month boundary.
- Settlement is assigned to its actual observed/provider settlement period, not the request creation month.
- The transition from approved to paying is atomic. Parallel requests and repeated calls cannot trigger a second wallet payment.
- The shared operator payment cap is checked before resolving a wallet and again before the payment claim. Over-limit or invalid-cap requests cannot contact the wallet or claim a payment. Ownership ambiguity and access are rechecked after wallet awaits before claims or receipt writes.
- A missing, invalid, or uncertain payment proof moves the request to `unknown`. Its budget remains reserved. No automatic retry is offered.
- Reconciliation checks the original wallet connection fingerprint, payment hash, amount, and preimage.
- Expiry releases only an unattempted pending or approved request, with an audit event. Paying and uncertain requests remain reserved.
- Credentials stay out of browser storage. The server encrypts delegated connections. Team names and invoice bodies are not written to diagnostic logs by the company router.
- Sample expense rows carry an explicit fixture flag. They may be reviewed, but their payment endpoint always rejects wallet execution.
- Verified receipts retain the public payment preimage, settlement time, and source NWC account/connection fingerprint. Receipt exports contain these proof fields and explicitly identify sample rows.
- Settled receipts remain canonical when a later pending, expired or timed-out wallet response arrives. A concurrent successful reconciliation cannot be overwritten by a delayed failure.
- Only the company owner can delete a live workspace, after entering its exact current name. The transaction blocks any in-progress or uncertain expense in an owned company and any unresolved owner-wallet payment. It removes the selected company's records and stored owner connection while preserving identity, sessions, personal payment history and other memberships. Failed deletion rolls back the records and persisted connection together.

The shared platform additionally handles signed Nostr identity authentication, session cookies, replay rejection, origin checks, secret encryption, NWC capabilities, relay validation, and provider transport policy. Those controls must remain enabled in deployment.

## Tested behavior

The local suite in `tests/satfamily.test.ts` exercises security and lifecycle scenarios using isolated in-memory SQLite databases and an authenticated test context. Ownership and legacy-state regressions cover company creation races and post-wallet-await checks. Operator-cap regressions assert zero wallet calls before rejection. Account-switch regressions change the client public key while retaining the wallet service key, reject verification before lookup, and confirm that the original connection can resume verification. Temporary identity checks use real Schnorr signatures, exact NIP-98 URL/method/payload, distinct login-event nonces, and an environment that rejects browser key storage. Deletion tests verify owner access, exact names, unresolved-payment guards, cascade scope, retained account history and atomic rollback. Deferred HTTP checks prove that late wallet failures and expiry responses cannot erase a concurrently verified receipt.

The earlier `docs/evidence/satfamily-regtest.json` preserves historical private Bitcoin regtest/LND payments with the previous service-key source reference. It is not relabeled as current connection-fingerprint or Convex evidence. Production Convex regressions and hosted acceptance have their own checks and deployment record. Local checks do not demonstrate independent adoption or a production security audit.

## Operational limits

Budgets currently count invoice amounts, not routing fees. Wallet binding is per owner, with one owned company per Nostr identity and fail-closed treasury guards for legacy duplicate-company accounts. Provider-level caps remain essential. SQLite audit history can be changed by an operator with database access; it is not an immutable chain record. Safe wallet rotation, backup, recovery, persistent hosted storage, and access revocation at the provider must be part of a deployment plan.

Do not run public preview persona endpoints in live production. Keep the regtest lab private and clearly labeled. Never supply a mainnet seed phrase to the application. Before wider live use, complete a separate security review and a small, explicitly capped company pilot.
