# Three guided experiments

Each exercise uses your no-value Bitcoin Core regtest lab. A successful experiment shows a protocol state change, not an investment result. Your Alpha and Beta wallets are separate; mining advances the runner's shared chain.

## 1. Your first transaction

Experiment ID: `first-transaction`.

**Question:** What happens between choosing a payment and seeing it on the network?

1. Open **Laboratory** and create or continue your lab.
2. Note Alpha's available balance and one unspent output.
3. Open **Build**. Select Alpha as the sender and Beta as the receiver.
4. Enter **10,000 regtest sats** and a fee rate of **2 sat/vB**. These are suggested exercise inputs, not retained results.
5. Select **Create preview**. Read the payment amount, actual fee, and change.
6. Select **Review and broadcast**, then confirm **Broadcast transaction** only after reviewing the displayed information.
7. Open the resulting transaction in **Explorer**.

**Observe:** A preview has no final network transaction yet. Broadcast produces a transaction ID and a mempool state. That transaction can exist before a block confirms it.

**Explain it back:** Name the sender, receiver, payment, fee, and transaction ID. Identify which step signed and broadcast the transaction.

**Complete it:** Submit that transaction to the experiment check. The server verifies the Core receipt before saving completion; an invented ID or another account's transaction cannot stand in for the exercise.

## 2. UTXOs and change

Experiment ID: `utxos`.

**Question:** Why can sending part of your balance create more than one output?

An unspent transaction output, or **UTXO**, is one piece of Bitcoin that a wallet can spend. A wallet balance is the sum of eligible pieces, rather than an account entry that the network subtracts from in place.

1. In **Laboratory**, inspect Alpha's available UTXOs. Each has a transaction ID, output index, amount, and confirmation count.
2. In **Build**, create a preview that spends less than the selected input total.
3. Inspect the input and output diagram. Locate Beta's payment and Alpha's change.
4. Check the arithmetic:

   ```text
   total input sats = payment sats + change sats + fee sats
   ```

5. Broadcast only after the review, then compare the before-and-after outputs.

**Observe:** An input is spent as a whole. The transaction creates the payment output and usually a change output. The fee is the difference between total inputs and total outputs; it is not a third spendable output in your wallet.

If Core selects several inputs or no change is needed, explain the actual preview. Do not force a screenshot to match the simplest teaching diagram. A pending change output and a confirmed spendable output can have different availability.

**Explain it back:** Point to a spent output, the new payment output, and any change. Explain why the wallet's address on a new change output can differ from its displayed receiving address.

**Complete it:** Select the actual change output in the exercise check. The server verifies the transaction's change and input/output conservation. A transaction without change is useful to inspect, but it does not meet this exercise's change-output requirement.

## 3. Broadcast versus confirmation

Experiment ID: `confirmations`.

**Question:** Why is being visible on the network different from being included in a block?

1. Broadcast a reviewed transaction and open it in **Explorer**.
2. Read its zero-confirmation state before mining. It is in the regtest mempool.
3. Select **Mine 1 block**.
4. Refresh the lab and reopen the same transaction ID.
5. Read its new confirmation count and inspect the updated UTXO state.

**Observe:** Regtest gives you a controlled way to produce a block. That block includes valid transactions and changes their confirmation counts. Later blocks increase those counts. Another active lab on the same runner can also advance the chain.

On mainnet you cannot press this button to make a block or guarantee when a transaction will confirm. The experiment demonstrates the state transition; it is not a mainnet fee prediction or mining service.

**Explain it back:** Distinguish a prepared proposal, a broadcast transaction, and a confirmed transaction. Explain why a failed browser response alone does not establish that a transaction was never broadcast.

**Complete it:** Submit the confirmed transaction. The server checks Core's confirmation state before saving the experiment record. A zero-confirmation transaction remains incomplete for this exercise.

## Workshop observations

Ask learners to perform the task themselves and explain their result in their own words. Record completion and time with consent. A builder's scripted browser check is useful engineering evidence, but it is not an independent learner outcome.

Keep wallet secrets and unnecessary personal information out of feedback. Collect only what helps improve explanations, phone usability, setup, and recovery.
