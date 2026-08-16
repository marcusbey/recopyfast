---
validated: no
---
# Plan — Story s13-agency-plan

Branch: `feature/s13-agency-plan`
Research: `docs/research/s13-agency-plan.md` — read it first; this plan does not repeat it.

## Target story

> ## ⛔ BLOCKING — this plan cannot be validated until PRD open decision 7 is answered
>
> `prd.md:444-446`, verbatim: *"**Agency plan shape.** Who is billed — agency only, or agency
> with client-paid upgrades? `s13-agency-plan` assumes agency-only, single invoice. Confirm
> before `s13` reaches `/ks-plan`."*
>
> **This is not a detail. It changes the data model.** Every task below is written under
> **answer A**. The frontmatter stays `validated: no` until an operator answers it.
>
> **Under answer A — agency-only, single invoice (assumed here).**
> No structural change. One `plans` row, one widened CHECK, one Stripe customer, one
> subscription keyed on the agency's `auth.users` id. Entitlement stays a per-**user**
> question: `resolveEntitlement(supabase, userId)` (`effective-plan.ts:198`) is unchanged,
> `countOwnedSites` is unchanged, `canCreateWebsite` is unchanged. **AC 7 ("one invoice
> covers all sites") is satisfied by doing nothing** — billing is already per-user and sites
> are never invoiced individually. `s13` stays a catalogue-and-quota story and this plan's
> ten tasks are complete and correct.
>
> **Under answer B — agency with client-paid upgrades. This plan is void, not amendable.**
> 1. A payer identity distinct from the site owner must be recorded — nothing today answers
>    *"which subscription pays for this site"*. It needs `sites.billing_subscription_id` or a
>    `subscription_sites` join table, plus its RLS policy in the same migration (ADR 002).
> 2. `resolveEntitlement(supabase, userId)` becomes `(userId, siteId)`. That function is the
>    shared path this story's own dependency (`s01-trial-signup`) is named for, and it is
>    called from `src/middleware.ts` with a request-scoped client — so the change propagates
>    into the router, not just the gates.
> 3. `canCreateWebsite` loses its meaning: it counts a user's `admin` rows against *one*
>    plan's `limits.websites` (`permissions.ts:110-125`). Under B there is no single plan.
> 4. `getUserSubscription` (`subscription.ts:301-313`) takes the most recent live row for a
>    user; with two live subscriptions of different scope that is a coin flip, and
>    `billing_subscriptions` has no uniqueness on (user, scope).
> 5. `resolveSiteOwnerId` (`permissions.ts:155`) answers *"whose plan pays for a seat"*; under
>    B that becomes *"whose subscription covers this site"* — a different lookup with a
>    different failure mode.
> 6. **AC 7 becomes false by construction** and must be rewritten.
> 7. Dunning, refunds and downgrade all need per-site resolution: a client's card failing must
>    not take the agency's other sites offline.
>
> Under B this is a re-architecture of the entitlement path, not a complexity-4 story. It
> needs a new ADR, a re-scored story, and a fresh plan. **Do not attempt to adapt this one.**

> ## ⚠ Second blocker, smaller and cheaper to answer — the Agency numbers (research Q3)
>
> The story says *"its own site limit, editor limit and monthly credit allowance"* and names
> no numbers. `prd.md:387` says only *"N sites, client sub-accounts, branded subdomain, bulk
> seat handoff, consolidated billing"*. **Stripe price amounts are immutable**
> (`sync-stripe-catalogue.mjs:238-247`) — a wrong number means creating a new price and
> repointing the env var in both accounts. Needed before Task 1:
> `websites`, `collaborators`, `translations`, `monthly_credits`, `ai_features`, `ab_testing`,
> `price_monthly`, `price_yearly_monthly_equivalent` (or NULL — see interdicts),
> `additional_site_price`, `sort_order` (Pro is 20, `credits` 30 → Agency 25), feature bullets.

**`s13-agency-plan` — one subscription for all my client sites.**
*As a web agency I want a plan priced for many sites under one bill so that adding a client
site is a decision I make in seconds, not a purchase I justify.*

`docs/stories.md:755-802`. Complexity **4** post-split. Dependency: `s01-trial-signup` (shares
the entitlement resolution path). Gates `s14a-grant-authorized-editing` and — per the M4 split
— `s20-agency-branded-subdomain`.

**Scope: AC 1–7 and 9. AC 8 (branded subdomain) is `s20` and is not in this plan.**

**The plan does not exist in code.** `src/lib/stripe/plans.ts:66-99` holds exactly `starter`,
`pro`, `credits`, `lifetime_pro`; the identity union is `PaidPlanId = "starter" | "pro"`
(`plan-types.ts:29`). The PRD names agencies the primary buyer, which makes this the **largest
single gap in the product** (`prd.md:392-393`).

**AC 4 — this plan resolves research Q2 as (a), display-only.** `canCreateWebsite` returns
`allowed: false` at the limit *regardless* of `additionalSitePrice`; the field only changes the
denial text (`permissions.ts:126-143`), and Pro already carries `additional_site_price = 5` and
still hard-refuses. This plan makes the offer **visible and distinct** (a `warning` Alert naming
the price, not a `destructive` wall) without provisioning or billing the extra site. Actual
metered overage — (b) — needs Stripe subscription-item quantity sync, a webhook path to
reconcile it, and a decrement on site delete. That is a third Stripe axis, it is not in the
complexity-4 score, and **it must be its own story with AC 4 reworded.** Recorded here so the
choice is visible rather than assumed.

**AC 9 — the criterion cannot be satisfied by the command it names. Fix and reword, both.**
`package.json:33` defines `check:stripe` as `--mode=test` only; live mode is a separate script,
`check:stripe:live` (`:34`), needing `STRIPE_SECRET_KEY_LIVE` and `*_PRICE_ID_LIVE` values that
`sync-stripe-catalogue.mjs:186-193` refuses to run without. One command cannot cover both modes.

- **Fix the script** (Task 4) for the *vacuity* half: it iterates its own `PRICE_ENV` literal
  (`:214`), not the catalogue, so a plan seeded and env-configured but missing from that literal
  is never inspected and the check exits 0 with *"Stripe matches the catalogue."* That is a real
  defect and it is what would let AC 9 pass while the Agency price is entirely unverified.
- **Reword the criterion** for the *mode* half, because no script change fixes it without
  merging two commands that require mutually exclusive API keys. New wording:
  *"`npm run check:stripe` passes against the new plan in CI, and `npm run check:stripe:live` is
  run by the operator against the live account and recorded on the deployment checklist before
  the Agency price is offered to a customer."*

## Tasks (ordered)

- [ ] **T1 — Migration: seed the `agency` row and widen the `billing_subscriptions` CHECK, in one file.**
  New `supabase/migrations/<YYYYMMDDHHMMSS>_agency_plan.sql`. Two statements, one file, because
  they must land in one deploy (see *The point everything turns on*):
  (a) `INSERT INTO plans (…) VALUES ('agency', 'subscription', …) ON CONFLICT (id) DO UPDATE SET …`
  following the exact shape of `20260802000000_plans_catalog.sql:257-320` — every column updated
  **except** `stripe_*_price_id_*`, so an operator override survives a replay;
  (b) `ALTER TABLE billing_subscriptions DROP CONSTRAINT billing_subscriptions_plan_valid;`
  then re-add it as `CHECK (plan = ANY (ARRAY['starter','pro','agency']))`.
  The `limits` jsonb must carry **all six** keys (`websites`, `collaborators`, `ai_features`,
  `translations`, `ab_testing`, `monthly_credits`) or `plans_subscription_limits_complete`
  (`20260802000000:125-135`) rejects the insert and the migration itself fails — which is the
  correct outcome, not a bug to work around. Header comment records T2 and the Starter incident
  (`20260802020000_plan_constraint_and_credit_collapse.sql:6-17`). **No new table**, so no new
  RLS policy is required — say so explicitly in the header so a reviewer does not read the
  absence as an omission (ADR 002 / non-negotiable 6).
  *Fails a test when:* the CHECK still rejects `plan='agency'`; the CHECK stops rejecting an
  unknown id; the seeded `limits` is missing a key; `loadPlanCatalogue` does not return an
  active `agency` row.

- [ ] **T2 — Widen `PaidPlanId` / `PAID_PLAN_IDS`, add the `agency` entry to `PRICE_ID_ENV_VARS`.**
  `src/lib/stripe/plan-types.ts:29,33` and `src/lib/stripe/plans.ts:66-99`. The
  `satisfies Record<PaidPlanId | OneTimeProductId, …>` clause makes the second a **compile
  error** until `agency` is added — the one duplication the type system does catch. Then
  `npm run type-check` enumerates every remaining call site for free. Env var names:
  `STRIPE_AGENCY_PRICE_ID` / `_LIVE`, `STRIPE_AGENCY_YEARLY_PRICE_ID` / `_LIVE`.
  *Fails a test when:* `type-check` fails; `isPaidPlanId("agency")` is false; `PAID_PLAN_IDS`
  does not have exactly three members; `resolveStripePriceId("agency", "monthly")` does not
  throw with the exact env var name when the var is unset.

- [ ] **T3 — `PLAN_RANK` in `DashboardNavigation.tsx:72-75`.**
  `Record<PaidPlanId, number>` — a compile error until `agency` is present. Rank **3**, above
  `pro` (2), so the nav does not offer an Agency account an "upgrade" that is a downgrade.
  *Fails a test when:* `type-check` fails; a test asserting `PLAN_RANK.agency > PLAN_RANK.pro`
  fails; a nav test asserting an Agency account is shown no upgrade CTA fails.

- [ ] **T4 — Add `agency` to `PRICE_ENV` in `scripts/sync-stripe-catalogue.mjs:53-68`, and write the parity test the script's own comment already claims exists.**
  This is research **T1, the most dangerous thing in the blast radius**. `:51` says the two maps
  are *"checked against each other by `scripts/__tests__`"* — **that directory does not exist**,
  and `jest.config.js` collects only from `src/`. Nothing enforces parity today.
  New `src/lib/stripe/__tests__/price-env-parity.test.ts`: read `scripts/sync-stripe-catalogue.mjs`
  as text via `fs.readFileSync` and assert that every plan id in `PRICE_ID_ENV_VARS`, and every
  env var name inside it, appears in the script's `PRICE_ENV` literal. Comment the test with the
  incident it prevents.
  *Rejected alternative — make `check:stripe` iterate the `plans` catalogue instead of its own
  literal.* It is the deeper fix, but it changes the script's failure semantics for the
  `one_time` kinds (`credits`, `lifetime_pro`) and would fail on any future subscription row
  that intentionally has no Stripe price. Larger blast radius than this story earns; record it
  as a follow-up, do not do it here.
  *Rejected alternative — extract a shared `price-env` module.* `plans.ts` is server-only (it
  opens a Supabase client on import) and the `.mjs` cannot import a `.ts` file under plain node.
  Not worth a build-config change inside a billing story.
  *Fails a test when:* `agency` is in `PRICE_ID_ENV_VARS` but absent from `PRICE_ENV` — i.e. the
  test must be written so that deleting the `PRICE_ENV` entry turns it red.

- [ ] **T5 — AC 6: the downgrade guard, before the Stripe call.**
  Export `countOwnedSites` from `src/lib/feature-gating/permissions.ts:79` (currently
  module-private) and insert the guard in `src/lib/stripe/subscription.ts` **between
  `resolveStripePriceId` (`:127`) and `stripe.subscriptions.update` (`:142`)**. Rules:
  `limits.websites === -1` (`UNLIMITED`) is always allowed; the count comes from
  `site_permissions` where `permission = 'admin'`, **never** `sites.user_id`; a count that
  cannot be read **throws** rather than defaulting to 0. The error message names the target
  plan, its limit, the current count and the exact number to remove — the same sentence the
  client-side guard shows (T7), so the customer never sees a vaguer version of the truth
  depending on which check caught it.
  *Fails a test when:* 8 sites → Starter (limit 1) does not throw, or throws without "remove 7";
  `stripe.subscriptions.update` **is called** on a refused downgrade; an unlimited target plan is
  refused; a failing count is swallowed and the change proceeds.

- [ ] **T6 — AC 3/4 surfaces: the site-count meter and the two-state registration modal.**
  Per `docs/designs/s13-agency-plan.md` § States. Meter on `src/app/dashboard/sites/page.tsx`,
  composed from `Metric` (`label="Sites"`, `value="{used} / {limit}"`, `.text-metric .tabular`)
  plus an adjacent `StatusBadge` carrying the state signal — the bar fill stays `bg-primary` at
  all times, because tone triplets have no solid/fill value (design gap #2, recorded, not filled
  here). Four states: normal / at-limit (`warning`, *not* danger — nothing has failed) /
  over-limit-with-offer (`info`) / over-limit-no-offer (`danger`). `SiteRegistrationModal.tsx`
  splits today's single generic destructive `Alert` into `warning` + priced submit label when
  `additionalSitePrice` is set, and `destructive` + disabled submit + "Upgrade plan" when it is
  not — **no price is shown when none exists**, which is what the no-fallback rule prohibits.
  *Fails a test when:* any of the four meter states renders the wrong tone/badge; the modal
  renders `destructive` for a plan with `additionalSitePrice` set, or renders a price for one
  without; the meter shows a hardcoded limit rather than `plan.limits.websites`.

- [ ] **T7 — `UpgradeDialog` pre-flight downgrade guard (client half of AC 6).**
  Thread the account's current site count into `src/components/billing/UpgradeDialog.tsx` as a
  prop — it already reaches `BillingDashboard` via `dashboardData.currentUsage.websites` for
  `UsageCard`, so this is wiring, not new data. Selecting a plan whose `limits.websites` is below
  the count replaces that card's feature list with `Alert variant="warning"` (a **guard**, never
  `destructive` — nothing has been attempted) and swaps the submit for `Remove sites first`
  linking to `/dashboard/sites`. The server-side refusal (T5) renders the **same sentence** in
  the existing error slot (`UpgradeDialog.tsx:157-161`), never the generic "Failed to change plan".
  *Fails a test when:* selecting Starter with 8 sites does not render the warning; the dialog
  still calls the plan-change endpoint while refused; the two messages differ in wording;
  the guard renders `destructive`.

