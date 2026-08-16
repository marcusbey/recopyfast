# Design — Story s11b-ab-surface

## Screen(s)

One route, three views inside it — the shape `src/app/dashboard/_ab-tests/page.tsx` already
has (`view: "list" | "create" | "results"`). This story un-parks the route (rename
`_ab-tests` → `ab-tests`, per the split proposal) and redesigns **list** and **create**; the
**results** view stays exactly as it is today — `s12` owns it, and this story stays out of it.

1. **Test list** — `/dashboard/ab-tests`. Site selector bar (existing `SiteSelectorBar`,
   unchanged) above a list of `ABTestCard`s, each carrying its lifecycle state via
   `ABTestStatusBadge`. Primary action "Create test" in the page header.
2. **Create flow** — a 4-step wizard reachable from the list's primary action, replacing the
   current AI-only 4-step wizard (`select-element → generate → review → configure`) with one
   that also supports manual variant authoring and a traffic split:
   `select-element → [generate | skip] → review-and-split → start`.
3. **Nav entry** — `DashboardNavigation`'s sidebar, entitled and unentitled states. The item is
   currently absent from `navGroups` entirely (`DashboardNavigation.tsx:49-51`); this story adds
   it back using the exact `requiresPlan` mechanism `Teams` already uses at `:59-64` — not a new
   gating pattern.

## Mockup

`docs/designs/s11b-ab-surface.html` — reference only, static, low-fidelity. Shows: the nav
sidebar in both entitled and unentitled states; the test list in loading / empty / error /
success; the create wizard's element-picker step (including a disabled "active test" row) and
the review-and-split step (manual variant authoring, per-variant split inputs, a persisted-save
confirmation, and the running-total validator); and the two duplicate-test refusal states —
the existing greyed row, and the new blocking `Alert` with a stated reason and a way out.

## Reused components

Inventoried before designing anything new, per the brief:

| File | What it does today | What this story changes |
|---|---|---|
| `src/app/dashboard/_ab-tests/page.tsx` | View switcher (list/create/results), site + element loading, error/empty states for the *site* list | Rename directory; swap its hand-rolled empty/error blocks for `EmptyState` / `Alert` (see States) |
| `ABTestManager.tsx` | Test list, create CTA, hand-rolled empty state, hand-rolled error text, `Loader2` spinner | Swap spinner → `Skeleton` rows; swap hand-rolled empty block → `EmptyState`; swap hand-rolled error `<p role="alert">` → `Alert variant="destructive"` |
| `ABTestCard.tsx` | One test's row: name, `ABTestStatusBadge`, variant count, activate/pause/resume, results link | Unchanged. Already correct: `StatusBadge`, `Button` variants, no hardcoded color |
| `ABTestStatusBadge.tsx` | Wraps `StatusBadge` over `abTestStatuses` (`status-badge.tsx:167-198`) | Unchanged — this is the lifecycle-state component; see States below for the mapping |
| `ABTestCreateFlow.tsx` | Wizard shell: `WizardStepIndicator` + step switch | Extend the step set (see Screens); no structural change to the shell itself |
| `ABTestElementPicker.tsx` | Radiogroup of elements; already greys + tags `hasActiveTest` rows (`:90,127-131`) | Add a second CTA ("Write manually") beside "Generate Variants"; the existing greyed-row treatment is kept as the *preventive* half of the refusal (see States) |
| `ABTestGeneratingState.tsx` | AI-generation loading state | Unchanged, only reachable from the "Generate with AI" path now |
| `ABTestVariantReview.tsx` | Control card (read-only) + AI variant cards, inline edit-in-place (`saveEdit` today only updates React state — the defect this story fixes) | Add: a traffic-split `Input` per variant, a running-total row, an "Add variant" action, and a persisted-save confirmation on the existing edit affordance |
| `ABTestConfigForm.tsx` | Sample-size / confidence-threshold / auto-complete fields, "Activate Test" button | Copy only: "Activate Test" → "Start test" (sentence case, matches the marketer-facing verb used elsewhere in this story). Fields are lifecycle/significance config (`s12` territory) and are left as-is — this story does not touch what they configure, only that this is where the wizard ends |
| `useABTestCreation.ts` | Wizard state, AI generate call, `saveEdit` (local-state only), `activate` (PUT) | Design assumes `saveEdit` becomes a real persisted write (the fix this story requires) and that `activate` can now return `409` with a `reason` string — both are Plan/Execute concerns, not this file |
| `useABTests.ts` | List fetch, status PUT, already surfaces server error text (`readError`, not swallowed) | Unchanged — already does the honest thing on failure |
| `DashboardNavigation.tsx` | `requiresPlan` gate (`:29,63,122-132`), used today only by `Teams` | Add an `A/B Tests` item with `requiresPlan: "pro"`, `icon: FlaskConical` (already imported, currently unused since the removal), remove the stale comment at `:49-51` |
| `WizardStepIndicator.tsx` | Plain step-label row, not one of the 17 `src/components/ui/` primitives but already shipped inside `ab-create/` | Reused as-is; its four labels change to match the new step set |

