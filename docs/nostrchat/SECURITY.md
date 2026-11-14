# NostrChat threat model

## Assets and trust boundaries

- Nostr signing and decryption keys belong to the user’s signer or an explicitly temporary local practice identity.
- Message plaintext is created and decrypted in the browser.
- Relays store encrypted gift wraps and transport acknowledgements. They are untrusted for message authorship and settlement.
- Wallet authority is delegated through NWC. The shared server is trusted with the encrypted delegated connection and enforces its authenticated API.
- A Lightning wallet/provider is the source of invoice and payment state.

## Threats addressed

| Threat | Control |
| --- | --- |
| Forged outer envelope | Bounded fresh signature verification before processing |
| Forged sender inside a valid wrap | Seal signature, seal/rumor public-key equality, rumor hash validation |
| Message intended for another identity | Gift-wrap recipient and rumor recipient checks |
| Mutation after cached verification | Untrusted events are copied before nostr-tools verification |
| Replayed or retried messages | Stable rumor IDs and deduplication |
| Oversized ciphertext or content | 80KB envelope limit and bounded text/structured payloads |
| Cross-site scripting in a message or profile | React text rendering, no raw HTML insertion, bounded profile strings |
| Fictional paid tags | Unknown paid structures remain text; they do not update invoice state |
| Fabricated invoice amount | Display amount/hash/expiry are compared with encoded BOLT11 facts |
| Fabricated payment proof | SHA-256 preimage must match the known invoice hash and expected counterparties |
| Secret leakage through localStorage | Raw keys and plaintext are held in memory; optional backup uses NIP-49 |
| Unexpected external publishing | Local relay default; explicit external relay choice, wss://, and a compatible signer |
| Unintentional wallet spend | Explicit amount review and confirmation; backend/payment provider verification |

## Remaining risks

An XSS compromise of the page or a malicious extension can access plaintext and practice keys in memory. Wallet connections authorize whatever their granted NWC capabilities and provider limits permit; use minimal methods and a small budget. Revoking the connection at the wallet provider is the final authority.

A relay can drop, delay, reorder, censor, or correlate envelopes. It can observe recipient tags, subscriptions, addresses, and timing. A relay acknowledgement is not proof that the recipient has read a message. There is no multi-relay redundancy in this MVP.

Contact names are local aliases and signed Nostr profiles do not establish real-world identity. An npub is a public key, not a verified person. Payment proof does not establish that a service was delivered.

The lightweight invoice decoder does not validate BOLT11 signatures. It supplies display facts; the receiving and paying providers remain authoritative. After an ambiguous wallet response, users must check the wallet before retrying. The shared wallet backend must preserve idempotency and reconciliation.

Private practice identities need an explicit encrypted backup before a tab refresh or close. Losing the key makes previously encrypted history unreadable. Forgotten backup passphrases cannot be recovered.

No external contact, public relay posting, or real-fund payment was performed by the implementation agent.
