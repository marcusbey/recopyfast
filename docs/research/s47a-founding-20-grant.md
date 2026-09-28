# Research — Story s47a-founding-20-grant (also covers s47b-founding-20-landing)

Written for `s47-founding-20-offer`, which was split at research into `s47a-founding-20-grant` and
`s47b-founding-20-landing` (docs/stories.md). The landing sections apply to s47b.

Operator decision 2026-09-27: the first 20 new accounts get Pro free for 90 days, 100 AI credits a
month, no card; account 21 onward gets today's 14-day trial. Base: `main` `0248ffc` (s46 merged,
s45 merged). Local Supabase (`supabase_db_recopyfast`) is up but its ledger stops at
`20260925120000`: the s45 migration `20260926120000` is **not applied locally**.

## The five structuring facts

1. **The offer grant must BE the account's one trial row, or a lapsed offer becomes a free
   14-day trial.** `ensureTrialStarted` writes only when the account resolves to `kind === "none"`
   (`src/lib/billing/trial.ts:132`), and an expired grant resolves to exactly that. The only thing
   that stops a second grant is the partial unique index `(user_id) WHERE source = 'trial'`
   (`supabase/migrations/20260817000000_trial_entitlements.sql:47-48`). A grant under any other
   `source` sits outside that index, so on the first sign-in after day 90 the insert succeeds and
   the account gets 14 more days (`trial.ts:87-93`). If the offer row is `source='trial'`, that
   insert returns 23505. `grantTrialEntitlement` reports that as `duplicate` (`trial.ts:96-98`)
   and the account stays "no plan". That is the state the story asks for.
2. **Every reader that singles out trials already does the right thing for an offer row that is a
   trial row.** Three readers match `source = 'trial'` against `TRIAL_SOURCE`
   (`effective-plan.ts:64`). `readGrantedPlanIds` excludes trials (`effective-plan.ts:240`), so an
   offer account can still buy Lifetime Pro. The comment at `:223-229` records a sale lost when
   that exclusion was missing. `otherHeldPlans` excludes trials (`:326`), so the offer never
   raises a Founding Agency buyer's allowance floor. `readTrialGrant` finds it (`:100`), so the
   countdown, the credit window and `everTrialed` all work. A new `source` would have to be
   threaded through all three. Missing one either sells Pro as "already owned" or gives a
   Founding Agency buyer 500 credits.
3. **Nothing makes 100 a month today.** Only one place enforces the allowance:
   `credits/system.ts:142-143` reads `entitlement.plan.limits.monthlyCredits`. A trial row resolves
   to the full `pro` row, which gives 500 (`effective-plan.ts:427-431` → `fullPlan`). The window is
   also wrong. An active trial's allowance runs from `granted_at` as **one** non-renewing window
   (`system.ts:190-200`), so a 90-day row would get 100 credits in total, not 100 a month. The
   anniversary helper already exists (`startOfCurrentAllowanceWindow`, `system.ts:273`). It does
   not change a 14-day trial: the shortest gap between two monthly anniversaries is 28 days, so a
   14-day trial always stays in its first window. The ADR 038 override mechanism cannot express
   this. It is keyed on the one active product that grants a plan, the loader refuses a second
   product granting the same plan (`plans.ts:416-429`), and `lifetime_pro` already grants `pro`.
4. **Capacity has an exact precedent, which is simpler here (no hold, no Stripe).**
   `reserve_founding_agency_spot` takes `pg_advisory_xact_lock(hashtextextended('founding_agency_capacity', 0))`,
   checks eligibility, counts, then inserts in one plpgsql transaction
   (`20260924065000_agency_plan_and_founding_capacity.sql:128-210`). `complete_founding_agency_purchase`
   writes `plan_entitlements` and the capacity row inside the same locked function
   (`20260925110000_enforce_one_founding_lifetime_per_account.sql:98-109`). A single
   `claim_founding_offer_spot` function can hold the lock, insert the 90-day trial row, then insert
   the claim row. Claim and grant then succeed or fail together. If the grant insert hits 23505,
   the claim rolls back with it.
