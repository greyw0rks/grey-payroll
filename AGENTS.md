# Sats hackathon build contract

The user explicitly asked for separate agents to build SatFamily, SatsAcademy, Bitcoin Sandbox, NostrChat, and NWC Gate, with excellent UI and complete working products. Build and verify ONE product at a time. SatFamily is a COMPANY account, now branded GreyFinance. The current publication instruction is to repurpose the existing personal repository `greyw0rks/grey-payroll` and the existing Vercel project/domain `grey-finance` / `https://grey-finance.vercel.app`. Preserve the previous application's Git history and archive branch, and leave the original dirty `/home/greyw0rks/grey-payroll` workspace untouched. Prepare the replacement in an isolated worktree. Earlier `grey-labz/greylabs` release instructions are superseded. Use Convex for the production backend. QuestN is inspiration for SatsAcademy, NOT GreyFinance. Avoid sidebars; use horizontal desktop navigation and accessible phone navigation.

Always prefix shell commands with `/home/greyw0rks/ubuntu-to-debian-migration/bin/rtk` (RTK is absent from PATH). Use `rtk proxy <command>` for raw commands. Do not expose secrets, inspect unrelated credentials, spend real funds, publish messages, or invent verified payment/adoption claims.

## Ownership

- Root agent: shared dependencies/config, `server/context.ts`, `server/index.ts`, authentication, shared wallet adapter and NWC Gate SDK, local relay, Bitcoin Sandbox, launcher, integration, review and documentation.
- SatFamily agent: ONLY `apps/satfamily/**`, `server/satfamily.ts`, `tests/satfamily.test.ts`, `docs/satfamily/**`.
- SatsAcademy agent: ONLY `apps/satsacademy/**`, `server/academy.ts`, `tests/academy.test.ts`, `docs/satsacademy/**`.
- NostrChat agent: ONLY `apps/nostrchat/**`, `tests/nostrchat.test.ts`, `docs/nostrchat/**`. It is a browser Nostr client using the local or user-selected relay.
- NWC Gate UI agent (when assigned): ONLY `apps/nwc-gate/**`, `docs/nwc-gate/**`; root owns the SDK/server.
- Additional reviewers work read-only unless explicitly assigned files.

Do not edit root package.json, tsconfig, shared files, or another agent's files. Send root dependency/API requests. Root installs dependencies. Do not commit while other agents are editing.

## Stack and app bootstraps

React 19, TypeScript, Vite 7, expressive handwritten CSS tokens, Phosphor icons, local Fontsource fonts. Node 22, Express 5, SQLite (`node:sqlite`), Zod, nostr-tools, Alby NWC SDK. Use relative imports to shared package as needed. Avoid Next.js to keep five running apps lightweight. There are five independent app builds and a small launcher.

Each app has `index.html`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`. Vite `/api` proxies to `http://127.0.0.1:4400`. Ports: launcher 4401, SatFamily 4402, SatsAcademy 4403, Sandbox 4404, NostrChat 4405, NWC Gate 4406. URLs must work on loopback and production paths `/satfamily/`, `/satsacademy/`, `/sandbox/`, `/nostrchat/`, `/nwc-gate/`.

## Shared API contract

`server/context.ts` exports `AppContext`, `User`, `WalletAdapter`, `WalletInvoice`. Routers:

```ts
import type { AppContext } from './context.ts';
export function createSatFamilyRouter(ctx: AppContext): import('express').Router;
export function createAcademyRouter(ctx: AppContext): import('express').Router;
```

`ctx.db`: DatabaseSync; `ctx.requireUser`: Express RequestHandler; `ctx.user(req)`: authenticated User `{id, pubkey, demo}`; `ctx.wallet()`: WalletAdapter|null; `ctx.now()`: Unix milliseconds. Use prepared queries/transactions and organization/member checks on every sensitive route. `ctx.walletForUser(userId)` returns the user's receiving NWC wallet adapter if connected (or null). `ctx.setWalletForUser` is root-owned; use shared endpoints for connection.

