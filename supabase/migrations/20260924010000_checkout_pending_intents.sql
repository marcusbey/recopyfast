-- One durable pending subscription checkout per user. The predecessor stored
-- only a timestamp and allowed authenticated callers to delete the guard.
CREATE TABLE IF NOT EXISTS public.checkout_pending_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  intent text NOT NULL CHECK (intent = 'subscription'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'expired')),
  stripe_session_id text UNIQUE,
  checkout_url text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS checkout_pending_intents_one_pending_user
  ON public.checkout_pending_intents (user_id) WHERE status = 'pending';

ALTER TABLE public.checkout_pending_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages checkout pending intents"
  ON public.checkout_pending_intents;
CREATE POLICY "Service role manages checkout pending intents"
  ON public.checkout_pending_intents FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.checkout_pending_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.checkout_pending_intents TO service_role;

CREATE OR REPLACE FUNCTION public.claim_subscription_checkout_intent(
  p_user_id uuid, p_expires_at timestamptz
)
RETURNS TABLE (id uuid, user_id uuid, stripe_session_id text,
  checkout_url text, expires_at timestamptz, is_new boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pending public.checkout_pending_intents%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  SELECT * INTO pending FROM public.checkout_pending_intents AS candidate
    WHERE candidate.user_id = p_user_id AND candidate.status = 'pending'
    FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT pending.id, pending.user_id, pending.stripe_session_id,
      pending.checkout_url, pending.expires_at, false;
    RETURN;
  END IF;
  -- The completed-session webhook persists even `incomplete` subscriptions
  -- before it finishes the intent. Checking the full non-terminal set in this
  -- same transaction closes the release-then-new-claim race.
  IF EXISTS (
    SELECT 1 FROM public.billing_subscriptions AS subscription
    WHERE subscription.user_id = p_user_id
      AND subscription.status IN (
        'active', 'trialing', 'past_due', 'incomplete', 'paused', 'unpaid'
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'user already has a non-terminal subscription';
  END IF;
  INSERT INTO public.checkout_pending_intents (user_id, intent, expires_at)
    VALUES (p_user_id, 'subscription', p_expires_at) RETURNING * INTO pending;
  RETURN QUERY SELECT pending.id, pending.user_id, pending.stripe_session_id,
    pending.checkout_url, pending.expires_at, true;
END; $$;

CREATE OR REPLACE FUNCTION public.attach_subscription_checkout_session(
  p_intent_id uuid, p_user_id uuid, p_stripe_session_id text, p_checkout_url text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.checkout_pending_intents SET
    stripe_session_id = p_stripe_session_id, checkout_url = p_checkout_url,
    updated_at = now()
  WHERE id = p_intent_id AND user_id = p_user_id AND status = 'pending'
    AND (stripe_session_id IS NULL OR stripe_session_id = p_stripe_session_id);
  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.checkout_pending_intents AS existing
    WHERE existing.id = p_intent_id AND existing.user_id = p_user_id
      AND existing.stripe_session_id = p_stripe_session_id
  ) THEN
    RAISE EXCEPTION 'pending checkout intent not found or session mismatch';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.finish_subscription_checkout_intent(
  p_intent_id uuid, p_stripe_session_id text, p_status text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_status NOT IN ('completed', 'expired') THEN
    RAISE EXCEPTION 'invalid checkout intent terminal status';
  END IF;
  UPDATE public.checkout_pending_intents SET status = p_status, updated_at = now()
  WHERE id = p_intent_id AND stripe_session_id = p_stripe_session_id
    AND status = 'pending';
  -- Zero rows is an idempotent replay or a delayed event for an old pair.
END; $$;

CREATE OR REPLACE FUNCTION public.expire_unattached_subscription_checkout_intent(
  p_intent_id uuid, p_user_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.checkout_pending_intents SET status = 'expired', updated_at = now()
  WHERE id = p_intent_id AND user_id = p_user_id AND status = 'pending'
    AND stripe_session_id IS NULL AND expires_at <= now();
  IF NOT FOUND THEN RAISE EXCEPTION 'unattached expired checkout intent not found'; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.claim_subscription_checkout_intent(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_subscription_checkout_session(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_subscription_checkout_intent(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_unattached_subscription_checkout_intent(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_subscription_checkout_intent(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_subscription_checkout_session(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_subscription_checkout_intent(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_unattached_subscription_checkout_intent(uuid, uuid) TO service_role;