- [ ] **T8 — AC 2: `PLAN_META` entry for `agency` in `src/app/api/pricing/route.ts:67-74`.**
  Unknown ids already fall through to `DEFAULT_META` (`:153`) and render with no badge and
  "Get started", so the feed does not break without this — it just renders Agency anonymously.
  Add the badge/CTA. `readStripeAmounts` returns `{}` for anything failing `isPaidPlanId`
  (`:92-94`), which T2 has already fixed. **No fallback catalogue is added** — see interdicts.
  *Fails a test when:* the feed omits Agency; Agency renders `DEFAULT_META`; a simulated database
  failure serves a literal amount instead of the last in-process cache (`:243-247`) or 503
  (`:249-253`).

- [ ] **T9 — AC 5 regression test: upgrade Pro → Agency preserves sites, content and grants.**
  Assertion, not implementation (research T5): nothing in `updateSubscription` touches `sites`,
  `content_elements` or `site_permissions`. The value is entirely in the test.
  *Fails a test when:* a Pro→Agency change touches any of those three tables; the Stripe call
  omits `proration_behavior: "always_invoice"`; the `billing_subscriptions` write is not keyed on
  both row id and `user_id` (`subscription.ts:165-183` — a silent zero-row UPDATE once threw
  *after* Stripe had invoiced the proration).

