# Design — Story s01-trial-signup

## Screen(s)

Three surfaces, all reach into existing screens rather than adding new routes — consistent
with this story's own framing ("reach, not redesign") and with the acceptance criteria, which
name exactly two UI requirements: *"the dashboard shows days remaining"* and *"an expired state
with a single upgrade action."* The AI-credit allowance (AC 8) is folded into the same card
rather than given its own screen, because it is one more fact about the same trial, not a
second feature.

### 1. Dashboard overview — compact trial indicator (`/dashboard`)

One `StatusBadge` added to the existing `PageHeader` (`src/app/dashboard/page.tsx:166-176`),
between the title and the "Add site" action. Text is computed, not a fixed label:
`Trial — {daysLeft} days left`. Tone is threshold-driven: `info` while `daysLeft > 3`, `warning`
at `daysLeft <= 3`. Links to `/dashboard/billing`. Renders only while `resolveEntitlement`
reports a trial grant — absent for unentitled, converted, or non-trial accounts. This is the
entire change to this page; nothing else in its layout moves.

### 2. Billing page — trial status card (`/dashboard/billing`)

A new card, full width, sitting directly below the page's own header and above
`CheckoutStatusBanner` (`BillingDashboard.tsx:212`) — the same "banner near the top" slot that
component already occupies. Two independent rows inside one `Card`, because the two things a
trial can run out of — time and AI credits — move on different clocks and must not be
compressed into a single tone:

- **Row 1 — trial time.** `IconTile` (`Clock`) + `{daysLeft} days left in your trial` +
  muted sub-line `Ends {date}`. Tone `info` / `warning` at the same `<= 3` day threshold as the
  dashboard badge — same signal, same words, two places.
- **Row 2 — trial AI credits.** `IconTile` (`Zap`) + `{used} of {limit} trial AI credits used`
  (tabular numerals) + a thin progress bar. Tone `info` under 80% used, `warning` from 80% to
  under 100%, `danger` at 100% — this is AC 8's "stop at zero" made visible: the bar fills, the
  tone changes, and at zero a caption states plainly what that means: *"AI suggestions and
  translations are paused until you upgrade. Editing text by hand still works."*
- Trailing action while still trialling (either row): `Button variant="outline" size="sm"` "See
  plans" → opens the existing `UpgradeDialog` (`BillingDashboard.tsx:37`, already wired). This
  button is a convenience, not the AC's mandated action — that requirement belongs to state 3.

### 3. Billing page — trial expired (`/dashboard/billing`)

Reuses the shell of the existing unentitled branch (`BillingDashboard.tsx:137-175`,
`Card` → `mx-auto max-w-lg p-8 text-center`) rather than inventing a new layout. That branch
already renders for every account with `currentPlan === null`, and `middleware.ts:151-171`
already bounces there — a lapsed trial is one more reason to be unentitled, not a new gate. Two
copy variants of the same shell:

- **Never subscribed** (existing, unchanged): *"Choose a plan to continue."*
- **Trial expired** (this story, new): *"Your trial has ended."* Body states the AC 4
  reassurance explicitly, because a customer landing here needs to know their site did not just
  go down: *"Your 14-day Pro trial ended on {date}. Your site keeps serving its current content
  — editing, new sites and collaborators need Pro."* One `Button size="lg"` — **"Upgrade to
  Pro"** — and nothing beside it. No secondary action, no dismiss: this is the literal reading
  of *"a single upgrade action."*

Distinguishing the two variants needs a signal ("was this account ever trialling") that the
current unentitled branch does not carry — a data requirement for `/ks-plan`, not something to
resolve visually here.

**Out of scope, named explicitly:** the Stripe checkout screen itself (Stripe's own UI, reached
through the existing `UpgradeDialog`) and any change to `UpgradeDialog`'s internals.

## Mockup

`docs/designs/s01-trial-signup.html` — visual reference for all three screens and every state
below. **Reference only — do not copy into production.** Execute builds with the real
`src/components/ui/*` primitives (`Card`, `Button`, `StatusBadge`, `IconTile`, `Skeleton`).

## Reused components (from the design system)

