# Research — Story s45-lifetime-ai-credits

Operator decision 2026-09-26: the lifetime Founding Agency ($299, 50 spots) confers everything
Agency confers **except** the monthly AI-credit allowance, which is 250 instead of 1,000. Credit
packs stay purchasable. Agency subscribers are unchanged. The $299 price, the 50-spot cap and the
Stripe price are unchanged. Base: `origin/main` `2376209`.

## The five structuring facts

1. A lifetime Founding Agency buyer is stored as `plan_entitlements.plan_id = 'agency'` — the
   plan id is **hard-coded in the database function**, not read from `grants_plan_id`
   (`supabase/migrations/20260925110000_enforce_one_founding_lifetime_per_account.sql:98-102`),
   and the resolver then hands them the full `agency` catalogue row, 1,000 credits included
   (`src/lib/billing/effective-plan.ts:344-363` → `src/lib/stripe/plans.ts:488-496` →
   `src/lib/credits/system.ts:142-143`).
2. The plan id `'agency'` is an identity contract in ~15 places — DB functions
   (`20260924065000_…sql:144-151` "owned", `20260925110000_…sql:98-102` grant), the webhook guard
   (`src/app/api/webhooks/stripe/route.ts:797-803`), checkout eligibility
   (`src/app/api/billing/checkout/route.ts:582-603`), the offer card
   (`src/components/billing/LifetimeOfferCard.tsx:84-88`), nav ranks
   (`src/components/dashboard/DashboardNavigation.tsx:67-71`), the entitlement summary
   (`src/app/api/billing/entitlement/route.ts:111-121`), `PaidPlanId` (`plan-types.ts:29-38`) —
   so a new plan id has to be threaded through all of them; a limits override touches none.
3. Every feature gate and the credit allowance read **limits only**, never the plan id:
   `permissions.ts:153,326,408,445,572`, `subscription.ts:574-592`,
   `ab-tests/generate/route.ts:70-86`, `credits/system.ts:142-143`. Changing one limit on the
   entitlement's plan object changes exactly the allowance and nothing else.