- [ ] **T10 — Env vars, operations docs, and the AC 9 rewording.**
  `.env.example`: add `STRIPE_AGENCY_PRICE_ID` / `_LIVE` and `STRIPE_AGENCY_YEARLY_PRICE_ID` /
  `_LIVE` beside the Pro block, and **delete the retired `STRIPE_ENTERPRISE_*` at `:72-77`** —
  no such plan exists in the catalogue and leaving it invites someone to configure it.
  Update `docs/operations/stripe-setup.md`, `docs/operations/deployment-checklist.md:29-31`
  (add the `check:stripe:live` operator step), `docs/operations/deployment-env.md`. Set the vars
  in Vercel **test and live**. Amend AC 9 in `docs/stories.md` to the wording given above.
  *Fails a test when:* `npm run check:stripe` reports a missing env var (blocker, exit 1); a
  deployment-checklist grep for `STRIPE_AGENCY_` finds nothing; `.env.example` still lists
  `STRIPE_ENTERPRISE_*`.

## Run interdicts

1. **Never add a hardcoded fallback catalogue, in any file, on any surface.** AGENTS.md
   non-negotiable 7 and the header of `src/app/api/pricing/route.ts:18-23`: a previous fallback
   *"meant a database outage served stale prices to customers with no indication anything was
   wrong — and it was that duplicate copy that had silently drifted from the real plan config in
   the first place."* The temptation in this story is to add `agency` to some client-side default
   so the pricing page renders before the seed lands. **Do not.** A `/api/pricing` failure must
   hide the Agency card exactly as it already hides every other paid plan.
