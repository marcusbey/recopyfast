-- Retire the free plan in the schema.
--
-- The code stopped depending on it first, deliberately: `RETIRED_PLAN_IDS` in
-- src/lib/billing/effective-plan.ts normalises `free` to unentitled on every
-- path, including the middleware one, so the row has been inert since e7ae07a.
-- This migration is the second half, and it is only safe to run *after* that
-- code is deployed. Running it first would have stranded every unsubscribed
-- account the instant it landed — the code-before-schema inversion that already
-- broke credits once on this project.
--
-- Verified against production before writing this: 0 rows in
-- billing_subscriptions, 0 in plan_entitlements, and 0 holding plan/plan_id =
-- 'free'. There is no data question here, which is the only reason the CHECK
-- can be tightened in the same migration that deactivates the row.

-- 1. The catalogue row stays, deactivated rather than deleted.
--
-- `loadPlanCatalogue` filters on is_active and verifies only PAID_PLAN_IDS
-- ('starter', 'pro') are present, so dropping 'free' out of the active set does
-- not trip its seed check. Keeping the row means the id still resolves for
-- anything reading historical records, and makes this reversible with an
-- UPDATE rather than a re-seed.
UPDATE plans SET is_active = FALSE WHERE id = 'free';

-- 2. Refuse to proceed if anything actually holds the value.
--
-- The counts above were true when this was written, not necessarily when it
-- runs. Tightening a CHECK out from under live rows fails loudly at ALTER time
-- anyway, but a named assertion says which table to look at instead of leaving
-- a bare constraint violation.
DO $$
DECLARE
  offending INTEGER;
BEGIN
  SELECT count(*) INTO offending FROM billing_subscriptions WHERE plan = 'free';
  IF offending > 0 THEN
    RAISE EXCEPTION
      'Refusing to retire the free plan: % billing_subscriptions row(s) still hold plan = ''free''. Migrate them to a paid plan or to no subscription first.',
      offending;
  END IF;
END $$;

-- 3. Tighten the constraint.
--
-- Previous definition, from 20260802020000:
--   CHECK (plan = ANY (ARRAY['free', 'starter', 'pro']))
-- That migration widened it to admit 'starter' (Starter checkouts had been
-- raising 23514, so the card was charged and the subscription row never
-- written). This one narrows it again now that 'free' is meaningless: a write
-- of 'free' from here on is a bug, and the database should say so rather than
-- accept a value the application will read as "no entitlement".
ALTER TABLE billing_subscriptions
  DROP CONSTRAINT IF EXISTS billing_subscriptions_plan_valid;

ALTER TABLE billing_subscriptions
  ADD CONSTRAINT billing_subscriptions_plan_valid
  CHECK (plan = ANY (ARRAY['starter'::text, 'pro'::text]));
