-- Stripe webhook idempotency: enforce one row per Stripe event id.
-- Closes the TOCTOU race where two concurrent Stripe retries both pass the
-- SELECT-by-stripe_event_id check before either inserts (see
-- src/app/api/webhooks/stripe/route.ts).

-- Drop any duplicate rows that may already exist before adding the constraint.
DELETE FROM billing_events a
USING billing_events b
WHERE a.ctid < b.ctid
  AND a.stripe_event_id IS NOT NULL
  AND a.stripe_event_id = b.stripe_event_id;

ALTER TABLE billing_events
  ADD CONSTRAINT billing_events_stripe_event_id_unique UNIQUE (stripe_event_id);
