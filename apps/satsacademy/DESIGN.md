# SatsAcademy design system

SatsAcademy helps first-time Bitcoin users in Nigeria and West Africa build practical payment skills. QuestN inspires the discovery and achievement experience. The artwork, typography, components, and product copy are original.

## Color

- Warm paper: `#faf8f1`, for the application background.
- Near-white: `#fffdf7`, for lesson reading and working surfaces.
- Ink: `#222a39`, for primary text and strong actions.
- Cobalt: `#3153d4`, for navigation, primary actions, and the wallet learning block.
- Apricot: `#ffc082`, for the Bitcoin coin, welcome accents, and tangible progress.
- Sage: `#e4edcf` with `#42683e`, for verified and completed states.
- Muted text: `#626d7b`, for readable supporting copy. Status color is always accompanied by a label.
- Red and amber are used for actual error and invoice expiry states.

The palette uses solid color blocks. There are no decorative dashboard charts, token balances, invented learner counts, or reward promises.

## Typography

Local Manrope Variable is the reading and interface face. Local Space Grotesk Variable provides expressive headings and Bitcoin units. English and Hausa are supported through local Latin and Latin Extended font files. The landing page uses a confident editorial headline; lessons use a narrower reading column and generous line height.

## Layout

Desktop uses a horizontal header and four learning tabs. Phones use a fixed, accessible five-item bottom navigation with safe-area padding. There is no application navigation sidebar.

The landing page introduces the purpose, three real learning quests, the wallet exercise, and practical questions. The signed-in learning workspace uses a cobalt-tinted introduction, true completion progress, searchable quest cards, and working wallet and course-guide entry points.

Lesson pages separate reading from knowledge checks. A contextual achievement panel describes what completion means; it is content, not navigation. The wallet lab shows a clear three-step flow and then the actual invoice, payment hash, network, expiry, and verified receipt.

## Components

Quest cards have original dimensional coin, key, and Lightning artwork. They behave as buttons and lead to actual lessons. Knowledge badges and a verified wallet badge have distinct labels and evidence requirements.

Controls have explicit labels and keyboard focus. Dialogs trap focus, support Escape, make the background inert, and restore the previous focus. Wallet connection fields are password inputs; delegated secrets are cleared before the connection request is sent. Error messages explain the next useful action.

The bottom navigation remains usable while an action notification is visible. Toast dismissal has a 44-pixel target. All payment states use readable text, rather than relying on icon or color alone.

## Responsive and motion rules

At 360 pixels, pages remain within the viewport and controls wrap rather than overlap. Lesson body copy remains readable, and touch text fields use 16-pixel type to prevent unexpected mobile zoom. Headings scale with the viewport; the artwork is vector and fonts are local.

Small hover and feedback transitions communicate interactivity. Reduced-motion settings disable animated movement and smooth scrolling. No motion is required to understand a state or complete a task.

## Honest product content

All course content is available in English and Hausa. Hausa is identified as an initial translation awaiting native-speaker review. Lesson durations are estimates. A regtest wallet is explicitly described as having no monetary value. Payment verification, adoption, and mainnet claims require separate recorded evidence.
