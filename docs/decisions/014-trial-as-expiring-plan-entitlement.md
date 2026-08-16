# ADR 014 — The trial is a time-boxed grant of the `pro` plan in `plan_entitlements`

- Status: accepted
- Date: 2026-08-16
- Scope: story s01-trial-signup

## Context

`s01-trial-signup` needs a 14-day Pro trial with no card and no Stripe customer
(`docs/stories.md:228`, `docs/plans/s01-trial-signup.md:11-17`). Nothing in the code models a
grant that expires. There are exactly two tables that already confer a plan, and both are wrong
shaped for this on inspection, not on assumption.

**`plan_entitlements` is built for permanence, not a window.** Its schema has no `expires_at`
(`supabase/migrations/20260802000000_plans_catalog.sql:220-235`), and its purpose is documented
as the opposite of a trial: *"a permanent grant from a one-time purchase (Lifetime Pro) or a
support comp. No period, never renews, never lapses"* (`src/lib/billing/effective-plan.ts:100-103`).
`readEffectivePlanId` filters it on `revoked_at IS NULL` and nothing else
(`effective-plan.ts:158-165`) — reusing this table means changing the chokepoint, not calling it
as-is.

**`billing_subscriptions` already has trial columns, and they are a trap.** The table carries
`trial_start`/`trial_end`, `status` admits `'trialing'`, and `'trialing'` is already a
`LIVE_SUBSCRIPTION_STATUSES` value (`effective-plan.ts:19-23`) — so a hand-written row
`{plan:'pro', status:'trialing', stripe_subscription_id: NULL}` would entitle with zero
chokepoint changes. It also breaks conversion in two places that only fail after the fact:
`POST /api/billing/checkout` reads `getUserSubscription` first and returns 409 *"You already have
a subscription. Use the upgrade flow to change plans"* (`src/app/api/billing/checkout/route.ts:113-122`),
because `getUserSubscription` selects on the same three statuses
(`src/lib/stripe/subscription.ts:324-339`); and the upgrade flow it points at,
`updateSubscription`, calls `stripe.subscriptions.retrieve(currentSubscription.stripe_subscription_id)`
(`subscription.ts:129-131`) — `null` for a card-less trial, so it throws.

**A `trial` catalogue row is not a milder version of the same idea — it is a full outage.**
`toSubscriptionPlan` throws on any id outside the `SubscriptionPlanId` union
(`src/lib/stripe/plans.ts:206-210`) and `toOneTimeProduct` throws on any id outside
`credits`/`lifetime_pro` (`plans.ts:228-236`). `loadPlanCatalogue` maps every active row before
returning anything (`plans.ts:283-288`), so one bad row does not degrade — it takes down
`/api/pricing`, every checkout, and every feature gate in the same request. The database backs
this independently: `plans_only_one_time_grants` forbids `grants_plan_id` on a `kind='subscription'`
row (`plans_catalog.sql:148-156`), which forces a trial row to be `kind='one_time'` — exactly the
branch that throws for an unrecognised id.

A decision is needed now because task 1 of `docs/plans/s01-trial-signup.md` is a schema change
to `plan_entitlements`, and every task after it — the chokepoint edit, the grant writer, the two
auth-route call sites, the credit-period fix — is built on top of which table that schema change
lands in.

## Decision

**The trial is a time-boxed grant of the existing `pro` plan, written as a row in
`plan_entitlements` — the same table lifetime purchases already write a permanent grant into —
tagged `source = 'trial'` and bounded by a new nullable `expires_at` column, `NULL` meaning
"never expires" so every existing lifetime row needs no backfill.**

