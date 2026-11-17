# Bitcoin Sandbox

**Learn the actual Bitcoin transaction lifecycle.**

[Open Bitcoin Sandbox](https://grey-finance.vercel.app/sandbox/) · [Published source](https://github.com/greyw0rks/grey-payroll)

Many beginners can explain a wallet or quote a Bitcoin price but have never inspected a transaction's inputs, understood its change, or checked its confirmations. Bitcoin Sandbox gives study groups and new developers a repeatable way to perform those steps without risking real money.

## The learning workflow

1. Open your lab and sign in with a Nostr signer such as Connect. The labeled temporary identity keeps its signing key only in this browser's memory; use a recoverable signer for ongoing access. Local practice accounts are available only when enabled locally.
2. Create a lab with separate **Alpha** and **Beta** Bitcoin Core wallets.
3. Inspect their balances, addresses, unspent outputs, and transaction history in **Laboratory**.
4. Open **Build**, choose opposite wallets, enter a whole-sat amount, and select a fee rate.
5. Create a preview. Read the inputs, payment, change, fee, and estimated transaction size.
6. Review and explicitly broadcast the transaction.
7. Find the transaction in **Explorer** before it is confirmed.
8. Select **Mine 1 block**, refresh, and inspect the new confirmations and outputs.

The three [guided experiments](EXPERIMENTS.md) explain what each step demonstrates. Completion is tied to a Core transaction: the first exercise requires a broadcast receipt, the change exercise checks an actual change output and value conservation, and the confirmation exercise checks block inclusion. A completion button alone cannot supply this evidence.

**Settings** saves the display name, sats/BTC display unit, refresh preference, default fee rate, and reduced-motion preference. **Help** keeps setup instructions and the regtest limits close to the working interface. The learning-record export excludes prepared PSBTs, private keys, and RPC credentials.

## What the wallet implementation does

Bitcoin Core creates the learning wallets, generates their addresses, selects inputs, constructs a partially signed Bitcoin transaction, signs it with the lab wallet, and broadcasts it on regtest. The app displays the returned protocol data. Learners do not need to import a recovery phrase, connect a mainnet wallet, or fund the exercise.

The preview is a transaction proposal, not a completed payment. Only a returned or independently recovered transaction ID establishes broadcast; a block confirmation is a further, distinct state. Displayed fee amounts come from the current Core preview, not a price forecast.

## Run and understand the boundaries

Run the repository-root `./start.sh sandbox`, then open `http://127.0.0.1:4404`. This starts a dedicated Sandbox API and provisions Bitcoin Core regtest. [Setup notes](SETUP.md) cover requirements, ports, Docker, restarts, and verification.

Every coin in the lab has **no monetary value**. Wallets are private to the learner's account, but their blockchain and mempool are shared on the runner. Mining can confirm transactions in another lab. This is a useful protocol demonstration, not mining for income or per-learner blockchain isolation.

The runner owns the educational wallet keys and needs to be trusted. The interface does not establish self-custody, provide a mainnet wallet, estimate guaranteed confirmation times, or prove independent adoption.

## Hosting and persistence

The hosted implementation uses Convex for authenticated learner preferences, progress, receipts, and durable lab operations, with a separate private runner executing narrowly scoped Bitcoin Core regtest commands. Request-bound HMAC authentication protects that runner. Core's RPC and credentials stay behind it. The local development API uses SQLite and the same wallet workflow.

The public Core and Convex flow passed 36 checks. The current hosted browser separately passed 63 checks across phone, tablet, and desktop. The free demonstration runner and tunnel operate on the builder's computer and need it to remain online. The operator's `pnpm preview:sandbox:watch` supervisor maintains that connection, recovers known-expired tunnels, and restores a stopped private runner while retaining the healthy tunnel and Core data. The [release record](RELEASE.md) links each result and its source hashes; [security notes](SECURITY.md) explain the trust and retention limits.

## Engineering evidence

The current local Core run passed 32 checks, including funded wallets, a broadcast transaction, fee/change conservation, mining, all three experiments, reset with retained history, private export, and sign-out. It is the protocol run embedded in the accepted fresh one-command setup. A separate browser run passed 58 checks with 16 captures and no page errors or horizontal overflow at the tested desktop and phone sizes. Its lost-response recovery checked the original transaction without another broadcast.

The public API separately passed 36 Core/Convex checks. The fresh one-command setup verified service cleanup, and its 32-check protocol run measured lab creation and reset below the existing request budget. The hosted check also confirmed creation and reset within that budget after a controlled Core restart preserved existing wallet and chain data. The shared repository passed 445 tests, including 56 Sandbox regressions. Each run retains its transaction identifiers and source hashes. These builder-controlled regtest runs use coins with no monetary value; independent learner results remain to be measured.

## Local impact to measure

Begin with a workshop or study group that already teaches Bitcoin. Measure independent learners' time to a first verified transaction, ability to identify payment/change/fee, and ability to distinguish broadcast from confirmation. Also record completion on phones and weak connections. Count builder tests separately.

Next: test with at least five independent learners, improve explanations from their feedback, and validate additional language content before publishing translations. A broader course catalog and mainnet operations are outside this laboratory's current scope.
