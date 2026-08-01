-- ========================================
-- Billing: full Stripe status vocabulary + idempotent add_tickets()
-- ========================================
-- A. billing_subscriptions.status rejects three statuses Stripe actually emits.
--    20250817000000_complete_database_setup.sql:145 declares
--      CHECK (status IN ('active','canceled','past_due','unpaid','incomplete'))
--    but Stripe's subscription.status enum also contains 'trialing',
--    'incomplete_expired' and 'paused'.  src/app/api/webhooks/stripe/route.ts:194
--    and :227 write subscription.status straight through, so any of those three
--    raises a check-constraint violation → the webhook 500s → Stripe retries the
--    event forever and the subscription is never reconciled into our database.
--
--    The application already expects the full set:
--      • src/types/billing.ts:19-25       declares all 8 values
--      • src/lib/stripe/subscription.ts:15 treats 'trialing' as a live status
--      • src/components/billing/SubscriptionCard.tsx:87 renders a trial branch
--    That code is currently unreachable, because the row can never be stored.
--
--    (billing_invoices.status is left alone — 'draft','open','paid','void',
--    'uncollectible' is already exactly Stripe's invoice status enum.)
--
-- B. add_tickets() double-credits on redelivery.
--    20260617001000_ticket_wallet_compat.sql:90-115 bumps the wallet balance
--    unconditionally and only guards the *ledger* insert with
--    ON CONFLICT (stripe_payment_intent_id) DO NOTHING.  A redelivered
--    payment_intent.succeeded therefore credits the balance a second time while
--    silently dropping the ledger row, so the wallet and its ledger disagree.
--    The event-level idempotency guard in the webhook masks this today, but the
--    function is a SECURITY DEFINER primitive and must be safe on its own.
--
--    Fix: claim the payment intent by writing the ledger row FIRST, and credit
--    the balance only when that insert actually produced a row.
-- ========================================

-- ============================================================
-- A. billing_subscriptions.status
-- ============================================================
-- The original constraint is an unnamed inline CHECK, so locate it by
-- definition rather than by a generated name (same approach as
-- 20260611040000_billing_constraints.sql).  On re-run this finds the named
-- constraint added below and simply recreates it, keeping the migration
-- idempotent.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT c.conname
    INTO v_conname
    FROM pg_constraint c
    JOIN pg_class     t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'billing_subscriptions'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%status%'
      -- discriminator: only the status CHECK mentions past_due, so this can
      -- never match billing_subscriptions_plan_check
      AND pg_get_constraintdef(c.oid) LIKE '%past_due%'
    LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE billing_subscriptions DROP CONSTRAINT %I', v_conname);
  END IF;
END
$$;

-- The complete Stripe subscription.status enum.
DO $$
BEGIN
  ALTER TABLE billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_status_check
      CHECK (status IN (
        'incomplete',
        'incomplete_expired',
        'trialing',
        'active',
        'past_due',
        'canceled',
        'unpaid',
        'paused'
      ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ============================================================
-- B. add_tickets(): idempotent per Stripe payment intent
-- ============================================================
-- Signature and RETURNS VOID are unchanged — src/lib/stripe/tickets.ts:30 calls
-- this via rpc() and inspects only `error` — so CREATE OR REPLACE is sufficient.
CREATE OR REPLACE FUNCTION add_tickets(
  user_uuid UUID,
  ticket_amount INTEGER,
  stripe_payment_intent_id_param TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_ticket_id UUID;
  v_txn_id    UUID;
BEGIN
  -- 1. Materialise the wallet without touching its balance, and take a row lock
  --    so concurrent deliveries for the same user serialise here.
  --    DO UPDATE (rather than DO NOTHING) is deliberate: it always returns the
  --    row and locks it, avoiding the upsert race where DO NOTHING returns
  --    nothing and the row is not yet visible to this snapshot.
  INSERT INTO tickets (user_id, balance, total_purchased)
  VALUES (user_uuid, 0, 0)
  ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_ticket_id;

  IF v_ticket_id IS NULL THEN
    RAISE EXCEPTION 'add_tickets: could not resolve ticket wallet for user %', user_uuid;
  END IF;

  -- 2. Claim the payment intent by writing the ledger row FIRST.  The UNIQUE
  --    constraint on stripe_payment_intent_id is what makes this a claim.
  --    A NULL payment intent (manual/non-Stripe grant) never conflicts, so
  --    those keep crediting as before.
  INSERT INTO ticket_transactions (
    user_id,
    ticket_id,
    type,
    amount,
    description,
    stripe_payment_intent_id
  )
  VALUES (
    user_uuid,
    v_ticket_id,
    'purchase',
    ticket_amount,
    'Ticket purchase',
    stripe_payment_intent_id_param
  )
  ON CONFLICT (stripe_payment_intent_id) DO NOTHING
  RETURNING id INTO v_txn_id;

  -- 3. Redelivery: the intent was already claimed, so the balance was already
  --    credited.  Return without crediting again.
  IF v_txn_id IS NULL THEN
    RETURN;
  END IF;

  -- 4. First delivery: credit the wallet.
  UPDATE tickets
  SET balance         = balance + ticket_amount,
      total_purchased = total_purchased + ticket_amount,
      updated_at      = NOW()
  WHERE id = v_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION add_tickets(UUID, INTEGER, TEXT) TO authenticated, service_role;