This is the mechanism `lifetime_pro` already exercises at the point of payment: a `lifetime_pro`
purchase resolves its `grants_plan_id` (`plans.ts:459-465`, a catalogue-only concept — there is no
catalogue row for a trial) to `pro`, then `grantPlanEntitlement` inserts `{plan_id: 'pro', source:
'lifetime_purchase', stripe_payment_intent_id: <real>}` into `plan_entitlements`
(`src/lib/billing/entitlements.ts:98-123`). The trial writes the same shape of row into the same
table by the same insert path in spirit — `{plan_id: 'pro', source: 'trial',
stripe_payment_intent_id: NULL, expires_at: <granted_at + 14d>}` — through a sibling function
rather than `grantPlanEntitlement` itself, because that function's signature requires a
non-nullable Stripe payment intent and is the webhook's money path. `readEffectivePlanId` and
`readGrantedPlanIds` both change to stay correct once a `plan_entitlements` row can expire and can
be non-purchased: the former gets an inside-the-query expiry filter shaped like
`spendableFilter()` (`src/lib/credits/spendable.ts:18-22`, `expires_at.is.null,expires_at.gt.<now>`),
applied before `.order().limit(1)` rather than checked after `.maybeSingle()` returns; the latter
gets `.neq("source", "trial")` so a trial is never read as "already paid for outright."

## Considered options

- **A new `trial` row in the plan catalogue** — rejected. Not a smaller version of the same idea:
  `loadPlanCatalogue` throws on any row whose id is outside the `SubscriptionPlanId`/
  `OneTimeProductId` unions and maps every row before returning (`plans.ts:206-210, 228-236,
  283-288`), so one trial row breaks pricing, checkout and every feature gate simultaneously, not
  just `resolveStripePriceId` and the public pricing feed. The `plans_only_one_time_grants`
  CHECK (`plans_catalog.sql:148-156`) independently forces it into the branch that throws.
  `src/__tests__/lib/stripe/plan-seed.test.ts:29` — *"ships exactly the three subscription
  plans"* — pins this shut.
- **A boolean/date column on the user, with bespoke trial gating** — rejected. `resolveEntitlement`
  (`effective-plan.ts:211-230`) is the one entitlement computation every gate calls through
  `getEffectivePlan` (`entitlements.ts:56`) — 10 non-test call sites plus `middleware.ts:43`. A
  second, independent read of "is this account trialling" living outside that function is a second
  opinion about authorization: the paywall redirect, the site-creation gate and the credit system
  would each need their own copy of the check, and the moment one path reads the column and
  another reads `plan_entitlements`, they disagree about who is entitled. This codebase has
  already paid for that class of bug once — `effective-plan.ts:113-129` documents a real refused
  sale caused by exactly this kind of chokepoint mismatch — and this option re-creates the
  conditions for it deliberately.
- **A Stripe trial subscription (`trial_period_days`) requiring a card** — rejected. The PRD's
  decision is explicitly no card, matching CloudCannon rather than TinaCMS's free-tier model
  (`docs/stories.md:256-257`). Setting that aside, the card-less variant of the same idea — a
  hand-written `billing_subscriptions` row with `status='trialing'` and no
  `stripe_subscription_id` — was independently checked and rejected on its own terms: see
  Context, `checkout/route.ts:113-122` and `subscription.ts:129-131`.
