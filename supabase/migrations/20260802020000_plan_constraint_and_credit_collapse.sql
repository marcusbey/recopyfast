-- ========================================
-- Starter was unsellable; credits were unspendable
-- ========================================
-- Two defects that both end with a customer paying and receiving nothing.
--
-- 1. billing_subscriptions.plan CHECK ALLOWS ONLY ('free','pro','enterprise')
-- ---------------------------------------------------------------------------
-- 20250817000000:144 wrote that constraint before Starter existed. The Stripe
-- webhook writes `plan: metadata.plan_id`, so a Starter checkout produces
-- plan='starter', violates the CHECK, and raises 23514. assertWritten() turns
-- that into a throw, the handler answers 500, and Stripe retries the delivery
-- forever. The card is charged on the first attempt and the subscription row
-- never lands, so the customer pays and stays on the free plan permanently.
-- Nothing logs it as a billing failure — it looks like a flaky webhook.
--
-- The constraint is rewritten to ('free','starter','pro'), matching the seeded
-- catalogue. Existing 'enterprise' rows are grandfathered to 'pro' first,
-- because the constraint cannot be added while a row violates it.
--
-- 2. CREDITS WERE PURCHASABLE BUT NOT SPENDABLE
-- ---------------------------------------------------------------------------
-- The app carried two unconnected credit stores:
--
--   tickets / ticket_transactions   <- credited by the Stripe webhook
--   credit_purchases / credit_usage <- read by every balance check and spend
--
-- Money went into the first and every feature spent from the second, so a
-- customer could buy 1,000 credits and still be told they had none. Nothing
-- ever wrote credit_purchases: addPurchasedCredits() had zero callers.
--
-- credit_purchases wins as the single store. It is the one consumption already
-- reads, and it already has per-purchase rows, a monotonicity trigger and the
-- RLS needed for users to spend their own balance under an anon-key session.
-- Balances sitting in `tickets` are carried across below so nobody loses one.
--
-- The `tickets` tables are left in place, not dropped: they are the historical
-- record of what was bought, and dropping a table in the same migration that
-- copies out of it leaves no way back if the copy is wrong. They are no longer
-- read or written by application code.
--
-- 3. PURCHASED CREDITS NO LONGER EXPIRE
-- ---------------------------------------------------------------------------
-- credit_purchases.expires_at was NOT NULL and addPurchasedCredits() set it 90
-- days out, but the product sells credits as non-expiring. Since that code path
-- had no callers, no customer has ever been subject to the 90-day window, so
-- making the column nullable (NULL = never expires) matches both the promise on
-- the pricing page and the behaviour every existing row has actually had.
-- ========================================

-- ============================================================
-- 1. Grandfather Enterprise subscribers onto Pro
-- ============================================================
-- Enterprise is retired. Anyone holding it paid for the highest tier, so they
-- move to the highest tier that still exists rather than being downgraded to
-- free. Runs before the constraint is replaced so no row violates the new one.
UPDATE billing_subscriptions
SET plan = 'pro',
    updated_at = NOW()
WHERE plan = 'enterprise';

-- ============================================================
-- 2. Rewrite the plan CHECK to match the catalogue
-- ============================================================
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  -- The constraint is unnamed in 20250817000000, so PostgreSQL generated a name
  -- for it. Look it up rather than guessing.
  SELECT con.conname INTO v_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'billing_subscriptions'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%plan%'
    AND pg_get_constraintdef(con.oid) ILIKE '%enterprise%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE billing_subscriptions DROP CONSTRAINT %I',
      v_constraint
    );
  END IF;
END
$$;

DO $$
BEGIN
  ALTER TABLE billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_plan_valid
    CHECK (plan IN ('free', 'starter', 'pro'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ============================================================
-- 3. Purchased credits stop expiring
-- ============================================================
ALTER TABLE credit_purchases ALTER COLUMN expires_at DROP NOT NULL;

COMMENT ON COLUMN credit_purchases.expires_at IS
  'NULL means the credits never expire, which is what the product sells. A '
  'timestamp is still honoured by the balance queries for promotional grants.';

-- ============================================================
-- 4. Carry any `tickets` balance into credit_purchases
-- ============================================================
-- One row per wallet that still holds a balance, attributed so it is
-- distinguishable from a real Stripe purchase in an audit.
--
-- stripe_payment_intent_id is UNIQUE and is used as the webhook's idempotency
-- key, so a synthetic value is used here rather than NULL: it makes the
-- migration itself re-runnable (ON CONFLICT DO NOTHING) and can never collide
-- with a real Stripe id, which is always prefixed `pi_`.
INSERT INTO credit_purchases (
  user_id, credits_purchased, credits_remaining,
  price_cents, stripe_payment_intent_id, expires_at
)
SELECT
  t.user_id,
  t.balance,
  t.balance,
  0,
  'migrated_wallet_' || t.id::text,
  NULL
FROM tickets t
WHERE t.balance > 0
ON CONFLICT (stripe_payment_intent_id) DO NOTHING;

-- ============================================================
-- 5. Balance queries must treat NULL expires_at as "never"
-- ============================================================
-- The partial index backing the balance read filtered on expires_at, which
-- would now skip every non-expiring row.
DROP INDEX IF EXISTS idx_credit_purchases_user_expires;
CREATE INDEX IF NOT EXISTS idx_credit_purchases_user_spendable
  ON credit_purchases(user_id, created_at)
  WHERE credits_remaining > 0;
