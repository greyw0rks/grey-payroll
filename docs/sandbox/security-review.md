# Bitcoin Sandbox security review

Reviewed November 16, 2026. This review covers the Sandbox API and its private Bitcoin Core regtest boundary. It does not establish an independent security audit, mainnet custody, or public adoption.

## Trust boundaries

- A browser supplies untrusted JSON and a session cookie. The server verifies the session and derives the learner identity; request bodies cannot choose an owner, Core wallet name, RPC method, or external payment address.
- A trusted server creates two separate Core wallets for each lab run. Learners share the regtest chain and block height; wallet access and application records remain owner-scoped.
- Bitcoin Core is a trusted local protocol implementation. Its credentials remain on the private runner and its RPC listener binds to loopback. Every Sandbox operation checks that the connected chain is regtest before requesting mutations.
- A hosted Convex adapter must authenticate to the private runner. The public browser never receives runner credentials, raw RPC access, PSBT signing material, or an unrestricted node operation.

## Findings in the initial implementation

1. **Uncertain broadcast recovery:** the initial route stored a transaction ID only after a successful send response. A lost response left an unknown claim with no usable reconciliation path. The signed transaction identity must be stored before dispatch, and recovery must inspect Core without signing or sending again.
2. **Concurrent lab creation and reset:** two start requests could create multiple funded runs and overwrite the current run. Reset could race signing and orphan the active transaction. Serialize per-owner mutations and refuse resets while signing or unknown claims remain.
3. **Session changes during Core awaits:** an authenticated request could outlive logout. Recheck the active session after awaited reads and immediately before sensitive mutations and private responses.
4. **Restart loading:** persisted wallet names alone do not establish that Core has loaded those wallets after restart. Reload only the current run's known wallet names when needed.
5. **Draft value correctness:** a missing decoded input value must not silently become zero. Require finite safe-integer satoshi values, nonnegative fees, the exact payment output, and input/output/fee conservation before offering a review.
6. **Resource boundaries:** run creation, previews, and mining need bounded rates and strict request shapes. A shared educational node must not expose arbitrary RPC or accept browser-supplied wallet names.
7. **Signed transaction integrity:** decoding the signed transaction is not sufficient by itself. Its inputs and outputs must match the saved review before dispatch. Explorer and experiment checks must also match the requested transaction ID and saved transaction facts.

The reviewed local backend now implements the corresponding controls. Claims and signed transaction IDs are durable before network dispatch, recovery uses reads, unresolved claims block resets, each learner's mutations serialize, and every awaited sensitive flow rechecks its session. Stored wallet names reload after a node restart. Strict satoshi conservation and signed input/output comparisons guard the review. The runner bounds each learner to eight lab creations and 120 preview/mining requests per hour. The verified test result is recorded below; hosted bridge validation remains separate.

## Acceptance tests

`tests/sandbox.test.ts` uses the real session middleware, isolated in-memory databases, a fresh temporary support directory, and a fake Core protocol boundary. It exercises mainnet exclusion, owner boundaries, concurrent creation and broadcast, literal confirmation, expiry, value conservation, signing-material privacy, session revocation during awaits, wallet loading, and read-only uncertain recovery. The fake boundary cannot contact a node or make a real payment.

Separate real Bitcoin Core acceptance remains necessary to establish wallet creation, funded PSBT decoding, transaction signing, broadcast, UTXO changes, mining, and confirmations. Regtest coins have no monetary value.

## Hosted runner requirements

The reviewed runner exposes a small application-action allowlist, authenticates the exact request body and operation, and persists request identifiers before dispatch. Exact replays return the stored response or a signed pending result. A reused reference with changed raw bytes or actor is rejected. The request binds the learner, operation, and a short expiry; response signatures bind the exact response bytes and original request reference. The anonymous status actor cannot read private state. Keep the runner secret and Core credentials server-side; keep them out of log messages and stored public metadata.

A per-owner in-process mutex protects a single runner replica. It is not a distributed lock. Multiple replicas require shared atomic claims or a queue before deployment.

## Limits to preserve in the product

This lab signs test transactions on its trusted private runner. It is not a mainnet wallet. Mining advances the shared regtest network. An unobserved uncertain transaction stays blocked until an operator can establish its outcome; a reset or automatic resend is not proof that it failed.

## Current acceptance status

The local API suite passed **33/33 tests with zero skips** after the signed input/output guard was added. The expanded suite first exposed the missing guard; the final run confirms both mutated inputs and outputs are rejected without a broadcast. Interrupted bootstrap funding resumes the original grant, and an unobserved grant remains blocked without sending another one. Checked experiments require owned broadcast evidence, the correct change output, and an actual node confirmation. Lesson evidence survives reset; exports omit signing material. Conflict/abandonment observations cannot finalize an uncertain claim.

Executed validation:

```bash
pnpm exec tsx --test tests/sandbox.test.ts
pnpm exec tsc --noEmit --strict --skipLibCheck --module NodeNext \
  --moduleResolution NodeNext --target ES2023 --allowImportingTsExtensions \
  --esModuleInterop tests/sandbox.test.ts
```

Both passed on November 16, 2026. These results establish isolated application behavior; they are not Bitcoin Core protocol acceptance or an independent security review. The Convex/private-runner bridge remains subject to its own authentication, replay, dispatch-journal, and awaited-session checks.

The signed private-runner suite subsequently passed **17/17 tests with zero skips**, including startup configuration failure, exact-byte HMAC domains, canonical operation restrictions, actor-bound state, short-lived authorization, concurrent replay, signed success/error responses, and expiry during a private Core read. Run it with `pnpm exec tsx --test tests/sandbox-bridge.test.ts`.

The unchanged Node API and signer baseline passed **100/100 tests** in a fresh temporary data directory. The two Sandbox suites and their imported backend/bridge code passed a combined strict TypeScript check. Convex dispatch and real Core acceptance are reviewed separately by the integration agents.

## Convex transaction-flow review

The focused Convex/private-runner suite passed **56/56 tests with zero skips** on November 16, 2026. The strict TypeScript check of that suite and its imported Convex backend also passed. The tests use isolated Convex records and an authenticated synthetic runner boundary; they do not contact Bitcoin Core or establish public deployment acceptance.

Two final concurrency controls were reviewed and exercised:

- After storing a verified runner result, the action checks the current session again before returning private data. Six regressions revoke, expire, or substitute the session after a snapshot or broadcast mutation commits but before its result reaches the action. Every response requires sign-in again. The committed account records and successful transaction receipt remain intact.
- A prepared status is definitive only when its signed read started after the original broadcast authorization and clock tolerance expired. The action passes the read's original `issuedAt` to the atomic mutation. Two regressions capture a prepared status or reconciliation response at 59 seconds and deliver it at 70 seconds. The broadcast remains uncertain, its export stays uncertain, and reset remains blocked. A fresh read started after expiry can establish that the original dispatch was rejected.

Executed focused validation:

```bash
pnpm exec vitest run tests/convex-sandbox.test.ts
pnpm exec tsc --noEmit --strict --skipLibCheck --module ESNext \
  --moduleResolution Bundler --target ES2023 --allowImportingTsExtensions \
  --esModuleInterop --types vite/client tests/convex-sandbox.test.ts
```

The earlier **33/33 local**, **17/17 runner**, and **100/100 Node baseline** counts remain their recorded checks; this final review did not repeat those suites. Root integration owns the complete release checks and fresh real regtest acceptance. No mainnet funds, external messages, or production deployment were used in this review.