- **A scheduled sweeper that flips or deletes expired trial rows** — rejected. Trial expiry is an
  authorization boundary (the story's own framing, `docs/stories.md:251-252`), and a cron makes it
  eventually consistent instead of exact — a request in the gap between expiry and the next sweep
  would be served as still-entitled. It also adds infrastructure this decision does not need:
  `vercel.json` schedules exactly one job today and `/api/cron/ab-test-lifecycle` exists unwired,
  so a second cron is a new entry plus its own auth pattern for a problem the inside-the-query
  filter already solves for free, at read time, with no schedule to miss.

## Consequences

**Easier.** The trial needs no new authorization surface: `resolveEntitlement` and every gate
built on it (`permissions.ts:99,266,335,377` and the seven other call sites `getEffectivePlan`
already has) get Pro's limits for a trialling account with no gate-level code change, because
`plan.limits.*` is read verbatim from the catalogue row regardless of why the grant exists. The
same ranking that already lets a lifetime grant beat a live subscription
(`effective-plan.ts:175-177`, then the `billing_subscriptions` fallback below it) is what makes
mid-trial conversion observe no gap for free — the trial grant simply outranks the new
subscription for the rest of its own window, and nothing has to revoke it at the moment of
payment.

**Harder.** `getEffectivePlan`/`resolveEntitlement` is the single chokepoint every authorization
gate in the product calls — permissions, middleware, credits, translation, AB test generation,
both billing routes — and this decision edits its predicate. A defect here does not fail loudly
in one feature; it silently grants or denies across the whole product, including on accounts that
are paying, which is why every task touching `effective-plan.ts` in
`docs/plans/s01-trial-signup.md` carries its own regression test against
`checkout-concurrency.test.ts:269` and the existing precedence tests in
`entitlements.test.ts`. Two specific failure modes are the ones to check any future change
against, not just this one:

- **The expiry filter has to live inside the query, never after it.** `readEffectivePlanId` is
  `if (entitlement && !isRetired(...)) return entitlement.plan_id` with nothing below it but the
  subscription fallback (`effective-plan.ts:175-198`). A post-query expiry check that returns
  `null` for an expired row would skip that fallback entirely and un-entitle a customer who
  *has* converted and is now paying — the opposite of AC 5. The filter belongs in the `.or()`
  clause, in the same shape `spendableFilter()` already uses, so an expired row is simply never
  selected and `.limit(1)` finds the live subscription underneath it.
- **`readGrantedPlanIds` must never answer "already paid" for a trial.** It exists to distinguish
  "what is in force" from "what has this account paid for outright," and its two consumers —
  the lifetime duplicate guard (`checkout/route.ts:187-197`) and the offer-card visibility check
  (`dashboard/billing/page.tsx:45-47`) — both 409 or hide the $199 offer when it returns `"pro"`.
  A trial resolving to `plan_id: 'pro'` with no `.neq("source", "trial")` filter would refuse a
  paying customer's Lifetime purchase silently, which is the *exact* defect
  `effective-plan.ts:113-129` already documents having shipped once, through a different door —
  and it would land on every trialling account, not one.

A trial must also never become an unmetered AI budget. `getUserCreditBalance` derives its
included allowance from `plan.limits.monthlyCredits` and, absent a `billing_subscriptions` row,
resets that allowance on the calendar month (`src/lib/credits/system.ts:123-125,144-176`). Left
unchanged, a trial that happens to cross a month boundary draws Pro's 500-credit allowance twice
in 14 days — the literal uncapped spend AC 8 forbids. The period start for a trial has to come
from the trial's own `granted_at`, not `startOfCurrentMonth()`, making the 14 days a single
non-renewing window regardless of which dates it spans.

**Watch.** `plan_entitlements.source` grows a third meaning. It was two values —
`lifetime_purchase` on grant, `revoked:<reason>` on revocation (`entitlements.ts:72,80-84`) — and
becomes three with `trial` added; any future code that branches on `source` without accounting
for the trial value inherits this ADR's blast radius. The "one trial per account, ever" guarantee
(AC 6) is enforced entirely by a new partial unique index on `plan_entitlements(user_id) WHERE
source = 'trial'`, not by application logic — if a future migration or manual data fix ever
hard-deletes a trial row instead of soft-revoking it the way `revokeEntitlementForPayment` already
does for purchases (`entitlements.ts:132-155`), the guard silently evaporates and the account can
trial again. Conversion during a trial must run inside the same lock subscription checkout already
uses — `claimSubscriptionReservation` / `withUserLock`, wrapped only around the subscription branch
of `checkout/route.ts:124-152` — or a concurrent request mid-checkout can observe a state this ADR
does not define. Because the grant is left to lapse on its own clock rather than being revoked at
conversion, that existing lock is sufficient and no new revocation-at-conversion path should be
added; introducing one would reopen exactly the race this modelling was chosen to avoid.
