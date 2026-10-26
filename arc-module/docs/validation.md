# Grey Payroll — Validation Record

**Date:** 2026-10-24  
**App:** grey-payroll-arc  
**Source:** `/home/user/app`

---

## Build checks

| Check | Command | Result |
|-------|---------|--------|
| Lint | `bun run check` (oxlint) | 0 errors, 0 warnings |
| TypeScript | `tsc --noEmit` | 0 errors |
| Production build | `bun run build` | ✓ succeeded (16.55 s) |
| Dev server | PID 2164, port 5173 | Running |

---

## Frontend unit tests

**Framework:** Vitest 3.2.7  
**Command:** `bun run test`  
**Environment:** jsdom

### Results: 105 / 105 passed, 0 failed

| File | Tests | Status |
|------|-------|--------|
| `__tests__/money.test.ts` | 41 | ✓ all pass |
| `__tests__/runId.test.ts` | 13 | ✓ all pass |
| `__tests__/storage.test.ts` | 20 | ✓ all pass |
| `__tests__/reconcile.test.ts` | 13 | ✓ all pass |
| `__tests__/txController.test.ts` | 18 | ✓ all pass |

### Coverage by module

**money.ts** (41 tests):
- `parseNativeUsdc`: one wei, 18 decimal places, 0.01/0.02 USDC, uint256 boundary, scientific notation rejection, overflow rejection, too-many-decimals rejection, negative/empty rejection
- `formatNativeUsdc`: zero, one wei (full 18 decimal display, NOT truncated to zero), round-trip with parseNativeUsdc
- `sumAmounts`: empty array, normal sum, uint256 overflow guard
- `validateAmountStr`, `validateAddress`: valid/invalid inputs

**runId.ts** (13 tests):
- `generateRunId`: 0x-prefixed 64-char hex (32 bytes), not zero hash, 50 unique IDs from successive calls, uses real viem keccak256
- `isValidRunId`: accepts generated IDs, rejects zero hash, wrong length, wrong prefix

**storage.ts** (20 tests):
- `loadState`: empty, version mismatch → empty, restores saved state
- `upsertRun` dedup: same runId → 1 record with merged status; different runId → 2 records (newest first)
- Immutable snapshot: never overwritten by second upsert; submittedAt never overwritten
- txHash never downgraded: known hash preserved when patch passes null; null → real value works
- `patchRun`: patches status, no-op for unknown runId
- `requireDurableWrite`: returns null on success; returns StorageWriteError on QuotaExceededError
- Scope isolation: different employer / chainId / contractAddress each have separate scopes
- `saveDraft`: saves and reloads; clears on null
- Pending/unknown reload: reloads with original runId/txHash/status

**reconcile.ts** (13 tests):
- Successful match: single recipient, two recipients, 0.01 and 0.02 USDC (not truncated)
- onchainTotal set from PayrollExecuted event
- Reverted receipt (status=reverted) → failed, no event lookup
- Missing PaymentSent → failed with `Missing PaymentSent` discrepancy
- Extra PaymentSent (count > snapshot) → failed with count discrepancy
- Wrong employer in event → eventFound=false, failed
- Amount mismatch → failed with `mismatch` discrepancy
- Wrong runId in event → eventFound=false
- Unrelated contract address filtered from PaymentSent logs
- `verificationToStatus`: confirmed iff receiptStatus=1 AND eventFound AND amountsMatch
- Fake stored confirmation: reverted receipt → reconcile returns failed regardless of stored status

**txController.ts** (18 tests):
- Happy path → `confirmed` with correct txHash; onSubmitted callback fires before receipt
- Fee floor: 5 Gwei network fee → 20 Gwei passed to writeContract; 40 Gwei network fee → 40 Gwei passed
- Gas headroom: 130% of estimate passed to writeContract
- Simulation failure → `rejected` (not `unknown`)
- Insufficient native balance → `rejected` with "Insufficient wallet balance" message
- Exact-sufficient balance → `confirmed`
- Stale account (different address before send) → `rejected`
- Null account → `rejected`
- Stale chain (different chainId before send) → `rejected`
- Null chain → `rejected`
- Wallet rejection (writeContract throws) → `rejected`
- Receipt timeout (waitForTransactionReceipt throws) → `unknown` with txHash preserved; onUnknown callback fires
- Reverted receipt → `failed` with txHash and reason
- Gas estimation failure fallback → proceeds to `confirmed` (simulation passed)
- maxFeePerGas always present and ≥ 20 Gwei in writeContract call

---

## Contract tests (Foundry)

**Command:** `forge test`

### Results: 84 / 84 passed, 0 failed, 0 skipped

| Suite | Tests | Status |
|-------|-------|--------|
| Deploy | 6 | ✓ |
| Deposit | 9 | ✓ |
| Withdraw | 11 | ✓ |
| Payroll | 15 | ✓ |
| Revert | 11 | ✓ |
| Isolation | 7 | ✓ |
| Reentrancy | 4 | ✓ |
| Fuzz | 4 (256 runs each) | ✓ |
| Invariant | 4 (256 runs, 128,000 calls each) | ✓ |

All `expectRevert` calls use `abi.encodeWithSelector` with typed parameters matching the current contract error signatures.

---

## Local EVM vs Arc runtime note

Standard Foundry tests run on a local EVM (Cancun). They verify:
- Function logic, CEI pattern, reentrancy guard, replay protection, arithmetic correctness
- All 84 tests pass on the standard EVM

They do NOT verify Arc-specific runtime behaviour:
- Arc blocklist enforcement (only the Arc RPC node enforces this)
- Native USDC gas deduction mechanics (the local test EVM uses plain ETH)
- 20 Gwei gas price floor (enforced by the Arc sequencer, not the EVM itself)
- System events and Arc-specific precompiles

These Arc-specific properties can only be tested on a live Arc Testnet or Mainnet node. The `txController.ts` enforces the 20 Gwei floor client-side before broadcast.

---

## Items fixed in this turn

| Item | Description | Fixed |
|------|-------------|-------|
| A | txController: gas estimate WITH headroom PASSED to writeContract; stale account/chain guard; finite wait; unknown on timeout | ✓ |
| A | ContractSetup: chain guard before deploy; bytecode keccak on reload | ✓ |
| B | storage: StorageWriteError type; requireDurableWrite blocks signing; txHash never downgraded | ✓ |
| C | ContractSetup: keccak256(runtimeCode) vs canonical hash; impersonation detection; post-deploy verify | ✓ |
| D | RunHistory: ALL statuses re-verified on mount; unverified indicator; human USDC amounts (not wei) in table and CSV | ✓ |
| E | package.json: renamed to grey-payroll-arc; Vitest + jsdom added; unused Circle SDK deps removed; vercel.json added; npm-compatible scripts | ✓ |
