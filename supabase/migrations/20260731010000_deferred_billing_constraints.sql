-- Re-apply the two billing constraints that had to be deferred because their
-- tables are created by migrations that run LATER than the migrations which
-- originally declared them:
--
--   billing_events        created by 20260731003000, constraint declared in 20260531000000
--   ticket_transactions   created by 20260617001000, constraint declared in 20260611040000
--
-- Those two files now skip their work when the table is absent (so a fresh
-- `supabase db reset` no longer aborts). This migration runs after every
-- CREATE TABLE and applies the constraints unconditionally, so a database built
-- from zero ends up identical to one that was migrated incrementally.
--
-- Fully idempotent: safe on a fresh build, on an already-migrated production
-- database where both constraints already exist, and on repeat runs.

-- ============================================================
-- A. billing_events.stripe_event_id UNIQUE
--    Backs the webhook idempotency guard in
--    src/app/api/webhooks/stripe/route.ts. Without it, two concurrent Stripe
--    retries can both pass the SELECT check and double-process an event.
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.billing_events') IS NULL THEN
    RAISE EXCEPTION
      'billing_events still does not exist — 20260731003000 must run before this migration.';
  END IF;

  DELETE FROM billing_events a
  USING billing_events b
  WHERE a.ctid < b.ctid
    AND a.stripe_event_id IS NOT NULL
    AND a.stripe_event_id = b.stripe_event_id;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'billing_events_stripe_event_id_unique'
      AND conrelid = 'public.billing_events'::regclass
  ) THEN
    ALTER TABLE billing_events
      ADD CONSTRAINT billing_events_stripe_event_id_unique
        UNIQUE (stripe_event_id);
  END IF;
END
$$;

-- ============================================================
-- B. ticket_transactions.stripe_payment_intent_id UNIQUE
--    Backs the idempotency guard in add_tickets(); without it a redelivered
--    payment_intent.succeeded credits the balance more than once.
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.ticket_transactions') IS NULL THEN
    RAISE EXCEPTION
      'ticket_transactions still does not exist — 20260617001000 must run before this migration.';
  END IF;

  DELETE FROM ticket_transactions a
  USING ticket_transactions b
  WHERE a.ctid > b.ctid
    AND a.stripe_payment_intent_id IS NOT NULL
    AND a.stripe_payment_intent_id = b.stripe_payment_intent_id;

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