WalletAdapter: `{kind:'nwc'|'lnbits', getInfo(), getBalance(), makeInvoice({amountSats,description,expirySeconds?}), lookupInvoice(paymentHash), payInvoice(bolt11)}`. WalletInvoice fields `{paymentHash, bolt11, amountSats, description, expiresAt, state:'pending'|'settled'|'expired', preimage?:string, settledAt?:number}`. No client-submitted paid flag is trusted.

Shared endpoints root implements:
- GET `/api/health`, GET `/api/session` -> `{user:User|null, demoEnabled:boolean}`
- POST `/api/demo/session` `{persona:'owner'|'finance'|'employee'|'learner'}` (local preview ONLY; response user) / POST `/api/session/logout`
- POST `/api/auth/nostr` with NIP-98 Authorization signed POST payload; server rejects stale/replayed/wrong-origin signatures
- GET `/api/wallet` -> `{connected, kind, capabilities, balanceSats?, error?}`
- POST `/api/wallet/connect` `{connectionUri}`; browser must not persist the URI. Server encrypts delegated token at rest. DELETE `/api/wallet` disconnects.
- POST `/api/wallet/invoices` `{amountSats,description}` -> WalletInvoice; GET `/api/wallet/invoices/:paymentHash` -> verified WalletInvoice; POST `/api/wallet/pay` `{bolt11}` -> verified payment result. Payment requires explicit UI confirmation.
- GET `/api/config` -> `{demoEnabled,relayUrl,bitcoinReady,walletConfigured}` (no secrets).
- Local Nostr relay websocket at `ws://127.0.0.1:4400/relay`; actual signed Nostr events and encrypted messaging, no fake server plaintext messages.

Demo users have stable server-chosen ids: `demo-owner`, `demo-finance`, `demo-employee`, `demo-learner`. Demo data is clearly labeled. Do not show fixture payments as actual settlement. Live mode disables demo sessions. Agents can implement separate preview data flows but must persist them separately and visibly identify them.

## Design direction

Read `/home/greyw0rks/.codex/skills/open-design-frontend-design/SKILL.md`. Commit to distinctive, polished product design. Each app gets a DESIGN.md with color, typography, layout, components.

- GreyFinance (SatFamily): Swiss financial grid and executive dashboard; warm chalk, deep forest, restrained lime/copper; Manrope. A credible company finance product with a standout balance panel, approval inbox, team avatars and crisp ledger. Horizontal desktop navigation and phone bottom navigation; no sidebar.
- SatsAcademy: QuestN-inspired quest discovery, learning paths and verified achievements, with vibrant blocks and editorial hierarchy; warm cream, cobalt ink, apricot; Space Grotesk and Manrope; original CSS/SVG diagrams and hands-on wallet exercises. English and Hausa MVP. No speculative cash rewards or decorative token metrics.
- Sandbox: dark ink, light technical grays, amber; IBM Plex Sans/Mono; a polished interactive lab with UTXO graph, transaction builder and real confirmations.
- NostrChat: warm white, deep teal, soft coral; Manrope; premium messaging, conversation list, readable bubbles, invoice cards, wallet drawer and excellent empty/onboarding states.
- NWC Gate: paper, charcoal, electric chartreuse; Space Grotesk/Plex Mono; a sharp developer docs + live checkout experience.

No generic purple gradients, excessive glass, stock illustrations, fake social proof, decorative graphs unsupported by data, or inert controls. WCAG contrast, 44px touch targets, labeled inputs, keyboard/focus, reduced motion, no horizontal overflow at 360px. Use local font files. Start directly in a usable product with a clear preview/live status. Help, settings, filters, create forms, details and errors must function.

## Quality and handoff

Implement critical security behavior tests (authorization, invoice verification, state transitions, replay/idempotency) and test happy-path logic. Do not mirror implementation with trivial tests. Root performs build, full typecheck and Playwright desktop/mobile QA after integration. Include README/setup, limitation notes, a 3-minute pitch outline, and metric suggestions per app in docs. Real user impact remains unproven until independently tested; describe target users and measured builder tests honestly.

Keep root informed when initial files are ready and when you need a contract or dependency. Own your full workflow until runnable, do not stop after mock UI. Do not modify shared node_modules, root configuration or other apps. No external outreach/publication without explicit authorization.
