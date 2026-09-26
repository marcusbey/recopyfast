-- s45 — the lifetime Founding Agency includes 250 AI credits a month.
--
-- Operator decision 2026-09-26: a lifetime Founding Agency owner keeps
-- everything the Agency plan confers except the monthly AI-credit allowance,
-- which is 250 instead of Agency's 1,000. Credit packs stay purchasable. The
-- $299 price, the 50-sale cap, grants_plan_id = 'agency' and the Stripe price
-- are unchanged, and Agency subscribers keep their 1,000.
--
-- HOW: `limits` on a one-time row that grants a plan now holds overrides of
-- the granted plan's limits (ADR 038). They apply to an account that holds the
-- plan through a purchase only — every live grant of it carries a Stripe
-- payment intent, the same predicate reserve_founding_agency_spot uses for
-- "owns the founding lifetime" — and no live subscription bills that plan.
-- Parsed strictly in src/lib/stripe/plans.ts; applied in
-- src/lib/billing/effective-plan.ts. The number lives here and nowhere else.
--
-- WHY NOT A NEW `agency_lifetime` PLAN ROW: the founding grant function
-- writes plan_id 'agency' literally, and 'agency' is the identity the webhook
-- guard, checkout eligibility, offer card, dashboard nav and entitlement
-- summary all compare against. A new id has to reach every one of them, and
-- repointing grants_plan_id before the code deploys makes the running loader
-- throw on an unknown grant target — pricing, checkout and every feature gate
-- down at once. The deployed loader never reads `limits` on this row, so this
-- UPDATE is inert until the code that reads it ships.
--
-- DEPLOY ORDER: either order is safe. Old code + this row: the override is
-- ignored (owners get 1,000; none exist yet). New code + the old row: `{}`
-- overrides nothing. Recommended: deploy the code, then apply this, so the
-- copy and the allowance switch together.
--
-- KEEP THIS ROW ACTIVE for as long as anyone holds the grant. The catalogue
-- loads active rows only, so `is_active = FALSE` would drop the override and
-- silently restore 1,000 credits to every lifetime owner. Withdraw the offer
-- with AGENCY_CHECKOUT_ENABLED=false or the founding cap (ADR 029), never here.
--
-- STRIPE: `description` is projected onto the live Stripe product by
-- scripts/sync-stripe-catalogue.mjs, so after applying this the operator runs
-- `npm run check:stripe:live` (reports the description drift) and then
-- `npm run sync:stripe:live` (patches the product text; no price is created or
-- changed).
--
-- Idempotent: fixed values, safe to replay.

UPDATE public.plans
SET limits = '{"monthly_credits": 250}'::jsonb,
    description = 'Pay once for permanent Agency access with 250 AI credits a month; limited to the first 50 completed sales',
    features = '["Everything in Agency, with 250 AI credits a month", "One payment, no renewal", "Founding offer limited to 50 completed sales"]'::jsonb,
    updated_at = NOW()
WHERE id = 'lifetime_agency';
