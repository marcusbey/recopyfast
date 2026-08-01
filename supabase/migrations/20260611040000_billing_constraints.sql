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

-- ORDERING NOTE: ticket_transactions is created by 20260617001000, which runs
-- AFTER this file. On an already-migrated database it exists (from the legacy
-- supabase/billing-schema.sql applied by hand) and this block is a no-op re-run.
-- On a FRESH database it did not exist yet, so the DELETE below aborted the
-- whole chain and `supabase db reset` could never complete. The work is guarded
-- here and re-applied by 20260731010000_deferred_billing_constraints.sql once
-- the table definitely exists. Both paths converge on the same schema.
--
-- Note `'ticket_transactions'::regclass` throws outright when the table is
-- absent, so the existence check must come first and must use to_regclass.
DO $$
BEGIN
  IF to_regclass('public.ticket_transactions') IS NULL THEN
    RAISE NOTICE
      'ticket_transactions not created yet; deferring to 20260731010000.';
    RETURN;
  END IF;

  -- Remove duplicate stripe_payment_intent_id rows, keeping the
  -- chronologically first row (lowest ctid as a tie-breaker within
  -- the same created_at, consistent with the stripe_event_idempotency
  -- migration pattern).
  DELETE FROM ticket_transactions a
  USING ticket_transactions b
  WHERE a.ctid > b.ctid
    AND a.stripe_payment_intent_id IS NOT NULL
    AND a.stripe_payment_intent_id = b.stripe_payment_intent_id;

  -- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, so guard on pg_constraint
  -- to stay idempotent on re-runs.
  -- 20260617001000 declares the column as `TEXT UNIQUE`, which Postgres names
  -- ticket_transactions_stripe_payment_intent_id_key. Guarding on our own
  -- constraint NAME would therefore miss it and add a SECOND redundant unique
  -- constraint (and its index) on every fresh build. Check for any single-column
  -- unique/primary-key constraint covering the column instead.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.ticket_transactions'::regclass
      AND c.contype IN ('u', 'p')
      AND array_length(c.conkey, 1) = 1
      AND a.attname = 'stripe_payment_intent_id'
  ) THEN
    ALTER TABLE ticket_transactions
      ADD CONSTRAINT ticket_transactions_stripe_payment_intent_id_unique
        UNIQUE (stripe_payment_intent_id);
  END IF;
END
$$;
