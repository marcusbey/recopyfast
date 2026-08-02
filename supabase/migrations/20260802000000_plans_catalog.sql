-- ========================================
-- Plan catalogue: prices, limits and feature lists move out of TypeScript
-- ========================================
-- Every price, seat limit and feature bullet the product sells lived in
-- src/lib/stripe/plans.ts as a frozen object literal. Changing $19 to $24, or
-- lifting Pro from 3 sites to 5, meant editing TypeScript, opening a PR and
-- shipping a build — and the same numbers were re-typed by hand in
-- src/components/sections/Pricing.tsx, where they had already drifted (the
-- landing page advertised "Up to 3 websites, +$6 per additional" while the
-- billing config granted 5 at +$5). This table makes the database the single
-- source of truth so both surfaces read the same row.
--
-- WHY ONE TABLE WITH A `kind` COLUMN INSTEAD OF A SIBLING TABLE
-- ------------------------------------------------------------
-- Subscriptions (free/starter/pro) and one-time products (credit packs,
-- Lifetime Pro) are different commercially but identical structurally: both are
-- a purchasable SKU with a name, a description, a price, a Stripe price id, a
-- feature list and an active flag. A sibling table would duplicate ten columns
-- and force every "what can this customer buy" query into a UNION.
--
-- The deciding factor is Lifetime Pro. It is a one-time purchase that grants a
-- subscription plan's entitlements, so it needs a foreign key onto the plan it
-- grants (`grants_plan_id` below). Within one table that is a self-reference
-- the database enforces; across two tables it is an unenforceable text column.
--
-- The cost of one table is that `price_yearly_monthly_equivalent` and the two
-- yearly price-id columns are meaningless for one-time rows. That is made
-- explicit by the plans_one_time_has_no_yearly_price CHECK rather than left to
-- convention.
--
-- WHY THE STRIPE PRICE ID COLUMNS EXIST BUT ARE SEEDED NULL
-- --------------------------------------------------------
-- The four stripe_*_price_id_* columns are present, but the seed leaves them
-- NULL and the loader falls back to STRIPE_*_PRICE_ID / _LIVE environment
-- variables. Environment is the right default home for these:
--
--   * A price id is scoped to one Stripe account. Every developer running
--     against their own Stripe test account, and every preview deployment,
--     needs a different value — a seeded row would be wrong for all of them,
--     and correcting it would mean editing the shared database.
--   * Test and live ids must never be swapped by accident. Selecting on
--     NODE_ENV in one place, next to the secret key that must match them, keeps
--     that decision in a single file.
--   * Rotating a price id is a deploy-time config change, not a schema change.
--
-- The columns are still worth having: populating one overrides the environment
-- for that plan, which lets an operator repoint a single price (a promo price,
-- a grandfathered tier) without a redeploy. Precedence is DB-then-env, and it
-- is applied in src/lib/stripe/plans.ts.
-- ========================================

