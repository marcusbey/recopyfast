---
validated: no
---
# Plan — Story s01-trial-signup

Branch: `feature/s01-trial-signup`
Research: `docs/research/s01-trial-signup.md` — read it first; this plan does not repeat it.

## Target story

`s01-trial-signup` — 14-day Pro trial without a card (`docs/stories.md:214-258`). Complexity 4,
no dependencies, gates entitlement in `s03`/`s09`/`s11`/`s13`. Eight acceptance criteria: (1) a
new account is Pro-entitled with no Stripe customer, (2) `getEffectivePlan` returns Pro-equal
limits, (3) expiry at 14 days refuses site/editor creation with `upgradeRequired: true`, (4)
content stays readable/served after expiry, (5) subscribing mid-trial converts with no gap,
(6) one trial per account, ever, (7) dashboard shows days remaining and a single-action expired
state, (8) AI draws from a capped trial allowance that never renews mid-trial.

Design: `docs/designs/s01-trial-signup.md` — a `StatusBadge` on `/dashboard`'s `PageHeader`, a
two-row trial card on `/dashboard/billing`, and a copy variant of the existing unentitled panel
for the expired state. Compose only from `src/components/ui/*`; the HTML mockup is reference
only.

## Tasks (ordered)

1. [ ] **Migration — widen `plan_entitlements` for a time-boxed, tagged grant.**
   New file `supabase/migrations/<ts>_trial_entitlements.sql`: `ALTER TABLE plan_entitlements
   ADD COLUMN expires_at TIMESTAMPTZ` (nullable — `NULL` keeps meaning "never expires", so every
   existing lifetime row needs no backfill), plus `CREATE UNIQUE INDEX
   plan_entitlements_one_trial_per_user ON plan_entitlements(user_id) WHERE source = 'trial'`
   (the mechanism behind AC 6 — enforced by Postgres, not application code, and survives site
   deletion because nothing about a site touches this table). No RLS change: the table's
   existing SELECT-own/service-role-write policies already cover the new column, and the trial
   writer added in task 3 is service-role, matching how `grantPlanEntitlement` already writes
   this table. Do not edit `20260802000000_plans_catalog.sql` — this is a new, forward-only file
   (ADR 002 / AGENTS.md).
   **Test:** new `src/__tests__/lib/stripe/plan-seed.test.ts` case (or a sibling test in the same
   file, matching its existing pattern of reading migration SQL text) asserting the new migration
   adds `expires_at` to `plan_entitlements` and the partial unique index on `(user_id) WHERE
   source = 'trial'`, and that `20260802000000_plans_catalog.sql` itself is untouched.

2. [ ] **Chokepoint — make `plan_entitlements` resolution expiry-aware, and stop a trial from
   blocking Lifetime.** In `src/lib/billing/effective-plan.ts`: add `export const TRIAL_SOURCE =
   "trial"`; add `export async function readTrialGrant(supabase, userId): Promise<{ grantedAt:
   string; expiresAt: string; isActive: boolean } | null>` reading the one possible
   `source = 'trial'` row regardless of expiry (at most one, by the task-1 index) — this single
   read serves task 5 (credit period), task 6 (days-remaining/expired-copy) and AC 6's "ever
   trialled" signal, so it is written once here; change `readEffectivePlanId` to filter the
   `plan_entitlements` query with the same expires-aware `.or()` shape `spendableFilter()` already
   uses in `src/lib/credits/spendable.ts` (`expires_at.is.null,expires_at.gt.<now>`), applied
   **inside** the query before `.order().limit(1)` — never as a post-query check, which is what
   would let an expired trial's `.maybeSingle()` hit return `null` outright and skip the
   subscription fallback below it (T2), un-entitling a converted paying customer; change
   `readGrantedPlanIds` to add `.neq("source", TRIAL_SOURCE)` so a trial grant never answers
   "already paid for this outright" (T1 — the exact defect already fixed once for lifetime vs.
   monthly-subscriber, `effective-plan.ts:113-129`). Also update the comment at
   `src/lib/feature-gating/permissions.ts:19-25` — an addition naming the trial as a plan
   entitlement, not a correction (T8); it does not change behaviour and has no test of its own,
   so it rides with this task's diff.
   **Tests**, extending `src/__tests__/lib/billing/entitlements.test.ts`: an active trial resolves
   `kind:"plan"` with Pro's limits and no Stripe customer/subscription row; an expired trial with
   no subscription resolves `UNENTITLED`; an expired trial **with a live subscription underneath
   it** resolves to the subscription's plan, not `none` (the T2 regression); a lifetime grant
   still outranks a trial when both are non-revoked (ordering safety); `readGrantedPlanIds`
   excludes an active trial's `plan_id` (new test, plus confirm
   `src/__tests__/api/billing/checkout-concurrency.test.ts:269` — "refuses a lifetime purchase the
   customer already holds a grant for" — still passes unmodified).