2. **Never edit an applied migration.** Specifically never touch
   `20260803000000_retire_free_plan.sql`. Non-negotiable 5; the CHECK is widened by a new
   forward-only file.
3. **Never count sites via `sites.user_id`.** `sites` has no owner column. That filter returned a
   PostgREST 42703 that was discarded with the count, so every quota check saw 0 sites and passed
   unconditionally (`permissions.ts:71-77`). Ownership is an `admin` row in `site_permissions`.
   A count that cannot be read must throw, never read as "plenty of room".
4. **Never place the downgrade guard after `stripe.subscriptions.update`.**
   `proration_behavior: "always_invoice"` (`subscription.ts:146`) bills or credits immediately; a
   guard downstream would have to reverse a completed invoice.
5. **Never ship `agency` in `PAID_PLAN_IDS` without the seed migration in the same deploy.**
   `loadPlanCatalogue:290-297` throws when any `PAID_PLAN_IDS` member has no active row, and it
   sits behind every pricing render, every checkout and every feature gate — in every
   environment, at once.
6. **No zod.** ADR 003. Any new input validation uses `src/lib/api/validation.ts`
   (`ValidationResult<T>`, `readJsonObject`, `requireString`, `requireEnum`, …) and extends it
   there.
7. **Do not invent a UI primitive.** Compose from the seventeen in `src/components/ui/`
   (`alert` `avatar` `badge` `button` `card` `content-value` `dialog` `dropdown-menu`
   `empty-state` `icon-tile` `input` `label` `metric` `page-header` `skeleton` `status-badge`
   `tabs`). Do not add a `tone-*-solid` token for the meter fill — the design resolves that by
   moving the state signal to `StatusBadge`.
