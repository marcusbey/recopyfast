-- ========================================
-- Missing Tables: Billing events & Credit system
-- ========================================
-- billing_events, credit_purchases and credit_usage are queried by application
-- code but existed only in the loose supabase/billing-schema.sql and
-- supabase/credit-system-schema.sql, which `supabase db push` never runs.
--
-- Column types follow the house convention (TEXT rather than the loose files'
-- VARCHAR(50)/VARCHAR(255)); no application code depends on the length caps.
-- ========================================

-- ============================================================
-- billing_events
--   read : src/app/api/webhooks/stripe/route.ts:59  (idempotency probe)
--   write: src/app/api/webhooks/stripe/route.ts:419
-- ============================================================
-- user_id is nullable: the webhook writes whatever user it resolved, which can
-- be null for events that are not tied to a known customer.
CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  stripe_event_id TEXT,
  data JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 20260531000000_stripe_event_idempotency.sql adds this same constraint under
-- this exact name.  Re-declare it here (guarded) so a database built from
-- migrations/ alone still gets it — the webhook relies on error code 23505 as
-- its idempotency backstop.  PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS.
DO $$
BEGIN
  ALTER TABLE billing_events
    ADD CONSTRAINT billing_events_stripe_event_id_unique UNIQUE (stripe_event_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;  -- backing index already exists
END
$$;

CREATE INDEX IF NOT EXISTS idx_billing_events_user_id ON billing_events(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_processed ON billing_events(processed);
CREATE INDEX IF NOT EXISTS idx_billing_events_created_at ON billing_events(created_at DESC);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own billing events" ON billing_events;
CREATE POLICY "Users can view their own billing events"
  ON billing_events
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage billing events" ON billing_events;
CREATE POLICY "Service role can manage billing events"
  ON billing_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- credit_purchases   (src/lib/credits/system.ts:69, :158, :173, :205)
-- ============================================================
CREATE TABLE IF NOT EXISTS credit_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_purchased INTEGER NOT NULL,
  credits_remaining INTEGER NOT NULL,
  price_cents INTEGER,
  stripe_payment_intent_id TEXT UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT credit_purchases_credits_positive
    CHECK (credits_purchased > 0 AND credits_remaining >= 0)
);

-- system.ts filters user_id + credits_remaining > 0 + expires_at > now(),
-- ordered by created_at ASC (oldest-first deduction).
CREATE INDEX IF NOT EXISTS idx_credit_purchases_user_expires
  ON credit_purchases(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_purchases_user_created
  ON credit_purchases(user_id, created_at);

ALTER TABLE credit_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own credit purchases" ON credit_purchases;
CREATE POLICY "Users can view own credit purchases"
  ON credit_purchases
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- src/lib/credits/system.ts:173 decrements credits_remaining under the caller's
-- own anon-key session, so authenticated users need UPDATE on their own rows.
-- On its own that would let a user restore their own balance, so the trigger
-- below makes credits_remaining monotonically decreasing for non-service roles.
-- (RLS alone cannot express this: USING sees the old row, WITH CHECK the new
-- one, and a single policy expression cannot reference both.)
DROP POLICY IF EXISTS "Users can spend their own purchased credits" ON credit_purchases;
CREATE POLICY "Users can spend their own purchased credits"
  ON credit_purchases
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION enforce_credit_purchase_monotonicity()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND NEW.credits_remaining > OLD.credits_remaining THEN
    RAISE EXCEPTION 'credit_purchases.credits_remaining may only decrease (attempted % -> %)',
      OLD.credits_remaining, NEW.credits_remaining;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS credit_purchases_monotonic_trigger ON credit_purchases;
CREATE TRIGGER credit_purchases_monotonic_trigger
  BEFORE UPDATE ON credit_purchases
  FOR EACH ROW EXECUTE FUNCTION enforce_credit_purchase_monotonicity();

DROP POLICY IF EXISTS "Service role can manage credit purchases" ON credit_purchases;
CREATE POLICY "Service role can manage credit purchases"
  ON credit_purchases
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- credit_usage   (src/lib/credits/system.ts:86, :132)
-- ============================================================
CREATE TABLE IF NOT EXISTS credit_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_used INTEGER NOT NULL,
  operation TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT credit_usage_positive CHECK (credits_used > 0)
);

CREATE INDEX IF NOT EXISTS idx_credit_usage_user_created
  ON credit_usage(user_id, created_at DESC);

ALTER TABLE credit_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own credit usage" ON credit_usage;
CREATE POLICY "Users can view own credit usage"
  ON credit_usage
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- src/lib/credits/system.ts runs under the caller's anon-key session, so the
-- INSERT at :132 must be permitted for the acting user (not just service_role).
DROP POLICY IF EXISTS "Users can record their own credit usage" ON credit_usage;
CREATE POLICY "Users can record their own credit usage"
  ON credit_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage credit usage" ON credit_usage;
CREATE POLICY "Service role can manage credit usage"
  ON credit_usage
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
