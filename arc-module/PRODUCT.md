# Grey Payroll on Arc

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Employers prepare, fund and approve payroll. Employees receive USDC in their own wallets. Grant reviewers need reproducible build and settlement evidence.

## Product Purpose

Grey’s complete blockchain money layer uses Arc native USDC for company treasury, employee balances, salaries and refunds. The payment engine is built through Arc Studio and integrated into the existing company platform.

## Operating Context

Prepare a run with recipient wallets and exact amounts, review exceptions, connect an employer wallet, fund that employer's contract balance, approve the run, then reconcile confirmed payments through explorer links.

## Capabilities and Constraints

- Arc Studio generates, tests and reviews the new contract and web app; Codex supplies reference material and retrieves artifacts.
- This MVP covers payroll preparation, funding, execution and reconciliation. The company dashboard and its financial records integrate the payment engine; native mobile and desktop payment interfaces remain later work.
- The employer's wallet authorizes payments. Advisory checks never authorize or send money.
- Arc mainnet is required for grant submission. A working preview or a testnet transaction alone does not qualify.
- Native USDC uses 18 decimal places on Arc. Its optional ERC-20 interface uses six and shares the same balance. This module uses the native interface consistently.
- Mainnet deployment and the example payout require a funded wallet and actual signatures. No real payment, funded address or mainnet settlement exists yet for this module.
- Public repository publication, the public app URL, the walkthrough video and submission remain delivery steps.

## Brand Commitments

Keep the Grey Payroll name and existing company account experience.

## Evidence on Hand

The company platform includes Next.js web routes, Clerk accounts, PostgreSQL records and an advisory AI reviewer. Those account and HR features do not prove an Arc payment occurred. Payment truth requires matching onchain receipts.

## Product Principles

- Exact amounts and visible recipient review before a wallet signature.
- Confirmed onchain execution is the source of payment truth.
- Every employer can spend only their own funded balance.
- Retry and reload must not duplicate a payroll run.
- Illustrative data and advisory rules must be labelled accurately.