8. **Do not add a second checkout or credit-spend path.** Checkout is serialized
   (`src/lib/billing/checkout-reservation.ts`, `user-lock.ts`) and credit spend is
   compare-and-swap (commit `aca2eb2`). A new plan flows through the existing path.
9. **Do not lower the coverage thresholds in `jest.config.js`.** They are a ratchet, not a
   target (AGENTS.md § Tests).
10. **Do not touch `src/app/dashboard/teams/page.tsx:149`** (`data.planId !== "pro"`, which would
    lock an Agency account out of the page). Teams is graveyard (`prd.md:136-138`) and belongs to
    `s04-retire-graveyard-surfaces`. Leave it; record it in the PR description so it is not lost.
11. **Do not "simplify" any of the tombstone comments** in `permissions.ts`, `subscription.ts`,
    `plans.ts` or `api/pricing/route.ts`. They are the only thing stopping the fix from being
    refactored back into the bug (AGENTS.md § Comments). Add one of your own to the migration.

## The point everything turns on

**The migration and the code are one deploy, migration first, or the product is down and the
customer has paid for nothing.** Two failure modes, opposite directions, both already survived:

- **Code ahead of schema → total outage.** Widening `PAID_PLAN_IDS` (T2) without the seeded row
  (T1) makes `loadPlanCatalogue` throw *"The plans table is missing active row(s)"*
  (`plans.ts:290-297`). `getPlanCatalogue` is behind **every pricing render, every checkout and
  every feature gate**, so this takes the whole billing surface down in every environment at
  once. This is the exact inversion `20260803000000:5-11` was written to prevent.
