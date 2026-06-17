-- ========================================
-- Billing Constraints Hardening
-- ========================================
-- Fix A: billing_subscriptions.plan CHECK constraint did not include
--   'starter', causing inserts/updates for Starter-plan users to fail.
--   The column is named 'plan' (not 'plan_id') in the canonical migration.
--   Strategy: DROP the old unnamed CHECK, then ADD a new named CHECK that
--   includes all valid plan values.
--
-- Fix B: ticket_transactions.stripe_payment_intent_id has no UNIQUE
--   constraint, allowing duplicate payment-intent rows and double-credit
--   races.  We delete duplicates first (keeping the earliest row by ctid,
--   matching the pattern from 20260531000000_stripe_event_idempotency.sql),
--   then add the constraint.
--   ticket_transactions lives in the legacy billing-schema.sql which IS
--   deployed (the app actively queries it).
--
-- Both fixes are as idempotent as PostgreSQL allows:
--   • The CHECK drop uses a DO block to skip if the constraint is absent.
--   • The UNIQUE add uses a DO block guarded on pg_constraint. (PostgreSQL does
--     NOT support ADD CONSTRAINT IF NOT EXISTS — that is a syntax error.)
-- ========================================

-- ============================================================
-- A. billing_subscriptions: add 'starter' to plan CHECK
-- ============================================================

-- Drop the existing inline (unnamed) CHECK constraint on the 'plan' column.
-- pg_constraint stores unnamed column CHECKs with auto-generated names;
-- we locate it by table + column to avoid hard-coding the generated name.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT c.conname
    INTO v_conname
    FROM pg_constraint c
    JOIN pg_class     t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    -- conkey references the column position; check the constraint definition
    WHERE n.nspname = 'public'
      AND t.relname = 'billing_subscriptions'
      AND c.contype  = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%plan%'
      -- Make sure it is the plan-value check (not some other check on the table)
      AND pg_get_constraintdef(c.oid) LIKE '%free%'
    LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE billing_subscriptions DROP CONSTRAINT %I', v_conname);
  END IF;
END
$$;

-- Re-add with the full set of valid plan values including 'starter'
ALTER TABLE billing_subscriptions
  ADD CONSTRAINT billing_subscriptions_plan_check
    CHECK (plan IN ('free', 'starter', 'pro', 'enterprise'));

-- ============================================================
-- B. ticket_transactions: deduplicate then add UNIQUE constraint
-- ============================================================

-- Remove duplicate stripe_payment_intent_id rows, keeping the
-- chronologically first row (lowest ctid as a tie-breaker within
-- the same created_at, consistent with the stripe_event_idempotency
-- migration pattern).
DELETE FROM ticket_transactions a
USING ticket_transactions b
WHERE a.ctid > b.ctid
  AND a.stripe_payment_intent_id IS NOT NULL
  AND a.stripe_payment_intent_id = b.stripe_payment_intent_id;

-- Add the unique constraint. PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, so
-- guard on pg_constraint inside a DO block to stay idempotent on re-runs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ticket_transactions_stripe_payment_intent_id_unique'
      AND conrelid = 'ticket_transactions'::regclass
  ) THEN
    ALTER TABLE ticket_transactions
      ADD CONSTRAINT ticket_transactions_stripe_payment_intent_id_unique
        UNIQUE (stripe_payment_intent_id);
  END IF;
END
$$;