3. [ ] **Grant and idempotency — `src/lib/billing/trial.ts` (new file).** `export const
   TRIAL_DURATION_DAYS = 14`; `export async function grantTrialEntitlement(userId):
   Promise<{granted: boolean; duplicate: boolean}>` — service-role insert into
   `plan_entitlements` with `plan_id: "pro"`, `source: TRIAL_SOURCE`, `stripe_payment_intent_id:
   null`, `expires_at: <now + 14 days>`; a `23505` from the task-1 partial index is a duplicate,
   matching `grantPlanEntitlement`'s existing collision handling, not a thrown error. Kept as a
   sibling function rather than widening `grantPlanEntitlement` — that function's signature
   requires a non-nullable Stripe payment intent and is the webhook's money path; a trial has
   neither a payment nor that shape, and the smaller, separate diff keeps the purchase path
   untouched. `export async function ensureTrialStarted(supabase, userId): Promise<void>` — calls
   `resolveEntitlement(supabase, userId)` first and returns without writing when the account is
   already entitled (plan, credits, **or** an existing trial row of any state), so a subscriber or
   a previously-trialled account signing in again never attempts a second grant; only when
   `kind === "none"` does it call `grantTrialEntitlement`. Wrapped so a write failure is logged,
   never thrown — granting a trial must not be able to block sign-in.
   **Tests**, new `src/__tests__/lib/billing/trial.test.ts`: grants Pro to a brand-new unentitled
   account with the right `expires_at` (~14 days, tolerant of test runtime); a second call for the
   same user is a no-op (`resolveEntitlement` already sees the trial and skips); a subscriber or
   lifetime holder never gets a trial row inserted; a direct duplicate insert (simulating a race
   past the `resolveEntitlement` check) resolves via the unique-violation path, not a thrown error
   — this is AC 6's "even after deleting and recreating sites" case, since nothing here reads
   `sites` at all.

4. [ ] **Wire the grant to the only two server-side sign-in touchpoints.** In
   `src/app/auth/callback/route.ts` and `src/app/auth/confirm/route.ts`, after
   `exchangeCodeForSession`/`verifyOtp` succeeds, read the now-established user
   (`supabase.auth.getUser()`) and call `ensureTrialStarted(supabase, user.id)` before redirecting
   — both routes fire on every sign-in, not just the first, which is why task 3's idempotency
   check is load-bearing here rather than a nicety. Failure is caught and logged; the redirect
   proceeds either way.
   **Tests**, new `src/__tests__/app/auth/callback.test.ts` and a matching case in a new
   `confirm.test.ts` (no existing tests cover either route today): a successful exchange for a
   brand-new user results in `ensureTrialStarted` being called and does not alter the redirect
   destination; a thrown error from the grant path is swallowed and the redirect still happens.

5. [ ] **Credit period — stop the calendar-month allowance from doubling mid-trial (T6).** In
   `src/lib/credits/system.ts`'s `getUserCreditBalance`, after resolving `entitlement`, call
   `readTrialGrant(supabase, userId)` (task 2); when it returns an active trial, use its
   `grantedAt` as `startOfPeriod` instead of `startOfCurrentMonth()` — the same variable that
   already falls back to the subscription's `current_period_start` when one exists, just with a
   third source ahead of the calendar-month default. This makes the trial's 500-credit Pro
   allowance (unchanged number — this does not decide a new COGS figure, it fixes the reset
   boundary) a single non-renewing grant for the whole 14 days rather than a fresh 500 on the 1st
   of any month the trial happens to cross, which is the "never grants uncapped spend" half of
   AC 8; `canUseAIFeatures` already denies at zero balance, which is the "stop at zero" half, and
   needs no change.
   **Tests**, new `src/__tests__/lib/credits/system.test.ts` (or extending it if it exists by the
   time this lands): a trial granted on the 25th and queried past the 1st of the next month still
   reports the same single-period balance, not a doubled one; total spend across the full 14-day
   window never exceeds the plan's `monthlyCredits`; a non-trial Pro subscriber's calendar-month
   reset behaviour is unchanged (regression guard).