- **Schema ahead of code, or CHECK left un-widened → charged and unsubscribed.**
  `billing_subscriptions_plan_valid` is `('starter','pro')`
  (`20260803000000_retire_free_plan.sql:56-57`). The Stripe webhook writes
  `plan: subscription.metadata?.plan_id || "pro"` (`api/webhooks/stripe/route.ts:385`, `:417`).
  An Agency checkout then produces `plan='agency'` → Postgres 23514 → `assertWritten` throws →
  500 → **Stripe retries forever, card already charged on the first attempt, subscription row
  never written, customer on nothing.** This is not hypothetical: it is verbatim what happened
  to Starter, recorded at `20260802020000_plan_constraint_and_credit_collapse.sql:6-17`.

So: T1 carries both the seed and the CHECK in **one file**; the branch is **one commit** (AGENTS
allows a second only for the migration, which is exactly the case here); and the migration is
applied before the code is promoted. Nothing else in this story can hurt a customer's money.

## Files touched

**New**
- `supabase/migrations/<YYYYMMDDHHMMSS>_agency_plan.sql` — seed + CHECK widening (T1)
- `src/lib/stripe/__tests__/price-env-parity.test.ts` (T4)
- `src/lib/stripe/__tests__/plans-agency.test.ts` (T2, T9)
- `src/lib/feature-gating/__tests__/permissions.test.ts` — directory does not exist yet (T5)
- `src/app/api/pricing/__tests__/route.test.ts` — directory does not exist yet (T8)
- `src/components/billing/__tests__/UpgradeDialog.test.tsx` (T7)
- `src/app/dashboard/sites/__tests__/site-count-meter.test.tsx` — `__tests__/` exists (T6)

**Modified**
- `src/lib/stripe/plan-types.ts:29,33` — `PaidPlanId`, `PAID_PLAN_IDS` (T2)
- `src/lib/stripe/plans.ts:66-99` — `PRICE_ID_ENV_VARS` (T2)
- `src/lib/stripe/subscription.ts:126-142` — downgrade guard insertion point (T5)
- `src/lib/feature-gating/permissions.ts:79` — export `countOwnedSites` (T5)
- `src/components/dashboard/DashboardNavigation.tsx:72-75` — `PLAN_RANK` (T3)
- `src/components/dashboard/SiteRegistrationModal.tsx` — offer vs refusal split (T6)
- `src/app/dashboard/sites/page.tsx` — site-count meter (T6)
- `src/components/billing/UpgradeDialog.tsx` — pre-flight guard, shared message (T7)
- `src/components/billing/BillingDashboard.tsx` — thread `currentUsage.websites` through (T7)
- `src/app/api/pricing/route.ts:67-74` — `PLAN_META` (T8)
- `scripts/sync-stripe-catalogue.mjs:53-68` — `PRICE_ENV` (T4)
- `.env.example:72-77` — add `STRIPE_AGENCY_*`, delete `STRIPE_ENTERPRISE_*` (T10)
- `docs/operations/stripe-setup.md`, `deployment-checklist.md:29-31`, `deployment-env.md` (T10)
- `docs/stories.md` — AC 9 rewording (T10)

**Deliberately untouched**
- `src/lib/billing/effective-plan.ts`, `entitlements.ts` — resolve by plan **id string** against
  the catalogue, so a new row flows through unchanged. `RETIRED_PLAN_IDS` stays `['free']`.
