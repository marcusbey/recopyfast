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

## Verification

`npx jest src/components/billing`, full `npx jest --ci`, `npm run type-check`, `npm run lint`.
Page-shell (R1–R7) and radius guards stay green. Playwright count unchanged (no e2e added).
After deploy: owner reloads `/dashboard/billing` and sees "Lifetime", no "Free".
