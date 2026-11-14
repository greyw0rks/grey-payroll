# Security reporting

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/greyw0rks/grey-payroll/security/advisories/new). Include the affected route, a minimal reproduction, expected behavior and observed behavior. General bugs belong in the repository issue tracker.

Do not include wallet seed phrases, NWC connection strings, private signing keys, session cookies or customer financial data. The [security notes](docs/satfamily/SECURITY.md) explain the trust boundaries, payment controls and current limits. The public app also has a [security page](https://grey-finance.vercel.app/security).

Application approvals are not cryptographic multisignature. A server with delegated spending permissions must be trusted within the connection's wallet-provider limits. Builder tests are not an independent security audit.
