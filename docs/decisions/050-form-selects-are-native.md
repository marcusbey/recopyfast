# ADR 050 — Form selects are styled native `<select>`s; Radix Select is the exception

- Status: accepted
- Date: 2026-10-08
- Scope: s66a-app-design-tokens-and-panels
- Numbering: follows ADR 049 (047 and 048 are taken on `feature/s68-security-hardening`).
  Renumber at merge if needed.

## Context

The owner's second screenshot (2026-10-07) shows the "Expires in" select in Share Preview Link:
a rounded box with the browser's chevron about 6 px from the right border. Research (fact 7)
found the cause:
- 8 reachable native `<select>`s carry 5 different hand-written class strings, and none sets
  `appearance: none`. They live in `ContentFilterBar` ×2, `BulkOperations` ×3,
  `AnalyticsDashboard`, `ShareSiteDialog` and `ApiKeysPanel`.
- The Radix wrapper `src/components/ui/select.tsx`, which s16 shipped, has one consumer
  (`WebhooksPanel`).

The app needs one answer to "which select do I use", and the chevron must sit inside the
control at a fixed inset.

## Decision

Add a new primitive, `src/components/ui/native-select.tsx`, for every form select:
- a native `<select>` with `appearance-none`;
- 40 px tall, 2 px radius, `border-input`, `bg-card`, `pl-3 pr-9`;
- a 16 px `ChevronDown` drawn by the wrapper, `pointer-events-none`, with its right edge 12 px
  from the control's right border, coloured `text-muted-foreground`;
- `id`, `aria-*`, `value`, `onChange` and the options pass straight to the `<select>`, so
  `<Label htmlFor>` and `getByLabelText` keep resolving to it.

Radix `Select` stays for the case a native select cannot serve: options that need custom
rendering (an icon, a description). Its trigger is restyled to match `NativeSelect` exactly. A
source-scan test forbids a raw `<select` on app surfaces outside `native-select.tsx`.

## Considered options

- **Move all 8 to Radix Select.** Rejected:
  - `BulkOperations.test.tsx:301` uses `selectOptions`, and `ShareSiteDialog.test.tsx` asserts
    `within(select).getByRole("option")`, so both rely on native semantics;
  - phones would lose the OS picker;
  - every select would need a portal and the popover token;
  - pages that only need a choice from a list would ship more JavaScript.
- **Keep hand-styled native selects and fix each class string.** Rejected: five strings have
  already drifted apart, and nothing would stop the next one.
- **Keep a single primitive: retire Radix Select and move `WebhooksPanel` to native.** Rejected
  for now: `select.test.tsx` covers the s16 consumer, and retiring it is churn with no benefit to
  users. Revisit if no second Radix consumer appears.

## Consequences

- **Open state.** The open list is drawn by the OS and cannot be styled. Designs show only the
  closed control. With `color-scheme: light dark` on `:root`, the list follows the theme.
- **Two components.** They must stay visually identical when closed. `docs/design-system.md`
  says when to use each, and the Playwright harness measures the chevron inset on the native one.