- `PageHeader` — unchanged; the trial badge slots into its existing `actions`/title area.
- `StatusBadge` — both the dashboard's compact indicator and, conceptually, the two rows of the
  billing card use its tone system (`info` / `warning` / `danger`). The dashboard badge's status
  object is built inline (`{ label: computed, tone: computed, ... }`), not pulled from a fixed
  registry like `siteStatuses` — the label is a live count, which a static registry entry can't
  hold. `StatusBadge`'s prop type (`status: StatusDefinition`) already allows this; no change to
  the component itself.
- `Card` (`outline` variant) — the trial status card and the expired-state panel, matching the
  `outline` used elsewhere in the dashboard body (`dashboard/page.tsx:231`).
- `IconTile` — `Clock` (trial time, tone `info`/`warning`) and `Zap` (AI credits, tone
  `info`/`warning`/`danger`). Both icons are already in use for these exact concepts elsewhere
  in the app (`dashboard/page.tsx`: `Clock` for "Last edit", `Zap` for "AI suggestions") — reused
  for continuity of icon meaning, not picked fresh.
- `Button` — `variant="outline" size="sm"` ("See plans", while trialling) and
  `variant="default" size="lg"` ("Upgrade to Pro", expired state — matching the existing
  `size="lg"` CTA already used one branch over at `BillingDashboard.tsx:149`).
- Type scale — `.text-title` (row headlines), `.text-eyebrow` (not required beyond what
  `StatusBadge` already renders), `text-sm text-muted-foreground` (sub-lines, captions),
  `.text-metric` + `.tabular` (the `{used} of {limit}` figure — it is a number in a data view and
  must not jitter in width as it changes).
- `Skeleton` — loading shape for the trial status card (two rows, each an icon-tile-shaped block
  plus two text-line blocks), following the same loading pattern already used for
  `BillingDashboard`'s own cards (`BillingDashboard.tsx:74-87`).

## States

Every state below belongs to the **billing-page trial status card** (screen 2), which is the
only genuinely data-driven view here — the dashboard badge (screen 1) is a smaller read of the
same data, and the expired panel (screen 3) is what state 2 hands off to once the trial ends.

- **Loading** — `Skeleton` in the shape of both rows, shown once while `/api/billing/entitlement`
  (or whatever route `/ks-plan` extends — research open question 6) is in flight.
- **Empty** — not applicable. The card either renders (account is trialling) or does not render
  at all (account is on a paid plan, unentitled-never-trialled, or converted). There is no
  "trialling with nothing to show" case to design for.
- **Error** — **deliberately not an `Alert`.** The research anchor for this data
  (`src/app/api/billing/entitlement/route.ts:13-16`) is explicit that this endpoint "must not
  become load-bearing for authorisation." A failed fetch here should fail closed to **hidden** —
  the card simply does not render, exactly like the empty case — rather than surface a
  `variant="destructive"` `Alert` about the reader's own trial status, which would read as an
  account-level problem it is not. This is a deliberate deviation from the design system's
  default "every data view gets an Alert error state" rule; see gap below.
- **Success** — the three tone sub-states described under screen 2 (healthy / time-or-credits
  warning / credits exhausted) together with screen 3's expired panel are the full success
  surface for this story. There is no separate confirmation toast for entering or converting a
  trial — conversion is reflected by the card disappearing, nothing announces it.

## Design system gaps

1. **No established pattern for a time-boxed, capped feature allowance.** The system has two
   existing shapes for AI usage — a permanent per-plan limit (`UsageCard`, which currently
   treats any plan with `limits.aiFeatures === true` as unlimited and never shows a number,
   `UsageCard.tsx:72`) and a purchasable wallet balance (`CreditBalanceCard`, "pay-per-use").
   A trial's AI allowance is neither: it is numeric, capped, and expires with the trial rather
   than resetting monthly or being topped up by purchase. This mockup's credit row borrows the
   progress-bar visual language `UsageCard` already established (`bg-surface-3` track, tone-coded
   fill) but is new data and copy, not a reuse of that component. `/ks-plan` should decide whether
   this becomes a new sibling element (as mocked) or a targeted fix to `UsageCard`'s `aiUsage`
   branch — recording the gap here rather than picking one silently.
2. **The default error-state rule and this data source's own contract conflict.** See "States" →
   Error, above. Recorded so the fail-hidden choice is confirmed at plan time, not assumed to be
   this document's final word.

No other gap found — `StatusBadge`, `Card`, `IconTile`, `Button` and the type scale cover
everything else this story's screens need.
