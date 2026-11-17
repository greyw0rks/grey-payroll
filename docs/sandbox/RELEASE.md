# Sandbox release record

**State: protocol, browser, automatic recovery, fresh setup, and current source checks accepted; submission kit prepared.**

Bitcoin Sandbox is available at [grey-finance.vercel.app/sandbox/](https://grey-finance.vercel.app/sandbox/). Its first published implementation is [0e2a6fb337598da3e44fc5fcb05965737397a003](https://github.com/greyw0rks/grey-payroll/commit/0e2a6fb337598da3e44fc5fcb05965737397a003), in [greyw0rks/grey-payroll](https://github.com/greyw0rks/grey-payroll).

The accepted runtime source is frozen at `92b56752848fa4206a348611cc6ec05abd01c37a`. The kit includes that runtime plus the final documentation and evidence; its SHA-256 manifest identifies the actual packaged files. Final repository publication is recorded separately.

The Vercel interface and Convex records are hosted services. Core runs on the builder's computer behind an authenticated free tunnel. The computer and private runner must remain online. This is a builder-controlled regtest demonstration whose coins have no monetary value.

## Accepted engineering evidence

| Layer | Accepted result |
| --- | --- |
| Fresh one-command setup | On November 17, `./start.sh sandbox` installed locked dependencies and checksum-pinned Core in a new directory, started a dedicated API/UI, passed 32 actual Core checks, and stopped the disposable services afterward. Initial lab creation took 1.952 seconds; reset took 0.652 seconds. |
| Bitcoin Core | Version 29.2; regtest confirmed; actual wallet funding, PSBT construction, signing, broadcast, output conservation, and mining. |
| Local protocol acceptance | 32 checks passed on November 17. This is the same Core run embedded in the accepted fresh setup, including current source hashes and a confirmed 25,000-sat transaction. |
| Public Core and Convex API | 36 checks passed on November 17, including two distinct builder-controlled identities, private owner boundaries, NIP-98 replay rejection, literal confirmation, real broadcast/mining, all three experiments, persistence, reset, export, sign-out, and creation/reset within the existing bridge budget. These identities are engineering fixtures, not independent learners. |
| Security and shared repository tests | 150 Node checks and 295 Convex checks passed: 445 total, including 56 Sandbox Convex regressions. Strict Sandbox and Convex TypeScript checks passed. |
| Uncertain broadcast handling | Local UI response-loss recovery restored its original 10,000-sat transaction without another broadcast. Regression tests cover session changes, delayed responses, immutable receipts, and unsafe recovery transitions. |
| Local browser UI | 58 checks and 16 captures; no page errors or horizontal overflow at recorded 1440px, 390px, and 360px widths. Five frontend source hashes match. |
| Current hosted browser UI | 63 checks and 21 captures passed; no page errors or horizontal overflow at 360px, 390px, 1024px, and 1440px. Separate 10,000-sat lost-response recovery sent no extra broadcasts. |
| Release build | Combined GreyFinance, Academy, and Sandbox production build passed. |
| Container definition | Docker Compose configuration validation passed. A fresh Docker image/runtime acceptance is not claimed. |
| Submission media | One thumbnail and six gallery PNGs, all 1500 × 1000 and 3:2, under 166 KB each; seven visual reviews and output/source/font/renderer hashes accepted. |
| Automatic infrastructure recovery | Expired-tunnel recovery and an actual supervised runner stop/restart passed. The healthy tunnel, original confirmed transaction, and Core data were preserved. |
| Dedicated Core setup | Controlled restart applied the Sandbox-only descriptor pool of 32, retaining the original confirmed transaction, wallets, chain, runner, tunnel, and supervisor. |
| Source/docs/media ZIP | Prepared by `prepare-kit.py`; strict evidence/source/media preflight, 35 MB limit, archive CRC, safe paths, and extracted SHA-256 checks pass. Archive and checksum are under `docs/sandbox/submission/`. |
| Public video and Devpost entry | User supplies the rendered YouTube/Vimeo URL. No Devpost submission confirmation is recorded. |

[sandbox-release-checks.json](../evidence/sandbox-release-checks.json) records the shared tests, strict typing, build, Compose validation, additive Convex deployment, accepted implementation revision, and source hashes. [security-review.md](security-review.md) records the Sandbox security review and 56 Convex regressions.

## Public protocol transaction

[sandbox-convex-regtest.json](../evidence/sandbox-convex-regtest.json) records **36 passing checks at 2026-11-17 18:37:03 UTC**, through the public GreyFinance origin, Convex, and the signed private Core runner.

```text
6226505be8fd2a608d5b788f471b5fcda6cd838626e67e8a9f2b5b6fd951f06d
```

This transaction spent 1,000,000 regtest sats: payment **25,000**, change **974,718**, fee **282**. Core reported zero confirmations before mining and one confirmation after mining, in block height **123**. All three experiments were verified from Core facts and saved in Convex. Reset preserved those achievements and the original receipt, and signing in again with the same identity restored the persisted lab.

First account creation took **11.554 seconds**, another account's creation **8.601 seconds**, and reset **2.486 seconds**. Each remained within the existing **25-second** bridge request budget. These are timings from this accepted hosted run, not service-level guarantees.

The accepted Vercel deployment is `dpl_BqFH4W6ncumbZkzPCLyiQNqWnj7h`, with deployment URL `grey-finance-ko9ro80lu-greyw0rks-projects.vercel.app`. The public project route is the stable URL above.

## Local and fresh setup transactions

[sandbox-regtest.json](../evidence/sandbox-regtest.json) records **32 passing local checks**, from **2026-11-17 18:29:05 UTC** to **18:29:17 UTC**. Its transaction is:

```text
e17835250e87c54495e0b833a4131cda322a99bbd6df4cd1ca220e303eeb4c76
```

The local run spent 1,000,000 sats: payment 25,000, change 974,718, fee 282. Core confirmed it in a mined regtest block at height 113. This run verified anonymous/owner boundaries, sign-in replay denial, duplicate-broadcast stability, all three experiments, saved preferences, reset with retained history, private export, and sign-out revocation.

[sandbox-fresh-setup.json](../evidence/sandbox-fresh-setup.json) records the current clean-directory setup at **2026-11-17 18:29:17 UTC**. There were no initial dependencies, downloaded executables, or wallet data in that directory. Its embedded 32-check Core run used:

```text
e17835250e87c54495e0b833a4131cda322a99bbd6df4cd1ca220e303eeb4c76
```

The local protocol record is the same 32-check run embedded in this fresh-setup report; those checks are not counted as two independent runs. The setup report adds seven setup assertions and `cleanupVerified: true`; it is not a claim that the global package-manager cache or operating system was newly installed.

The Sandbox-only setup defaults to a 32-address look-ahead pool for each Core descriptor pool; Core replenishes it as needed. Its added timing check measured first lab creation at 1.952 seconds, another account's creation at 1.102 seconds, and reset at 0.652 seconds, all below the existing 25-second bridge budget. These are local builder timings, not a hosted latency guarantee. General-lab defaults and signing, RPC, and bridge timeouts remain unchanged. [SETUP.md](SETUP.md) explains the validated override and the required restart for an existing Core process.

## Current public browser acceptance

[The hosted UI report](hosted-acceptance/2026-11-17T18-09-28-737Z/ui-verification.json) records **63 passing checks and 21 captures**, from **2026-11-17 18:09:29 UTC** to **18:10:27 UTC**, at the public GreyFinance origin. It covers 360px and 390px phones, a 1024px tablet, and a 1440px desktop, with no page errors or horizontal overflow.

The current 20,000-sat public UI payment is:

```text
fb5e25fdb582a7232eeea565dfe9c7d282dd561f1d2213f45f3c9f5a5f87995f
```

Its separate 10,000-sat lost-response recovery is:

```text
244c529bcb231f2173719eb28ccce6ef975057267127d69433331e431ef129a2
```

Reconciliation and reload sent zero extra broadcasts. These are distinct from the earlier local UI transactions retained in the media gallery.

[sandbox-public-release.json](../evidence/sandbox-public-release.json), at **2026-11-17 18:38:39 UTC**, verifies the public routes for GreyFinance, Academy, and Sandbox, exact deployed JavaScript/CSS matches against the current accepted production build, security headers, immutable assets, and the same-origin Convex API. The published interface is the accepted November 16 deployment; the later source revision adds operational setup and verification changes.

## Local browser and media provenance

[The retained UI report](submission/media/sources/ui-verification.json) records **58 passing local browser checks**, from **2026-11-16 15:01:45 UTC** to **15:02:47 UTC**, and 16 captures. It exercised review details, uncertainty locks, settings, temporary-key-loss copy, export privacy, reset, and verified experiments.

Its 20,000-sat UI payment, used in gallery panels 02–05, is:

```text
006d79649d226ef36126606446972b1b2726fe458ba5693e8ac0494fc5a78fb4
```

The separate 10,000-sat response-loss recovery shown in panel 06 is:

```text
f1e2b67edae07f0b4b922fdcfa0964176b1b397ad71e65409c0d17fed78c7e14
```

Recovery and reload sent **zero extra broadcasts**. Panel 01 explicitly labels the landing-page illustration. [MEDIA-MANIFEST.json](submission/MEDIA-MANIFEST.json) preserves the original captures, output hashes, crop/scale descriptions, typography licenses, per-image visual acceptance, and transaction/run context.

These browser results are builder automation. They do not establish physical-device accessibility or independent learner outcomes.

## Availability, retention, and next acceptance

The free demonstration bridge needs this computer, Core, the private runner, and its tunnel to stay running. The operator's `pnpm preview:sandbox:watch` supervisor probes signed regtest availability and recovers known-expired tunnels while updating only the two Sandbox Convex settings.

[sandbox-availability.json](../evidence/sandbox-availability.json) records five read-only checks after a real next-day tunnel expiry. [sandbox-runner-recovery.json](../evidence/sandbox-runner-recovery.json), at **2026-11-17 18:15:16 UTC**, records an actual stopped-runner recovery. Only the known Sandbox runner process group was stopped; the supervisor relaunched it while retaining the healthy tunnel process/URL and the original confirmed 25,000-sat transaction and Core data. The source hashes record the accepted helper fix and current recheck separately from the original expiry-recovery time.

[sandbox-wallet-setup.json](../evidence/sandbox-wallet-setup.json), at **2026-11-17 18:34:29 UTC**, records the separate controlled restart of the dedicated Core process. It verified ownership, the regtest network, and an idle runner before applying `keypool=32` to the existing data directory. The original `a08baba2172066a5e952e8cc5a8830773aba4bade3b5faa659bc9542bab07d25` transaction still had five confirmations afterward. The runner, tunnel, and supervisor were retained; this maintenance check sent no transaction.

Reset starts new educational wallets while retaining progress and older receipts. Exports stop explicitly above 500 saved previews. Account-wide deletion, automatic historical-wallet cleanup, and permanent hosting are further work.

The final kit retains its own source snapshot and SHA-256 manifest. All current protocol, release, recovery, setup, browser, and media hashes passed strict preflight. The kit's adjacent checksum and validation report record its exact bytes, archive CRC, and extracted-entry hash checks. Archive integrity is separate from a security audit or blockchain attestation.

The user owns final video rendering/export, upload, and URL entry at submission. The GreyFinance and Connect video preview ports 4417–4420 remain stopped.
