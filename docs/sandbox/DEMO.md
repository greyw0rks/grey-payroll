# Three-minute demonstration

Use the accepted release and a fresh no-value regtest lab. Record the actual interface and outputs; do not replace wallet or transaction states with illustrations. Keep **regtest** and **no monetary value** visible. Final rendering and export are the user's responsibility.

| Time | Show and explain |
| --- | --- |
| 0:00–0:25 | Open the landing page. A learner in a Bitcoin workshop has read about transactions but has never built one. Sandbox makes inputs, change, fees, and confirmations observable through actual Bitcoin Core operations. |
| 0:25–0:50 | Open the lab, sign in, and show Alpha/Beta. Explain that the runner controls these educational wallets and their coins have no monetary value. Select a UTXO and point to its amount and output index. |
| 0:50–1:30 | In Build, send a small amount from Alpha to Beta. Create the preview. Point to the actual payment, change, fee, and transaction size. Explain `inputs = outputs + fee`; the preview has not yet broadcast anything. |
| 1:30–1:55 | Open Review and broadcast, inspect the summary, then explicitly select Broadcast transaction. Show the returned transaction ID and zero confirmations in Explorer. |
| 1:55–2:20 | Select Mine 1 block. Reopen the same transaction. Show the confirmation count and the new payment/change outputs. Explain that mining advances the shared regtest chain, and that a mainnet user cannot press a button to guarantee a block. |
| 2:20–2:40 | Submit the actual transaction to an experiment check, then reload and continue the lab. Show the retained completion and export without PSBTs or keys. If the accepted build has a tested recovery state, show its read-only status-check behavior without creating a duplicate transaction. |
| 2:40–3:00 | Name the intended workshop audience, measured engineering evidence, and next independent learner trial. Show setup/source links only after they have been published and checked. |

## Before recording

- Run the setup and happy path from [SETUP.md](SETUP.md) on the accepted release.
- Confirm which values belong to this recording; never mix balances or transaction IDs from separate runs.
- Ensure the payment, fee, change, and confirmations remain readable at the final video resolution.
- Close unrelated tabs and keep private credentials out of the recording.
- Play the full exported video with sound before uploading.

The demo outline is not a public video URL. Devpost needs the actual YouTube or Vimeo link. A builder-controlled recording is not independent learner testing or a submitted entry.

## Pilot metrics

Measure time to a first verified transaction; completion of all three experiments; correct identification of payment, change, and fee; correct distinction between broadcast and confirmation; recovery success; setup failures; and phone/weak-connection task success. Use independent learners' consent and keep their data separate from engineering tests.