## States

### Nav entry

- **Entitled (Pro):** rendered like any other item — active-state rail, no lock treatment,
  clicking navigates.
- **Unentitled:** identical DOM to `Teams` today — `opacity-45 cursor-not-allowed`, a
  `Badge variant="tone-neutral" size="sm"` reading "Pro", click intercepted
  (`DashboardNavigation.tsx:167-170`) rather than the link being omitted. The item stays visible
  so an unentitled account can see the feature exists and where the upgrade path is, instead of
  the sidebar silently having one fewer row.

### Test list

- **Loading** — row-shaped `Skeleton`s (icon + two lines), not the current `Loader2` spinner.
  The design system's own rule: "Skeleton in the shape of the content, not a spinner."
- **Empty** (fetch succeeded, zero tests) — `EmptyState`: `IconTile` with `FlaskConical`, title
  "No A/B tests yet", description "Create a test on any content element to compare two
  versions of its copy.", primary action "Create test". Replaces the current hand-rolled
  `Card` + manual icon circle.
- **Error** (fetch failed) — `Alert variant="destructive"` with the server's message (already
  surfaced honestly by `useABTests`'s `readError`) and a retry action. Replaces the current
  hand-rolled `<p role="alert">`. **Never renders as empty** — `useABTests` already keeps
  `error` and `tests` distinct, so this is a component swap, not a logic change.
- **Success** — list of `ABTestCard`s. Lifecycle state per card via `ABTestStatusBadge`,
  mapped from the four states the schema and `abTestStatuses` already define
  (`status-badge.tsx:167-198`) onto the brief's three-word vocabulary:

  | Brief's term | Actual status value | Badge tone | Label |
  |---|---|---|---|
  | draft | `draft` | neutral | "Draft" |
  | running | `active` | success | "Active" |
  | (running, deprioritized) | `paused` | warning | "Paused" |
  | ended | `completed` | accent | "Completed" |

  No new status is introduced — `paused` already exists in the running codebase and is kept
  distinct because it is a real, different state (a test that was serving traffic and is now
  deliberately not), not folded into "ended."

### Create flow — element picker (step 1)

- **Loading / error / no-elements-yet** — unchanged, already correct (`ABTestElementPicker.tsx`
  has all three: a spinner + label, an `AlertCircle` + retry, and a dashed-border "install the
  script" prompt).
- **Success, with one or more elements already under test** — the existing per-row treatment:
  `aria-disabled`, `opacity-60`, `cursor-not-allowed`, and an inline
  `Badge` reading "Active test running" (`ABTestElementPicker.tsx:90,127-131`). This is the
  **preventive** half of the one-test-per-element rule — it stops the obviously-blocked case
  before the user commits to a whole wizard run. It is not, by itself, sufficient (see below).
- Action row now offers **two** paths instead of one: "Generate with AI" (`Sparkles` icon,
  existing) and "Write variants manually" (`Button variant="outline"`, new — no AI call, no
  credit spend). Both require a selected element first, same as today.

### Create flow — the duplicate-test refusal (the story's explicit requirement)

The brief is explicit: a greyed-out row is not enough on its own — the user needs to learn
*why*, and the system needs to say so even when the block isn't visible in the picker (a second
browser tab activating a test on the same element between this session's step 1 and step 4 is a
real race, not a hypothetical one — that window is exactly what a database-level unique
constraint and a `409` are for, per the split proposal). Two touchpoints, not one:

