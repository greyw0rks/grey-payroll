# NostrChat design system

NostrChat is a calm, personal workspace for private conversations and the small payments that happen inside them. Its visual direction is warm stationery with precise messaging controls.

## Color

- Deep pine `#153f35`: navigation rail and high-confidence actions.
- Pine `#1c5e4c`: primary buttons, focus context, identity accents.
- Warm paper `#fafbf7`: conversation canvas and welcome space.
- White `#ffffff`: inbox, message cards, dialogs.
- Coral `#d9866a`: wordmark dot and expressive editorial accent.
- Soft sage `#e7efe9`: selected conversations and outgoing bubbles.
- Ink `#263d34`: primary text.
- Muted labels use darkened `#78817a` and related shades; decorative captions can be lighter. Touch and keyboard focus use coral outline.
- Success appears with both a label and icon. Pending invoices use amber; failures use warm red.

## Typography

Locally bundled Manrope Variable carries the entire product. Weight and letter spacing create a readable hierarchy. Georgia italic on the welcome page’s “Your sats” adds a small human detail. Protocol hashes and connection strings use the browser monospace stack.

## Layout

Desktop uses a compact pine navigation rail, a 300px conversation list, a fluid chat, and an optional 251px contact detail panel. The detail panel disappears first on tablets. Mobile presents the welcome flow, conversation list, or active chat as one screen, with persistent bottom navigation. Dialogs and the wallet drawer fit 360px screens.

## Components

- Pastel identity avatars with initials; no externally hosted profile images.
- Flat, restrained cards with thin sage borders.
- Conversation bubbles align to sender and include a precise timestamp.
- Lightning cards display fixed sats, the invoice description, expiry state, and the verification source.
- A relay acknowledgement is described as “Published,” never a read receipt.
- Nostr identities and wallet connections have distinct onboarding and controls.
- Empty states explain the next action. Every visible action has a working handler.
- Visible keyboard focus, reduced-motion support, error feedback, and clear payment confirmation are required.

The original SVG on the welcome screen depicts two conversations and a private payment. It is local, lightweight, and uses the product palette.
