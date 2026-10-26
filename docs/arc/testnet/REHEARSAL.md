# Actual Arc Testnet rehearsal — October 25, 2026

All three user-signed payment steps passed independent finalized-receipt, canonical-runtime, exact-event and employer-ledger verification. This is actual Arc Testnet evidence, separate from local EVM fixtures and unit tests.

- Chain: 5042002; RPC: https://rpc.testnet.arc.io.
- Contract: [0xb3bd28388099c84d33090b0e53330863b26567b9](https://explorer.testnet.arc.io/address/0xb3bd28388099c84d33090b0e53330863b26567b9).
- Employer: 0xB9e3A2D811729C11F64313F59922Ab37Afa52010.
- Second recipient: 0xc61Bbc0CF5694EF410A578A9833f77C173790450.
- Native USDC: eighteen decimals.
- Runtime keccak: 0xb219b4c8f0374fef7421d4cebb32c81dbd6dbbf44869d7569dad4209f8eeae9d.
- Run ID: 0x6de0d071991b8cc636f2e541aa5b85a9fe18c69e6297a2f469864b5e33664da3.

| Step | Test USDC | Finalized transaction | Receipt block | Employer ledger (USDC) |
|---|---|---|---|---|
| deposit | 0.10 | [0xa818d96a0a…](https://explorer.testnet.arc.io/tx/0xa818d96a0ab109e80fae3c4f90268a0933ba8e3e5877448c28fd81a5c9b944ac) | 69064154 | 0.1 |
| payroll | 0.03 (0.01 + 0.02) | [0x4b5d442bdf…](https://explorer.testnet.arc.io/tx/0x4b5d442bdfc23fdc74727c9987bbcc3a25c14bede76bdc5d1fc75384ea411fd2) | 69064804 | 0.07 |
| withdraw | 0.01 | [0x612a5fbd46…](https://explorer.testnet.arc.io/tx/0x612a5fbd46afdb2bdec02a96bc42fcb296add163b5c411747b6a0ab44aa97181) | 69065014 | 0.06 |

PayrollExecuted reported exactly two recipients and 0.03 USDC. Each PaymentSent matched the specified employer, original runId, recipient and amount. Deposited and Withdrawn matched their exact amounts and employer. Gas is outside the contract ledger. Final ledger: 60000000000000000 native units (0.06 USDC).

Replay protection passed: hasExecuted was true at a finalized block, and read-only simulation of the original payroll reverted with RunAlreadyExecuted. No replay transaction was broadcast.

The Studio-reported deployment transaction was independently decoded through its ERC-4337 smart-account execution: the inner operation succeeded, its factory call contained the canonical creation bytecode, ContractDeployed named the exact deployment, and the runtime at that finalized receipt block matched the pinned artifact. Compiler: Solidity 0.8.28, Cancun, optimizer 200 runs. Source and embedded creation/runtime bytes match the existing pinned Forge artifact.

Structured evidence: deployment-verification.json, deposit-verification.json, payroll-verification.json, withdraw-verification.json and replay-verification.json. wallet-rehearsal.json preserves the initial ledger (zero), recipient snapshot and completed steps. Public hashes were supplied by the user; no private key was requested or read. The scripts only read RPC state. This does not claim an automated full wallet-browser test, a Neon settlement import or any mainnet action.

Reverify a receipt with rtk proxy node scripts/verify-arc-rehearsal.mjs followed by deposit, payroll or withdraw and the saved public hash. For replay, use replay and the original payroll hash. Reverification uses the historical receipt block for ledger assertions; it does not resend transactions.
