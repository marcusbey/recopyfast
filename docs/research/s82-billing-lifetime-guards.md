# Research — Story s82-billing-lifetime-guards

Verified against `origin/main` at `72f4cff` on 2026-10-09, by reading the code and running nothing
against production: no Supabase connector, no Stripe call (live or test), no credentials. Sources:
`docs/reviews/s71-billing-plan-badge.md` (N-1, the reactivate gap), `docs/reviews/s45-lifetime-ai-credits.md`
(new findings 1 and 2), `docs/stories.md` s69 L5, ADR 035, ADR 038.

## The structuring facts

1. **Reactivate has no lifetime check, and the webhook already defines the rule it lacks.**
   `POST /api/billing/subscription/reactivate` (`route.ts:9-37`) authenticates and calls
   `reactivateSubscription` (`src/lib/stripe/subscription.ts:477-527`), which reads the user's
   newest `billing_subscriptions` row through the RLS client, refuses only when `cancel_at` is null,
   then calls `stripe.subscriptions.update(…, { cancel_at_period_end: false })`. Nothing reads
   `plan_entitlements`. The webhook's `stopBillingForLifetimeOwner`
   (`src/app/api/webhooks/stripe/route.ts:941-1000`) sets every live subscription to cancel at
   period end after a lifetime purchase, except one (`:971`): a Lifetime Pro grant keeps a running
   Agency subscription. That is a rank rule — a grant replaces a subscription on its own plan or a
   lower one, never a higher one — and `PAID_PLAN_IDS` is declared as exactly that order
   ("Ascending entitlement priority", `src/lib/stripe/plan-types.ts:33-38`).
