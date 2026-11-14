# SatsAcademy

Learn Bitcoin by doing one small, verifiable thing at a time.

SatsAcademy helps first-time users understand sats, wallet safety and Lightning payments through three complete lessons in English and Hausa. A learner can connect a limited NWC wallet, create a 10-sat invoice, receive a payment and earn a practical achievement only after the receiving wallet verifies settlement.

Run the suite from its root with the shared setup and `pnpm dev`, then open `http://127.0.0.1:4403`. The production application path is `/satsacademy/`. The root README contains installation and local Lightning setup instructions.

The app includes a persistent learning dashboard, interactive unit conversion, server-graded quizzes, a wallet lab, transaction receipts, achievements, language settings and a course guide. An optional AI tutor uses only the course material; without a configured provider, the app clearly identifies local course explanations.

Use the included regtest Lightning lab for a reproducible no-value demonstration. Connect it from Wallet lab → Connect wallet → Use local Lightning lab. External NWC wallets work separately; use tiny provider-enforced budgets and matching networks.

See [the demo outline](DEMO.md) and [security and limitations](SECURITY.md).
