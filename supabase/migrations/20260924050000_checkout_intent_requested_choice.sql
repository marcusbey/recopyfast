-- A pending checkout can be resumed only for the exact plan, billing period,
-- and Stripe Price the customer originally selected. Before these columns
-- existed, clicking back from Pro yearly and choosing Starter monthly resumed
-- the still-open Pro session. The immutable choice belongs on the reservation
-- row because that row is the cross-instance concurrency authority.
ALTER TABLE public.checkout_pending_intents
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS plan_id text,
  ADD COLUMN IF NOT EXISTS billing_period text;

ALTER TABLE public.checkout_pending_intents
  DROP CONSTRAINT IF EXISTS checkout_pending_intents_plan_id_check,
  DROP CONSTRAINT IF EXISTS checkout_pending_intents_billing_period_check;
ALTER TABLE public.checkout_pending_intents
  ADD CONSTRAINT checkout_pending_intents_plan_id_check
    CHECK (plan_id IN ('starter', 'pro')),
  ADD CONSTRAINT checkout_pending_intents_billing_period_check
    CHECK (billing_period IN ('monthly', 'yearly'));

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
     p_plan_id IS NULL OR p_plan_id NOT IN ('starter', 'pro') OR
     p_billing_period IS NULL OR
       p_billing_period NOT IN ('monthly', 'yearly') THEN
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

  -- Keep this eligibility list in step with the original claim RPC. N2 tracks
  -- the separate product decision for recoverable incomplete/unpaid/paused
  -- subscriptions; this migration changes only checkout-choice correctness.
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
