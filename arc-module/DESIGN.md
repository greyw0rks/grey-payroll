---
name: Grey Payroll on Arc
description: Considered payroll tools with clear amounts and employer-controlled approval.
colors:
  ground: "#F4F3EE"
  surface: "#FFFFFF"
  ink: "#16181C"
  muted: "#60645F"
  accent: "#3DDC84"
  line: "#DDDFD5"
  soft-mint: "#DFEBDD"
  focus-green: "#1A7A3C"
  notice-ground: "#E8F7EB"
  notice-ink: "#245C36"
  workspace-subtle: "#F9F8F5"
  workspace-border: "#E8E6DF"
  workspace-muted: "#6B6B6B"
  error: "#D63B3B"
typography:
  display:
    fontFamily: "'Space Grotesk', sans-serif"
    fontSize: "clamp(64px, 6.65vw, 96px)"
    fontWeight: 500
    lineHeight: 1.04
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "'Space Grotesk', sans-serif"
    fontSize: "clamp(36px, 4vw, 56px)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  title:
    fontFamily: "'Space Grotesk', sans-serif"
    fontSize: "23px"
    fontWeight: 500
    letterSpacing: "-0.035em"
  body:
    fontFamily: "'DM Sans', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
  body-compact:
    fontFamily: "'DM Sans', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "'DM Sans', sans-serif"
    fontSize: "13px"
    fontWeight: 500
  amount:
    fontFamily: "'Space Grotesk', sans-serif"
    fontSize: "42px"
    fontWeight: 500
    letterSpacing: "-0.035em"
rounded:
  control: "8px"
  action: "10px"
  workspace-surface: "12px"
  account-surface: "14px"
  feature-surface: "16px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  card: "28px"
  section-gap: "32px"
  inset: "48px"
  column-gap: "80px"
components:
  button-mint:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.action}"
    padding: "16px 24px"
    height: "54px"
  button-mint-hover:
    backgroundColor: "#34CD78"
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.action}"
    padding: "16px 24px"
    height: "54px"
  button-dark-hover:
    backgroundColor: "#343831"
  button-compact:
    rounded: "{rounded.control}"
    padding: "12px 17px"
    height: "43px"
  button-workspace-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-workspace-primary-hover:
    backgroundColor: "#2a2d33"
  button-workspace-secondary:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-workspace-secondary-hover:
    backgroundColor: "#EDECEA"
  button-workspace-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-workspace-ghost-hover:
    backgroundColor: "{colors.ground}"
  button-workspace-danger:
    backgroundColor: "{colors.error}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-workspace-danger-hover:
    backgroundColor: "#b83030"
  recipient-input:
    backgroundColor: "{colors.workspace-subtle}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
  payroll-preview:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.feature-surface}"
    padding: "30px"
  account-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.account-surface}"
    padding: "28px"
  workflow-notice:
    backgroundColor: "{colors.notice-ground}"
    textColor: "{colors.notice-ink}"
    rounded: "{rounded.control}"
    padding: "13px 14px"
  workspace-tabs:
    backgroundColor: "{colors.workspace-subtle}"
    rounded: "{rounded.workspace-surface}"
    padding: "4px"
  status-badge:
    rounded: "{rounded.pill}"
    padding: "2px 8px"
---

# Design System: Grey Payroll on Arc

## Overview

**Creative North Star: "A considered payday"**

Grey makes precise payroll work feel calm and tangible. The established visual world combines a warm ivory ground, white working surfaces, charcoal typography and mint actions. Space Grotesk provides the broad display voice; DM Sans carries instructions and financial rows.

The interface changes density with the task: open spacing for the public introduction, a contained account form for entry, and compact bordered controls for preparing payroll. Procedural three-dimensional artwork supplies physical depth without becoming payment evidence. This document records the implemented identity; route composition and messaging strategy remain in the surface brief.

**Key Characteristics:**

- Warm grounds and restrained mint emphasis.
- Broad display typography with clear, compact working text.
- Exact amounts, visible units and aligned financial rows.
- Soft corners, quiet borders and selective depth.
- Finite motion with reduced-motion and rendering fallbacks.

## Colors

The palette gives payroll a warm, composed setting while keeping amounts and actions clear. The frontmatter owns the exact values; sidecar tonal ramps are preview aids, not additional application tokens.

### Primary

- **Mint:** Main public action, selected workflow number, ready-to-execute payroll action and the procedural payroll slab. Pair it with charcoal text.
- **Focus Green:** Keyboard focus on the public screens, input caret and the existing success signal.