1. **Preventive** — the greyed picker row above. Reachable at step 1.
2. **Reactive** — an `Alert variant="destructive"` that can appear at **either** step 1 (if the
   element picker's data was stale) or step 4 (if the conflict happened after variants were
   already authored), carrying:
   - Title: "Can't start this test"
   - Body: the server's stated reason, e.g. "This element already has an active test running.
     Pause or end it first, or choose a different element." — not a generic "something went
     wrong."
   - Two actions inside the alert: `Button variant="outline"` "Choose a different element"
     (returns to step 1, clearing the current selection) and `Button variant="ghost"` "View
     active test" (returns to the list view, scrolled/focused to that test's `ABTestCard`).

   This reuses the exact `Alert` pattern the wizard already uses for generation/activation
   errors (`ABTestCreateFlow.tsx:43-47`) — same component, same position (top of the step), just
   with a specific reason and a specific way out instead of a bare string.

### Create flow — review & split (step 3, replaces "review")

- **Control** — unchanged: read-only `Card`, "Control (Original)" badge, the site's current
  text.
- **Each variant** — extends today's edit-in-place card (`ABTestVariantReview.tsx:51-97`):
  - Text field: unchanged `textarea` + Save/Cancel, reachable whether the variant came from AI
    or was typed manually.
  - **Persisted-save confirmation** — the concrete fix for "review-step edits must persist."
    On `Save`, once the write round-trips, a small `text-tone-success-text` check mark + "Saved"
    label appears next to the Save button for a moment (`--dur-fast` fade, the system's existing
    fast duration — no bespoke timing). This is the visible signal that the edit is now server
    state, not React state that evaporates on activation — the defect `useABTestCreation.ts:
    157-163` has today.
  - **Traffic split** — a plain `Input type="number"` (0–100) beside a `text-sm
    text-muted-foreground` "%" label, `Label` "Traffic split" above it. Not an icon-in-input —
    a right-side unit label, composed the same way the system already composes a left icon
    (`design-system.md`'s documented `pl-10` pattern, mirrored on the right with a fixed-width
    suffix instead of an absolute icon).
  - Manual path seeds one blank variant card automatically so the reviewer is never looking at
    an empty step.
- **"Add variant"** — `Button variant="outline" size="sm"`, `Plus` icon, below the last variant
  card. Available on both paths (AI-generated variants can be supplemented manually and vice
  versa — the story doesn't restrict mixing).
- **Running total** — a row under the variant cards: "Total: 100%" in `.text-metric .tabular`
  (numbers must not shift width as they change, and this one changes on every keystroke). At
  exactly 100% it reads in `text-foreground`; away from 100% it turns `text-tone-danger-text`
  and an `Alert variant="warning"` appears under it: "Splits must add up to 100% — currently
  {n}%." The step's "Next" button is disabled until the total is exactly 100 and every variant
  has non-empty text — mirrors the existing pattern of disabling "Generate Variants" until an
  element is picked (`ABTestElementPicker.tsx:150`).

### Create flow — start (step 4, was "configure")

Unchanged fields and layout (`ABTestConfigForm.tsx`). Button copy "Activate Test" → "Start
test" — sentence case, active voice, matches the verb the rest of this document uses for the
same action. This is also the second place the duplicate-test `Alert` above can surface, since
activation is the moment the server-side constraint is actually checked.

## Design system gaps

1. **No toast/transient feedback primitive** — already an open gap in `docs/design-system.md`
   ("Open design system gaps" #1). This screen is a concrete instance of it: the ideal signal
   for "your edit was saved" is a brief, non-blocking toast, and the system has none. The
   inline "Saved" micro-confirmation described above is the same workaround the system doc
   already prescribes (everything is inline `Alert` / inline text) — recorded here so a future
   toast primitive has this as a second cited use, not invented fresh for this story.

No other gap. Traffic split uses `Input` + `Label` (existing primitives, right-side unit label
instead of a slider — no slider exists in `src/components/ui/`, and none is needed here: a
percentage that must sum exactly to 100 across an unknown number of variants is better typed
than dragged). The duplicate-test refusal uses the existing `Alert` component and pattern
already established in this same wizard (`ABTestCreateFlow.tsx:43-47`) — no new component.
