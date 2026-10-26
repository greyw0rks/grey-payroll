# Grey Payroll — Security Review Report

**Contract:** `contracts/GreyPayroll.sol`  
**Build date:** 2026-10-24  
**Preset:** max (Critical + High + Medium + Low)  
**Reviewers:** solidity-auditor (rule corpus), functional-auditor (end-to-end correctness)

---

## Summary

| Severity | Total | Auto-fixed | Remaining |
|----------|-------|------------|-----------|
| High     | 1     | Documented (spec-intentional) | 0 |
| Low      | 2     | 1 applied, 1 closed | 0 |
| Functional | 0   | —          | 0         |

Both auditors reported zero unresolved findings after fixes.

---

## Finding 1 — HIGH (spec-intentional, documented)

**Title:** Atomic batch payroll can be DoS'd by a single blocked/non-payable recipient  
**Corpus rule:** `arc-native-value-transfer-reverts-blocklist-zero-address-precompile`  
**Location:** `GreyPayroll.sol::executePayroll`

**Issue:** `executePayroll` uses push-payments to each recipient via native call. On Arc, native sends can fail not only for contract `receive()` behavior but also for Arc-specific address restrictions (blocklisted addresses, precompiles, system contracts). A single un-transferable recipient causes the full run to revert, preventing all other recipients from being paid.

**Resolution:** This is the exact behavior required by the BUILD_SPEC: *"Reverting recipient payments must revert the entire run, including ledger changes, replay marker and events."* A pull-payment model is architecturally sound but outside the specified MVP scope. The `PaymentFailed` error now includes the failing recipient's address, amount, and array index so the employer can identify and remove the problematic address before re-submitting under a new `runId`.

**Documentation added in contract:** Full NatSpec on `PaymentFailed` explains the Arc-specific failure modes and the recommended employer action.

---

## Finding 2 — LOW (applied)

**Title:** Custom errors lacked diagnostic context parameters  
**Corpus rule:** `custom-error-context-parameters`  
**Location:** Multiple custom errors throughout `GreyPayroll.sol`

**Fix applied:** Added typed parameters to all non-trivial custom errors:
- `InsufficientBalance(uint256 available, uint256 required)`
- `ArrayLengthMismatch(uint256 recipientsLen, uint256 amountsLen)`
- `ZeroAmount(uint256 index)`, `ZeroRecipient(uint256 index)`, `SelfPayment(uint256 index)`, `DuplicateRecipient(uint256 index)`
- `PaymentFailed(address recipient, uint256 amount, uint256 index)`

All revert sites updated to pass concrete values.

---

## Finding 3 — LOW (closed, no action)

**Title:** Withdraw event emitted after external call  
**Corpus rule:** `emit-events-before-external-calls`  
**Location:** `GreyPayroll.sol::withdraw`

**Disposition:** CEI ordering is correct — the ledger is debited before the native transfer, preventing reentrancy. Emitting `Withdrawn` *before* the external call would be semantically incorrect (an event should record what happened, not what was intended) and could cause confusion in event-driven reconciliation. The reentrancy guard independently prevents re-entry. No change made.

---

## Functional Audit

No findings. The functional auditor verified:
- Employer isolation: each employer's balance is fully independent.
- Atomicity: partial execution is impossible (CEI + reentrancy guard).
- Replay protection: `runExecuted[employer][runId]` is per-employer, not global.
- CEI ordering is correct in both `withdraw` and `executePayroll`.
- Reverting recipients cause full rollback including the replay marker.
- `receive()`/`fallback()` correctly reject plain transfers.
- `totalDeposited` invariant is maintained across all code paths.
- No fund-lock vectors: employers can always withdraw uncommitted balance.
- Arc-specific failure handling is documented in contract NatSpec.

---

## Test Results

**84 tests passed, 0 failed** (forge test, 2026-10-24)

Test files:
- `contracts/test/GreyPayroll.Base.t.sol`
- `contracts/test/GreyPayroll.Deploy.t.sol`
- `contracts/test/GreyPayroll.Deposit.t.sol`
- `contracts/test/GreyPayroll.Withdraw.t.sol`
- `contracts/test/GreyPayroll.Payroll.t.sol`
- `contracts/test/GreyPayroll.Revert.t.sol`
- `contracts/test/GreyPayroll.Isolation.t.sol`
- `contracts/test/GreyPayroll.Reentrancy.t.sol`
- `contracts/test/GreyPayroll.Fuzz.t.sol` (256 fuzz runs)
- `contracts/test/GreyPayroll.Invariant.t.sol` (256 runs × 500 calls = 128,000 calls)

**Limitation:** Standard EVM unit tests cannot verify Arc-specific native USDC blocklist enforcement, chain-level transfer restrictions, or system-contract interactions. Those paths require a live Arc fork (Arc Foundry) or a live testnet integration test.

---

## Audit Provenance

| Subagent | Dispatched | Files audited | Corpus rules cited |
|---|---|---|---|
| solidity-auditor | yes | 1 | arc-native-value-transfer-reverts-blocklist-zero-address-precompile, emit-events-before-external-calls, custom-error-context-parameters |
| functional-auditor | yes | 1 | — |

> **Reminder:** This max-preset review is best-effort against Arc Studio's internal rule corpus. It is NOT a substitute for a paid third-party audit before mainnet deployment with real funds.
