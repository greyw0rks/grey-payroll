import type { ExperimentId } from "./api";

export type Experiment = {
  id: ExperimentId;
  title: string;
  summary: string;
  minutes: string;
  concept: string;
  steps: Array<{
    title: string;
    body: string;
    action?: "builder" | "lab" | "mine" | "explorer";
  }>;
};
export const experiments: Experiment[] = [
  {
    id: "first-transaction",
    title: "Your first transaction",
    summary:
      "Move sats from Alpha to Beta, then find your transaction in Bitcoin Core.",
    minutes: "About 5 minutes",
    concept:
      "A transaction describes which existing outputs are spent and where their sats go next. The sending wallet signs it; the node validates it before accepting it into the mempool.",
    steps: [
      {
        title: "Open your two wallets",
        body: "Create your private lab. Bitcoin Core funds Alpha and Beta with valueless regtest coins. Their balances and addresses come from actual wallet RPC calls.",
        action: "lab",
      },
      {
        title: "Build a transaction",
        body: "Send 20,000 sats from Alpha to Beta at 2 sats/vB. Create a preview to inspect the input, payment, change and fee before signing.",
        action: "builder",
      },
      {
        title: "Review and broadcast",
        body: "Review the exact amounts. Confirming broadcasts a signed transaction to the regtest node. A preview alone never sends coins.",
      },
      {
        title: "Check the transaction",
        body: "Open the transaction in Explorer. Its ID comes from Bitcoin Core, and its unconfirmed state shows that a mempool transaction has not entered a block.",
        action: "explorer",
      },
    ],
  },
  {
    id: "utxos",
    title: "Follow the change",
    summary:
      "See how spending one output creates a payment and a new change output.",
    minutes: "About 4 minutes",
    concept:
      "A wallet balance is the sum of outputs the wallet can unlock. Those unspent transaction outputs are called UTXOs. You spend a whole output, even when you only want to send part of its value.",
    steps: [
      {
        title: "Inspect an available output",
        body: "Open Laboratory and select Alpha. Choose an output in the wallet graph. Its transaction ID and output index identify the exact coin that can be spent.",
        action: "lab",
      },
      {
        title: "Compare input and outputs",
        body: "Build a preview. Add the payment, change and fee: they should equal the total input amount. Click each part of the anatomy diagram to see its role.",
        action: "builder",
      },
      {
        title: "Spend and inspect again",
        body: "Broadcast the reviewed transaction. The spent input disappears from the available-output graph; the sending wallet now controls a smaller change output.",
      },
      {
        title: "Find the receiving output",
        body: "Switch to Beta in Laboratory. Its new payment output has the broadcast transaction ID and an output index. It can become an input in a future transaction.",
        action: "lab",
      },
    ],
  },
  {
    id: "confirmations",
    title: "From mempool to block",
    summary:
      "Mine a regtest block and watch a pending payment gain a confirmation.",
    minutes: "About 3 minutes",
    concept:
      "The mempool contains valid transactions waiting for a block. A transaction has one confirmation when a block includes it. Later blocks increase its confirmation count; they do not make the original block immutable.",
    steps: [
      {
        title: "Start with a pending transaction",
        body: "Broadcast a transaction and open Explorer. Before mining, its confirmation count is zero. Refresh if another lab user has already advanced the shared chain.",
        action: "explorer",
      },
      {
        title: "Mine one block",
        body: "Mining is instant on regtest. It advances the node’s shared test chain and includes eligible mempool transactions. No real Bitcoin is mined.",
        action: "mine",
      },
      {
        title: "Verify the block inclusion",
        body: "Inspect the same transaction. Bitcoin Core should now report its block hash and at least one confirmation. Wallet balances and output confirmation counts update too.",
        action: "explorer",
      },
      {
        title: "Mine another block",
        body: "A second block adds another confirmation. Observe the count rather than assuming it: the node is the source of truth.",
        action: "mine",
      },
    ],
  },
];

export const glossary = [
  [
    "Satoshi",
    "A satoshi, or sat, is one hundred-millionth of a bitcoin. All lab balances are valueless regtest coins.",
  ],
  [
    "UTXO",
    "An unspent transaction output: an amount of sats locked by a script, waiting to become an input in another transaction.",
  ],
  [
    "Change",
    "The part of an input that comes back to the sending wallet after subtracting the payment and fee.",
  ],
  [
    "PSBT",
    "A partially signed Bitcoin transaction. The preview is prepared before signing; Bitcoin Core signs it only after your explicit confirmation.",
  ],
  [
    "Virtual byte",
    "A measure of transaction weight used for fee calculation. A fee rate of 2 sats/vB means two sats per virtual byte.",
  ],
  [
    "Mempool",
    "The node’s set of valid unconfirmed transactions. Each node has its own mempool.",
  ],
  [
    "Confirmation",
    "The number of blocks from the one containing a transaction through the current chain tip.",
  ],
  [
    "Regtest",
    "A private Bitcoin testing mode where blocks can be generated on demand. Its coins have no monetary value.",
  ],
] as const;