2. **"Held for life" already has one reader.** The billing page reads
   `readGrantedPlanIds(supabase, userId)` (`src/app/dashboard/billing/page.tsx:52`): non-revoked,
   non-trial `plan_entitlements` rows (`effective-plan.ts:246-269`). Checkout's lifetime guard
   reads the same function (`checkout/route.ts:602`). The reactivate guard reads it too, through
   the same RLS client `reactivateSubscription` already holds, so the page, checkout and the
   endpoint cannot disagree about who holds what. Trials are excluded by the query
   (`.neq("source", TRIAL_SOURCE)`), so a trial-only account is not refused.
   **Corrected in the fix pass (review finding 2):** that query had no expiry predicate, while the
   entitlement resolver's own grant read does (`effective-plan.ts:410`, `.or(spendableFilter())`).
   A non-trial grant can carry an `expires_at` — production holds one (source
   `qa_recovery_20260919`, the orchestrator's read-only count on 2026-10-09) — so after that date
   the resolver stopped honouring it while this reader still reported it held. It now sends the
   same predicate; every caller (page, dashboard route, entitlement badge, checkout, reactivation,
   plan change) reads through it.
3. **Founding Agency + Agency subscription.** ADR 038: a live subscription on the same plan makes
   the account hold full Agency (1,000) while it runs; the purchase alone gives 250. The webhook
   cancels that subscription at period end (`:941-1000`, no exception for agency/agency), the card
   never offers Reactivate under lifetime (`SubscriptionCard.tsx:221-227`), and the plan dialog
   disables Agency for an Agency holder (`UpgradeDialog.tsx:385`). Decision in the plan.
   **Corrected in the fix pass (review finding 1):** this said reactivation "would be the only
   path" to a recurring Agency subscription for a lifetime Agency owner. It was not: see fact 12.
4. **The allowance after the subscription can only be resolved server-side.** Whether a grant was
   bought (payment intent, ADR 038) or comped decides it — a comped Agency grant keeps 1,000 after
   the subscription ends, a bought one drops to 250 — and the client never sees payment intents.
   `readEffectivePlanBasis` (`effective-plan.ts:386-490`) reads the subscription in exactly one
   place (`:448-461`); resolving with that read skipped gives the post-subscription allowance with
   every other rule (Agency precedence, purchase-only, offer, floor) unchanged.
5. **The allowance bullet match already fails on live data.** `featuresWithAllowance`
   (`SubscriptionCard.tsx:54-70`) looks for `"<n> AI credits"` with `n` the catalogue allowance.
   Agency's bullet is "1,000 AI credits / month" (match); Pro's is "AI rewrite suggestions, 500
   credits a month" (`supabase/migrations/20260928130000_catalogue_copy_truth.sql:56`, no match). A
   founding-offer holder (Pro at 100, ADR 039) gets the card with `monthlyCredits` 100 and reads
   "500 credits a month". The structured anchor is `plan.limits.monthlyCredits`: the bullet that
   carries that number beside the word "credit" is the allowance bullet, however it is phrased.
6. **The plan dialog has no notion of a plan held for life.** `UpgradeDialog` knows `currentPlan`
   and `hasSubscription`; it prints "Current" (`:263-264`), `$<price>/month` (`:275-285`) and the
   catalogue bullets (`:287-305`) for every tile. `BillingDashboard` already computes
   `isPlanHeldForLife` (`:271-273`) and the resolved allowance (`creditWallet.included`, `:318`).
7. **`refundCharge` never throws; it returns what it gave back.** `src/lib/credits/system.ts:527-568`
   returns `{ success, refunded }` and logs its own failure with `console.error`.
   `refundOwner` in the suggest route (`:153-162`) discards that result, and the 502 says "You were
   not charged" unconditionally (`:338-341`).
8. **`console.error` does not reach Sentry.** `sentry.server.config.ts` sets no
   `captureConsoleIntegration`; `src/instrumentation.ts` forwards only errors Next catches
   (`onRequestError`). A handled 502 is invisible to Sentry. `logger.error` in
   `src/lib/monitoring/logger.ts:146-183` writes the structured line to stdout and calls
   `Sentry.captureException`/`captureMessage` in production when a DSN is set; it is already used by
   `api/health` and imports cleanly under Jest (the health suites import it unmocked).
9. **Translate charges the caller.** `src/app/api/ai/translate/route.ts:261` calls
   `consumeFeatureUsage(user.id, "translation", …)` with the cookie client, after
   `checkOwnerCanEdit(siteId)` has already returned the owner (`:229-232`). ADR 035: the payer is
   the site owner, charged through the service client by a route that has authorised and graded
   the caller and resolved the owner — this route does all three (`getUser`, `edit`/`admin` read at
   `:195-210`, `checkOwnerCanEdit`). `consumeFeatureUsage(…, client)` is the explicit-payer
   contract (`src/lib/feature-gating/permissions.ts:497-511`); the suggest route already uses it
   (`ai/suggest/route.ts:289-301`). The existing translate fixture's caller (`user-123`) is not
   its owner (`owner-1`), so the suite has been charging a non-owner all along.
10. **Raw exception text reaches the client in five handlers.** `subscription/route.ts:104-107`
    (PUT), `:141-144` (DELETE), `subscription/reactivate/route.ts:28-33`,
    `payment-methods/route.ts:119-122` (POST), `:204-207` (DELETE) all return `error.message`.
    Some of those messages are deliberate and actionable ("You are already on this plan", "No
    active subscription found", "Subscription is not scheduled for cancellation"); the rest are
    Stripe's or PostgREST's. `stripe.paymentMethods.retrieve` throws `resource_missing` ("No such
    PaymentMethod: 'pm_…'") for an unknown id → 500 with that text, while a foreign id answers 404
    "Payment method not found" (`:94-100`, `:165-170`): an existence oracle (s69 L5).
11. **The limiter convention for billing.** Checkout rate-limits per IP before `getUser()`
    (`checkout/route.ts:145-156`, `CHECKOUT_IP`, `onStoreFailure: "allow"`, justified in a comment)
    and per user after it. Presets: `src/lib/security/rate-limiter.ts:419-444`.
    `enforceRateLimit` answers a 429 as `{ error: "Rate limit exceeded", message }`
    (`src/lib/api/rate-limit.ts:154-165`); the only billing UI that handled a 429 was `useCheckout`,
    which prints `error` plus "Try again at HH:MM." from `X-RateLimit-Reset` — so a route's own
    `message` never reaches the page (review finding 7).
12. **Two more doors into a covered subscription (fix pass, review finding 1).** On `origin/main`,
    Checkout's subscription intent reads no grant: it reads the live subscription
    (`checkout/route.ts:209-214`) and goes on to `getRecoverableSubscriptionCheckout` (`:237`, the
    first Stripe call) and a new session; only the lifetime intent reads grants (`:602`). The plan
    change `updateSubscription` (`src/lib/stripe/subscription.ts:313-410`) reads the subscription
    and goes straight to the price and `stripe.subscriptions.retrieve`/`update`. A Lifetime Pro owner
    with nothing billing could buy Starter (or Pro, by request); one still paying for Agency could
    switch it down to Pro or Starter — each billed monthly for a plan the grant includes, and the
    webhook would not stop it (`stopBillingForLifetimeOwner` runs only on a lifetime purchase). On
    `c02df19` the plan dialog refused only the plan held for life (`UpgradeDialog.tsx`,
    `isSelectedHeldForLife`).
13. **A subscription read error was told to the customer as "no subscription" (fix pass, review
    finding 3).** `updateSubscription`, `cancelSubscription` and `reactivateSubscription`
    (`subscription.ts:331,434,505` on `c02df19`) answered `fetchError || !row` with the 404
    `BillingRefusal`, which `billingErrorResponse` does not log. `.single()` answers a missing row
    with PGRST116; any other code is a failure, not an absence.
14. **Checkout's catch and the dialog's "for life" (fix pass 2, second review m1 and m3).** On
    `84d7b0c`, `POST /api/billing/checkout`'s catch (`route.ts:811-821`) answered `error.message`;
    what reaches it is never a sentence for the customer (they are all returned before it) but a
    read failure, Stripe or configuration text — `getGrantedPlanIds` throws "Failed to read plan
    entitlements: <PostgREST message>". `GET` already answered generically. The dialog's
    included tile said "for life" whatever the grant: the page read only `plan_id`
    (`readGrantedPlanIds`), so no grant end reached the client; the dashboard payload carries the
    trial's end only (`dashboard/route.ts:192-193`), and trials are excluded from the grants.
    Selecting `expires_at` in that same query is the only source that needs no new fetch.

## Traps

- **The RLS harness for subscription writes models one table.**
  `src/__tests__/lib/stripe/subscription-rls.test.ts:91-139` answers every `from()` as
  `billing_subscriptions` and has no `is`/`neq`/`returns`. A grant read inside
  `reactivateSubscription` throws there. The harness needs a `plan_entitlements` branch (fixture
  only — no assertion changes).
- **Two dashboard route suites mock `@/lib/billing/effective-plan` with a closed factory**
  (`dashboard-unentitled.test.ts:51-54`, `dashboard-founding-offer.test.ts:54-57`). A new export
  called unconditionally would be `undefined` there. Calling it only when a live subscription AND a
  permanent grant exist keeps those suites untouched (both return `[]` grants with a subscription)
  and spares every plain subscriber the resolution's reads — not every read: a plain subscriber
  still pays the one grant read that finds no grant (corrected in the fix pass, review finding 6).
- **Test fakes of `plan_entitlements` that do not apply `.or()`** break once `readGrantedPlanIds`
  sends the expiry predicate (`subscription-rls.test.ts`, `reactivate-lifetime.test.ts`). The
  filtering fakes in `entitlements.test.ts` and `founding-offer-allowance.test.ts` already parse
  `.or()` arms; the new ones copy that parser.
- **`subscription.test.ts:196-206` pins the leak.** "should return 500 with the underlying reason"
  rejects with a plain `Error("No active subscription found")` and expects that text. Under this
  story a plain error is answered generically; the deliberate refusal is a typed error. The test
  changes (declared in the plan).
- **`reactivateSubscription` reads the newest row whatever its status** (`:483-489`), so a fully
  `canceled` row with `cancel_at` set would reach Stripe and fail. Pre-existing, out of scope; the
  generic error hygiene keeps Stripe's text off the page in that case.
- **ADR 035's "Watch" names translate as a follow-up** ("keeps its cookie auth"). Auth stays the
  cookie session; only the payer changes, which is what the ADR decides.

## Not verified here

No Stripe test-mode run; no real database. The `plan_entitlements` filters the reactivate,
checkout and plan-change guards rely on are `readGrantedPlanIds`'s, unit-tested in
`src/__tests__/lib/billing/entitlements.test.ts` (expiry included since the fix pass); the
`.or(spendableFilter())` string is the one the entitlement resolver already sends to production.
The `qa_recovery_20260919` grant was not read here (no database access); its existence and date
come from the orchestrator's read-only count.
