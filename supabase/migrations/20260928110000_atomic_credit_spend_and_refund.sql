-- s48 — AI credits are spent and refunded by database functions (ADR 040).
--
-- WHAT BROKE (.omx/qa-20260927/REPORT.md, defects 2 and 3)
--
--   P4  src/lib/credits/system.ts spent purchased credits with one
--       compare-and-swap per purchase row. On a collision it restarted with the
--       FULL amount and never undid the rows it had already decremented; after
--       eight collisions it refused, keeping those partial decrements too.
--       Twelve concurrent 5-credit charges lost 2-9 credits per round and
--       refused 3-6 requests the wallet covered. Two concurrent charges could
--       also both draw the same remaining monthly allowance.
--   P2  A usage row stored `credits_used` only, so a refund could not say where
--       a charge came from. It minted a new never-expiring "purchased" row —
--       even for a charge the allowance had paid, which stayed counted as used.
--   P3  A minted row is an entitlement: a lapsed trial that never paid, with one
--       refunded failure, resolved to `credits` and passed the paywall.
--
-- THE DESIGN
--
--   spend_credits does the whole charge in one transaction, under a per-user
--   advisory lock: sum the usage in the window, draw the allowance first, lock
--   the spendable purchase rows oldest first, refuse without writing anything
--   if they cannot cover the rest, otherwise decrement them relatively and
--   insert the usage row recording its purchased share and the rows it debited.
--
--   The allowance (`p_included`) and the window start (`p_window_start`) are
--   computed in TypeScript and passed in. ADR 035 rejected a SQL spend function
--   because it would copy the plan and window rules into SQL where the two
--   would drift; passing them in keeps every plan and window rule in one place
--   (getUserCreditBalance) and moves only the arithmetic and the exclusion here.
--
-- WHY SECURITY INVOKER
--
--   Spenders run two ways: the service role (the widget's /api/ai/suggest
--   charges the site owner, ADR 035) and the signed-in user's JWT (translate,
--   ab-tests). INVOKER keeps the JWT caller inside RLS and inside the
--   "may only decrease" trigger on credit_purchases, unchanged. DEFINER would
--   need its own tenant checks, and function-grants.test.ts forbids any
--   DEFINER function `authenticated` can execute. A JWT caller naming another
--   user is refused with this function's own message rather than an RLS error
--   that would read as "insufficient". Calling it directly gains nothing: a
--   caller who inflates `p_included` only writes usage rows for itself, which
--   it can already INSERT, and receives no AI output.
--
-- THE LOCK NAMESPACE
--
--   hashtextextended('credits:' || user_id, 0). Checkout claims already lock
--   the bare hashtextextended(user_id::text, 0) (20260924020000,
--   20260924050000, 20260925100000); sharing that key would queue every AI
--   charge behind the user's checkout. Webhook revoke/restore take row locks
--   only, and both functions here take the advisory lock before any row lock,
--   so there is no deadlock cycle.
--
-- NET credits_used
--
--   `credits_used` becomes the NET charge. A refund lowers it and raises
--   `credits_refunded`, so every existing reader — the TypeScript window sum,
--   the in-lock SQL sum, totalConsumed — stays correct unchanged, and a refund
--   gives the allowance back with no extra rule. `credits_from_purchased` and
--   `purchase_debits` (spend order, oldest row first) are written once by the
--   charge and never change. A refund returns purchased credits first, walking
--   the debits in reverse and skipping what earlier refunds already returned,
--   in place and capped at each row's `credits_purchased` — the exact reverse of
--   the spend. It is service-role only and keyed by the usage id the charge
--   returned in the same request, never one taken from a request body.
--
-- DEPLOY ORDER: this migration BEFORE the code. Old code ignores the new
-- columns, and relaxing the CHECK refuses nothing it wrote. New code without
-- this migration fails every AI charge (nobody is overcharged).
--
-- NEVER ROLL THIS SCHEMA BACK once a refund has written a net-0 usage row: the
-- old `credit_usage_positive` CHECK (credits_used > 0) refuses it.
--
-- PostgreSQL 14 syntax only: scripts/run-db-invariants.mjs applies every
-- migration to a bare PG14. Idempotent: CI and deploy retries re-run it.

ALTER TABLE public.credit_usage
  ADD COLUMN IF NOT EXISTS credits_from_purchased INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_debits JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS credits_refunded INTEGER NOT NULL DEFAULT 0;

-- One CHECK replaces credits_used > 0. Existing rows satisfy it through the
-- column defaults: from_purchased 0 <= credits_used + 0.
ALTER TABLE public.credit_usage
  DROP CONSTRAINT IF EXISTS credit_usage_positive;
