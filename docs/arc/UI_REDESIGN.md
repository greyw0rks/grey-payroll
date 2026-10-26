# Grey frontend redesign continuation

The user's frontend request extends the standalone Arc module with a landing page, Three.js 3D motion, Framer Motion, new account pages and the existing Grey Clerk accounts. The company integration now uses Arc as its money layer. UI evidence does not satisfy the pending actual Arc testnet rehearsal.

## Delivered surfaces

- `arc-module/src/components/site/LandingPage.tsx`: landing, interactive four-step payroll example, control explanation and native FAQ disclosures.
- `PayrollScene.tsx`: locally authored Three.js geometry and textures, bounded payment animation, mouse response, visibility pause, reduced-motion treatment and WebGL fallback.
- `AuthPage.tsx`: real Clerk login/signup with Grey styling, retry boundary and missing-key fallback.
- `WorkspacePage.tsx`: account gate before lazy wallet loading; `WalletWorkspace.tsx` owns the original wallet providers and payroll component.
- Self-hosted existing Grey fonts, responsive layout, themed focus/selection, production SPA rewrites and preserved Arc Studio attribution.

The user's existing Clerk **publishable** key is configured in ignored `.env.local`. A secret key supplied in conversation was neither stored nor used; rotation was advised. Clerk is currently in test/development mode. No real user account was created during UI validation.

## Validation and limits

The payroll helper suite has 132 passing tests. Typecheck and type-aware lint pass. Browser evidence lives in `arc-module/.impeccable/review/`, including desktop/mobile landing, login and signup, plus the isolated mobile wallet workspace. The isolated wallet capture checks UI and the testnet default; it is not evidence of a signed-in account or a payment.

`arc-module/validation/check-ui.mjs` exercises workflow selection, FAQ disclosure, local account routing, reduced motion, WebGL-unavailable fallback, horizontal overflow and signed-out workspace gating. It uses this workstation's existing Playwright/Chromium installation, creates no account and submits no financial transaction. Final `browser-results.json` records the completed checks. All seven captures passed; the signed-out production account redirect also passed.

The original wallet adapter exposed `writeContract` with incomplete types and omitted the deployment method used by its controller. The local continuation restores those transport methods and type declarations; payment authorization and contract logic remain as in the Studio implementation. October 25 continuation: actual Arc Testnet deployment and user-signed deposit/payroll/withdrawal with replay rejection passed independent finalized receipt verification. See `testnet/REHEARSAL.md`; this payment proof remains distinct from UI captures and company settlement ingestion.

## Resume

Run `npm ci` then `npm run dev` in `arc-module/`. This session's development URL uses port 5178. Routes: `/`, `/login`, `/signup`, `/app`. Rebuild after configuring the publishable key because Vite embeds browser environment variables at build time.

Use `npm run build`, `npm run lint`, and `npm test` for verification. `package-lock.json` is current for the local export; the retained Bun lock is the earlier Studio baseline. Do not overwrite the redesigned local files by pulling an old Studio snapshot without reviewing the differences. The contract has not been changed, deployed or funded by this UI continuation.
