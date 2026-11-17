# Security, privacy, and limits

These notes explain the product boundaries. The [release record](RELEASE.md) separates tested local behavior from hosted acceptance. This engineering review is not an independent security audit.

## What needs protection

The private runner holds learning-wallet keys and Core RPC credentials. Authentication sessions, the association between an account and its wallets, prepared transactions, broadcast records, and learning preferences also need protection. Although regtest coins have no monetary value, an unrestricted runner could expose other learners' data or exhaust the operator's resources.

## Threat model

| Threat | Required boundary |
| --- | --- |
| Another learner reads or spends your lab | Bind every wallet, preview, operation, and transaction lookup to the authenticated owner and current lab run. |
| An attacker substitutes a mainnet node | Verify the Core chain is `regtest`; stop before wallet or transaction mutations on any other chain. |
| A forged request reaches arbitrary Core commands | Expose a bounded lab API, not a general RPC proxy. Keep RPC loopback/private. |
| A double click or retry sends twice | Atomically claim a reviewed preview once and return or recover its existing result. |
| A lost response is treated as a failed broadcast | Retain an uncertain operation and check Core for the original transaction before any new attempt. |
| Concurrent start/reset mixes two lab runs | Serialize or atomically reserve account operations, bind results to the current run, and reject stale previews. |
| Wallet creation, previews, or mining exhaust resources | Validate amounts and fee rates, enforce per-account mutation limits, and make cleanup deliberate. |
| A stolen session or replayed sign-in changes state | Use verified request-bound Nostr authentication, replay protection, secure sessions, and server-side owner checks. |
| Browser content exfiltrates credentials | Keep credentials server-side, use a restrictive content security policy, and render untrusted text safely. |

Core supplies the transaction facts used for experiment completion. The retained local acceptance exercises owner boundaries, literal broadcast confirmation, value conservation, receipt recovery, reset, export, and session revocation. Final source hashes and hosted bridge acceptance are recorded separately.

## Wallet and chain boundaries

Bitcoin Core owns the educational wallet keys and signs transactions on the runner. Users do not gain independent Bitcoin custody by using this app. Importing real wallet seeds, mainnet signing, arbitrary receiving destinations, and real-money transfers are outside the lab workflow.

Alpha and Beta are separate wallets, scoped to a learner. Their blockchain and mempool are shared with other labs on the runner. Mining therefore changes node-wide confirmation state. Wallet separation must not be described as a separate isolated blockchain for each learner.

A preview contains payment/change/fee information and an expiry. It does not establish broadcast. The broadcast step requires explicit confirmation of the saved preview. Unknown outcomes remain visible through saved-preview status and read-only reconciliation; they must not trigger an automatic second payment. Reset is blocked while a signing or unknown broadcast remains unresolved.

## Identity and hosted trust

Nostr signs request-bound identity authentication; Core implements the Bitcoin learning wallets. A compatible signer such as Connect keeps the identity key outside the website. Local practice accounts are enabled only in the local environment when explicitly configured.

The temporary identity generates a Nostr signing key in browser memory. Reloading loses that key. An existing session cookie may continue to work until it expires or is revoked, but the learner cannot recover or sign in again as the same temporary identity afterward. A recoverable signer is required for ongoing access.

Hosted operation adds Convex and a private Core runner. The runner accepts a bounded allowlist of lab operations and authenticates the exact request body, actor, method, path, and short authorization window. It persists the request reference before dispatch. Responses bind to that reference with an HMAC. Exact replays return the stored result or pending status; altered replays are rejected. The public 35-check Core/Convex acceptance and 56 Sandbox Convex regressions are recorded in [RELEASE.md](RELEASE.md).

## Private data and exports

Do not log or export session cookies, signing keys, raw RPC credentials, private wallet files, or unrestricted runner credentials. Keep `.data/` and `.tools/` outside the source archive. Share selected regtest transaction evidence only with its network and builder-test labels intact.

The interface saves display and motion preferences and separately records Core-verified experiment completion. Reset creates a fresh wallet pair while retaining earned experiments and saved transaction receipts from older runs. Old receipts therefore remain evidence of those earlier transactions, not the new wallets' balances.

The learning-record export excludes PSBTs, raw signed transactions, keys, and credentials. It allows up to 500 saved previews and fails explicitly above that bound. Reset does not delete the account's history. Account-wide deletion and automatic wallet/data cleanup are not implemented in this release; the operator retains responsibility for private storage, backups, and retention.

## Current limits

Regtest results are protocol evidence with no monetary value. They do not establish mainnet settlement, independent adoption, guaranteed mainnet fees, or mainnet mining ability. Independent workshop testing and physical-phone accessibility checks remain separate from browser automation.

The free hosted demonstration uses a runner and tunnel on the builder's computer. The operator's supervisor probes signed regtest availability and recovers known-expired tunnels, updating only the two Sandbox Convex settings. It still requires the computer to remain online. Persistent production hosting, storage/backups, account deletion, and cleanup are further work.
