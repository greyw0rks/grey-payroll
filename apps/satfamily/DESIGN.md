# GreyFinance design system

GreyFinance is a company Lightning treasury and expense workspace for small African teams. Its main job is to turn an employee's payment request into an independently approved, verifiable expense.

The visual direction combines a financial dashboard with Swiss Modernism: a disciplined grid, clear hierarchy, aligned financial values, and restrained decoration. A horizontal company header and navigation keep the treasury, approval inbox, team, and ledger in one workspace. QuestN is reserved for the separate learning product.

## Color

Warm chalk `#f5f5ee` is the canvas; ivory `#fffef9` is the work surface. Forest `#163c32` anchors navigation and treasury. Fresh lime `#d6ef93` highlights the main next action, with forest text. Copper `#ad603e` adds human warmth to small illustrations and category markers. Ink `#273a32` is primary text and `#60746a` supports text. Borders use `#dce3d7`. Critical destructive actions use `#a13c32` on `#fcece7`. No information relies only on color.

## Typography

Local Manrope variable font. Body 14–15px, line-height 1.55. Section heading 20px; page title 30px; treasury amount uses 44px with tabular numerals. Labels are short and sentence case. Financial values align right and use tabular numerals.

## Layout

Desktop: a centered 1320px workspace, horizontal brand/company/profile header, sticky navigation tabs, and 32px content padding. The overview places treasury, spending, and budget cards above the approval inbox and ledger. Tables are restrained and aligned, with readable 56px rows. Mobile: the company switcher sits below the brand/profile row; six persistent bottom tabs keep every main view reachable without a drawer. Content uses 15–19px gutters, one-column panels, expense cards in place of dense rows, and primary actions and navigation targets of at least 44px. Forms and details open accessible focusable dialogs. Navigation changes views without reloading the page or clearing a temporary signing identity.

## Components

Company switcher, profile chip, horizontal navigation tabs, segmented period control, solid forest action, lime action on forest, outlined utility actions, small state chips with text, initials avatars, category icons, progress bars tied to actual stored policy totals, ledger rows, expense details dialog, invoice QR, wallet capability notice, and toast with live region. Empty states explain the next action. Loading skeleton and offline banner keep the workflow understandable.

Each identity can own one company and join others. Hide further company creation once ownership is established, preserve membership-based company switching, and show the limit in the company menu and creation form.

Preview rows use explicit “Sample” payment states and the preview badge stays visible. Real settlement appears only after wallet proof verification.

## Motion and accessibility

120–180ms opacity/translation for panels and menus. Respect reduced motion. Visible focus rings, descriptive form labels, dialog focus containment, escape to close, contrast checked for body labels, and no hidden essential mobile controls.
