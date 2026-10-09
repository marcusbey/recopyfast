# Research — Story s71-billing-plan-badge

Verified on `origin/main` `828970c`, 2026-10-08. Written after the build, from the plan's inline
research and the two review passes (`docs/reviews/s71-billing-plan-badge.md`), to give the story
the Research → Design → Plan trail AGENTS.md asks of a UI story (Devin Review flag, PR #74).

## The owner's report

Screenshot of `/dashboard/billing`: the sidebar says **Pro**; the plan card says **Pro plan ·
Lifetime access** and, top right, a **Free** badge. "here is my account. it says FRee on the right
and PRO on the left."

## Facts

1. **Where "Free" came from.** `SubscriptionCard.getStatusBadge()` (`SubscriptionCard.tsx:133`)
   returned `<Badge>Free</Badge>` whenever `subscription` was absent. "Free" names a retired plan
   (`DashboardNavigation.tsx:136`; migration `20260803000000` sets it `is_active = FALSE`).
2. **A lifetime grant has no subscription row.** `subscription` is only ever a live row:
   `getUserSubscription` filters on `LIVE_SUBSCRIPTION_STATUSES` (active, trialing, past_due).
   So every lifetime owner hit the "Free" branch. The price line already read "Lifetime access"
   because `priceLabel` checks `isLifetime` — hence "Lifetime access" and "Free" on one card.
3. **What decides "held for life".** `BillingDashboard.tsx:264-267` computed
   `isPlanHeldForLife = granted && planIds.includes(plan.id) && subscription?.plan_id !== plan.id`.
   The plan in force comes from `readEffectivePlanBasis` (`src/lib/billing/effective-plan.ts`):
   an Agency subscription always wins; otherwise a grant outranks a lower subscription.
4. **A lifetime purchase sets the old subscription to cancel.** `stopBillingForLifetimeOwner` in
   the Stripe webhook (`route.ts:973-976`) sets `cancel_at_period_end` on the buyer's subscription
   unless it is Agency (`:965`). So the realistic "lifetime + subscription" state is a cancelling
   row, not an active renewing one.
5. **Same-plan buyers were excluded.** A Pro subscriber who buys Lifetime Pro (the main purchase
   path, `LifetimeOfferCard.tsx:83-97`) failed the third clause in fact 3, so the card showed
   "ACTIVE · $19/month · Plan will be canceled · Reactivate Subscription" for up to one period
   after paying (review M-1).
6. **Reactivate restarts billing.** `reactivateSubscription` (`src/lib/stripe/subscription.ts:
   480-520`) and `POST /api/billing/subscription/reactivate` have no lifetime check (review M-2).
   Out of this UI story's scope; recorded as a follow-up.
7. **Empty payment-methods copy.** `PaymentMethodsCard.tsx:205` offered "Add a card to start a
   subscription or buy AI credits" to everyone, including an account with nothing left to
   subscribe to.
8. **Other "Free" texts on the page** (review pass 1): the header `{currentPlan} PLAN` badge can
   not read FREE (a retired plan resolves to no plan); `UpgradeDialog` hides unpaid plans;
   `BillingDashboard.tsx:37` "90 days of free Pro" shows only to an account with no plan.

## Constraints

- No API, data, embed or migration change; no new fetch — the plan catalogue is already on the
  page (`findSubscriptionPlan`, `src/lib/stripe/plan-types.ts:143`).
- Components from `src/components/ui/` only (`Badge`, `Alert`, `Button`); ADR 050 radius tokens.
- Non-lifetime states must stay byte-identical.

## Follow-ups (not this story)

- Server-side: refuse reactivation when a non-trial grant covers the subscription's plan.
- A Founding Agency buyer still running out an Agency subscription is not told the AI-credit
  allowance drops from 1,000 to 250 at period end (pre-existing since s45 for Pro → Founding
  Agency).
