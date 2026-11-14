# SatsAcademy design system

SatsAcademy is a learning studio for first-time Bitcoin users in Nigeria and West Africa. Its core job is to turn an unfamiliar payment concept into a small action that a learner can check themselves.

## Color

Warm paper `#f8f7f2` and near-white `#fffefa` keep long lessons comfortable. Cobalt `#3150d6` marks navigation, primary actions and verified steps. Apricot `#ffc17d` gives Bitcoin illustrations warmth without using orange as every surface. Sage `#4d775b` signals completed checks. Ink `#222a35` is used for reading; muted copy uses `#677487` or darker. Red and amber are reserved for real errors and invoice expiry.

## Typography

Local Manrope Variable is the reading and UI face. Local Space Grotesk Variable gives headings and numeric units a distinct character. Both support the Latin characters used in English and Hausa; no remote font requests are needed.

## Layout

A quiet fixed sidebar anchors the learning workspace. The dashboard combines a small illustrated introduction, an actual progress ring, three lesson cards, and a prominent wallet lab. Lesson pages concentrate content in a readable main column with contextual help. At 650px the sidebar becomes a keyboard-accessible menu and cards become compact horizontal rows. At 360px all pages remain within the viewport.

## Components

Buttons use a six-pixel radius and a 44px main touch target. Cards have restrained borders and gentle elevation on hover. Every modal traps keyboard focus and supports Escape. A single toast reports completed actions; errors explain the next useful step. Diagrams are original SVG/CSS and distinguish educational illustrations from actual wallet invoices. Verified achievements, knowledge badges and preview state are visually and semantically separate.

## Motion and accessibility

Transitions use opacity and transforms. Reduced-motion users receive immediate state changes. Radio quizzes use native inputs, inputs have explicit labels, and tab lists carry tab semantics. Pending payments show a text label alongside an activity indicator, so color alone never conveys payment status.
