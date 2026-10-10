# Design — Story s71-billing-plan-badge

Research: `docs/research/s71-billing-plan-badge.md`. Design system: `docs/design-system.md`.
Scope: the existing "Current subscription" card and the empty state of "Payment methods" on
`/dashboard/billing`. No new screen, no layout change: the card keeps its frame, header, plan
line, features list and action block; only what each state prints changes. Written after the
build to record the state matrix the code implements (Devin Review flag, PR #74). No `.html`
mockup: nothing moves on the card, so the state matrix below is the design.

## Components

- Header badge: `Badge variant="default"` — the same variant as the card's "ACTIVE" badge and the
  page header's `… PLAN` badge. The design system lists `Badge` for static labels; "Lifetime" is a
  tenure label. Base `rounded-control` (2 px), no extra classes (ADR 050).
- Running-out row: one `p.text-sm.font-medium` line in the slot the period grid occupied.
- No new component, no colour token: status words travel in the copy, not a second badge.

## State matrix — the card

| Plan in force | Subscription row | Badge | Price line | Below the plan line | Actions |
|---|---|---|---|---|---|
| Held for life | none | **Lifetime** | Lifetime access | — | — |
| Held for life | active, set to cancel | **Lifetime** | Lifetime access | "Your Pro subscription ends October 10, 2026 — you won't be charged again." | none |
| Held for life | active, renewing | **Lifetime** | Lifetime access | "Your Pro subscription renews October 10, 2026 — you hold Agency for life, so you no longer need it." | Cancel |
| Held for life | past due, set to cancel | **Lifetime** | Lifetime access | "… is past due and ends … — it will not renew." | none |
| Held for life | past due / trialing, not cancelling | **Lifetime** | Lifetime access | "… is past due — you hold Agency for life, so you no longer need it." | none |
| Held for life | trialing, set to cancel | **Lifetime** | Lifetime access | "… is trialing and ends … — you won't be charged again." | none |
| Monthly | active | ACTIVE | $19/month | period grid (unchanged) | Cancel (unchanged) |
| Monthly | active, set to cancel | ACTIVE | $19/month | grid, "Plan will be canceled" | Reactivate (unchanged) |
| Monthly | trialing / past due | TRIALING / PAST DUE | $19/month | grid (unchanged) | — |
| Any, no grant | none (trial, founding offer) | **no badge** | $<price>/month | — | — |

Rules:

- "Free" is printed in no state. A zero price reads "$0/month".
- "Held for life" = the grant covers the plan in force, whatever plan a still-running
  subscription bills (review M-1). An Agency subscription outranks a lifetime Pro grant, so that
  account is "Monthly".
- Under a plan held for life the subscription is always named by its own plan, from the page's
  catalogue; unnamed fallback "Your previous subscription". Reactivate is never offered.
- Cancel confirmation under a plan held for life: "Cancel your Pro subscription? You keep Agency
  for life, and you will not be charged again." Otherwise unchanged: "Cancel your subscription?
  You keep access until <date>, and you will not be charged again."

## State matrix — Payment methods, empty

| Plan held for life | Copy |
|---|---|
| yes | No payment methods added yet · Add a card to buy AI credits |
| no | No payment methods added yet · Add a card to start a subscription or buy AI credits |

## Responsive and accessibility

No new layout: the row is a single wrapping text line inside the card's existing `space-y-4`
column, at every width the card already supports. Copy carries the status in words, so the
past-due warning does not rely on colour.

## Design system gaps

None. Every element is an existing `ui/` component in an existing slot.
