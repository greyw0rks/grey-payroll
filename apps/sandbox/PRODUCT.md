# Bitcoin Sandbox

Bitcoin Sandbox is a practical Bitcoin Core laboratory for new developers, workshop facilitators and curious learners, particularly in Nigeria and West Africa. The visitor succeeds by creating a pair of valueless regtest wallets, reviewing and broadcasting a real transaction, identifying its inputs and change, and checking actual block inclusion.

The app uses the repository's React 19, TypeScript and Vite stack. The local Core runner executes wallet and transaction operations; the production API uses Convex for signed identity, owned records, preferences, durable broadcast status and experiment progress. Root owns that backend and deployment. All browser operations use same-origin API requests with secure sessions. No wallet signing keys or PSBTs are persisted in browser storage.

The core views are Laboratory, Build, Explorer, Experiments, Settings and Help. Hash routes work at local root and at `/sandbox/`. Desktop navigation is horizontal; phone navigation is a four-item bottom bar. Landing content demonstrates a labeled illustrative transaction; the operational views show only Core-supplied wallet data.

Regtest coins have no monetary value. Wallets are account-owned but mining advances a shared node-wide regtest chain. Experiments are completed only after the backend verifies an owned broadcast, change output or confirmation. UI clicks and illustrations are never settlement evidence.

Users can sign in through Connect or another NIP-07 signer. Temporary identity keys remain in memory only, with visible recovery limits. Local predictable practice personas are available only when the backend explicitly enables them.

Quality requires a reviewable broadcast, read-only uncertain-attempt recovery, preserved receipts across wallet resets, persistent preferences, owned JSON exports, helpful offline states, keyboard focus, accessible contrast and no horizontal page overflow at 360px. Independent learner adoption and mainnet settlement are not claimed.