6. [ ] **Surface trial state on the two routes the dashboard already calls.** Extend
   `EntitlementSummary` (`src/types/billing.ts`) with an optional `trial: { daysRemaining: number;
   endsAt: string } | null`, populated in `GET /api/billing/entitlement` from `readTrialGrant` when
   active — this is the cheap per-page call the dashboard overview badge (design screen 1) reads,
   and adding a countdown to it stays presentation-only, not load-bearing for authorisation (its
   existing header comment already states that constraint). Extend `BillingDashboardData`
   similarly with `trial: { daysRemaining: number; endsAt: string; creditsUsed: number;
   creditsLimit: number } | null` and an `everTrialed: boolean`, populated in `GET
   /api/billing/dashboard` (which already resolves `entitlement` and calls `getCreditWallet`) —
   this is what `BillingDashboard.tsx` already fetches, so the billing-page card and the expired
   panel need no second request. `trial` is populated only while no live subscription exists
   (`hasLiveSubscription` is already computed in `BillingDashboard.tsx`; the route computes the
   server-side equivalent via `getUserSubscription`), matching the design's "conversion is
   reflected by the card disappearing" — a still-unexpired trial grant must not keep showing the
   trial card once a subscription is live. `everTrialed` distinguishes the two expired-state copy
   variants (design screen 3) and comes from `readTrialGrant` returning non-null regardless of
   `isActive`.
   **Tests**: extend `src/__tests__/api/billing/entitlement.test.ts` with active-trial and
   no-trial cases; extend `src/__tests__/api/billing/dashboard-unentitled.test.ts` with
   never-trialled (`everTrialed: false`) vs. expired-trial (`everTrialed: true`) cases, and a case
   where an active trial coexists with a live subscription and `trial` is omitted from the
   response.

7. [ ] **Dashboard UI — badge, trial card, expired panel.** All composed from
   `src/components/ui/*` per `docs/design-system.md` and `docs/designs/s01-trial-signup.md`; no
   new primitive. `src/app/dashboard/page.tsx`: add a `StatusBadge` in `PageHeader`'s action area,
   fetched from `/api/billing/entitlement`, text `Trial — {daysLeft} days left`, tone `info` (>3
   days) or `warning` (≤3), linking to `/dashboard/billing`; absent when `trial` is null.
   `src/components/billing/BillingDashboard.tsx`: a new `Card` (`outline`) above
   `CheckoutStatusBanner`, two rows (`IconTile` `Clock` for time, `IconTile` `Zap` for AI credits
   with a `.text-metric .tabular` count and a progress bar, tone `info`/`warning`/`danger` at the
   thresholds the design specifies), a `Skeleton` while loading, and — the deliberate deviation the
   design flags — hidden entirely (not an `Alert`) on fetch failure, since this route "must not
   become load-bearing for authorisation" and a destructive alert about the reader's own account
   would misstate an unrelated fetch failure as an account problem. Extend the existing
   `currentPlan === null` branch (`BillingDashboard.tsx:137-175`) with the `everTrialed` copy
   variant: "Your trial has ended" / the AC-4 reassurance sentence / one `Button size="lg"`
   "Upgrade to Pro" and nothing beside it, alongside the existing never-subscribed copy.
   **Tests**: component tests for the badge (renders/hides per `trial`, tone switches at the
   3-day threshold) and for the billing card's three tone sub-states and the two expired-panel
   copy variants; a loading-skeleton test; a fetch-failure test asserting the card does not
   render (not an `Alert`).

8. [ ] **Restore the marketing claims the product can now honour.** Un-comment/replace the
   tombstoned copy in `src/components/sections/Pricing.tsx:55-58` (`TRUST_POINTS`),
   `src/components/sections/FinalCTA.tsx:96-100`, and `src/components/sections/Hero.tsx:115-124`
   with "14-day free trial" / "No credit card required" copy, removing the now-inaccurate
   tombstone comments (the claims are true again — leave a short note only if the CTA copy itself
   changes, per the house comment style of anchoring to what actually happened).
   **Tests**: new render tests (`Pricing.test.tsx`, `FinalCTA.test.tsx`, `Hero.test.tsx` — none
   exist today) asserting the restored strings are present in the rendered output.

