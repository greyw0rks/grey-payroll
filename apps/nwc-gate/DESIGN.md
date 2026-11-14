# NWC Gate design system

NWC Gate is a developer workbench with a real paid-access example. The visual direction is precise, editorial and slightly industrial: warm paper, crisp charcoal rules, one electric chartreuse accent, and technical annotations that belong to the product.

## Color

- Paper canvas: `#f8f7f0`
- Surface: `#ffffff`
- Charcoal ink: `#242821`
- Secondary text: `#64685d`
- Quiet rule: `#dedfd3`
- Active chartreuse: `#ddfa72` with charcoal text
- Deep green success: `#236447`
- Rust error: `#a53c25`

Accent color marks the active page, important action and confirmed feedback. It never substitutes for text status. White text is reserved for the charcoal code surface and book cover. Meaningful text uses contrast appropriate for normal reading.

## Typography

Local Space Grotesk variable font provides the display and interface voice. Local IBM Plex Mono Latin 400/500 provides code, protocol labels and payment hashes. Body text is at least 15px, with 1.6 line height for explanatory content. Numbers use tabular figures.

## Layout

A 244px documentation rail, slim top bar and generous editorial content area create a recognizable developer product. The overview combines large typography, a functional code example and an original protocol diagram. The live example uses a sharply designed field-guide cover, a short payment flow and an actual invoice panel. At tablet and phone widths, navigation becomes an accessible drawer and all multi-column layouts collapse without horizontal page overflow.

## Components

Buttons have 44px minimum targets, restrained 5px corners and visible focus rings. Code panels include file labels, line numbers and copy feedback. Status chips always pair color with text. Search, wallet connection, confirmation and guide reading use accessible dialogs with focus trapping, Escape and focus restoration. Invoice QR codes are generated locally from real BOLT11 invoices. Error, offline, empty and expired states are real states, never fake payment claims.

Motion is limited to short opacity/position changes and respects reduced motion. No external images, trackers or remote fonts are required.
