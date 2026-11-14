# Security and constraints

The browser does not claim that a payment was successful. Exercise creation records a unique server-created invoice associated with one learner. Verification queries the appropriate receiving wallet and checks invoice hash, amount and settled state. If the wallet returns a preimage, its SHA-256 digest must match the invoice hash. An unavailable wallet, pending invoice, mismatched provider response or forged paid flag awards no practical badge.

Quiz completion and practical achievements use separate database records. Quizzes are graded on the server; repeated passing attempts cannot duplicate a badge. Payment verification updates exercise state and awards the practical badge in one SQLite transaction. A learner cannot read or verify another learner’s exercise. Resetting quiz progress preserves payment receipts and the verified achievement.

Shared authentication, NIP-98 freshness/replay checks, CSRF/origin enforcement and encrypted NWC credential storage are implemented by the root platform. SatsAcademy never asks for seed phrases. Its connection form holds the delegated URI in memory only and clears it after connection attempts. Removing an app connection is distinct from revoking the underlying wallet permission; the UI explains both actions.

The course guide rejects recognizable NWC URIs, Nostr private-key encodings and API-key strings. It does not send wallet credentials, transaction history or profile information to an AI provider. If `ACADEMY_AI_API_KEY` is configured, an OpenAI Responses API tutor receives only a learner’s question and public lesson content, with a short timeout and output limit. Failed provider calls fall back to clearly labeled local explanations. Questions must remain free of secrets; this is not a guaranteed sensitive-data detector.

The local preview identity is intentionally convenient for a single-machine hackathon demonstration. Production must disable demo sessions. Local regtest sats have no monetary value and must not be described as mainnet payment evidence. External wallet compatibility still depends on provider methods, signer support and network availability.

Hausa content is implemented but has not yet received independent native-speaker review. The course is education, not financial advice. Estimated reading times are estimates. Independent local impact is not yet measured. Automated tests use injected provider fixtures to exercise security transitions; genuine regtest integration evidence is recorded centrally by the root agent.

The MVP supports three complete lessons and a narrow wallet lab. It does not provide recovery custody, automatic payments, exchange services, cash rewards, investment advice or generalized financial credentials.
