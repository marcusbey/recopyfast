# Design — Story s16-webhook-config

## Screen(s)

One panel: **Webhooks**, added to `SiteDetailView.tsx` alongside `DomainVerification` and
the `VersionHistoryPanel` entry point (research's anchor point — "likely sibling to
`ApiKeysPanel`... or on the per-site detail view") — per-site, matching AC 1's "configure a
webhook URL per site." Structured as one `Card` whose shape stays fixed across every state,
the same principle `s02`'s install card used: the state changes what's *inside* the card, not
the card's frame.

1. **Header** — `IconTile` (`accent`) + `.text-title` "Webhooks" + one line of description.
2. **Config form** — URL `Input`, a coalescing-window `Select` with the default stated inline,
   `Button` "Save"/"Update", `Button` (`outline`) "Send test delivery."
3. **Delivery history** — a list, not a table. No `Table` primitive exists in the design
   system; this is composed the same way `ApiKeysPanel`'s key list and
   `VersionHistoryPanel`'s timeline already are — `<ul>`/`<li>` rows inside the `Card`
   (`ApiKeysPanel.tsx:207-243` is the precedent followed here).

A second, separate surface: the **show-once secret dialog** (`Dialog`), presented immediately
after a webhook is first created. It is not a state of the panel — it is a modal interruption
that must be explicitly resolved before the panel underneath is usable again.

## Mockup
docs/designs/s16-webhook-config.html — visual reference. DO NOT copy into production: Execute
builds with the real `src/components/ui/*` components (`Card`, `IconTile`, `Input`, `Label`,
`Select`, `Button`, `StatusBadge`, `Alert`, `Dialog`, `EmptyState`, `Skeleton`).

## Reused components (from the design system)
- `Card` (`default`) — the Webhooks panel container, same frame as `ApiKeysPanel`.
- `IconTile` (`accent`) — panel header glyph. Solid-tile brand treatment, same family as the
  `<>` mark — no gradient.
- `Label` + `Input` — the webhook URL field.
- `Select` — the coalescing window (batch interval). The control alone doesn't satisfy AC 4's
  "the default is stated in the UI," since a closed `Select` hides its own selected value's
  meaning until opened — the default is *also* restated as helper text under the field.
- `Button` (`default`) — Save/Update. `Button` (`outline`) — Send test delivery.
  `Button` (`ghost` `size="sm"`) — Copy secret, inside the dialog.
- `StatusBadge` — one per delivery row, mapped exactly onto the brief's required outcomes:
  `delivered` → `success`, `retrying` → `warning`, `failed` → `danger`, `pending` → `neutral`.
  No new tone, colour signals state only.
- `Alert` (`variant="destructive"`) — the SSRF refusal at configuration time, inline under the
  URL field.
- `Alert` (`variant="warning"`) — the show-once secret warning inside the dialog.
- `Alert` (`variant="success"` / `variant="destructive"`) — the manual test-delivery result,
  inline under the test button. There is no toast primitive (design-system gap #1), so this
  follows the same inline-feedback fallback `ApiKeysPanel` already uses for its own errors
  (`ApiKeysPanel.tsx:145-152`) and that `s02`'s design already adopted for the same gap.
- `Dialog` — the show-once secret. Configured to be non-dismissible by accident (see gap #1
  below).
- `EmptyState` — no webhook configured yet for this site.
- `Skeleton` — loading, shaped as header + form + two history rows.
- `.text-title` / `.text-eyebrow` / `text-sm` / `text-xs text-muted-foreground` — panel title,
  "Recent deliveries" eyebrow, body and metadata text.
- `--font-mono` — the saved webhook URL (read-only display), each row's response status, and
  the secret itself in the dialog. All three are machine strings per the design system's
  explicit rule.
- `.tabular` — the attempt-count digit ("2 of 5") so it doesn't reflow as it increments.

## States

All four required states, plus the story-specific ones the brief calls out:

- **Loading** — `Skeleton` in the panel's shape: header bar, two input-shaped bars, two
  list-row-shaped bars. Not a spinner.
- **Empty** — `EmptyState`: icon, "No webhook configured for this site.", one action ("Add
  webhook"). Distinct from *configured-with-no-deliveries-yet*, which stays inside the
  configured state with a one-line "No deliveries yet" note replacing the row list — that is a
  content state of the config card, not the panel-level empty state, and must not reuse
  `EmptyState` (same distinction `s02`'s design already draws; the system separately rules
  that empty must never stand in for error either).
- **Error** — `Alert variant="destructive"` if the webhook record fails to load or save,
  positioned where the config form would render — "what failed and what to do," per the
  system pattern.
- **Success** — the configured state itself: `StatusBadge` `success` on delivered rows, and an
  `Alert variant="success"` after a successful manual test.
- **Retrying** — `StatusBadge` `warning`; the row shows "Attempt 2 of 5" (`.tabular`) and a
  next-attempt note ("Next attempt in 4 min").
- **Failed** — `StatusBadge` `danger`; stays visible once retries exhaust (AC 3 — "marked
  failed and visible as such," not pruned from the list). Row reads "Failed — gave up after 5
  attempts."
- **SSRF refusal** — two distinct moments, same visual language (`Alert variant="destructive"`)
  but different copy, so each teaches its own moment rather than reading as one generic error:
  - *Configuration time*: inline under the URL field on save. Names the specific address class
    refused (private / loopback / link-local) and states *why* — the endpoint must be
    reachable from the public internet — instead of a bare "invalid URL."
  - *Delivery time (DNS rebinding)*: rendered as a `failed` history row whose reason line says
    the endpoint resolved to a private address **at send time**, distinct from a generic
    connection failure. A URL that passed configuration-time validation and then fails this
    way is signalling a changed or rebound DNS record — the owner needs that to read
    differently from "your server didn't respond."

## Design system gaps

1. **`DialogContent` (`src/components/ui/dialog.tsx:32-54`) always renders the corner
   `DialogPrimitive.Close` (the X) unconditionally — there is no prop to omit it.** The
   show-once secret moment needs a dialog with *no* accidental-dismiss affordance at all: no
   corner X, no overlay-click dismiss, no Escape. `onInteractOutside` / `onEscapeKeyDown` /
   `onPointerDownOutside` already pass straight through today via the `...props` spread onto
   `DialogPrimitive.Content` (`dialog.tsx:38-45`), so preventing overlay-click and Escape
   dismissal needs no change. The corner X does — it's hardcoded inside `DialogContent`
   itself. Execute needs a `showClose` prop (default `true`) on the existing primitive, not a
   new component; flagging for `/ks-plan` since it's a one-line addition to what's already
   there, not an invention beside it.
2. **No toast/transient feedback primitive** (existing gap #1, `design-system.md:288-289`).
   This story has two moments that would ordinarily be a transient confirmation — "secret
   copied" and "test delivery sent." Both resolved here the way `ApiKeysPanel` and `s02`
   already resolve the same gap: an inline, non-dismissing `Alert` (test delivery), or the
   button's own label swapping briefly (copy secret) — no new primitive.
3. Everything else needed by this screen — the URL/select form, status pills, delivery list
   rows, dialog shell, empty/loading/error states — is already covered by existing components.
   No other gap found.