- `src/components/billing/InvoiceHistoryCard.tsx` — AC 7 is satisfied by doing nothing under
  answer A; an Agency subscription produces one more row of the existing shape.
- `src/app/dashboard/teams/page.tsx` — graveyard, `s04`'s.
- Anything in `src/lib/security/site-auth.ts` or `src/lib/sites/embed-script.ts` — that is `s20`.

## Test strategy

**Unit (jest), the bulk of the value**
- Catalogue: `agency` loads, has six limit keys, `isPaidPlanId` accepts it, `resolveStripePriceId`
  throws with the exact env var name when unconfigured, `clearPlanCatalogueCache` used between
  cases (5-minute TTL, `plans.ts:37`).
- Downgrade guard: refusal names the right number; unlimited passes; a failing count throws;
  **`stripe.subscriptions.update` is asserted not-called on refusal** — this is the assertion
  that proves "before the Stripe call".
- `PRICE_ENV` parity — the test that closes research T1. Must be written so that deleting the
  `agency` entry from the `.mjs` turns it red.
- AC 5 as a negative assertion: no writes to `sites`, `content_elements`, `site_permissions`.

**Component (Testing Library)**
- Meter: four states → correct `StatusBadge` tone and hint. Limit read from the plan, never a
  literal.
- `SiteRegistrationModal`: offer-configured → `warning` + priced label; not configured →
  `destructive` + disabled + upgrade CTA, and **no price rendered**.
- `UpgradeDialog`: pre-flight refusal renders, endpoint not called, message identical to the
  server's.

**Route**
- `/api/pricing` includes Agency with `source: "database"`; a simulated DB failure yields the
  cached response or 503, never a literal amount.

**Script**
- `npm run check:stripe` must exit 0 **and** must be shown to exit 1 when the `agency` env var is
  unset — a green run alone proves nothing (research T1).

**What cannot be tested here, and must be an operator step**
- `npm run check:stripe:live`. It needs `STRIPE_SECRET_KEY_LIVE` and live price ids present where
  it runs; `sync-stripe-catalogue.mjs:186-193` refuses a key whose prefix does not match the
  mode. CI does not hold that key. This is why AC 9 is reworded in T10 rather than automated.

**Not modified:** existing tests. If one must change, change the behaviour instead, or change the
test **and say so in the PR** (AGENTS.md § Tests).

## Definition of Done

- [ ] **PRD open decision 7 answered in writing, and the answer is A.** If B, this plan is closed
      unexecuted and the story is re-scored and re-planned. Frontmatter stays `validated: no`
      until this line is satisfiable.
- [ ] The Agency numbers (research Q3) are recorded before any Stripe price is created — amounts
      are immutable.
- [ ] AC 1, 2, 3, 4 (as (a)), 5, 6, 7 and the reworded 9 each map to a passing test named in the
      PR description. AC 8 is explicitly out of scope, delegated to `s20`.
- [ ] `npm run lint`, `type-check`, `format:check`, `build`, `test` all green. CI additionally
      green on `audit:prod` and `type-check:build`.
- [ ] Coverage thresholds unchanged or raised, never lowered.
- [ ] Migration applied before the code is promoted, in every environment. `plan='agency'`
      verified accepted by `billing_subscriptions` in staging **before** a live Agency price is
      offered to anyone.
- [ ] `npm run check:stripe` green in CI; `npm run check:stripe:live` run by the operator and its
      output recorded on `docs/operations/deployment-checklist.md`.
- [ ] `STRIPE_AGENCY_*` set in Vercel test **and** live.
- [ ] No hardcoded fallback catalogue anywhere in the diff — reviewer greps for one.
- [ ] Single PR, `git diff main...feature/s13-agency-plan` readable, structured description
      listing the deploy order and naming the `teams/page.tsx:149` follow-up.
- [ ] `/ks-review` passed with no open critical (`docs/reviews/s13-agency-plan.md` ending
      `Ship allowed: yes`).
- [ ] No ADR required under answer A — the decisions here are recorded in this plan and in the
      migration header. Under answer B an ADR is mandatory and this plan does not apply.
