-- Checkout hardening for the two money boundaries that cannot rely on one
-- request seeing fresh provider state: scarce founding capacity and recurring
-- subscription obligations.

ALTER TABLE public.founding_agency_reservations
  ADD COLUMN IF NOT EXISTS reconciliation_required_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_reason TEXT;

DO $$
BEGIN
  ALTER TABLE public.founding_agency_reservations
    ADD CONSTRAINT founding_agency_reconciliation_reason_check
    CHECK (
      reconciliation_reason IS NULL OR reconciliation_reason IN (
        'stripe_history_no_session',
        'stripe_session_lookup_failed',
        'stripe_session_state_unresolved'
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS founding_agency_reconciliation_queue
  ON public.founding_agency_reservations(reconciliation_required_at)
  WHERE reconciliation_required_at IS NOT NULL;

COMMENT ON COLUMN public.founding_agency_reservations.reconciliation_required_at IS
  'Operator reconciliation queue. Set when an unresolved hold is released after its ten-minute grace period; retained after a late paid completion.';
COMMENT ON COLUMN public.founding_agency_reservations.reconciliation_reason IS
  'Bounded reason code for an unresolved founding hold; provider error detail is never persisted.';

CREATE OR REPLACE FUNCTION public.release_unresolved_founding_agency_checkout(
  p_reservation_id UUID,
  p_reconciliation_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_reconciliation_reason IS NULL OR p_reconciliation_reason NOT IN (
    'stripe_history_no_session',
    'stripe_session_lookup_failed',
    'stripe_session_state_unresolved'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'invalid founding reconciliation reason';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('founding_agency_capacity', 0));

  -- The database repeats the grace check under the same lock as reservation
  -- and completion. A stale application process therefore cannot release a
  -- hold early or race a payment completion into a lost purchase.
  UPDATE public.founding_agency_reservations
  SET status = 'released',
      released_at = COALESCE(released_at, NOW()),
      reconciliation_required_at = COALESCE(reconciliation_required_at, NOW()),
      reconciliation_reason = COALESCE(reconciliation_reason, p_reconciliation_reason),
      updated_at = NOW()
  WHERE id = p_reservation_id
    AND product_id = 'lifetime_agency'
    AND status = 'reserved'
    AND checkout_expires_at <=
      FLOOR(EXTRACT(EPOCH FROM NOW()))::BIGINT - 600;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- A paid customer wins over the ordinary cap. An unresolved hold can be
-- released so another buyer takes spot 50, then complete late. Granting the
-- paid purchase may make the durable sold count 51; refusing it would keep the
-- money while denying the product. Ordinary reservations remain capped by the
-- shared advisory lock in reserve_founding_agency_spot.
CREATE OR REPLACE FUNCTION public.complete_founding_agency_purchase(
  p_reservation_id UUID,
  p_user_id UUID,
  p_stripe_payment_intent_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('founding_agency_capacity', 0));

  SELECT status INTO v_status
  FROM public.founding_agency_reservations
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND product_id = 'lifetime_agency'
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'founding reservation not found';
  END IF;

  IF v_status = 'completed' AND EXISTS (
    SELECT 1
    FROM public.founding_agency_reservations
    WHERE id = p_reservation_id
      AND user_id = p_user_id
      AND stripe_payment_intent_id = p_stripe_payment_intent_id
  ) THEN
    RETURN 'duplicate';
  END IF;

  IF v_status NOT IN ('reserved', 'released') THEN
    RAISE EXCEPTION 'founding reservation is %, not completable', v_status;
  END IF;

  INSERT INTO public.plan_entitlements(
    user_id, plan_id, source, stripe_payment_intent_id
  ) VALUES (
    p_user_id, 'agency', 'lifetime_purchase', p_stripe_payment_intent_id
  );

  UPDATE public.founding_agency_reservations
  SET status = 'completed',
      stripe_payment_intent_id = p_stripe_payment_intent_id,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_reservation_id;

  RETURN 'granted';
END;
$$;

-- Keep the legacy overload safe because older application instances can call
-- it during a rolling deploy. The lifecycle guard deliberately runs before a
-- pending intent is returned: a webhook may have written a recoverable
-- obligation after that intent was first claimed.
CREATE OR REPLACE FUNCTION public.claim_subscription_checkout_intent(
  p_user_id UUID,
  p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  stripe_session_id TEXT,
  checkout_url TEXT,
  expires_at TIMESTAMPTZ,
  is_new BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  pending public.checkout_pending_intents%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  IF EXISTS (
    SELECT 1 FROM public.billing_subscriptions AS subscription
    WHERE subscription.user_id = p_user_id
      AND subscription.status IN (
        'active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paused'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'user already has a non-terminal subscription';
  END IF;

  SELECT * INTO pending FROM public.checkout_pending_intents AS candidate
  WHERE candidate.user_id = p_user_id AND candidate.status = 'pending'
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT pending.id, pending.user_id, pending.stripe_session_id,
      pending.checkout_url, pending.expires_at, false;
    RETURN;
  END IF;

  INSERT INTO public.checkout_pending_intents (user_id, intent, expires_at)
  VALUES (p_user_id, 'subscription', p_expires_at)
  RETURNING * INTO pending;

  RETURN QUERY SELECT pending.id, pending.user_id, pending.stripe_session_id,
    pending.checkout_url, pending.expires_at, true;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_subscription_checkout_intent(
  p_user_id UUID,
  p_expires_at TIMESTAMPTZ,
  p_stripe_price_id TEXT,
  p_plan_id TEXT,
  p_billing_period TEXT
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  stripe_session_id TEXT,
  checkout_url TEXT,
  stripe_price_id TEXT,
  plan_id TEXT,
  billing_period TEXT,
  expires_at TIMESTAMPTZ,
  is_new BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  pending public.checkout_pending_intents%ROWTYPE;
BEGIN
  IF p_stripe_price_id IS NULL OR btrim(p_stripe_price_id) = '' OR
     p_plan_id IS NULL OR
     p_billing_period IS NULL OR
     p_billing_period NOT IN ('monthly', 'yearly') OR
     NOT EXISTS (
       SELECT 1
       FROM public.plans AS plan
       WHERE plan.id = p_plan_id
         AND plan.is_active
         AND plan.kind = 'subscription'
         AND plan.price_monthly > 0
         AND (
           p_billing_period = 'monthly'
           OR (
             p_billing_period = 'yearly'
             AND COALESCE(
               plan.price_yearly_total,
               plan.price_yearly_monthly_equivalent
             ) > 0
           )
         )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'invalid subscription checkout choice';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  IF EXISTS (
    SELECT 1 FROM public.billing_subscriptions AS subscription
    WHERE subscription.user_id = p_user_id
      AND subscription.status IN (
        'active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paused'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'user already has a non-terminal subscription';
  END IF;

  SELECT * INTO pending FROM public.checkout_pending_intents AS candidate
  WHERE candidate.user_id = p_user_id AND candidate.status = 'pending'
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT pending.id, pending.user_id, pending.stripe_session_id,
      pending.checkout_url, pending.stripe_price_id, pending.plan_id,
      pending.billing_period, pending.expires_at, false;
    RETURN;
  END IF;

  INSERT INTO public.checkout_pending_intents (
    user_id, intent, stripe_price_id, plan_id, billing_period, expires_at
  ) VALUES (
    p_user_id, 'subscription', p_stripe_price_id, p_plan_id,
    p_billing_period, p_expires_at
  ) RETURNING * INTO pending;

  RETURN QUERY SELECT pending.id, pending.user_id, pending.stripe_session_id,
    pending.checkout_url, pending.stripe_price_id, pending.plan_id,
    pending.billing_period, pending.expires_at, true;
END;
$$;

REVOKE ALL ON FUNCTION public.release_unresolved_founding_agency_checkout(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_founding_agency_purchase(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_subscription_checkout_intent(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_subscription_checkout_intent(
  UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.release_unresolved_founding_agency_checkout(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_founding_agency_purchase(UUID, UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_subscription_checkout_intent(UUID, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_subscription_checkout_intent(
  UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT
) TO service_role;
