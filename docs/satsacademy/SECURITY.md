# Security and constraints

## Identity and sessions

The server verifies signed NIP-98 authentication events against the exact request URL, method, raw-body digest, and freshness window. Every browser sign-in adds a random nonce so two attempts from the same identity in one second remain distinct. Used events cannot be replayed. Sessions use secure server-controlled cookies; private keys are not placed in browser storage.

An optional temporary Nostr identity keeps its signing key only in module/tab memory. The key is zeroed on failed authentication, replacement with a signer identity, and sign-out. A session cookie can survive reload, but the app does not claim the lost signing key can be recovered. An existing Nostr signer is recommended for ongoing access.

Asynchronous UI responses are scoped to the current account/read generation. Changing identities, resetting lessons, or ending a session prevents old responses from restoring another state. Quiz results are also scoped to the lesson route that initiated them.

Browser requests retain a 20-second deadline when sign-in supplies its own cancellation signal. Closing sign-in aborts a pending browser request; it does not claim to undo work the server has already accepted.

## Learning wallet boundaries

Academy wallet connections and exercises are separate from GreyFinance company treasury credentials. The academy exposes receiving operations only and requires `make_invoice` and `lookup_invoice`. Balance access is optional. It has no public sending or training-payment route.

A connection form accepts a bounded delegated NWC URI, displays a password input, and clears the value before sending it to the server. The server encrypts delegated credentials at rest, binds them to the owner, and validates wallet providers and relay access. No recovery phrase or unrestricted wallet master key is requested.

Disconnecting the app removes its saved academy connection. Revocation at the wallet provider is a separate action and is explicitly explained. An app-held delegated connection remains sensitive even when the app exposes a narrow interface; provider-level permissions remain necessary.

## Payment evidence

Invoice creation records a fresh receiving request, its owner, network, amount, expiry, and wallet fingerprint. A pending request earns no practical achievement.

Verification queries the original receiving wallet and requires all of the following:

- A matching exercise owner and wallet source.
- The same payment hash, amount, and network as the created invoice.
- A settled invoice status.
- A 32-byte payment preimage whose SHA-256 digest equals the invoice hash.

A missing, invalid, or mismatched preimage awards no verified badge. An unavailable wallet, wrong network, pending or expired request, screenshot, forged paid flag, or another learner's exercise cannot substitute for proof. Settled receipts are durable and repeated verification is idempotent.

Knowledge-check achievements and payment-based achievements are stored separately. Resetting lessons retains payment receipts and the verified wallet achievement. Exports include all paginated receipt metadata but exclude wallet credentials, signed-session secrets, BOLT11 requests, and preimages.

## Course guide and privacy

The course guide rejects recognizable NWC URIs, Nostr nsec keys, WIF and extended-private-key encodings, and API-key strings. This is a bounded precaution, not a guaranteed detector of every secret, recovery phrase, or personal detail. Learners are told to keep secrets out of questions.

The default guide uses public course explanations and identifies them as course guidance. If an AI tutor is configured, it receives only the question and public course context, not the learner's wallet credentials, transaction history, or profile. It does not control funds. Provider failures fall back to clearly identified course content. Responses are displayed as text, rather than rendered HTML.

## Honest limits

Production disables predictable local preview personas and lab shortcuts. A local shortcut is available only when the local demo and actual regtest Lightning lab are ready. Lab coins have no monetary value. Builder-controlled regtest checks establish working integration, not independent adoption or mainnet usage.

Hausa is implemented but has not yet received independent native-speaker review. Reading times are estimates. The product teaches payment skills and gives no investment advice, exchange guarantees, cash rewards, recovery custody, or automatic payments.

Critical security tests and genuine two-wallet acceptance are maintained by the root platform. Layout-only fixtures, when used, are labeled separately from actual payment evidence.