-- ============================================================
-- 1. plans
-- ============================================================
CREATE TABLE IF NOT EXISTS plans (
  -- Text primary key, not a UUID: 'starter' / 'pro' are already the identifiers
  -- Stripe metadata, billing_subscriptions.plan and the API surface all carry.
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'subscription',
  name TEXT NOT NULL,
  description TEXT NOT NULL,

  -- For one-time products this is the single charge, not a recurring amount.
  price_monthly NUMERIC(10, 2) NOT NULL,
  -- Monthly-equivalent of the annual plan (annual total / 12), which is what
  -- the pricing UI displays. The amount actually charged once a year is
  -- derived from it, so the two can never disagree.
  price_yearly_monthly_equivalent NUMERIC(10, 2),

  stripe_price_id_test TEXT,
  stripe_price_id_live TEXT,
  stripe_yearly_price_id_test TEXT,
  stripe_yearly_price_id_live TEXT,

  -- Subscription rows: {websites, collaborators, ai_features, translations,
  -- ab_testing, monthly_credits}. -1 means unlimited, matching the gating code.
  -- One-time rows use whatever keys the product needs (a credit pack carries
  -- credits_per_pack / max_packs_per_purchase).
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Per-site overage beyond limits.websites. NULL means the plan sells no
  -- extra sites, which is not the same as $0.
  additional_site_price NUMERIC(10, 2),

  -- Set on one-time products that confer a subscription plan's entitlements
  -- permanently. Lifetime Pro -> 'pro'.
  grants_plan_id TEXT,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT plans_kind_valid
    CHECK (kind IN ('subscription', 'one_time')),
  CONSTRAINT plans_price_non_negative
    CHECK (price_monthly >= 0),
  CONSTRAINT plans_yearly_price_non_negative
    CHECK (price_yearly_monthly_equivalent IS NULL
           OR price_yearly_monthly_equivalent >= 0),
  CONSTRAINT plans_additional_site_price_non_negative
    CHECK (additional_site_price IS NULL OR additional_site_price >= 0),
  -- features is read straight into a string[] by the loader; anything else
  -- would surface as a render crash rather than a data error.
  CONSTRAINT plans_features_is_array
    CHECK (jsonb_typeof(features) = 'array'),
  CONSTRAINT plans_limits_is_object
    CHECK (jsonb_typeof(limits) = 'object'),
  -- A one-time charge has no billing cycle, so a yearly price on one of those
  -- rows is a data-entry mistake, not a discount.
  CONSTRAINT plans_one_time_has_no_yearly_price
    CHECK (
      kind <> 'one_time'
      OR (price_yearly_monthly_equivalent IS NULL
          AND stripe_yearly_price_id_test IS NULL
          AND stripe_yearly_price_id_live IS NULL)
    ),
  -- Every gate in src/lib/feature-gating reads these five keys unguarded. A
  -- subscription row missing one would gate on `undefined` and silently allow
  -- (or deny) the feature for everybody on that plan.
  CONSTRAINT plans_subscription_limits_complete
    CHECK (
      kind <> 'subscription'
      OR (limits ? 'websites'
          AND limits ? 'collaborators'
          AND limits ? 'ai_features'
          AND limits ? 'translations'
          AND limits ? 'ab_testing'
          AND limits ? 'monthly_credits')
    )
);

-- Self-reference added separately: the table must exist before it can point at
-- itself, and PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS.
DO $$
BEGIN
  ALTER TABLE plans
    ADD CONSTRAINT plans_grants_plan_id_fkey
    FOREIGN KEY (grants_plan_id) REFERENCES plans(id) ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Only a one-time product grants another plan; a subscription *is* its plan.
DO $$
BEGIN
  ALTER TABLE plans
    ADD CONSTRAINT plans_only_one_time_grants
    CHECK (grants_plan_id IS NULL OR kind = 'one_time');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- The catalogue is read as "active rows of this kind, in display order" on
-- every pricing page render and every checkout.
CREATE INDEX IF NOT EXISTS idx_plans_kind_active_sort
  ON plans(kind, is_active, sort_order);

-- 20250817000000 defines this and is recorded as applied against production,
-- but the function is not there: the only `update_updated_at_column` in that
-- database lives in the `storage` schema, which is Supabase's own and not this
-- one. Somewhere the migration history was backfilled rather than replayed, so
-- "an earlier migration created it" cannot be relied on.
--
-- Recreating it here costs nothing where it already exists — CREATE OR REPLACE
-- with an identical body is a no-op — and is the difference between this
-- migration applying and aborting on a database whose history lies. It is
-- schema-qualified for the same reason the mismatch was hard to see: an
-- unqualified reference resolves through search_path, and there is a
-- same-named function one schema away.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_plans_updated_at ON plans;
CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- Public read: the pricing page is served to logged-out visitors, and the
-- catalogue contains no customer data. Inactive rows stay hidden so a plan can
-- be retired without deleting the row that historical subscriptions reference.
DROP POLICY IF EXISTS "Anyone can view active plans" ON plans;
CREATE POLICY "Anyone can view active plans"
  ON plans
  FOR SELECT
  TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "Service role can manage plans" ON plans;
CREATE POLICY "Service role can manage plans"
  ON plans
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON plans TO anon, authenticated;

-- ============================================================
-- 2. plan_entitlements
-- ============================================================
-- Lifetime Pro is paid once and never renews, so it has no row in
-- billing_subscriptions and no current_period_end. Recording it there would
-- make every "when does this renew / has this lapsed" query lie, and the
-- Stripe customer portal would offer to cancel a subscription that does not
-- exist. It gets its own grant table instead.
--
-- Effective plan = active entitlement, else live subscription, else free.
-- Resolved by getEffectivePlanId() in src/lib/billing/entitlements.ts.
CREATE TABLE IF NOT EXISTS plan_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  -- Which purchase produced this grant. Kept open-ended so a support-issued
  -- comp does not need a schema change.
  source TEXT NOT NULL DEFAULT 'lifetime_purchase',
  -- Idempotency key for the Stripe webhook: a redelivered
  -- checkout.session.completed hits this UNIQUE instead of granting twice.
  stripe_payment_intent_id TEXT UNIQUE,
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- Set rather than deleting the row, so a refunded lifetime purchase leaves
  -- an audit trail.
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_entitlements_user_active
  ON plan_entitlements(user_id) WHERE revoked_at IS NULL;

