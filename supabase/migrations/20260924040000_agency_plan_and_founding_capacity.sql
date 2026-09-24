-- Agency subscriptions and the 50-sale Founding Agency lifetime offer.
--
-- The founding cap is a money boundary, so the database owns it. Page views,
-- browser sessions and an application-level count-then-insert can all race.
-- Every capacity-changing RPC below takes the same transaction advisory lock;
-- the fiftieth completed purchase or live reservation therefore wins before a
-- fifty-first checkout can be created.

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS price_yearly_total NUMERIC(10, 2);

DO $$
BEGIN
  ALTER TABLE public.plans
    ADD CONSTRAINT plans_yearly_total_non_negative
    CHECK (price_yearly_total IS NULL OR price_yearly_total >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.plans
    ADD CONSTRAINT plans_one_time_has_no_yearly_total
    CHECK (kind <> 'one_time' OR price_yearly_total IS NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

INSERT INTO public.plans (
  id, kind, name, description,
  price_monthly, price_yearly_monthly_equivalent, price_yearly_total,
  limits, features, additional_site_price, grants_plan_id,
  is_active, sort_order
) VALUES
  (
    'agency', 'subscription', 'Agency',
    '10 client websites, unlimited invited editors, Agency support',
    49, 40.83, 490,
    '{"websites": 10, "collaborators": -1, "ai_features": true, "translations": -1, "ab_testing": true, "monthly_credits": 1000}'::jsonb,
    '["10 client websites", "+$4 per additional website", "Unlimited invited editors", "Everything in Pro", "1,000 AI credits / month", "Priority support + onboarding call"]'::jsonb,
    4, NULL, TRUE, 25
  ),
  (
    'lifetime_agency', 'one_time', 'Founding Agency (lifetime)',
    'Pay once for permanent Agency access; limited to the first 50 completed sales',
    299, NULL, NULL,
    '{}'::jsonb,
    '["Everything in Agency", "One payment, no renewal", "Founding offer limited to 50 completed sales"]'::jsonb,
    NULL, 'agency', TRUE, 45
  )
ON CONFLICT (id) DO UPDATE SET
  kind = EXCLUDED.kind,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly_monthly_equivalent = EXCLUDED.price_yearly_monthly_equivalent,
  price_yearly_total = EXCLUDED.price_yearly_total,
  limits = EXCLUDED.limits,
  features = EXCLUDED.features,
  additional_site_price = EXCLUDED.additional_site_price,
  grants_plan_id = EXCLUDED.grants_plan_id,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- The webhook writes this column from verified Stripe prices. Agency has to be
-- admitted in the same deploy as its catalogue row or every paid checkout will
-- retry forever on the old starter/pro-only constraint.
ALTER TABLE public.billing_subscriptions
  DROP CONSTRAINT IF EXISTS billing_subscriptions_plan_valid;
ALTER TABLE public.billing_subscriptions
  ADD CONSTRAINT billing_subscriptions_plan_valid
  CHECK (plan = ANY (ARRAY['starter'::text, 'pro'::text, 'agency'::text]));

CREATE TABLE IF NOT EXISTS public.founding_agency_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable + SET NULL is deliberate: deleting an account may remove its
  -- entitlement, but it cannot make a completed founding sale disappear and
  -- reopen a supposedly permanent first-50 spot.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  product_id TEXT NOT NULL DEFAULT 'lifetime_agency'
    CHECK (product_id = 'lifetime_agency'),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'completed', 'released')),
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  -- Frozen into Stripe Checkout params and reused byte-for-byte with the
  -- reservation idempotency key. A retry after Stripe forgets the key sees a
  -- past timestamp and fails instead of creating a fresh payable session.
  checkout_expires_at BIGINT NOT NULL DEFAULT (
    FLOOR(EXTRACT(EPOCH FROM NOW()))::BIGINT + 31 * 60
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS founding_agency_one_live_reservation_per_user
  ON public.founding_agency_reservations(user_id, product_id)
  WHERE status = 'reserved';

ALTER TABLE public.founding_agency_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages founding reservations"
  ON public.founding_agency_reservations;
CREATE POLICY "Service role manages founding reservations"
  ON public.founding_agency_reservations
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON public.founding_agency_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_founding_agency_spot(
  p_user_id UUID
)
RETURNS TABLE(reservation_id UUID, outcome TEXT, checkout_expires_at BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing UUID;
  v_checkout_expires_at BIGINT;
  v_completed INTEGER;
  v_reserved INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('founding_agency_capacity', 0));

  IF EXISTS (
    SELECT 1
    FROM public.plan_entitlements
    WHERE user_id = p_user_id
      AND plan_id = 'agency'
      AND stripe_payment_intent_id IS NOT NULL
  ) THEN
    RETURN QUERY SELECT NULL::UUID, 'owned'::TEXT, NULL::BIGINT;
    RETURN;
  END IF;

  SELECT id, founding_agency_reservations.checkout_expires_at
    INTO v_existing, v_checkout_expires_at
  FROM public.founding_agency_reservations
  WHERE user_id = p_user_id
    AND product_id = 'lifetime_agency'
    AND status = 'reserved';

  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT v_existing, 'reserved'::TEXT, v_checkout_expires_at;
    RETURN;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_completed
  FROM public.founding_agency_reservations
  WHERE product_id = 'lifetime_agency'
    AND status = 'completed';

  SELECT COUNT(*)::INTEGER INTO v_reserved
  FROM public.founding_agency_reservations
  WHERE product_id = 'lifetime_agency'
    AND status = 'reserved';

  IF v_completed >= 50 THEN
    RETURN QUERY SELECT NULL::UUID, 'sold_out'::TEXT, NULL::BIGINT;
    RETURN;
  END IF;

  IF v_completed + v_reserved >= 50 THEN
    RETURN QUERY SELECT NULL::UUID, 'capacity_busy'::TEXT, NULL::BIGINT;
    RETURN;
  END IF;

  INSERT INTO public.founding_agency_reservations(user_id)
  VALUES (p_user_id)
  RETURNING id, founding_agency_reservations.checkout_expires_at
    INTO v_existing, v_checkout_expires_at;

  RETURN QUERY SELECT v_existing, 'reserved'::TEXT, v_checkout_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.bind_founding_agency_checkout(
  p_reservation_id UUID,
  p_user_id UUID,
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
  UPDATE public.founding_agency_reservations
  SET stripe_checkout_session_id = p_stripe_checkout_session_id,
      updated_at = NOW()
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND product_id = 'lifetime_agency'
    AND status = 'reserved'
    AND (stripe_checkout_session_id IS NULL
         OR stripe_checkout_session_id = p_stripe_checkout_session_id);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_founding_agency_checkout(
  p_reservation_id UUID,
  p_user_id UUID,
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
  PERFORM pg_advisory_xact_lock(hashtextextended('founding_agency_capacity', 0));
  UPDATE public.founding_agency_reservations
  SET status = 'released',
      stripe_checkout_session_id = COALESCE(
        stripe_checkout_session_id,
        p_stripe_checkout_session_id
      ),
      released_at = NOW(),
      updated_at = NOW()
  WHERE id = p_reservation_id
    AND user_id = p_user_id
    AND status = 'reserved'
    AND (stripe_checkout_session_id IS NULL
         OR stripe_checkout_session_id = p_stripe_checkout_session_id);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

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

  IF v_status <> 'reserved' THEN
    RAISE EXCEPTION 'founding reservation is %, not reserved', v_status;
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

CREATE OR REPLACE FUNCTION public.get_founding_agency_availability()
RETURNS TABLE(completed INTEGER, remaining INTEGER, sold_out BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sales AS (
    SELECT LEAST(COUNT(*)::INTEGER, 50) AS completed
    FROM public.founding_agency_reservations
    WHERE product_id = 'lifetime_agency'
      AND status = 'completed'
  )
  SELECT completed, GREATEST(50 - completed, 0), completed >= 50
  FROM sales;
$$;

REVOKE ALL ON FUNCTION public.reserve_founding_agency_spot(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bind_founding_agency_checkout(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_founding_agency_checkout(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_founding_agency_purchase(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_founding_agency_availability() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reserve_founding_agency_spot(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_founding_agency_checkout(UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_founding_agency_spot(UUID) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.bind_founding_agency_checkout(UUID, UUID, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_founding_agency_checkout(UUID, UUID, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_founding_agency_purchase(UUID, UUID, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_founding_agency_availability() FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.release_founding_agency_checkout(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_founding_agency_purchase(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_founding_agency_availability() TO service_role;