9. [ ] **Integration — close the loop through real route handlers.** New
   `src/__tests__/integration/trial-lifecycle.test.ts`: grant a trial via `ensureTrialStarted` →
   `POST /api/sites/register` succeeds with no Stripe customer row anywhere (AC 1); mutate the
   grant's `expires_at` into the past (simulating day 15, no cron involved — task 2's read-time
   filter is what expires it) → a second `POST /api/sites/register` is refused with
   `upgrade_required: true` in the response body (AC 3, and the existing `upgrade_required`
   wire-name — not `upgradeRequired` — stays as-is, this story does not rename it); `GET
   /api/content/:siteId` for that now-expired-trial site still returns 200 with current content
   (AC 4 — content routes never call entitlement, confirmed by this test rather than by reading
   the code); with an active (non-expired) trial, `POST /api/billing/checkout` with `intent:
   "subscription"` is **not** blocked by the trial (AC 5) — verifying `checkout/route.ts`,
   `checkout-reservation.ts` and `user-lock.ts` need no changes, since none of them read
   `plan_entitlements` at all.

## Run interdicts

- `src/lib/stripe/plans.ts` and `supabase/migrations/20260802000000_plans_catalog.sql` diffs must
  stay empty — no new plan/product row, no catalogue change (T7: any id outside the
  `SubscriptionPlanId`/`OneTimeProductId` unions takes down pricing, checkout and every gate).
- `src/lib/billing/checkout-reservation.ts`, `src/lib/billing/user-lock.ts`, and the subscription
  branch of `src/app/api/billing/checkout/route.ts` diffs must stay empty — task 9's test proves
  they need nothing added; do not introduce a revocation-at-conversion path (T4 — the trial is
  left to lapse on its own clock, which is what makes AC 5 free).
- No new `vercel.json` cron entry and no new `/api/cron/*` route — expiry is a read-time query
  predicate (task 2), never a sweeper (T11).
- `src/__tests__/api/billing/checkout-concurrency.test.ts:269` must pass unmodified — it is the
  regression guard for T1.
- No zod, no new schema library — any new input parsing (none is expected; no task adds a request
  body) goes through `src/lib/api/validation.ts` (ADR 003).
- `public/embed/recopyfast.src.js`, `public/embed/recopyfast.js`, and `scripts/build-embed.mjs`
  diffs must stay empty — this story does not touch the embed; task 9 proves content delivery is
  already independent of entitlement.
