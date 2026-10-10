# Design — Story s82-billing-lifetime-guards

Research: `docs/research/s82-billing-lifetime-guards.md`. Design system: `docs/design-system.md`.
**No new screen and no layout change.** The "Current subscription" card and the "Change plan"
dialog on `/dashboard/billing` keep their frames and slots; what changes is the copy a few states
print, one badge word and one price slot in the dialog. The rest of this story is server-side
(routes and messages), listed at the end because its messages reach the same page. No `.html`
mockup, as for s71: nothing moves on either surface, so the state matrices below are the design.

## Components

- No new component, no new token. `Badge variant="secondary"` (the dialog's existing "Current"
  badge variant) carries "Lifetime" in the dialog — and, since the fix pass, "Included" on a plan
  a lifetime grant includes; the card's header badge is unchanged from s71. "Included for life"
  — or "Included until <date>" for a plan included only by dated grants (fix pass 2) — takes the
  price slot at the same `text-xl font-semibold` as "Lifetime access".
- The dialog's price slot for a plan held for life prints "Lifetime access" at `text-xl
  font-semibold` — a phrase, not a number, so not `.tabular`, and one step below the tile's
  `text-3xl` number so it fits a third-width tile at `md` without wrapping.
- Running-out row: the same `p.text-sm.font-medium` line s71 introduced; one sentence is appended.

## State matrix — the card's running-out row (plan held for life + a live subscription)

`N` is the allowance the server resolves without the subscription (`includedAfterSubscription`),
present only when it is lower than the allowance in force.

| Subscription | `N` | Row |
|---|---|---|
| active, set to cancel | absent | "Your Pro subscription ends October 10, 2026 — you won't be charged again." (unchanged) |
| active, set to cancel | 250 | "Your Agency subscription ends October 10, 2026 — you won't be charged again. Without it, your plan includes 250 AI credits a month." |
| active, renewing | 250 | "Your Agency subscription renews October 10, 2026 — you hold Agency for life, so you no longer need it. Without it, your plan includes 250 AI credits a month." |
| past due / trialing (any) | 250 | the s71 sentence for that status, then "Without it, your plan includes 250 AI credits a month." |
| any | absent | the s71 sentence, unchanged |

Cancel confirmation in the same state, with `N`: "Cancel your Agency subscription? You keep Agency
for life, and you will not be charged again. Without it, your plan includes 250 AI credits a
month." Without `N`: unchanged.

The feature list keeps stating the allowance in force (the wallet's `included`, e.g. 1,000 while
the Agency subscription runs); the row is where its end is told.

## The allowance bullet (card and dialog)

The bullet restated is the one that carries the plan's own `limits.monthlyCredits` beside the word
"credit", in any spelling of the number ("1,000" or "1000"). Only that number is replaced; the
catalogue's wording stays.

| Catalogue bullet | Catalogue allowance | Resolved | Printed |
|---|---|---|---|
| "1,000 AI credits / month" | 1000 | 250 | "250 AI credits / month" |
| "AI rewrite suggestions, 500 credits a month" | 500 | 100 | "AI rewrite suggestions, 100 credits a month" |
| "1000 AI credits every month" (reworded) | 1000 | 250 | "250 AI credits every month" |
| "+$4 per additional website", "10 client websites" | 1000 | 250 | unchanged |
| any allowance bullet | n | null | dropped |
| any | n | n | the catalogue's list, untouched |

## State matrix — the "Change plan" dialog tile

| Tile's plan | Badge | Price slot | Bullets | Submit when selected |
|---|---|---|---|---|
| Held for life (grant covers the plan in force) | **Lifetime** | **Lifetime access** (no "/month", no annual line) | allowance restated to the account's own | disabled, labelled "You hold Agency for life" (added at build: the default label "Continue to payment — $49" would have put the removed price back on the button) |
| Included by a lifetime grant (same plan or lower, not the one held for life — fix pass, review finding 1) | **Included** | **Included for life** (no "/month", no annual line) | catalogue (unchanged) | disabled, labelled "Included in your lifetime Pro" (the highest undated grant that includes it) |
| Included only by dated grants (e.g. `qa_recovery_20260919` — fix pass 2, m3) | **Included** | **Included until November 19, 2026** (the latest end; no "/month", no annual line) | catalogue (unchanged) | disabled, labelled "Included in your plan until November 19, 2026" — never "for life" or "lifetime" |
| The plan in force, billed monthly | Current (unchanged) | $49/month (unchanged) | catalogue (unchanged) | disabled (unchanged) |
| Any other | Selected when selected (unchanged) | $price/month, annual line (unchanged) | catalogue (unchanged) | enabled (unchanged) |

## Devin fix pass — a dated grant on the plan in force, and a plan change that keeps

Still no new screen, component or token: the same badge, price slot, running-out row, confirmation
line and dialog description print different words in two states (plan decisions 18 and 19; s96
folded in). Dates in the card's long US form.

### The card when the plan in force is held only through a dated grant (ends November 19, 2026)

| Slot | Undated grant (unchanged) | Dated grant |
|---|---|---|
| Header badge | Lifetime | **Included** |
| Price slot | Lifetime access | **Included until November 19, 2026** |
| Running-out row, subscription renewing | "Your Pro subscription renews October 10, 2026 — you hold Agency for life, so you no longer need it." | "Your Pro subscription renews October 10, 2026 — **Agency is included until November 19, 2026.**" (never "no longer need it": the subscription keeps the plan after the grant) |
| Running-out row, set to cancel | "… ends October 10, 2026 — you won't be charged again." | unchanged |
| Cancel confirmation | "Cancel your Pro subscription? You keep Agency for life, and you will not be charged again." | "Cancel your Pro subscription? **Agency stays included until November 19, 2026**, and you will not be charged again." |
| Reactivate | hidden | hidden (the server refuses it while the grant is live) |

### The dialog's tile for that plan

| | Undated grant (unchanged) | Dated grant |
|---|---|---|
| Badge | Lifetime | **Included** |
| Price slot | Lifetime access | **Included until November 19, 2026** |
| Submit when selected | disabled, "You hold Agency for life" | disabled, "**Included in your plan until November 19, 2026**" (the dated included tile's wording) |

### The dialog's description for a subscriber

| Subscription | Description |
|---|---|
| Renews (unchanged) | "Switch plans at any time. Stripe prorates the difference and charges your card on file straight away." |
| Set to end (October 10, 2026) | the same, then "**Your subscription is set to end on October 10, 2026. Switching plans keeps it: it will renew instead of ending.**" — the plan change clears the scheduled cancellation |

A subscription refused by the webhook as covered by a lifetime grant (cancelled and refunded) is
recorded cancelled, so it never reaches this page as live; nothing on the page announces it.

## Server messages that reach this page

| Situation | Status | Message |
|---|---|---|
| Reactivate a subscription a lifetime grant covers | 409 | "Your lifetime plan already includes this one, so this subscription can't be restarted." |
| Start (Checkout) a subscription a lifetime grant covers (fix pass) | 409 | "Your lifetime plan already includes this one. There is nothing further to buy." |
| Anything Checkout did not write for the customer — a grant or subscription read failure, Stripe, configuration (fix pass 2, m1) | 500 | "Failed to start checkout. Please try again." (was the exception's own text, e.g. "Failed to read plan entitlements: connection reset") |
| Switch a subscription to a plan a lifetime grant covers (fix pass) | 409 | "Your lifetime plan already includes this one. Cancel your subscription instead of switching to it." |
| The subscription or grant read fails in plan change / cancel / reactivate (fix pass) | 500 | the route's generic message below (no longer "No active subscription found") |
| No active subscription to change or cancel | 404 | "No active subscription found" (text unchanged; was 500) |
| No subscription to reactivate | 404 | "No subscription found" (text unchanged; was 500) |
| Change to the price already billed | 409 | "You are already on this plan" (text unchanged; was 500) |
| Reactivate a subscription not set to cancel | 409 | "Subscription is not scheduled for cancellation" (text unchanged; was 500) |
| Anything else in plan change / cancel / reactivate | 500 | "Failed to update subscription" / "Failed to cancel subscription" / "Failed to reactivate subscription" |
| Unknown or foreign payment method | 404 | "Payment method not found" |
| Set-default / remove card rate limited (fix pass, review finding 7) | 429 | the card shows "Too many payment method requests. Try again at HH:MM." — the limiter's `message` and checkout's retry sentence, never its `error` "Rate limit exceeded" |
| Anything else in set-default / remove card | 500 | "Failed to update payment method" / "Failed to remove payment method" |
| AI suggestion failed, refund succeeded | 502 | "AI suggestions are unavailable right now. You were not charged." (unchanged) |
| AI suggestion failed, refund failed | 502 | "AI suggestions are unavailable right now. We could not refund the credit for this request automatically, and we have been notified." |
| Translate refused by the owner's plan or wallet, caller is not the owner | 403 | "AI translation isn't available on this site's plan right now. Ask the site owner to add AI credits." |

The card and the dialog already print `error` from any non-ok response, so no client change is
needed for these — except the payment-methods card's 429, whose human sentence is in `message`
(fix pass).

## Responsive and accessibility

No layout change. The appended sentence wraps inside the row at every width the card supports.
The dialog's "Lifetime access" is plain text in the slot the price occupied; the tile stays a
`role="radio"` button and its accessible name gains "Lifetime" in place of "Current".

## Design system gaps

None.