ALTER TABLE plan_entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own entitlements" ON plan_entitlements;
CREATE POLICY "Users can view their own entitlements"
  ON plan_entitlements
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Deliberately no INSERT/UPDATE policy for authenticated: an entitlement is
-- worth $199 and is only ever written by the Stripe webhook, which runs as
-- service_role.
DROP POLICY IF EXISTS "Service role can manage entitlements" ON plan_entitlements;
CREATE POLICY "Service role can manage entitlements"
  ON plan_entitlements
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON plan_entitlements TO authenticated;

-- ============================================================
-- 3. Seed
-- ============================================================
-- ON CONFLICT DO UPDATE, not DO NOTHING: this file is the record of what the
-- catalogue should contain, so re-running it repairs drift instead of silently
-- leaving a stale price in place. The stripe_*_price_id columns are excluded
-- from the update so an operator override survives a replay.
INSERT INTO plans (
  id, kind, name, description,
  price_monthly, price_yearly_monthly_equivalent,
  limits, features, additional_site_price, grants_plan_id,
  is_active, sort_order
) VALUES
  (
    'free', 'subscription', 'Free', 'No active subscription',
    0, 0,
    '{"websites": 0, "collaborators": 0, "ai_features": false, "translations": 0, "ab_testing": false, "monthly_credits": 0}'::jsonb,
    '[]'::jsonb,
    NULL, NULL, TRUE, 0
  ),
  (
    'starter', 'subscription', 'Starter',
    '1 website, instant copy testing, basic features',
    -- 7.47/mo billed annually = $89.64/yr, ~17% off the $108 monthly total.
    9, 7.47,
    '{"websites": 1, "collaborators": 0, "ai_features": false, "translations": 0, "ab_testing": false, "monthly_credits": 0}'::jsonb,
    '["1 website", "Instant copy testing", "Click-to-edit interface", "Basic version history", "Community support"]'::jsonb,
    NULL, NULL, TRUE, 10
  ),
  (
    'pro', 'subscription', 'Pro',
    'Up to 5 websites, all features, +$5 per additional website',
    19, 15.77,
    '{"websites": 5, "collaborators": 5, "ai_features": true, "translations": -1, "ab_testing": true, "monthly_credits": 500}'::jsonb,
    '["Up to 5 websites", "+$5 per additional website", "Instant copy testing", "Click-to-edit interface", "Full version history", "Priority support", "AI A/B copy testing"]'::jsonb,
    5, NULL, TRUE, 20
  ),
  (
    'credits', 'one_time', 'Credits',
    '1,000 AI credits for suggestions, translations and A/B copy generation',
    19, NULL,
    '{"credits_per_pack": 1000, "max_packs_per_purchase": 100}'::jsonb,
    '["1,000 AI credits", "Works on any plan", "Credits never expire while your account is active"]'::jsonb,
    NULL, NULL, TRUE, 30
  ),
  (
    'lifetime_pro', 'one_time', 'Lifetime Pro',
    'Pay once, keep every Pro feature forever',
    199, NULL,
    '{}'::jsonb,
    '["Everything in Pro", "One payment, no renewal", "Includes all future Pro features"]'::jsonb,
    NULL, 'pro', TRUE, 40
  )
ON CONFLICT (id) DO UPDATE SET
  kind = EXCLUDED.kind,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly_monthly_equivalent = EXCLUDED.price_yearly_monthly_equivalent,
  limits = EXCLUDED.limits,
  features = EXCLUDED.features,
  additional_site_price = EXCLUDED.additional_site_price,
  grants_plan_id = EXCLUDED.grants_plan_id,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- ============================================================
-- 4. Retire Enterprise
-- ============================================================
-- Enterprise is discontinued: the plan had no Stripe price ids configured, its
-- landing-page CTA pointed at a non-existent /contact route, and nobody can
-- have subscribed to it. Deactivated rather than deleted so that if a row does
-- exist in some environment, billing_subscriptions rows referencing it stay
-- readable — the SELECT policy hides it from the catalogue either way.
UPDATE plans SET is_active = FALSE, updated_at = NOW() WHERE id = 'enterprise';