### Neutral

- **Ivory Ground:** Page background and the shared workspace's secondary action.
- **White Surface:** Payroll previews, account cards and operating panels.
- **Charcoal Ink:** Main text, dark actions and the network context bar.
- **Muted Text:** Public descriptions, navigation context and explanatory notes.
- **Quiet Line:** Public section dividers and the replay control border.
- **Soft Mint:** Account story panel and the closing public section.
- **Notice Ground / Notice Ink:** Paired background and text for the illustrative workflow status.
- **Workspace Subtle / Workspace Border / Workspace Muted:** The existing operating controls retain their own subdued field, border and secondary-text values.

Error red is reserved for invalid input and the shared destructive-action variant. Transaction badges use the implemented green, amber, red and slate status treatments together with an icon and a written state.

**The Dark-on-Mint Rule.** Mint actions use charcoal text. White text belongs to charcoal or error-red actions.

## Typography

**Display Font:** Space Grotesk, with sans-serif fallback.  
**Body Font:** DM Sans, with sans-serif fallback.

The pairing is established and pinned. Keep the broad, slightly tightened display shapes and the plain, readable supporting text; do not substitute a new display identity.

### Hierarchy

- **Display:** The public hero uses the frontmatter's fluid display role, with two deliberate lines.
- **Headline:** Major public section headings share the headline role. Account-story headings use a separate observed clamp from 40px to 60px.
- **Title:** Public feature and workflow titles use the title role; workspace panel titles use a denser 16px semibold treatment.
- **Body:** Public section descriptions use the body role. Hero supporting text is larger at 18px; account-story copy is 17px.
- **Compact Body:** Supporting feature copy and workspace instructions use the compact role, with 12–14px text where the task requires denser context.
- **Label:** Navigation and compact action labels use DM Sans. Supporting metadata is smaller and never substitutes for the main amount or action.
- **Amount:** The illustrative total uses Space Grotesk and tabular numerals. Recipient amounts remain aligned and preserve their visible USDC unit.
- **Address:** Wallet addresses use the workspace's native monospace stack. The unused JetBrains Mono declaration in the token file does not establish a loaded display or address font.

**The Two-Voice Rule.** Use Space Grotesk for headings and prominent totals, and DM Sans for explanations, controls and recipient details.

## Layout

Public screens use a centered container with a maximum width of 1280px. The default available width subtracts 112px from the viewport; it subtracts 64px at the 1100px breakpoint and 40px at the 480px breakpoint.

The desktop hero uses two columns (1fr / 1.06fr). Workflow, control and FAQ layouts use two columns with an 80px gap; the gap reduces to 45px at 1100px. At 800px these sections and the hero become single columns, and product navigation anchors disappear while account entry remains available. Workflow options become a two-column grid, then one column at 480px.

Public section spacing is generous: the workflow uses 130px / 122px vertical padding on desktop, with 85px at 800px and 72px at 480px. Other public sections follow the same reduction in density. Do not carry this marketing spacing into the payroll form.

Account entry uses a split story/form layout (0.95fr / 1.05fr) and a form width capped at 390px. At 800px the story reduces to the brand strip and the form becomes the main page content. Clerk root, card box and card all fill the form's available width.

The wallet workspace keeps a narrower 768px maximum working column with 16px horizontal padding. Its header wraps, and the network/wallet controls spread across the available width on small phones. The disconnected-wallet action is centered within its message.

## Elevation & Depth

Most operating surfaces rely on white against ivory, thin borders and compact spacing. The public payroll preview has a soft ambient shadow; the account card removes Clerk's default shadow. Physical perspective, bevels and lighting belong to the procedural Three.js illustration and its CSS fallback.

### Shadow Vocabulary

- **Payroll Preview** (`0 16px 55px #16181C09`): Soft separation for the illustrative payroll card.
- **Illustration Fallback** (`12px 20px 38px #16181C12`): Diffuse depth beneath the tilted mint fallback.
- **Selected Workspace Tab** (`0 1px 2px 0 rgb(0 0 0 / 0.05)`): The existing shared workspace's small selected-state lift.

**The Finite-Depth Rule.** The payroll illustration completes a short sequence and rests. Pause rendering outside the viewport or while the document is hidden; reduced motion shows the settled scene and removes replay.

The public hero's Framer Motion entry lasts 700ms using the established ease-out curve. Buttons and disclosure arrows use 160ms feedback. Hover movement applies only to a fine pointer; reduced motion removes button translation, disclosure transitions and smooth scrolling.

