-- s50 — the plans catalogue says only what the product does.
--
-- Operator decision 2026-09-28, from the launch-kit fact check: every claim on
-- the homepage is true on production today, or it goes. The pricing cards, the
-- billing screens and the Stripe products render these rows, and they
-- advertised features with no customer surface and support with no channel.
-- Research IDs are docs/research/s50-homepage-truth.md's inventory:
--
--   starter       C1 "instant copy testing" (no such feature), C3 "Basic
--                 version history" (no plan gate on versions), C4 "Community
--                 support" (no community exists).
--   pro           C1, C3 "Full version history", C5 "AI A/B copy testing" (the
--                 A/B page is unrouted and its cron unscheduled), C6 "Priority
--                 support" (no support tier exists).
--   agency        C6 "Agency support" and "Priority support + onboarding call".
--   credits       C9 "suggestions, translations and A/B copy generation":
--                 translation and A/B have no customer surface.
--   lifetime_pro  C12 "unlimited translations, A/B testing", C13 "Includes all
--                 future Pro features" (a promise about the future; owner:
--                 remove). "Every Pro feature forever" stays: it means the
--                 features Pro has today.
--
-- Support is "Email support" on every subscription plan (owner), answered at
-- support@recopyfa.st. Pro's description is not written: "all features" is
-- true once its bullets are. Credits' bullets are not written: both are true.
--
-- NOT TOUCHED: `limits` still carries the `ab_testing` and `translations`
-- flags. They are not copy, and s50 changes no limit, price or grant. The
-- `free` and `lifetime_agency` rows are not named.
--
-- KEEP THESE ROWS ACTIVE. The catalogue loads active rows only; setting
-- `is_active = FALSE` to hide a row drops it from checkout and from every
-- grant that points at it (see 20260926120000_lifetime_agency_monthly_credits).
--
-- STRIPE: `description` is projected onto the live Stripe product by
-- scripts/sync-stripe-catalogue.mjs. After applying this the operator runs
-- `npm run check:stripe:live` (reports the drift) and then
-- `npm run sync:stripe:live` (patches the product text; no price is created or
-- changed). Four product descriptions change: starter, agency, credits and
-- lifetime_pro. Until then Stripe Checkout shows the old text.
--
-- /api/pricing caches the catalogue in memory for 5 minutes, so the new copy
-- reaches the pricing cards within 5 minutes of this being applied.
--
-- DEPLOY ORDER: either order is safe; this changes copy only.
--
-- Idempotent: fixed values, safe to replay.

UPDATE public.plans
SET description = '1 website, click-to-edit, draft and publish',
    features = '["1 website", "Draft, then publish", "Click-to-edit interface", "Version snapshots and restore", "Email support"]'::jsonb,
    updated_at = NOW()
WHERE id = 'starter';

UPDATE public.plans
SET features = '["Up to 5 websites", "+$5 per additional website", "Draft, then publish", "Click-to-edit interface", "Version snapshots and restore", "Email support", "AI rewrite suggestions, 500 credits a month"]'::jsonb,
    updated_at = NOW()
WHERE id = 'pro';

UPDATE public.plans
SET description = '10 client websites, unlimited invited editors, email support',
    features = '["10 client websites", "+$4 per additional website", "Unlimited invited editors", "Everything in Pro", "1,000 AI credits / month", "Email support"]'::jsonb,
    updated_at = NOW()
WHERE id = 'agency';

UPDATE public.plans
SET description = '1,000 AI credits for AI rewrite suggestions',
    updated_at = NOW()
WHERE id = 'credits';

UPDATE public.plans
SET description = 'Pay once, keep every Pro feature forever — 5 websites and AI features. No recurring billing.',
    features = '["Everything in Pro", "One payment, no renewal"]'::jsonb,
    updated_at = NOW()
WHERE id = 'lifetime_pro';