- No `stripe_payment_intent_id` value is ever synthesized for a trial row (contrast
  `refundCredits`'s synthetic-key pattern) — it stays `NULL`; the uniqueness guarantee for AC 6
  comes from the task-1 partial index, not from that column.

## The point everything turns on

The whole plan stands on one choice: model the trial as a **row in `plan_entitlements`**, tagged
`source = 'trial'` and time-boxed by a new `expires_at` column, filtered **inside** the query
rather than checked after it. Two rejected alternatives are in the research (a `trial` catalogue
row breaks the catalogue loader outright; a `billing_subscriptions` row with `status='trialing'`
and no Stripe subscription id breaks the checkout 409 guard and throws in the upgrade flow) — this
is the structural decision that needs an ADR travelling with the branch (see below).

Three places this could be wrong, and what each must be checked against:

1. **The expiry filter's placement.** Filtering `plan_entitlements` for `expires_at IS NULL OR
   expires_at > now()` has to happen inside the `readEffectivePlanId` query, before
   `.order().limit(1)`, not as a check on the row after `.maybeSingle()` returns it. A post-query
   check that returns `null` on an expired row skips the subscription read below it entirely —
   un-entitling a customer who converted and is now paying. Check against: task 2's "expired trial
   with a live subscription underneath it" test, which is the one case that distinguishes the two
   implementations.
2. **`readGrantedPlanIds`'s trial exclusion.** If the `.neq("source", TRIAL_SOURCE)` filter is
   missing, wrong, or later regressed, a trialling account is silently told "you already have
   lifetime access" on a $199 purchase they have never made — the exact defect
   `effective-plan.ts:113-129` documents having already shipped once, through a different door.
   Check against: the new `readGrantedPlanIds` test in task 2, plus
   `checkout-concurrency.test.ts:269` staying green unmodified.
3. **The credit period boundary.** If `getUserCreditBalance` keeps using
   `startOfCurrentMonth()` for a trial instead of the trial's own `grantedAt`, a trial that
   happens to cross a calendar-month boundary draws its included allowance twice — the literal
   "uncapped spend" the story forbids. Check against: task 5's cross-month-boundary test, which is
   the only test in this plan that exercises a real calendar boundary rather than a fixed offset.

## Files touched

New: `supabase/migrations/<ts>_trial_entitlements.sql`, `src/lib/billing/trial.ts`,
`src/__tests__/lib/billing/trial.test.ts`, `src/__tests__/app/auth/callback.test.ts`,
`src/__tests__/app/auth/confirm.test.ts`, `src/__tests__/lib/credits/system.test.ts` (if absent),
`src/__tests__/integration/trial-lifecycle.test.ts`, `src/components/sections/Pricing.test.tsx`,
`src/components/sections/FinalCTA.test.tsx`, `src/components/sections/Hero.test.tsx`, and
component test(s) for the new dashboard/billing UI.

Edited: `src/lib/billing/effective-plan.ts`, `src/lib/feature-gating/permissions.ts` (comment
only), `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts`,
`src/lib/credits/system.ts`, `src/types/billing.ts`, `src/app/api/billing/entitlement/route.ts`,
`src/app/api/billing/dashboard/route.ts`, `src/app/dashboard/page.tsx`,
`src/components/billing/BillingDashboard.tsx`, `src/components/sections/Pricing.tsx`,
`src/components/sections/FinalCTA.tsx`, `src/components/sections/Hero.tsx`,
`src/__tests__/lib/billing/entitlements.test.ts`,
`src/__tests__/api/billing/entitlement.test.ts`,
`src/__tests__/api/billing/dashboard-unentitled.test.ts`,
`src/__tests__/lib/stripe/plan-seed.test.ts`.

Untouched (see Run interdicts): `src/lib/stripe/plans.ts`,
`supabase/migrations/20260802000000_plans_catalog.sql`,
`src/lib/billing/checkout-reservation.ts`, `src/lib/billing/user-lock.ts`,
`src/app/api/billing/checkout/route.ts`, `public/embed/**`, `vercel.json`.

## Test strategy

Unit-level (tasks 1, 2, 3, 5): the chokepoint and its supporting functions get direct Jest
coverage with a mocked Supabase client, following the existing shape in
`entitlements.test.ts`/`checkout-concurrency.test.ts`. Route-level (tasks 4, 6): new/extended
route tests with the standard mocked-`createClient` pattern already used across
`src/__tests__/api/billing/*`. Component-level (task 7, 8): React Testing Library renders against
the real `src/components/ui/*` primitives, no new mocks beyond fetch. Integration (task 9): real
route handlers chained together against a mocked Supabase client, proving the untouched files in
Run interdicts genuinely need no change rather than asserting it in prose.

Existing regression nets that must stay green, unmodified: `permissions.test.ts` (573 lines —
proves the editor/collaborator half of AC 3 falls out of the task-2 fix with no gate code
change), `middleware.test.ts` (the paywall redirect an entitled trial must now skip),
`checkout-concurrency.test.ts:269`, `plan-seed.test.ts`'s existing "ships exactly the three
subscription plans" case. Per `AGENTS.md:204`/T9, none of these may be edited to accommodate this
story's behaviour; if one turns out to need a genuine change, the plan is wrong about scope and
that must be said in the PR, not silently patched.

Manual/QA: none required beyond the automated suite — there is no external system, deployment, or
byte budget in this story (research's "Real complexity" section).

## Definition of Done

- All 9 tasks' checkboxes ticked, each with the test(s) named above passing.
- `npm run lint` — 0 errors. `npm run type-check` — clean. `npm run format:check` — clean.
- `npm run build` — succeeds (includes `build:embed`; this story's embed diff is empty per Run
  interdicts, so `--check` must still pass against the unmodified artifact).
- Full `npm test` suite green, including every existing file named under "existing regression
  nets" above, unmodified.
- `docs/decisions/014-trial-as-expiring-plan-entitlement.md` exists, describing the
  `plan_entitlements` modelling choice and the rejected alternatives — see "The point everything
  turns on". Written per AGENTS.md's "story decisions travel with `feature/<id>`".
- Review passed (`/ks-review`), no open critical issue, before `/ks-ship`.
