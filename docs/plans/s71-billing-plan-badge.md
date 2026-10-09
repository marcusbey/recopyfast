---
validated: yes
---
# Plan — Story s71-billing-plan-badge

> Owner decision (2026-10-08): plan validated; ship now, alongside s66c2 and s70.

Research: inline (the story's cause section, verified on `origin/main` `828970c`). No API, data,
embed or migration change. Two components, two tasks.

Inputs already on the page: `BillingDashboard` computes `isPlanHeldForLife`
(`BillingDashboard.tsx:265-267`) and passes it to `SubscriptionCard` as `isLifetime`.
`subscription` is only ever a live row (`BillingDashboard.tsx:167-169`).

## Task 1 — truthful status badge on the plan card

Failing tests first, in `src/components/billing/__tests__/SubscriptionCard.badge.test.tsx`:
1. no subscription + `isLifetime` → badge "Lifetime"; the text "Free" is absent from the card.
2. live `active` subscription, not lifetime → badge "ACTIVE" (unchanged).
3. lifetime owner running out a lower subscription (`isLifetime` true, subscription present) →
   "Lifetime" badge (the plan in force is the lifetime one; the period rows below still show the
   running subscription).
4. no subscription, not lifetime (e.g. a trial without a subscription row) → no status badge;
   "Free" absent.

Change: `getStatusBadge()` in `SubscriptionCard.tsx` — `isLifetime` first, then the subscription
status, else `null`. Remove the "Free" fallback.

- [x] Task 1

## Task 2 — payment-methods empty state matches the plan

Failing tests first, in `src/components/billing/__tests__/PaymentMethodsCard.empty.test.tsx`:
1. no cards, `isPlanHeldForLife` → "Add a card to buy AI credits"; "start a subscription" absent.
2. no cards, default → existing copy unchanged.

Change: `PaymentMethodsCard` takes an optional `isPlanHeldForLife?: boolean` (default false);
`BillingDashboard` passes `isPlanHeldForLife`.

- [x] Task 2

## Task 3 — review follow-up (review majors M-1, M-2; minors m-1…m-3)

UI only: nothing under `src/lib/stripe` or `src/app/api` changes. Each item had its failing test
first.

- [x] **M-1** — `isPlanHeldForLife` (`BillingDashboard.tsx`) drops its third clause
  (`subscription?.plan_id !== plan.id`): a plan the grant covers is held for life whatever a
  still-live subscription bills. Buying Lifetime Pro sets the Pro subscription to cancel at period
  end (the webhook's `stopBillingForLifetimeOwner`), so the same-plan case is the one every
  upgrading Pro subscriber lands in — they read "$19/month · ACTIVE". Comment rewritten to say why.
  Consumers checked: `priceLabel` ("Lifetime access"), the badge ("Lifetime") and
  `PaymentMethodsCard` (credits-only copy) all now read correctly in that state. Test
  (`BillingDashboard.plan-card.test.tsx`): Pro subscriber with Lifetime Pro, Pro subscription
  `cancel_at_period_end: true` → "Lifetime" and "Lifetime access", no "$19/month", no "ACTIVE".
- [x] **M-2** — `SubscriptionCard` takes an optional `subscriptionPlanName`; `BillingDashboard`
  passes the subscription plan's name from `dashboardData.catalogue` (`findSubscriptionPlan`, no
  new fetch). When `isLifetime` and a subscription row are both present, the unlabelled period
  grid is replaced by one named row: "Your Pro subscription ends October 10, 2026 — you won't be
  charged again." (cancelling) or "Your Pro subscription renews October 10, 2026 — you hold Agency
  for life, so you no longer need it." (not cancelling; Cancel still offered). Falls back to "Your
  previous subscription" when the catalogue cannot name the plan. Reactivate is never rendered
  when `isLifetime` (the action block is skipped when the row is set to cancel under a lifetime
  plan). Non-lifetime states keep their grid, copy and Reactivate unchanged. Tests
  (`SubscriptionCard.badge.test.tsx`): cancelling row named, no further charge, no Reactivate;
  renewing row named with Cancel; unnamed fallback; regression guards for the non-lifetime active
  and cancelling states; the realistic `cancel_at_period_end: true` badge case beside case 3.
  Dashboard-level test proves the name reaches the card from the catalogue.
- [x] **m-1** — in that row the subscription's status is said when it is not active: "Your Pro
  subscription is past due and ends … — it will not renew." / "… is trialing and ends …". The
  header badge stays "Lifetime". A past-due row is not promised "you won't be charged again" (its
  failed invoice is still open to Stripe's retries). Tests: past due (badge still "Lifetime", no
  "PAST DUE" in the header) and trialing.
- [x] **m-2** — `BillingDashboard.plan-card.test.tsx` asserts the page passes
  `isPlanHeldForLife` to `PaymentMethodsCard`: lifetime grant → "Add a card to buy AI credits";
  no grant → the subscription copy. Seen red with the prop pass removed.
- [x] **m-3** — `priceLabel` states a zero price as "$0/month"; no state of the card prints
  "Free". Test: a plan priced 0, not lifetime → "$0/month", no "Free".
- [x] **Cancel confirmation under a lifetime plan** (left by the fix pass, cheap) — the confirm
  text said "You keep access until <period end>", untrue when the plan is held for life. It now
  reads "Cancel your Pro subscription? You keep Agency for life, and you will not be charged
  again."; the non-lifetime text is unchanged. Test: "confirms the cancel without ending access
  the owner holds for life" (red before the fix).

Case 3 of Task 1 asserted `getByText("Current period")` in the lifetime + running-out state; that
grid is what M-2 replaces, so the assertion now checks the named row ("Your Pro subscription
renews …") instead.

## Verification

`npx jest src/components/billing`, full `npx jest --ci`, `npm run type-check`, `npm run lint`.
Page-shell (R1–R7) and radius guards stay green. Playwright count unchanged (no e2e added).
After deploy: owner reloads `/dashboard/billing` and sees "Lifetime", no "Free".
