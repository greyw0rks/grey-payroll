# Contributing

GreyFinance helps small teams manage Bitcoin expenses with independent approvals and checkable receipts. Contributions that make this workflow clearer, more reliable and easier to use on phones are welcome.

Run the private Bitcoin and Lightning lab with `./start.sh`. The public landing page is at `http://127.0.0.1:4402`; the company workspace is at `/app`. The lab uses actual Bitcoin Core and LND regtest operations, with no monetary value.

Before opening a pull request, run `pnpm test`, `pnpm typecheck` and `pnpm build -- greyfinance`. Describe the user-visible change and relevant validation. Add a regression when changing authorization, spending policy, receipt verification or payment state transitions. For visual changes, check keyboard navigation and 360px phone layouts.

The current release focuses on GreyFinance. The academy, Bitcoin sandbox, Nostr messenger and NWC Gate are separate products developed in sequence. Their initial folders remain in this repository; avoid coupling their interfaces to the company treasury.

Use [private security reporting](https://github.com/greyw0rks/grey-payroll/security/advisories/new) for vulnerabilities. Contributions are covered by the MIT license.