5. **Deploy order has to be migration first.** The story says "deploy, apply the migration". The
   resolver needs an offer marker, and the cheapest place for it is a column in the query that
   already reads live grants (`effective-plan.ts:346`). If that code deploys before the column
   exists, PostgREST returns an error, `readEffectivePlanBasis` throws (`:367-371`), and every
   gate and every API route that resolves entitlement fails, for every account. Middleware only
   hides it because it fails open (`middleware.ts:39-49`). Applying the migration first is safe:
   old code never reads the column or calls the new functions, and keeps granting 14-day trials.
   The precedent is `docs/operations/stripe-setup.md:96` ("Migration first, then feature
   application release"). The story's operator note has to be changed to: apply the migration,
   deploy, run the live proof, release the spot.

## Target story

A brand-new account's first sign-in, while spots remain, writes a grant that confers `pro` for 90
days (server clock) with 100 AI credits a month and no card. Purchased credit packs stack on top
and are spent after the allowance. The database owns exactly 20 spots. Concurrent sign-ins never
claim a 21st, and claim and grant succeed or fail together. An account that has had a trial, a
plan, a lifetime grant or credits never takes a spot, and neither does a repeat sign-in. A failure
in the offer falls back to the 14-day trial and never fails the sign-in. After 20 claims, sign-in
behaves exactly as today. At day 90 the account lapses the way a trial lapses, and "one trial per
account, ever" still holds. The landing page shows a live "X of 20 spots left" from a public
count-only endpoint, and shows the 14-day trial line again at 0. The badge and billing card say
"Founding offer — N days left" and "100 AI credits a month". The operator can release a QA
account's spot with a service-role command documented in the runbook, which reverts that account
to "no plan". No Stripe change. One story commit.

## Current state of the code

**Grant path.** Only `/auth/callback` (`src/app/auth/callback/route.ts:43-52`, call at `:48`) and
`/auth/confirm` (`src/app/auth/confirm/route.ts:123-132`, call at `:128`) see a session start. Both
run on every sign-in, and both wrap `ensureTrialStarted` in their own try/catch.
`ensureTrialStarted(supabase, userId)` (`trial.ts:125-140`) resolves entitlement with the
signed-in user's cookie client, returns unless the result is `none`, then calls
`grantTrialEntitlement(userId)` (`trial.ts:82-103`). That function inserts through the service
role `{plan_id:'pro', source:'trial', stripe_payment_intent_id:null, expires_at: now+14d}`, with
the expiry taken from the server clock in TS (`trial.ts:59-61`), maps 23505 to `duplicate`, and
throws on anything else. `ensureTrialStarted` swallows every error (`:137-139`). No code creates
auth users except the browser's `signInWithOtp` (`src/contexts/AuthContext.tsx:88`). Invited
editors have no Supabase account (they use `/edit` and editor grants), so no "invited editor
account" can take a spot.

**Resolution.** `resolveEntitlement` (`effective-plan.ts:508-533`) calls
`readEffectivePlanBasis` (`:340-435`). That selects `plan_id, stripe_payment_intent_id, source`
for live grants, with expiry filtered inside the query (`:346-363`). Agency wins first
(`:395-397`, `:414-425`). Otherwise the newest recognised grant beats the subscription
(`:427-432`). The s45 path (`isPurchaseOnly` `:301-307`, `purchasedPlan` → `findPurchasedPlanById`
→ `withAllowanceFloor` `:475-487`) is the only place a plan's limits are ever changed. A trial row
has no payment intent, so it always gets `fullPlan` (500 credits).

**Credits.** `getUserCreditBalance` (`credits/system.ts:121-221`): included = `plan.limits.monthlyCredits`
(`:142-143`). The window is the subscription period, else `trial.grantedAt` when the trial is
active, else the calendar month (`:190-200`). `consumeCredits` spends the included allowance
before purchased credits (`:457-461`), so packs already stack.

**Presentation.** `/api/billing/entitlement` returns `trial: {daysRemaining, endsAt}` only when
the trial is active and no subscription or non-trial grant exists (`route.ts:55-82`). It feeds
`TrialStatusBadge` (label `Trial — N days left`, `TrialStatusBadge.tsx:63`, tooltip "Your Pro
trial ends…" `:75`), which the dashboard renders at `src/app/dashboard/page.tsx:185`.
`/api/billing/dashboard` returns `trial: {…, creditsUsed: wallet.usedThisMonth, creditsLimit:
wallet.included}` and `everTrialed` (`dashboard/route.ts:142-164`). It feeds `TrialStatusCard`
("N days left in your trial" `:115`, "of {creditsLimit} trial AI credits used" `:132`, aria
`:138`) at `BillingDashboard.tsx:255`, and the lapsed branch ("Your trial has ended" / "Your
14-day Pro trial has ended…", `BillingDashboard.tsx:157-178`). `SubscriptionCard` already rewrites
the "500 AI credits / month" bullet to `wallet.included` (`SubscriptionCard.tsx:45-61`, fed at
`BillingDashboard.tsx:268`), so it will read 100 with no change once the resolver returns 100.

**Founding Agency public count (precedent).** `getFoundingAgencyAvailability`
(`src/lib/billing/founding-agency.ts:60-75`) is a service-role RPC to
`get_founding_agency_availability()` (`20260924065000_…sql:369-384`, EXECUTE for service_role
only, `:386-405`). It is served in `/api/pricing` (`pricing/route.ts:184-196`) behind a 5-minute
in-process cache (`:27-29`, `:279-281`) and `Cache-Control: public, max-age=300, s-maxage=300,
stale-while-revalidate=600` (`:264-265`). On a failed refresh the count becomes `null` rather than
a stale number (`:290-299`). The landing page reads it on the client (`Pricing.tsx:83-101`,
`:365-369`). Worst-case lag is about 15 minutes, and the runbook accepts that ("the availability
display can lag its cache", `stripe-setup.md:175-176`). That is too slow for "correct after a
claim".

**Landing copy.** `Hero.tsx:154` "14 days of Pro. No credit card required."; `Hero.tsx:133`
"Start your free trial"; `Pricing.tsx:69-74` TRUST_POINTS "14-day free trial" (tombstone
`:63-68`); `FinalCTA.tsx:104-107` "14-day free trial" (tombstone `:94-101`);
`src/app/try/page.tsx:73` "Start your free trial" (generic, still true). The root landing page
is `"use client"` (`src/app/page.tsx:1`), so any count is fetched on the client.

## Anchor points

- **New migration** `supabase/migrations/20260927NNNNNN_founding_offer.sql` (must sort after
  `20260926120000`). It adds:
  - a nullable marker column on `plan_entitlements` (recommended `offer_id TEXT`, CHECK
    `offer_id IS NULL OR (offer_id = 'founding_20' AND source = 'trial')`);
  - a claims table with RLS on and a service_role-only policy in the same migration (AGENTS.md
    non-negotiable 6; precedent `20260924065000_…sql:117-126`). It needs `user_id` →
    `auth.users` with `ON DELETE SET NULL` so a deleted account cannot reopen a spot (precedent
    `:80-83`), `entitlement_id` → `plan_entitlements(id)` with `ON DELETE SET NULL`
    (`plan_entitlements.user_id` cascades on user delete), and `status claimed|released`,
    `claimed_at`, `released_at`, `release_reason`;
  - three SECURITY DEFINER functions: `claim_founding_offer_spot(uuid)`,
    `get_founding_offer_availability()` and `release_founding_offer_spot(uuid, text)`, all taking
    one new advisory-lock key. They need `REVOKE … FROM PUBLIC, anon, authenticated` and
    `GRANT EXECUTE … TO service_role` (enforced by `src/__tests__/db/function-grants.test.ts`
    rule 1).
- `src/lib/billing/founding-offer.ts` (new, sibling of `founding-agency.ts`) holds the RPC wrappers
  and offer constants (id, 20, 90, 100).
- `src/lib/billing/trial.ts` `ensureTrialStarted`: try the claim first, then call
  `grantTrialEntitlement` for any outcome other than "claimed", including errors.
- `src/lib/billing/effective-plan.ts`: add the marker to the select (`:346`) and to `LiveGrant`
  (`:295-299`). When `pro` is in force and every live grant conferring it is an offer row, and no
  live subscription bills `pro`, override `monthlyCredits` to 100, then apply `withAllowanceFloor`
  with `otherHeldPlans`. `readTrialGrant` (`:92-130`) returns the marker.
- `src/lib/credits/system.ts:200`: `trial.grantedAt` → `startOfCurrentAllowanceWindow(trial.grantedAt)`.
- `src/types/billing.ts:38-54,203-212`, `api/billing/entitlement/route.ts:55-82`,
  `api/billing/dashboard/route.ts:142-164`: carry the offer marker (and the lapsed kind).
- `TrialStatusBadge.tsx:63,75`, `TrialStatusCard.tsx:115-138`, `BillingDashboard.tsx:157-178`: copy.
- New public route, for example `src/app/api/offers/founding/route.ts`, returns
  `{remaining, limit, soldOut}` only.
- Landing: a hook in `src/hooks/` (reference shape `useSites.ts`), `Hero.tsx:154`,
  `Pricing.tsx`, possibly `FinalCTA.tsx`.
- Runbook section plus a registry row in `docs/README.md:120-126`. New ADR 039.

## Verified APIs / functions

- `ensureTrialStarted(supabase: SupabaseClient, userId: string): Promise<void>` — `trial.ts:125`.
- `grantTrialEntitlement(userId: string): Promise<StartTrialResult>` — `trial.ts:82`;
  `StartTrialResult {granted, duplicate}` `:46-50`; `TRIAL_DURATION_DAYS = 14` `:23`;
  `trialDaysRemaining(expiresAt)` `:38` (rounds up).
- `resolveEntitlement(supabase, userId): Promise<Entitlement>` — `effective-plan.ts:508`. Callers:
  `middleware.ts:44`, `permissions.ts:91`, `credits/system.ts:140`, `trial.ts:130`, and through
  `getEffectivePlan` (`entitlements.ts:57`) `permissions.ts:143,319,540`,
  `subscription.ts:574`, `ab-tests/generate/route.ts:70`, `billing/dashboard/route.ts:127`,
  `billing/entitlement/route.ts:96`.
- `readTrialGrant(supabase, userId): Promise<TrialGrant | null>` — `effective-plan.ts:92`;
  `TrialGrant {grantedAt, expiresAt, isActive}` `:67-72`.
- `readGrantedPlanIds` `:231`; `withAllowanceFloor(plan, otherHeld)` `:475`;
  `findPurchasedPlanById` `plans.ts:585`; `findPlanHeldByPurchase` `plan-types.ts:170`.
- `startOfCurrentAllowanceWindow(periodStart: string, now?: Date): string` — `credits/system.ts:273`
  (exported, UTC, clamps day-of-month to the anchor).
- `getFoundingAgencyAvailability(): Promise<{remaining, soldOut, limit}>` — `founding-agency.ts:60`;
  `FOUNDING_AGENCY_LIMIT = 50` `:5` mirrors the SQL constant `50` (`…065000…sql:193,198,377,382`).
- `enforceRateLimit(request, {limit, endpoint, onStoreFailure})` — `src/lib/api/rate-limit.ts:98`.
- `revokeEntitlementForPayment(pi, reason)` — `entitlements.ts:132`. It **rewrites `source` to
  `revoked:<reason>`** (`:142`). See Traps.
- Schema, measured on the local DB: `plan_entitlements(id, user_id → auth.users ON DELETE CASCADE,
  plan_id → plans RESTRICT, source TEXT NOT NULL DEFAULT 'lifetime_purchase',
  stripe_payment_intent_id UNIQUE, granted_at DEFAULT now(), revoked_at, created_at,
  expires_at)`. Indexes: pkey, PI unique, `idx_plan_entitlements_user_active`,
  `plan_entitlements_one_trial_per_user`. RLS: SELECT own for `authenticated`, ALL for
  `service_role`.
- Plan seed: `pro` limits `{websites 5, collaborators 5, ai_features, translations -1,
  ab_testing, monthly_credits 500}` (`20260802000000_plans_catalog.sql:295`); `starter`
  `monthly_credits 0` (`:287`).

## Traps & constraints

- **Representation choice, evaluated.**
  - **(A) Recommended: the offer is the account's one trial row.** It is written as
    `plan_id 'pro'`, `source 'trial'`, `expires_at = now() + 90 days` (DB clock, server side), no
    payment intent, marked `offer_id = 'founding_20'`. The one-trial index, `readGrantedPlanIds`,
    `otherHeldPlans`, ADR 029 precedence, "hide the countdown once converted"
    (`entitlement/route.ts:64-76`), `everTrialed` and the lapsed billing screen all hold without
    change. What changes: the allowance (resolver), the window (credits), copy, and one
    migration-first column.
  - **(B) Rejected: a new `source` or a new plan row.**
    - A new source needs a second unique index covering both sources, and the three trial readers
      above (fact 2) each have to learn it. Missing one hides Lifetime Pro from the account, or
      raises a Founding Agency buyer to 500 credits. ADR 014's "Watch" names exactly this: any
      code that branches on `source` without accounting for the trial value inherits this ADR's
      blast radius.
    - A `plans` row is worse. A second product granting `pro` makes `loadPlanCatalogue` throw
      (`plans.ts:416-429`), which takes down pricing, checkout and every gate. An unknown id is
      filtered out with a warning (`plans.ts:80-98`), so it never resolves. A row the loader
      does parse is listed on `/api/pricing` (`pricing/route.ts:203-205`).
  - A synthetic payment intent on the row is forbidden by `trial.ts:70-73`, and would also make
    ADR 038 treat the row as a purchase.
- **Release must keep `source = 'trial'`.** The house revocation rewrites `source`
  (`entitlements.ts:142`). Doing that to an offer row takes it out of the one-trial index
  (`…trial_entitlements.sql:47-48`), and the released QA account gets a new 14-day trial on its
  next sign-in instead of "no plan". Release has to set `revoked_at` only. The index is not scoped
  on revocation on purpose: "a revoked trial is a spent trial" (`:44-46`). The CHECK proposed
  above makes the database refuse any rewrite of `source` on an offer row.
- **Eligibility is decided in SQL, under the lock.** `kind === "none"` in `ensureTrialStarted`
  also covers lapsed trials, spent credit wallets, refunded lifetime grants and cancelled
  subscriptions. The function must refuse the claim when any of these exists for the user:
  a `plan_entitlements` row of any source, revoked or expired included; a `billing_subscriptions`
  row of any status; a `credit_purchases` row. Every refusal falls back to `grantTrialEntitlement`,
  which is exactly today's behaviour for that account. A repeat sign-in after a claim already has
  a trial row, so it is ineligible.
- **The fallback cannot double-grant.** If the claim RPC commits but its response is lost, the TS
  fallback insert hits 23505 and returns `duplicate`. If a parallel sign-in's fallback trial row
  lands first, the claim's own trial insert fails, and the whole transaction, claim included,
  rolls back. Insert the trial row first, then the claim row (`RETURNING id` links them). Do not
  catch 23505 inside the function in a way that commits the claim.
- **The lock serialises every "none" sign-in.** After the 20 spots are gone, each new or lapsed
  account's sign-in still reaches the RPC. Use a key separate from
  `founding_agency_capacity`, so sign-ins never queue behind Stripe checkouts. Check "sold
  out/ineligible" before taking the lock, then re-check under it. Use a blocking
  `pg_advisory_xact_lock`, as the precedent does. A try-lock would hand the 14-day trial to
  someone who arrived while spots remained.
- **Resolver precedence cases the plan must pin** (s45-style fixtures):
  - offer only → `pro`, 100;
  - offer + Pro subscription → 500 (a subscription bills `pro`);
  - offer + Starter subscription → `pro`, max(100, 0) = 100 (the grant wins, `:427`);
  - offer + Agency subscription or Founding Agency → Agency, 1000 or 250, and the offer does not
    raise the floor (trial excluded, `:326`);
  - offer + Lifetime Pro → 500 (not every `pro` grant is an offer row);
  - a plain 14-day trial → unchanged 500.
- **Allowance windows.** Monthly windows anchored on `granted_at` give three allowances in 90
  days. When the three months after the anchor total fewer than 90 days (for example an anchor
  of Feb 1 or Jan 31), a 1–2-day fourth window opens before expiry: at most 400 credits in total.
  Accept this, or cap it at the plan stage. The calendar month is worse: sign up on the 28th and
  get 100 credits, then 100 more on the 1st. The change at `system.ts:200` applies to every trial
  and is behaviour-identical for 14-day ones. Pin that with the existing
  `src/__tests__/lib/credits/trial-period.test.ts:141-237`.
- **Public count caching.** Do not piggy-back on `/api/pricing` (≤15 min stale, see Current
  state). The dedicated route should:
  - use the service role for an aggregate-only RPC (precedent `founding-agency.ts:60-75`; anon
    EXECUTE is forbidden by `function-grants.test.ts`), and return no user data;
  - set `export const dynamic = "force-dynamic"` (precedent `api/upload/image/route.ts:33`) and
    `Cache-Control: public, max-age=0, s-maxage=<small>, stale-while-revalidate=<small>`;
  - on error, return `null`, so the landing shows the trial line and never a guessed count.

  Its staleness bound is the definition of "correct after a claim without a redeploy". State the
  bound in the plan.
- **Middleware and gates.** A `pro` grant from a trial row already passes every gate; no
  `permissions.ts` change (`permissions.ts:28-35`). "All sites" (s39) needs no plan gate.
- **Tests pinned to today's copy.** Hero "no credit card required" (`trial-claims.test.tsx:38-42`),
  Pricing and FinalCTA "14-day free trial" (`:47-68`), Playwright `e2e/landing.spec.ts:196-203`
  (in `#pricing`). CI's E2E job runs a real local Supabase with migrations applied
  (`.github/workflows/ci.yml:218-253`), so during E2E the count endpoint will report 20 spots
  left. If the offer replaces the Pricing trust point, `landing.spec.ts` changes, and the PR
  must say so (AGENTS.md Tests). A new Playwright test moves the 44 contract in five places
  (`playwright.config.ts:14`, `e2e/support/strict-reporter.ts:108`, `ci.yml:209,294,336-343`,
  `strict-run-contract.test.ts`). Component tests pinned: `TrialStatusBadge.test.tsx:55,75,87`,
  `BillingDashboard.trial.test.tsx:107,165,168`.
- **Test infrastructure.**
  - Unit tests mock the service client (`trial.test.ts:25-41`).
  - Resolver behaviour runs through in-memory fakes that read the rows out of the migrations
    (`src/__tests__/lib/billing/lifetime-agency-allowance.test.ts:330-441` is the template).
  - The end-to-end fake (`src/__tests__/integration/trial-lifecycle.test.ts`) **throws on an
    unknown RPC** (`:252-298`). The existing lifecycle tests stay green only because the new code
    falls back on error. Add the claim RPC to the fake for the offer lifecycle.
  - Real-Postgres tests use `src/__tests__/db/db-harness.ts` (gated at collection time). The
    barrier-synchronised concurrency test to copy is `founding-agency-cap.test.ts:157-251`; it
    fails closed when the migration is absent (`:27-63`) and checks service-role-only execution
    (`:1016`).
  - **CI runs DB suites only by name.** `ci.yml:258-289` runs `founding-agency-cap.test.ts`, and
    `scripts/run-db-invariants.mjs` runs only `column-privileges.test.ts`. A new
    `founding-offer-cap.test.ts` never runs in CI unless the workflow names it.
  - Optional mutation proof precedent: `scripts/test-founding-agency-lock-mutation.mjs`.
- **Local gates.**
  - `npm run precommit` (lint + type-check + jest), `format:check`, `type-check:build`,
    `npm run build`, `npx jest src/__tests__/db` against the running local Supabase (apply the
    pending local migrations `20260926120000` and the new one first), and `npm run test:e2e` if
    the landing surface changes.
  - **Trap:** `next/jest` loads `.env` (`jest.config.js:3-6`), and the untracked root `.env` sets
    `NEXT_PUBLIC_APP_URL` to production. Suites that read it (for example
    `src/__tests__/api/auth/public-origin.test.ts`, `api/sites/register/route.test.ts`,
    `lib/security/site-auth-origin.test.ts`) fail at the repo root. Run gates in a worktree
    (`/new-feature`; it has no `.env`), or have new tests set the variable explicitly.
- **Rollback.** Old code reading offer rows treats them as plain trials: 500 credits in one window,
  "Trial — 80 days left". That over-delivers but causes no outage.
- **Account deletion.** No self-serve path exists (`auth.admin` is only `getUserById`,
  `src/lib/auth/user-identity.ts:48`). Operator deletion cascades the trial row
  (`plan_entitlements.user_id ON DELETE CASCADE`), so re-registering with the same email starts
  fresh. That is already true for trials. `SET NULL` on the claim keeps the spot consumed.

## Open questions

1. **Where the number 100 lives.** Recommended: a TS constant keyed by `offer_id` in
   `founding-offer.ts`, like `TRIAL_DURATION_DAYS` (ADR 014 keeps trial terms in code), with 20
   and 90 enforced in the SQL function (precedent: 50 in SQL, mirrored in TS). The alternative is
   a per-grant `monthly_credits` column written by the function. That is closer to the "per-entitlement
   limits column" ADR 038 rejected, so pick one in ADR 039.
2. **"Brand-new" beyond "no billing history".** The local DB already holds an auth user with no
   entitlement row (3 users, 2 trial rows). An old account like that would take a spot on its
   next sign-in. Add `auth.users.created_at >= offer_opened_at` (the migration's `NOW()`) if
   "new accounts after the offer opens" is meant literally.
3. **Lapsed copy.** The lapsed screen is the `everTrialed` branch ("Your trial has ended", body
   "Your 14-day Pro trial has ended…", `BillingDashboard.tsx:166-178`), not the "Choose a plan to
   continue" heading the AC names. Pick one: keep the branch and make the copy duration-neutral
   or offer-aware (needs the marker in the dashboard payload), or route lapsed offer accounts to
   "Choose a plan".
4. **Landing layout.** Decide whether the offer replaces the Hero line, the Pricing
   "14-day free trial" trust point, or both; whether FinalCTA changes; and how to avoid a
   trial→offer flash on a client-rendered hero. This is `/ks-design` input.
5. Whether the count route gets a rate limiter (public read → `onStoreFailure: "allow"`) or relies
   on the CDN `s-maxage` alone (`/api/pricing` has none).
6. Whether to cap the fourth partial allowance window (see Traps).

## Real complexity

Scored 4 in `docs/stories.md`. After reading the code: **5**. The story touches:

- the sign-in path;
- a new SECURITY DEFINER capacity boundary with a concurrency proof and a CI step;
- the `resolveEntitlement` chokepoint, where s45's one rule was scored 3 and this story adds a
  second "held as" branch with six precedence cases;
- the credit window every trial uses;
- two API payload shapes and three dashboard components;
- a public endpoint;
- the landing surface with Playwright-pinned copy;
- an operator runbook;
- a deploy-order inversion.

Rough plan size is 11–12 tasks: migration and DB suite (with CI step), wrappers, sign-in path,
resolver, credit window, payload marker, dashboard copy, count route, ADR and runbook, landing
hook and hero, then pricing/final CTA/e2e. That is above the story's ten-task limit.

Likely ADR: **039**, "The founding offer is the account's one trial, lengthened and metered
monthly". It covers: representation (A), the marker column, the claim table and lock, the
held-by-offer-only allowance rule and its floor, monthly windows anchored on `granted_at` for
every trial (this amends ADR 014's single-window consequence), release that keeps `source`, and
the migration-first order.

## Split proposal

- **s47a-founding-20-grant (4).** Migration (marker, claims, claim/availability/release functions)
  with the real-Postgres suite and CI step; the offer-first `ensureTrialStarted` with fallback;
  the resolver allowance; the monthly window; offer-aware entitlement and dashboard payloads; the
  badge, trial card and lapsed copy; the public count route; ADR 039; the release runbook.
  Covers every AC except the landing one. Delivered alone, the first 20 accounts get more than
  the landing page promises (90 days instead of 14), which is harmless. The count route can be
  proved live (claim → 19, release → 20) without any UI.
- **s47b-founding-20-landing (2).** Hook, Hero line, Pricing (and FinalCTA) presentation with
  "X of 20 spots left", the switch back to the 14-day trial line at 0 or unknown, the
  `trial-claims` and `landing.spec` updates, and the e2e contract if a test is added. Covers the
  landing AC. It depends only on s47a's count route.