ALTER TABLE public.credit_usage
  DROP CONSTRAINT IF EXISTS credit_usage_amounts_valid;
ALTER TABLE public.credit_usage
  ADD CONSTRAINT credit_usage_amounts_valid CHECK (
    credits_used >= 0
    AND credits_refunded >= 0
    AND credits_from_purchased >= 0
    AND credits_from_purchased <= credits_used + credits_refunded
    AND jsonb_typeof(purchase_debits) = 'array'
  );

CREATE OR REPLACE FUNCTION public.spend_credits(
  p_user_id      UUID,
  p_credits      INTEGER,
  p_included     INTEGER,
  p_window_start TIMESTAMPTZ,
  p_operation    TEXT,
  p_metadata     JSONB
)
RETURNS TABLE (
  outcome        TEXT,
  usage_id       UUID,
  from_allowance INTEGER,
  from_purchased INTEGER,
  remaining      INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller          UUID := auth.uid();
  v_used            INTEGER;
  v_from_allowance  INTEGER;
  v_from_purchased  INTEGER;
  v_available       INTEGER := 0;
  v_row_ids         UUID[] := '{}';
  v_row_credits     INTEGER[] := '{}';
  v_row             RECORD;
  v_left            INTEGER;
  v_take            INTEGER;
  v_debits          JSONB := '[]'::JSONB;
  v_usage_id        UUID;
BEGIN
  IF p_user_id IS NULL
     OR p_credits IS NULL OR p_credits <= 0
     OR p_included IS NULL OR p_included < 0
     OR p_window_start IS NULL
     OR p_operation IS NULL OR btrim(p_operation) = '' THEN
    RAISE EXCEPTION 'spend_credits: invalid input'
      USING ERRCODE = '22023';
  END IF;

  IF v_caller IS NOT NULL AND p_user_id <> v_caller THEN
    RAISE EXCEPTION 'spend_credits: a signed-in caller may only spend its own credits'
      USING ERRCODE = '42501';
  END IF;

  -- Every spend and refund for this user runs one at a time from here on. The
  -- statements below take fresh snapshots, so they see every charge committed
  -- by whoever held the lock before.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('credits:' || p_user_id::TEXT, 0)
  );

  -- `>=` matches the TypeScript read (`.gte("created_at", startOfPeriod)`),
  -- and the window start is the parameter, never now() or a month of our own.
  SELECT COALESCE(SUM(cu.credits_used), 0)::INTEGER
    INTO v_used
    FROM public.credit_usage AS cu
   WHERE cu.user_id = p_user_id
     AND cu.created_at >= p_window_start;

  v_from_allowance := LEAST(p_credits, GREATEST(0, p_included - v_used));
  v_from_purchased := p_credits - v_from_allowance;

  -- Spendable exactly as src/lib/credits/spendable.ts defines it, oldest first
  -- (the order system.ts has always spent in). FOR UPDATE holds each row
  -- against a concurrent webhook revoke until this transaction ends.
  FOR v_row IN
    SELECT cp.id, cp.credits_remaining
      FROM public.credit_purchases AS cp
     WHERE cp.user_id = p_user_id
       AND cp.credits_remaining > 0
       AND (cp.expires_at IS NULL OR cp.expires_at > NOW())
     ORDER BY cp.created_at, cp.id
       FOR UPDATE
  LOOP
    v_row_ids := v_row_ids || v_row.id;
    v_row_credits := v_row_credits || v_row.credits_remaining;
    v_available := v_available + v_row.credits_remaining;
  END LOOP;

  IF v_available < v_from_purchased THEN
    RETURN QUERY SELECT
      'insufficient'::TEXT,
      NULL::UUID,
      0,
      0,
      GREATEST(0, p_included - v_used) + v_available;
    RETURN;
  END IF;

  v_left := v_from_purchased;
  FOR i IN 1 .. COALESCE(array_length(v_row_ids, 1), 0) LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, v_row_credits[i]);

    -- Relative, never an absolute snapshot: the P4 loss was two writers each
    -- setting the value they had read.
    UPDATE public.credit_purchases AS cp
       SET credits_remaining = cp.credits_remaining - v_take
     WHERE cp.id = v_row_ids[i];

    v_debits := v_debits || jsonb_build_array(
      jsonb_build_object('purchase_id', v_row_ids[i], 'credits', v_take)
    );
    v_left := v_left - v_take;
  END LOOP;

  INSERT INTO public.credit_usage (
    user_id,
    credits_used,
    operation,
    metadata,
    credits_from_purchased,
    purchase_debits
  )
  VALUES (
    p_user_id,
    p_credits,
    p_operation,
    COALESCE(p_metadata, '{}'::JSONB),
    v_from_purchased,
    v_debits
  )
  RETURNING id INTO v_usage_id;

  RETURN QUERY SELECT
    'charged'::TEXT,
    v_usage_id,
    v_from_allowance,
    v_from_purchased,
    GREATEST(0, p_included - (v_used + p_credits))
      + (v_available - v_from_purchased);
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_credit_usage(
  p_usage_id UUID,
  p_user_id  UUID,
  p_credits  INTEGER
)
RETURNS TABLE (
  refunded     INTEGER,
  to_purchased INTEGER,
  to_allowance INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_usage        public.credit_usage%ROWTYPE;
  v_refund       INTEGER;
  v_to_purchased INTEGER;
  v_skip         INTEGER;
  v_left         INTEGER;
  v_debit        JSONB;
  v_debit_left   INTEGER;
  v_give         INTEGER;
BEGIN
  IF p_usage_id IS NULL
     OR p_user_id IS NULL
     OR p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'refund_credit_usage: invalid input'
      USING ERRCODE = '22023';
  END IF;

  -- The same lock as spend_credits, so a refund never interleaves with a
  -- charge's in-window sum.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('credits:' || p_user_id::TEXT, 0)
  );

  SELECT cu.*
    INTO v_usage
    FROM public.credit_usage AS cu
   WHERE cu.id = p_usage_id
     FOR UPDATE;

  -- Missing and foreign are one answer: the caller holds a receipt from its
  -- own charge, so either means a bug, and neither may move anyone's credits.
  IF NOT FOUND OR v_usage.user_id <> p_user_id THEN
    RAISE EXCEPTION 'refund_credit_usage: no such charge for this user'
      USING ERRCODE = 'P0002';
  END IF;

  -- Capped at what the charge still holds, so refunding a receipt twice (a
  -- provider failure and then the catch) can never return more than it took.
  v_refund := LEAST(p_credits, v_usage.credits_used);
  IF v_refund <= 0 THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  -- Purchased credits always go back first, so what earlier refunds returned
  -- to purchase rows is LEAST(credits_refunded, credits_from_purchased), taken
  -- from the END of the debit list. Skip that much, then keep walking back.
  v_to_purchased := LEAST(
    v_refund,
    GREATEST(0, v_usage.credits_from_purchased - v_usage.credits_refunded)
  );
  v_skip := LEAST(v_usage.credits_refunded, v_usage.credits_from_purchased);
  v_left := v_to_purchased;

  FOR i IN REVERSE jsonb_array_length(v_usage.purchase_debits) - 1 .. 0 LOOP
    EXIT WHEN v_left <= 0;
    v_debit := v_usage.purchase_debits -> i;
    v_debit_left := (v_debit ->> 'credits')::INTEGER;

    v_give := LEAST(v_skip, v_debit_left);
    v_skip := v_skip - v_give;
    v_debit_left := v_debit_left - v_give;
    CONTINUE WHEN v_debit_left <= 0;

    v_give := LEAST(v_left, v_debit_left);

    -- In place, never a new row (a new row is what P2/P3 minted). Capped at
    -- what the pack held, and only ever a row of this user. Raising the
    -- balance passes enforce_credit_purchase_monotonicity because this
    -- function is only executable by the service role.
    UPDATE public.credit_purchases AS cp
       SET credits_remaining = LEAST(
             cp.credits_purchased,
             cp.credits_remaining + v_give
           )
     WHERE cp.id = (v_debit ->> 'purchase_id')::UUID
       AND cp.user_id = p_user_id;

    v_left := v_left - v_give;
  END LOOP;

  -- The allowance comes back by itself: it is the in-window sum of
  -- credits_used, which this lowers.
  UPDATE public.credit_usage AS cu
     SET credits_used = cu.credits_used - v_refund,
         credits_refunded = cu.credits_refunded + v_refund
   WHERE cu.id = p_usage_id;

  RETURN QUERY SELECT v_refund, v_to_purchased, v_refund - v_to_purchased;
END;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC on new functions, and Supabase's default
-- privileges add anon and authenticated. The anon key must reach neither.
REVOKE ALL ON FUNCTION public.spend_credits(
  UUID, INTEGER, INTEGER, TIMESTAMPTZ, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_credits(
  UUID, INTEGER, INTEGER, TIMESTAMPTZ, TEXT, JSONB
) TO authenticated, service_role;

-- A refund raises credits_remaining, which only the service role may do. A
-- signed-in user must never be able to refund, even a usage row it inserted
-- itself.
REVOKE ALL ON FUNCTION public.refund_credit_usage(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credit_usage(UUID, UUID, INTEGER)
  TO service_role;