4. A new catalogue plan id is an **outage hazard** during a rolling deploy: the deployed loader
   throws on a one-time row whose `grants_plan_id` is not a known `SubscriptionPlanId`
   (`plans.ts:333-340`), and a throw in `loadPlanCatalogue` takes down pricing, checkout and every
   gate at once (ADR 014 context; ADR 029 consequences). The one-time row's `limits` column, by
   contrast, is never read for `lifetime_*` rows by the deployed code (`plans.ts:327-350`; only
   the `credits` row's limits are read, `plans.ts:401-425`).
5. "Bought the founding lifetime" already has a database definition: a live `agency` grant that
   carries a Stripe payment intent (`reserve_founding_agency_spot`, `20260924065000_…sql:144-151`).
   Comps and trials carry none (`entitlements.ts:98-123` writes the PI; trial rows never do,
   ADR 014).

## Target story

A lifetime Founding Agency owner gets every Agency capability (10 websites, unlimited
collaborators and translations, AI features, A/B testing, $4 extra sites, Agency nav) and a
monthly AI-credit allowance of 250. Purchased credit packs stack on top as today.

Acceptance criteria (operator-prevalidated, 2026-09-26):

- Entitlement resolution for a lifetime Founding Agency purchase yields plan `agency` with every
  Agency limit and `monthlyCredits = 250`; the credit balance shows 250 included.
- An Agency subscriber still gets 1,000; so does a lifetime buyer while an Agency subscription
  they already paid for runs out its period (the offer card promises they keep that period,
  `LifetimeOfferCard.tsx:178-186`). A support comp of Agency (no payment) keeps 1,000.
- ADR 029 precedence is kept: the purchased Agency grant still outranks a newer Pro trial/grant.
- The lifetime offer states "Everything in Agency, with 250 AI credits a month" wherever it is
  presented: landing Pricing card, billing LifetimeOfferCard, UpgradeDialog, /compare pages
  (their FAQ/JSON-LD does not mention the offer — verified below), Stripe Checkout product text.
- No new catalogue row is added, so `/api/pricing` lists exactly what it lists today.
- Idempotent forward migration; no applied migration edited; price, cap, Stripe price unchanged.

## Current state of the code

**How a plan resolves.**
`resolveEntitlement` (`effective-plan.ts:344-363`) asks `readEffectivePlanId`
(`effective-plan.ts:256-332`) for an id, then `findPlanById` (`plans.ts:488-496`) for the
catalogue row, which comes from the active `plans` rows (`plans.ts:358-427`, `.eq("is_active",
true)` at `:364`). `readEffectivePlanId` selects `plan_id` only (`:260-279`), with the s01/ADR 014
expiry predicate in the query; Agency wins over anything (`:294-305` grant, `:322-327`
subscription); otherwise newest recognised grant, else the live subscription (`:329-331`).
`grants_plan_id` is consulted only at checkout/webhook time (`checkout.ts:204-220,362-372`;
webhook `route.ts:764-816`) — never at resolution time.

**Monthly allowance (s28).** `getUserCreditBalance` (`credits/system.ts:120-215`) takes
`entitlement.plan.limits.monthlyCredits` (`:142-143`); the window is the live subscription's
period, else an active trial's `granted_at`, else the calendar month (`:190-198`, `:225-231`).
A lifetime owner with no subscription therefore resets on the 1st. The widget path passes an
explicit payer client (`:139-141`, ADR 035) through the same `resolveEntitlement`.

**The rows (production, per operator; seed `20260924065000_…sql:31-68`).** `agency`:
subscription, $49, limits.monthly_credits 1000. `lifetime_agency`: one_time, $299,
`grants_plan_id 'agency'`, `limits {}`, features `["Everything in Agency", "One payment, no
renewal", "Founding offer limited to 50 completed sales"]`, description "Pay once for permanent
Agency access; limited to the first 50 completed sales". The local dev database
(`supabase_db_recopyfast`) holds the same values. Production reservations: 0 completed,
2 released — nobody owns the lifetime yet.

**Schema.** `plans.limits` on one-time rows is "whatever keys the product needs"
(`20260802000000_plans_catalog.sql:75-79`); `plans_subscription_limits_complete` binds only
`kind='subscription'` (`:120-133`); `plans_only_one_time_grants` (`:148-156`).
`plan_entitlements` has `stripe_payment_intent_id TEXT UNIQUE` (`:229`) and authenticated
SELECT on the whole table (`:260`), so the request-scoped middleware client can read it.

## Anchor points

- `src/lib/stripe/plan-types.ts` — `OneTimeProduct` (`:99-108`) gains the parsed overrides; a pure
  helper returns the plan as a purchase confers it (client-safe, reused by /compare).
- `src/lib/stripe/plans.ts` — `toOneTimeProduct` (`:327-350`) parses the overrides strictly
  (house rule: known rows fail closed, `:72-78`); `loadPlanCatalogue` (`:378-397`) refuses two
  active products granting the same plan; a `findPlanById` sibling for purchased holders.
- `src/lib/billing/effective-plan.ts` — `readEffectivePlanId` (`:256-332`) also reports whether
  the plan is held by purchase only; `resolveEntitlement` (`:344-363`) picks the purchased view.
- `src/lib/compare/comparison-pricing.ts:62-71` + `src/components/compare/ComparisonPage.tsx:63-83`
  — the only offer copy built in code.
- New migration `supabase/migrations/20260926120000_lifetime_agency_monthly_credits.sql`.

## Verified APIs / functions

- `readEffectivePlanId(supabase: SupabaseClient, userId: string): Promise<string | null>` —
  `effective-plan.ts:256`; callers: `entitlements.ts:34-38` (`getEffectivePlanId`, used by tests
  only) and `resolveEntitlement` (`:348`).
- `resolveEntitlement(supabase, userId): Promise<Entitlement>` — `effective-plan.ts:344`; callers
  `middleware.ts:43`, `permissions.ts:91`, `credits/system.ts:140`, `billing/trial.ts:130`, and via
  `getEffectivePlan` (`entitlements.ts:56-58`) the dashboard, entitlement and ab-tests routes.
- `findPlanById(planId: string | null | undefined): Promise<SubscriptionPlan | null>` —
  `plans.ts:488`.
- `findSubscriptionPlan(catalogue, planId)` — `plan-types.ts:136-144` (pure, client-safe).
- `getPlanCatalogue(): Promise<PlanCatalogue>` — `plans.ts:429-446`, 5-min process cache.
- `loadComparisonPricing(): Promise<ComparisonPricing>` — `comparison-pricing.ts:31`.
- `getUserCreditBalance(userId, client?)` — `credits/system.ts:120`.
- `scripts/sync-stripe-catalogue.mjs` projects `plans.description` onto the Stripe product
  (`expectationsFor`, `:259-281`); it never reads `limits`.

## Traps & constraints

- **Design choice (answers the preferred design).** A new `agency_lifetime` plan row was
  evaluated and rejected: (a) the DB grant function and the "owned" check hard-code `'agency'`
  and would have to be restated by `CREATE OR REPLACE` (two 60–100-line money functions);
  (b) the webhook guard, checkout eligibility, offer card, nav rank, entitlement summary, pricing
  filter, UpgradeDialog (`isPaidPlanId` filter, `UpgradeDialog.tsx:64`) and `PaidPlanId` /
  `PRICE_ID_ENV_VARS` (`plans.ts:130-179`, `satisfies Record<PaidPlanId|…>`) would each need the
  new id, and a missed one either locks the owner out of Agency nav (`entitlement/route.ts:111`
  → `planId: null` → `DashboardNavigation.tsx:124-129` denies plan-gated items) or sells the
  hidden plan; (c) repointing `lifetime_agency.grants_plan_id` before the code deploys makes the
  deployed loader throw (`plans.ts:333-340`) — a site-wide billing outage; (d) the hidden row
  would need `is_active = true` to resolve (`plans.ts:364`) yet be filtered from four sales
  surfaces. **Chosen: an override on the `lifetime_agency` row's own `limits`**
  (`{"monthly_credits": 250}`), applied only when the plan is held by purchase alone. No plan
  id, no DB function, no Stripe metadata changes; `plans` stays the source of truth and the
  number 250 exists only in the migration. Recorded as ADR 038.
- **Deploy order.** Both orders are safe. Old code + new row: the lifetime row's `limits` is not
  read (`plans.ts:327-350`), buyers keep 1,000 (over-delivery, no buyer exists) while the copy
  already says 250. New code + old row: `limits {}` → no override → 1,000, copy still
  "Everything in Agency" — consistent. **Recommended: deploy the code, then apply the
  migration**, so copy and enforcement switch together (≤ 5 min catalogue cache, `plans.ts:39`;
  `/api/pricing` cache, `pricing/route.ts:27`).
- **Stripe product text.** The migration changes the `lifetime_agency` description, which
  `sync-stripe-catalogue.mjs` projects onto the live Stripe product. `npm run check:stripe:live`
  will report description drift until the operator runs `npm run sync:stripe:live` (product
  description patch only — no price is created or changed). Not run here (no network to Stripe).
- **Keep the row active.** The loader reads active rows only; deactivating `lifetime_agency`
  would drop the override and silently restore 1,000 to every owner. Sales are withdrawn with
  `AGENCY_CHECKOUT_ENABLED=false` or the cap (ADR 029), never `is_active`. Stated in the
  migration and the ADR.
- **Overlap window.** An Agency subscriber who buys the lifetime keeps the subscription until
  period end (`webhooks/stripe/route.ts:923-1000`, `cancel_at_period_end`). Today the agency
  grant short-circuits before the subscription read (`effective-plan.ts:298-305`); the new rule
  must read the subscription for a purchase-only Agency grant, or that customer drops to 250
  mid-period. Cost: one extra indexed read for purchase-only Agency holders only.
- **Ambiguity.** "The product that grants plan X" must be unique, or the override is a
  first-match guess — the failure `findPaidPlanIdByStripePriceId` refuses (`plans.ts:655-689`).
  Production has one granting product per plan (`lifetime_pro→pro`, `lifetime_agency→agency`).
  The loader will refuse a second one (only reachable by repointing a known row: unknown ids are
  filtered first, `plans.ts:79-98`).
- **Strict parsing.** Unknown or mistyped override keys must throw at load, like every other
  known-row defect (`plans.ts:72-78`, ADR 029 "malformed rows still fail validation"). Use
  `Object.hasOwn` on the key table (`__proto__` from JSON is an own key).
- **Test mocks.** 16 suites mock `@/lib/stripe/plans` with a factory (list in the plan). Any
  that drive a *purchased* grant through `resolveEntitlement` will need the new export; rows
  without `stripe_payment_intent_id` stay on `findPlanById`.
- **Existing assertions that change.** `comparison-pricing.test.ts:76-107` pins the `founding`
  object with `toEqual`; `comparison-pages.test.tsx:171-180,545-557` builds `ComparisonPricing`
  literals. Both gain the allowance field (declared). The /compare regexes
  (`comparison-pages.test.tsx:383,540`) use `.*` between segments and stay valid.
- **Playwright.** `e2e/landing.spec.ts:40-78` asserts names and prices only; the count contract
  stays 44 (`src/__tests__/e2e/strict-run-contract.test.ts:16`). No catalogue count contract
  exists; no row is added, so none moves.
- **Not in scope, found:** the billing page's SubscriptionCard lists the catalogue plan's
  features for a lifetime owner (`SubscriptionCard.tsx:150-168`), i.e. "1,000 AI credits /
  month", beside the already-wrong "$49/month" (`:123-126`) every lifetime owner sees today. The
  credit balance shown is correct (server-computed). "No other pricing copy changes" — logged as
  a follow-up, not fixed.

## Open questions

None blocking. Settled for the plan: the purchase marker is `stripe_payment_intent_id IS NOT
NULL` (same predicate as the DB "owned" check), not `source`; the override type covers the six
plan-limit keys (strictly parsed) but only `monthly_credits` is used.

/compare FAQ/JSON-LD verified: `ComparisonPage.tsx:19-31` builds FAQPage from
`comparison.faqs`, and `src/lib/compare/comparisons.ts` contains no lifetime/founding/price
mention (`grep -n -i "lifetime\|founding\|299"` → none). Only `pricingCopy` presents the offer.

## Real complexity

Not scored in `docs/stories.md` (operator-prevalidated). Verdict **3**: one data migration, one
resolver rule with a precedence subtlety (the overlap window), a strictly parsed catalogue
extension and one copy builder. A plan-row design would have been a 5.
