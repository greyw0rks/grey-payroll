# GreyFinance deployment

Public app: https://grey-finance.vercel.app/
Source: https://github.com/greyw0rks/grey-payroll

The existing GreyFinance project now builds only the company finance interface. Its same-origin API rewrites to intent-curlew-185.convex.site. Convex production retains the existing company memberships, approval policies, wallet credentials and verified receipts.

Each other submission has its own repository and site. Existing Academy links redirect to https://satsacademy.vercel.app/, Sandbox links to https://bitcoin-sandbox.vercel.app/, and chat links to https://nostrchat-greyw0rks.vercel.app/. Nested routes preserve their path.

Run `pnpm build:release` for the Finance-only dist output. Deploy it through the existing grey-finance Vercel project in greyw0rks-projects. Backend changes must coordinate the shared Convex schemas and preserve the other products.

The original dirty local grey-payroll workspace remains the owner's working copy. Its Arc history is retained at archive/grey-finance-arc-2026-11-14 and in Git. This isolated release directory does not migrate or delete its financial data.

Historical builder-controlled payment and browser checks remain in docs/evidence. Private regtest coins have no monetary value; those checks do not establish independent adoption or mainnet settlement. Final demo-video export, upload and Devpost confirmation remain with the user.
