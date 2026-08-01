-- Stripe webhook idempotency: enforce one row per Stripe event id.
-- Closes the TOCTOU race where two concurrent Stripe retries both pass the
-- SELECT-by-stripe_event_id check before either inserts (see
-- src/app/api/webhooks/stripe/route.ts).
--
-- ORDERING NOTE: billing_events is created by 20260731003000, which runs AFTER
-- this file. On an already-migrated database the table exists (it came from the
-- legacy supabase/billing-schema.sql, applied by hand) and this migration is a
-- no-op re-run. On a FRESH database it did not exist yet, so the statements
-- below aborted the whole chain and `supabase db reset` could never complete.
--
-- Rather than reorder an already-applied migration, the work is guarded here and
-- re-applied unconditionally by 20260731010000_deferred_billing_constraints.sql
-- once the table definitely exists. Both paths converge on the same schema.
DO $$
BEGIN
  IF to_regclass('public.billing_events') IS NULL THEN
    RAISE NOTICE 'billing_events not created yet; deferring to 20260731010000.';
    RETURN;
  END IF;

  -- Drop any duplicate rows that may already exist before adding the constraint.
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
