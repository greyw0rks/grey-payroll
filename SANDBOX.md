# Bitcoin Sandbox

Learn how a Bitcoin transaction works by making one.

[Open the lab](https://grey-finance.vercel.app/sandbox/) · [Source](https://github.com/greyw0rks/grey-payroll)

Bitcoin Sandbox is a hands-on laboratory for learners, developer workshops, and Bitcoin study groups in Nigeria and West Africa. Start two learning wallets, inspect their unspent outputs, review a transaction, broadcast it, and mine a block to see what actually changed.

The lab uses **Bitcoin Core regtest**, a private testing network. Its coins have **no monetary value**. Wallet balances, transaction IDs, outputs, fees, and confirmations come from Core rather than an animated imitation.

```bash
./start.sh sandbox
```

Open **http://127.0.0.1:4404**. Fresh setup with locked dependencies, checksum-pinned Core, a real transaction, and service cleanup has passed. See [setup](docs/sandbox/SETUP.md) and the [release record](docs/sandbox/RELEASE.md).

Explore **Laboratory**, **Build**, **Explorer**, and **Experiments**. The three guided exercises cover a first transaction, UTXOs and change, and confirmations. A transaction preview shows its payment, change, and fee before a separate broadcast confirmation.

Each learner has separate wallets. Those wallets share the runner's regtest blockchain: mining advances the same chain for every active lab on that runner. The runner controls the educational wallet keys; this is not a wallet for holding real Bitcoin.

[Product guide](docs/sandbox/README.md) · [Experiments](docs/sandbox/EXPERIMENTS.md) · [Security and limits](docs/sandbox/SECURITY.md) · [Three-minute demo](docs/sandbox/DEMO.md) · [Devpost draft](docs/sandbox/DEVPOST.md)

The public Core and Convex flow passed 36 checks, and the public browser passed 63 checks across phones, tablet, and desktop. Fresh one-command setup passed 32 Core checks with cleanup verified; the shared suite passed 445 tests. The free demo requires the builder's computer and private runner to remain online; a supervisor recovers expired tunnels and stopped runners while preserving Core data. Builder tests establish protocol behavior; independent learner testing is next.