## Shapes

Public actions have gently curved corners: the full action uses the action radius and the compact header action uses the control radius. Public previews use the feature-surface radius; account cards use the account-surface radius. The existing workspace retains its workspace-surface radius for panels and the control radius for fields and actions.

Circles are specific to workflow numbers, illustrative recipient avatars, status pills and the replay control. Borders are thin and quiet. The procedural artwork uses a rounded extruded slab and circular recipient nodes; those shapes explain the illustration rather than redefining the form controls.

## Components

### Buttons

Public mint and charcoal actions use DM Sans at 14px semibold, a 54px minimum height and a 22px icon gap. The compact header action is 43px tall with 12px type. Fine-pointer hover moves an action up 2px and changes its fill; pressing returns it to its resting position. Public keyboard focus uses a green 2px outline with a 5px offset.

The shared workspace Button supports primary, secondary, ghost and danger variants with small, medium and large heights of 32px, 40px and 48px. Its keyboard focus uses a charcoal ring, its press state scales to 0.98, and disabled or loading states reduce opacity and prevent interaction. Ghost and danger remain available component variants; current payroll screens primarily mount primary and secondary actions. The confirmed execution action receives mint with charcoal text.

### Cards / Containers

The illustrative payroll card has a white surface, roomy internal padding, a prominent total, thin recipient-row separators and a green explanatory status strip. Always retain the “Illustrative” marker and the note that no payment has been sent.

Workspace panels retain white fills, the workspace border and compact internal padding. Account forms use white cards and fit their containing column without added shadows.

### Inputs / Fields

Recipient fields use a subtly tinted workspace background, a thin border and a 40px height. Invalid input changes the border to error red and includes a written validation message; disabled fields reduce opacity. Keyboard focus uses the workspace's charcoal ring. Amounts use decimal input mode and tabular numerals; address fields use monospace.

Clerk account inputs use the real authentication component, a minimum height of 44px and 16px text. Preserve Clerk's authentication, validation and account-switch behavior rather than drawing a simulated form.

### Navigation

Public navigation is compact DM Sans text with underlined fine-pointer hover and visible keyboard focus. Account links remain available when product anchors are hidden on smaller screens.

Workspace tabs use a subtly tinted bordered track. The selected tab is white, charcoal and slightly lifted; unselected tabs use muted text and become charcoal on hover. Preserve the tab roles, labels and selected state.

### Status Badges

Transaction badges combine a status icon, written label and subtle colored border on a pale fill. Pending, confirmed, failed, replaced and unknown are distinct states. A green badge represents a verified result, not the public illustration.

### Workflow and Disclosure

Workflow options are real buttons with an announced pressed state. Selection changes the numbered circle to mint and updates the accompanying illustrative summary and status.

FAQ answers use native disclosure elements. Opening an answer rotates the chevron by 180 degrees; keyboard focus stays visible and reduced motion removes the transition.

### Account Entry and Payroll Illustration

Login and signup render the existing Clerk account flow and redirect successful account entry to the workspace. Show the configuration fallback only when Clerk is absent, and keep a retry path for account-rendering failure. When Clerk is configured, signed-out access returns to login before wallet dependencies load. An account organizes access; the employer wallet approves funds.

The Three.js illustration is procedural geometry with a runtime canvas texture, not a shipped raster asset. It depicts one payroll branching toward three recipient nodes. A short entrance and staggered transfer sequence settle after roughly four seconds; mouse movement gives restrained perspective response. Replay is available only when rendering is ready and reduced motion is off. If WebGL cannot start or loses its context, preserve the readable mint CSS fallback and the illustrative caption.

## Do's and Don'ts

### Do:

- **Do** preserve the established ivory, white, charcoal and mint palette.
- **Do** keep Space Grotesk headings and DM Sans working text.
- **Do** preserve tabular amounts, visible USDC units and readable recipient rows.
- **Do** distinguish illustrative examples from confirmed payment records.
- **Do** keep keyboard focus visible and honor reduced motion.
- **Do** preserve the existing workspace's denser controls and palette details.

### Don't:

- **Don't** replace the pinned identity during an ordinary extension.
- **Don't** put white text on mint actions.
- **Don't** describe account access or illustrative animation as payment approval.
- **Don't** turn the finite payroll illustration into a perpetual animation.
- **Don't** duplicate Clerk's account-switch controls outside the configured Clerk form.

