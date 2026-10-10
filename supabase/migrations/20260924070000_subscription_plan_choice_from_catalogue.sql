-- Subscription checkout choices follow the catalogue instead of a duplicated
-- starter/pro allow-list. The 050000 migration was already applied in
-- production before Agency existed; this forward migration repairs both the
-- row constraint and the claim RPC without editing that production history.

ALTER TABLE public.checkout_pending_intents
  DROP CONSTRAINT IF EXISTS checkout_pending_intents_plan_id_check;

DO $$
BEGIN
  ALTER TABLE public.checkout_pending_intents
    ADD CONSTRAINT checkout_pending_intents_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.plans(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.claim_subscription_checkout_intent(
  p_user_id uuid,
  p_expires_at timestamptz,
  p_stripe_price_id text,
  p_plan_id text,
  p_billing_period text
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  stripe_session_id text,
  checkout_url text,
  stripe_price_id text,
  plan_id text,
  billing_period text,
  expires_at timestamptz,
  is_new boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pending public.checkout_pending_intents%ROWTYPE;
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
         -- Free is a catalogue row for entitlement fallback, not a purchasable
         -- paid checkout choice. Price positivity keeps that distinction in
         -- the catalogue rather than growing another plan-id allow-list.
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
  SELECT * INTO pending FROM public.checkout_pending_intents AS candidate
    WHERE candidate.user_id = p_user_id AND candidate.status = 'pending'
    FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT pending.id, pending.user_id, pending.stripe_session_id,
      pending.checkout_url, pending.stripe_price_id, pending.plan_id,
      pending.billing_period, pending.expires_at, false;
    RETURN;
  END IF;

  -- Keep this eligibility list in step with the original claim RPC. This
  -- migration changes the source of valid plan choices, not subscription
  -- lifecycle policy.
  IF EXISTS (
    SELECT 1 FROM public.billing_subscriptions AS subscription
    WHERE subscription.user_id = p_user_id
      AND subscription.status IN ('active', 'trialing', 'past_due')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'user already has a non-terminal subscription';
  END IF;

  INSERT INTO public.checkout_pending_intents (
    user_id,
    intent,
    stripe_price_id,
    plan_id,
    billing_period,
    expires_at
  ) VALUES (
    p_user_id,
    'subscription',
    p_stripe_price_id,
    p_plan_id,
    p_billing_period,
    p_expires_at
  ) RETURNING * INTO pending;

  RETURN QUERY SELECT pending.id, pending.user_id, pending.stripe_session_id,
    pending.checkout_url, pending.stripe_price_id, pending.plan_id,
    pending.billing_period, pending.expires_at, true;
END; $$;

REVOKE ALL ON FUNCTION public.claim_subscription_checkout_intent(
  uuid, timestamptz, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_subscription_checkout_intent(
  uuid, timestamptz, text, text, text
) TO service_role;
