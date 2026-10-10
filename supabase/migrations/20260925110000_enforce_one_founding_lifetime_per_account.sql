-- A Founding Agency lifetime is an account-level product. A released hold can
-- finish late after the same account reserved another Checkout Session; both
-- payments are real, but only the first may consume capacity and grant Agency.
-- Persist the second payment as a sticky refund outcome before calling Stripe
-- so unordered webhook events and retries can never turn it into a later grant.

ALTER TABLE public.founding_agency_reservations
  ADD COLUMN IF NOT EXISTS duplicate_refund_required_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duplicate_refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS founding_agency_unique_stripe_refund
  ON public.founding_agency_reservations(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

COMMENT ON COLUMN public.founding_agency_reservations.duplicate_refund_required_at IS
  'Set atomically when this paid reservation is the account''s second Founding Agency lifetime. The row stays released and every retry returns refund_required until Stripe success is recorded.';
COMMENT ON COLUMN public.founding_agency_reservations.duplicate_refunded_at IS
  'Set only after Stripe reports the duplicate-account refund succeeded.';
COMMENT ON COLUMN public.founding_agency_reservations.stripe_refund_id IS
  'Stripe refund that returned the account''s second Founding Agency payment.';

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
  v_payment_intent_id TEXT;
  v_duplicate_refund_required_at TIMESTAMPTZ;
  v_duplicate_refunded_at TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('founding_agency_capacity', 0));

  SELECT status, stripe_payment_intent_id, duplicate_refund_required_at,
         duplicate_refunded_at
    INTO v_status, v_payment_intent_id, v_duplicate_refund_required_at,
         v_duplicate_refunded_at
  FROM public.founding_agency_reservations
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND product_id = 'lifetime_agency'
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'founding reservation not found';
  END IF;

  IF v_status = 'completed'
     AND v_payment_intent_id = p_stripe_payment_intent_id THEN
    RETURN 'duplicate';
  END IF;

  -- Sticky even after the first refund succeeds or the original entitlement
  -- is later revoked. A replay of either signed success event must never
  -- reconsider a grant.
  IF v_status = 'released'
     AND v_duplicate_refund_required_at IS NOT NULL
     AND v_payment_intent_id = p_stripe_payment_intent_id THEN
    IF v_duplicate_refunded_at IS NOT NULL THEN
      RETURN 'refunded';
    END IF;
    RETURN 'refund_required';
  END IF;

  IF v_status NOT IN ('reserved', 'released') THEN
    RAISE EXCEPTION 'founding reservation is %, not completable', v_status;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.founding_agency_reservations AS owned
    WHERE owned.user_id = p_user_id
      AND owned.product_id = 'lifetime_agency'
      AND owned.status = 'completed'
      AND owned.id <> p_reservation_id
  ) THEN
    UPDATE public.founding_agency_reservations
    SET status = 'released',
        stripe_payment_intent_id = p_stripe_payment_intent_id,
        duplicate_refund_required_at = COALESCE(
          duplicate_refund_required_at,
          NOW()
        ),
        released_at = COALESCE(released_at, NOW()),
        updated_at = NOW()
    WHERE id = p_reservation_id;

    RETURN 'refund_required';
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

CREATE OR REPLACE FUNCTION public.bind_founding_agency_duplicate_refund_session(
  p_reservation_id UUID,
  p_user_id UUID,
  p_stripe_payment_intent_id TEXT,
  p_stripe_checkout_session_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_stripe_checkout_session_id IS NULL
     OR btrim(p_stripe_checkout_session_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'stripe checkout session id is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('founding_agency_capacity', 0));

  UPDATE public.founding_agency_reservations
  SET stripe_checkout_session_id = COALESCE(
        stripe_checkout_session_id,
        p_stripe_checkout_session_id
      ),
      updated_at = NOW()
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND product_id = 'lifetime_agency'
    AND status = 'released'
    AND stripe_payment_intent_id = p_stripe_payment_intent_id
    AND duplicate_refund_required_at IS NOT NULL
    AND (
      stripe_checkout_session_id IS NULL
      OR stripe_checkout_session_id = p_stripe_checkout_session_id
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_founding_agency_duplicate_refunded(
  p_reservation_id UUID,
  p_user_id UUID,
  p_stripe_payment_intent_id TEXT,
  p_stripe_refund_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_stripe_refund_id IS NULL OR btrim(p_stripe_refund_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'stripe refund id is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('founding_agency_capacity', 0));

  UPDATE public.founding_agency_reservations
  SET duplicate_refunded_at = COALESCE(duplicate_refunded_at, NOW()),
      stripe_refund_id = COALESCE(stripe_refund_id, p_stripe_refund_id),
      updated_at = NOW()
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND product_id = 'lifetime_agency'
    AND status = 'released'
    AND stripe_payment_intent_id = p_stripe_payment_intent_id
    AND duplicate_refund_required_at IS NOT NULL
    AND (stripe_refund_id IS NULL OR stripe_refund_id = p_stripe_refund_id);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- The deployed application has used only the catalogue-bound five-argument
-- claim since 20260924070000. The two-argument compatibility overload has no
-- caller and its rolling-deploy comment in the applied migration is stale;
-- remove it forward-only rather than editing migration history.
DROP FUNCTION IF EXISTS public.claim_subscription_checkout_intent(
  UUID,
  TIMESTAMPTZ
);

REVOKE ALL ON FUNCTION public.complete_founding_agency_purchase(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_founding_agency_duplicate_refunded(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bind_founding_agency_duplicate_refund_session(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_founding_agency_purchase(UUID, UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_founding_agency_duplicate_refunded(UUID, UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_founding_agency_duplicate_refund_session(UUID, UUID, TEXT, TEXT)
  TO service_role;
