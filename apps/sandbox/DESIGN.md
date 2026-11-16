# Bitcoin Sandbox design

## Color

The accepted world is dark ink, technical light grays and amber. The lab is used on mid-range laptop and phone displays during workshops; restrained dark panels keep transaction data grouped, while warm amber carries deliberate actions and inspection state. Background `#15191e`, panels `#1c2127` and `#242b33`, primary text `#f2f3f4`, secondary text `#acb6c1`, borders `#37414b`, amber `#f7b748`, confirmed green `#a6dabd`, and error text `#ffb6ac`. Amber buttons use ink text. Confirmation states always have text labels.

## Typography

Local IBM Plex Sans 400/500/600/700 carries product copy and headings. Local IBM Plex Mono 400/500 carries wallet amounts, transaction references, output indices and fee measurement. Heading tracking stays within `-.04em`; app headings are 28–38px and the landing statement is 49–88px. Figures use tabular numerals. Protocol data wraps or abbreviates with copy controls, while exported records preserve complete values.

## Layout

The desktop canvas is at most 1240px with 40px side gutters. Horizontal navigation sits in the header. Laboratory begins with two real wallet choices, followed by a wallet-to-output graph and a selected-output inspector. Build separates editable payment details from the exact transaction anatomy. Explorer uses a ledger followed by full transaction details. Experiments use sequential guides and Core-verified completion panels. Phone layouts stack the working areas, convert ledger rows into readable compact records, and keep a four-item bottom navigation bar.

## Components

Panels use restrained 7–10px corners and visible one-pixel boundaries. Wallet, input, payment and change nodes express actual relationships rather than decorative charts. Selected nodes receive an amber border. Controls have explicit hover, focus, disabled, loading and error states. Signing and reset use focus-trapped confirmation dialogs with an inert background and restored trigger focus. Inspection uses inline panels. Inputs, select menus, scrollbars, selection and caret colors inherit the palette.

## Motion

The signature interaction is selecting a transaction input, payment, change or fee to reveal its role in the anatomy. State feedback is immediate and brief. Modal entry uses a small 180ms translation and opacity change. No decorative animation or constant ambient motion is required. Device and saved reduced-motion preferences disable animation and transition effects.

## Direction contract

THESIS: A workbench for understanding what a transaction actually consumes and creates.

OWN-WORLD: Dark ink, slate panel boundaries, local Plex typography, amber actions, and legible protocol data.

STORY: A learner connects an identity, creates wallets, inspects a reviewable transaction, broadcasts deliberately, and verifies its inclusion.

FIRST VIEWPORT: The landing pairs a large two-line statement and clear Open your lab action with a labeled interactive transaction anatomy. The operational first viewport pairs Alpha and Beta wallet balances with the real output graph.

FORM: Operate-first lab with a separate Persuade landing; `seed: none (pinned)` — "dark ink, light technical grays, amber; IBM Plex Sans/Mono; a polished interactive lab with UTXO graph, transaction builder and real confirmations."

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

The logo and diagrams are original authored SVG/CSS. No shipping raster assets are used.

## Finish review

Reviewed on November 16, 2026 against the real local Bitcoin Core regtest backend. The final frontend passed 58 builder-controlled Chromium checks with 16 operational captures at 1440px, 390px and 360px, zero unhandled page errors, and no horizontal overflow. The earlier anonymous landing, onboarding and help review produced 10 captures at the same widths. These checks describe the builder's test environment; independent learner outcomes remain unmeasured.

Inspected the desktop landing, wallet graph, prepared transaction, deliberate broadcast review, pending and confirmed Explorer, lost-response recovery, and the actual phone Laboratory, Builder, Explorer, Experiments and Settings. The final recovery review caught and fixed a mismatched default form amount: restored sender, recipient, amount and fee now come from the authoritative preview. Unresolved attempts keep those fields fixed; editing a resolved payment clears its previous review. Recovery and reload each produced zero extra broadcasts.

Keyboard focus, modal containment, visible status labels, readable text colors, reduced motion, phone touch targets and bottom-navigation clearance were reviewed. Saved preferences, temporary-key-loss copy, secret-free record export, exact reset confirmation, retained experiment completions and all three Core-verified exercises passed the operational check.

Verdict: frontend accepted for release integration. Evidence is local in `.qa/ui-verification.json`, with source hashes matching the reviewed frontend. Root owns final production-path, Convex and hosted-runner acceptance. Captured screenshots are verification artifacts, not shipped product assets.
