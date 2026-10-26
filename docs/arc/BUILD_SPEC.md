# Grey Payroll Arc Studio build specification

Current user-approved scope: Arc powers Grey’s entire money layer, with employer-approved native-USDC treasury, payroll and refund flows integrated into the company dashboard. Build all application and contract implementation in Arc Studio. The old code is read-only reference; do not copy its unsupported execution claims or emergency withdrawal model.

## Network facts

Verified against official Arc documentation on 2026-10-24:

- Mainnet: chain ID 5042; RPC https://rpc.mainnet.arc.io; explorer https://explorer.arc.io.
- Testnet: chain ID 5042002; RPC https://rpc.testnet.arc.io; explorer https://explorer.testnet.arc.io.
- Native USDC has 18 decimals. Optional ERC-20 USDC at 0x3600000000000000000000000000000000000000 has six decimals and represents the same underlying balance.
- Use native USDC consistently in this MVP: payable deposits, native payouts, parseUnits(input, 18), formatUnits(value, 18). Never convert money through Number, floats or scientific notation.
- Arc has a 20 Gwei maxFeePerGas floor. Reserve wallet funds for gas and estimate fees using current RPC data.
- Native transfers can fail for restricted, zero or non-payable recipient addresses. Payroll must revert atomically on any failed transfer; never mark the run paid after partial execution.
- Arc finality is deterministic on inclusion. Require a successful receipt and verify this contract's payment events. A timeout is an unknown/pending outcome, not proof of failure.
- Use Arc Foundry for Arc-specific runtime testing where available. Standard Foundry unit tests do not prove blocklist or system-event behavior.

Official references:

- https://docs.arc.io/arc/references/connect-to-arc.md
- https://docs.arc.io/arc/references/evm-differences.md
- https://docs.arc.io/arc/references/contract-addresses.md
- https://docs.arc.io/arc/tutorials/install-arc-foundry.md

## One minimal contract

Implement a new native-USDC multi-employer payroll contract. Each wallet has an isolated funded ledger balance. No administrator or relayer may withdraw another employer's money.

- `deposit()` payable credits only msg.sender; reject zero deposits.
- `withdraw(uint256 amount)` returns only msg.sender's uncommitted funded balance; reject zero/excessive withdrawals and reentrancy.
- `executePayroll(bytes32 runId, address[] recipients, uint256[] amounts)` debits only msg.sender's balance and transfers the full payroll atomically.
- Enforce nonempty equal-length arrays, a small documented upper bound (e.g. 50), nonzero amounts, nonzero recipient addresses, no recipient equal to the payroll contract, no duplicate recipients, nonzero run ID and employer-scoped replay protection.
- Check total funding, record run execution and debit the ledger before external calls; protect all value-moving entry points against reentrancy.
- Reverting recipient payments must revert the entire run, including ledger changes, replay marker and events.
- Expose employer balance and whether that employer/run ID has executed. Keep totals and invariants verifiable. Explain that uncommitted funds are withdrawable; this is not a promised locked salary buffer.
- Emit deposit, withdrawal, run summary and per-recipient payment events with indexed employer and run ID. Reconciliation uses these events, not token-emitter heuristics or database flags.
- Avoid proxies, autonomous AI payments, emergency sweeping, arbitrary owner powers, unbounded loops and new libraries without need.

## Functional web module

Use Arc Studio's supported Vite/React/TypeScript sandbox and viem/wagmi where supported. Deliver complete source, ABI, reproducible bytecode generation and build instructions. No dependency on Grey's existing Clerk/Postgres/Redis environment.

The primary flow is an inline payroll workspace: recipient rows and amount inputs, review section, funding action, execution action and reconciliation. Preserve Grey's incumbent warm light palette (#F4F3EE background, #FFFFFF surface, #16181C foreground, #3DDC84 action accent with dark text), restrained borders and familiar product typography. Use semantic form controls, tabular amounts and clear keyboard focus. Do not build a new marketing landing page or template dashboard. All populated example data is labelled illustrative and starts unpaid.

- Connect an injected employer wallet; explicitly display Arc mainnet/testnet and add/switch the selected chain. Use separate contract configuration, drafts and history for each chain, contract and employer wallet.
- Provide exact decimal text inputs with validation, maximum 18 decimal places, no negative/nonfinite/scientific values, and no rounding hidden from the employer.
- Allow adding/removing recipients and preparing a run; flag duplicate/invalid recipients and unusually large draft values where an explicit rule exists. Label deterministic advice as review checks, not a live AI service.
- Show wallet USDC once, funded contract balance, total payroll and gas needs. Never show native and ERC-20 balances as different assets.
- Require a visible final recipient/amount review and human confirmation before submitting payroll. Changes invalidate that confirmation.
- Use actual wallet writes for deposits, withdrawals and payroll, simulation before writes, and successful receipts before success. Handle wallet rejection, unsupported network, disconnected wallet, insufficient funds, reverted transfers, RPC errors and receipt timeouts.
- Generate a strong unique bytes32 run ID and persist it before submission. Keep it stable through retries/reloads. Use onchain replay checks to recover ambiguous outcomes; never silently create a new ID after a pending send.
- Record pending hashes immediately. On completion reconcile every recipient and amount against this contract's events. Handle replaced/cancelled transactions and retain the actual final hash.
- Version local storage and scope by chain + contract + employer. Store amount strings, not floating-point numbers. Confirm history with chain data rather than trusting local storage.
- Without a contract deployment, provide a truthful setup state and a wallet-signed deployment route from verified ABI/bytecode, or a documented attach-address route with chain, code and interface checks. A placeholder address never enables payment.
- Include a public read-only run/receipt view or shareable reconciliation export with contract, network, employer, recipients, amounts and confirmed transaction links. Do not expose private HR metadata onchain.
- Responsive desktop/mobile rendering; visible labels, accessible errors/status announcements, touch targets, and no page-load choreography. Parallelize independent reads; avoid stale wallet/chain state during a transaction.

## Required verification

Write meaningful contract tests: employer isolation, unauthorized spending/withdrawal, exact amount conservation, replay scoped per employer, empty/mismatched/oversized arrays, zero/duplicate/contract recipients, zero amounts, insufficient ledger funds, failed recipient rollback, malicious reentrant recipient and fuzzed amount conservation. Document limitations of standard EVM tests.

Test amount parsing and replay/recovery behavior on the frontend. Run frontend typecheck and production build, and inspect desktop/mobile UI once; repair observed defects in one batch. Produce honest test/audit reports with commands and actual results.

## Delivery and authorization boundary

This first task builds, tests and audits; do not broadcast any mainnet deployment, fund a contract or send payroll from a hosted wallet. The employer wallet address and payout recipients are not yet supplied. Prepare wallet-signed deployment and execution as concrete reviewable human actions. A testnet rehearsal may be prepared but is never described as a mainnet submission.

Required artifacts: contract source/tests, frontend source, ABI/bytecode generation, build/test results, audit findings, network configuration, README, a Studio provenance/build log, and a grant evidence template. Persist these as files. Provide the Arc Studio project URL. A Studio workspace preview is not a standalone public app URL; report that distinction honestly.

Grant evidence still needed: public app URL; public repo; mainnet contract address and payout transaction on explorer.arc.io; video showing the Studio build and that transaction; short project description; public builder profile. Deadline text is inconsistent: use November 1, 2026 as the conservative target, ahead of the portal's November 2 05:59 UTC+1 timestamp.
