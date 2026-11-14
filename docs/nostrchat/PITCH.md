# Three-minute NostrChat demo

## 0:00–0:25 — A real local workflow

“A freelance designer in Lagos agrees on a task in chat, sends a separate payment request, and returns to chat to confirm whether it was paid. NostrChat keeps that small workflow together: private conversation, Lightning request, verified payment.”

Show the warm, lightweight messenger interface. State that the users are builder test identities unless the demo includes independently participating users.

## 0:25–1:05 — Private conversation

Connect two independent Nostr identities in separate browser contexts using the supplied local relay. Copy npubs, add contacts, and send a message. Show both sides receiving the same real encrypted Nostr message and the published acknowledgement.

Briefly show an envelope or the protocol inspector without showing secret keys or plaintext logs. Explain that the relay receives NIP-59 gift wraps and cannot read message text; it still observes connection metadata.

## 1:05–2:05 — Wallet implementation

Connect two compatible narrowly permissioned NWC wallets. State the network and whether these are controlled test wallets or capped real funds.

Generate a small fixed-amount invoice from the receiving wallet and share it in the conversation. On the paying account, review the sats and confirm payment. Show the card changing only after provider verification and a matching payment preimage. On the receiver, press “Check payment” to verify against the receiving wallet.

If compatible wallets are unavailable, stop at invoice generation or connection requirements and state that live settlement remains unverified. Do not replace it with a fictional paid state.

## 2:05–2:35 — Security and mobile use

Show the wallet capability list, explicit confirmation, and a 360px mobile conversation. Mention no seed phrase handling, no raw keys or message plaintext in localStorage, stable message IDs, and signature/recipient verification.

Show a relay disconnect and recovery if time permits. Explain “published” honestly.

## 2:35–3:00 — Impact and next steps

“Our initial users are freelancers and small teams who need to discuss work and settle small payments in one place. Next we’ll measure first-message success, time to paid invoice, and recovery on weak connections with independent local users.”

Point to the open-source code and one-command setup. The next iteration adds relay discovery, pagination, and payment reconciliation improvements.

## Submission evidence to capture

- A real two-account encrypted message round trip and acknowledged event IDs.
- Receiving invoice, paying provider result, matching payment hash/preimage, and receiver lookup on the declared network.
- Desktop and 360px screenshots.
- Passing protocol tests and production build.
- Independent feedback if collected; keep builder tests clearly labeled.
