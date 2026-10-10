-- s47a — the founding offer: the first 20 accounts get Pro free for 90 days,
-- metered at 100 AI credits a month, no card (ADR 039).
--
-- DESIGN. The offer is the account's ONE trial row — `plan_entitlements`,
-- `plan_id = 'pro'`, `source = 'trial'`, no payment intent — lengthened to 90
-- days and marked `offer_id = 'founding_20'`. It is not a new `source` and not a
-- `plans` row:
--
--   * `plan_entitlements_one_trial_per_user` (20260817000000) is a partial
--     unique index on `(user_id) WHERE source = 'trial'`. It is the only thing
--     standing between a lapsed grant and a second free trial: an expired grant
--     resolves to "no plan", and `ensureTrialStarted` then tries the 14-day
--     insert. On an offer row that insert returns 23505 and the account stays
--     "no plan". Under any other `source` it would succeed.
--   * Every reader that singles out trials (`readGrantedPlanIds`,
--     `otherHeldPlans`, `readTrialGrant`) already handles a trial row
--     correctly; a new source would have to be threaded through all three.
--   * A second catalogue product granting `pro` makes `loadPlanCatalogue` throw,
--     which takes down pricing, checkout and every gate.
--
-- CONSTANTS. 20 spots and 90 days live here, in SQL, where the grant is written
-- under the lock on the database clock (precedent: 50 in
-- reserve_founding_agency_spot). 20 appears in claim_founding_offer_spot and in
-- get_founding_offer_availability, which returns it as `spot_limit` so the
-- application never restates it; change both together. The 100 monthly credits
-- are an allowance term, read by the resolver from FOUNDING_OFFER_TERMS in
-- src/lib/billing/founding-offer.ts.
--
-- RELEASE MUST NOT REWRITE `source`. The house revocation
-- (`revokeEntitlementForPayment`) rewrites `source` to `revoked:<reason>`. On an
-- offer row that takes it out of the one-trial index, and the released QA
-- account gets a fresh 14-day trial on its next sign-in instead of "no plan".
-- release_founding_offer_spot sets `revoked_at` only, and the CHECK on
-- `plan_entitlements` makes the database refuse any rewrite of an offer row's
-- `source`, whoever attempts it.
--
-- DEPLOY ORDER: THIS MIGRATION FIRST, THEN THE APPLICATION. The new resolver
-- selects `plan_entitlements.offer_id`. Deployed before the column exists,
-- PostgREST errors, `readEffectivePlanBasis` throws, and every gate and every
-- route that resolves entitlement fails for every account (middleware only
-- hides it by failing open). The old application never reads the column or
-- calls these functions, so applying this first is safe: it keeps granting
-- 14-day trials until the new code ships. Runbook:
-- docs/operations/founding-offer.md.

-- ============================================================
-- 1. The offer, and the moment it opened
-- ============================================================
CREATE TABLE IF NOT EXISTS public.founding_offers (
  id TEXT PRIMARY KEY,
  opened_at TIMESTAMPTZ NOT NULL
);

-- ON CONFLICT DO NOTHING: a re-run must never move `opened_at`, which decides
-- which accounts are "created after the offer opened".
INSERT INTO public.founding_offers (id, opened_at)
VALUES ('founding_20', NOW())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.founding_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages founding offers"
  ON public.founding_offers;
CREATE POLICY "Service role manages founding offers"
  ON public.founding_offers FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.founding_offers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.founding_offers TO service_role;

-- ============================================================
-- 2. The marker on the grant
-- ============================================================
-- Nullable: every existing row, trial or purchase, is not an offer row and
-- needs no backfill.
ALTER TABLE public.plan_entitlements
  ADD COLUMN IF NOT EXISTS offer_id TEXT REFERENCES public.founding_offers (id);

COMMENT ON COLUMN public.plan_entitlements.offer_id IS
  'Set only on a founding offer grant, which is the account''s one trial row (ADR 039). The resolver meters it at the offer''s monthly allowance.';

-- An offer row is a trial row, for Pro, that nobody paid for — and it stays
-- one. This is what refuses the house revocation's `source` rewrite (23514) on
-- an offer row; see RELEASE above.
ALTER TABLE public.plan_entitlements
  DROP CONSTRAINT IF EXISTS plan_entitlements_offer_is_a_trial;
ALTER TABLE public.plan_entitlements
  ADD CONSTRAINT plan_entitlements_offer_is_a_trial
  CHECK (
    offer_id IS NULL
    OR (
      source = 'trial'
      AND plan_id = 'pro'
      AND stripe_payment_intent_id IS NULL
    )
  );

-- ============================================================
-- 3. The claims ledger
-- ============================================================
CREATE TABLE IF NOT EXISTS public.founding_offer_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id TEXT NOT NULL REFERENCES public.founding_offers (id),
  -- SET NULL, never CASCADE: deleting an account removes its grant but must not
  -- turn its claim back into a free spot (precedent:
  -- founding_agency_reservations.user_id, 20260924065000).
  user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  -- `plan_entitlements.user_id` cascades on account deletion, so this link
  -- must let go of the row rather than block the delete.
  entitlement_id UUID REFERENCES public.plan_entitlements (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'released')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  release_reason TEXT,
  CONSTRAINT founding_offer_claims_release_coherent
    CHECK ((status = 'released') = (released_at IS NOT NULL))
);

-- One claim per account per offer, whatever its status: a released account
-- has spent its claim.
CREATE UNIQUE INDEX IF NOT EXISTS founding_offer_claims_one_per_account
  ON public.founding_offer_claims (offer_id, user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.founding_offer_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages founding offer claims"
  ON public.founding_offer_claims;
CREATE POLICY "Service role manages founding offer claims"
  ON public.founding_offer_claims FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.founding_offer_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.founding_offer_claims TO service_role;

-- ============================================================
-- 4. Claiming a spot
-- ============================================================
-- The only writer of an offer row. Eligible, under the lock, trial row and
-- claim row together or neither.
--
-- Eligible means: the account was created at or after the offer opened (a NULL
-- created_at fails closed), and it has NEVER had a `plan_entitlements`,
-- `billing_subscriptions` or `credit_purchases` row — revoked, expired,
-- cancelled and spent rows included. `ensureTrialStarted` only calls this for
-- an account resolving to "no plan", which also covers lapsed trials, refunded
-- lifetimes and cancelled subscriptions; each of those is refused here and
-- falls back to today's 14-day insert, which the one-trial index then decides.
--
-- The checks run twice: once without the lock, so that after sell-out a
-- sign-in never queues on it, and again under it, because only the locked pass
-- can count. The unlocked pass only ever refuses. Its own key, not
-- `founding_agency_capacity`, so sign-ins never wait behind Stripe checkouts.
-- A blocking lock, not a try-lock: a try-lock would hand the 14-day trial to an
-- account that arrived while spots remained.
--
-- The trial row is inserted FIRST and 23505 is never caught. If a parallel
-- sign-in's 14-day fallback lands first, this insert fails and the whole
-- transaction, claim row included, rolls back; no claim ever exists without its
-- row. If this commits and its response is lost, the caller's fallback insert
-- hits the index and reports a duplicate.
CREATE OR REPLACE FUNCTION public.claim_founding_offer_spot(p_user_id UUID)
RETURNS TABLE (outcome TEXT, entitlement_id UUID, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pass INTEGER;
  v_is_eligible BOOLEAN;
  v_claimed INTEGER;
  v_entitlement_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  FOR v_pass IN 1..2 LOOP
    IF v_pass = 2 THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('founding_offer_capacity', 0));
    END IF;

    SELECT EXISTS (
             SELECT 1
             FROM auth.users AS account
             JOIN public.founding_offers AS offer ON offer.id = 'founding_20'
             WHERE account.id = p_user_id
               AND account.created_at IS NOT NULL
               AND account.created_at >= offer.opened_at
           )
       AND NOT EXISTS (
             SELECT 1 FROM public.plan_entitlements AS grant_row
             WHERE grant_row.user_id = p_user_id
           )
       AND NOT EXISTS (
             SELECT 1 FROM public.billing_subscriptions AS subscription
             WHERE subscription.user_id = p_user_id
           )
       AND NOT EXISTS (
             SELECT 1 FROM public.credit_purchases AS purchase
             WHERE purchase.user_id = p_user_id
           )
      INTO v_is_eligible;

    IF NOT v_is_eligible THEN
      RETURN QUERY SELECT 'ineligible'::TEXT, NULL::UUID, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    SELECT COUNT(*)::INTEGER INTO v_claimed
    FROM public.founding_offer_claims AS claim
    WHERE claim.offer_id = 'founding_20'
      AND claim.status = 'claimed';

    IF v_claimed >= 20 THEN
      RETURN QUERY SELECT 'sold_out'::TEXT, NULL::UUID, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
  END LOOP;

  INSERT INTO public.plan_entitlements AS grant_row (
    user_id, plan_id, source, stripe_payment_intent_id,
    granted_at, expires_at, offer_id
  ) VALUES (
    p_user_id, 'pro', 'trial', NULL,
    NOW(), NOW() + INTERVAL '90 days', 'founding_20'
  )
  RETURNING grant_row.id, grant_row.expires_at
    INTO v_entitlement_id, v_expires_at;

  INSERT INTO public.founding_offer_claims AS claim (
    offer_id, user_id, entitlement_id
  ) VALUES (
    'founding_20', p_user_id, v_entitlement_id
  );

  RETURN QUERY SELECT 'claimed'::TEXT, v_entitlement_id, v_expires_at;
END;
$$;

-- ============================================================
-- 5. The public count
-- ============================================================
-- Aggregate only, never identities. Takes no lock: a count is exact at its
-- snapshot, and locking would queue landing-page views behind sign-ins.
-- Released claims are not counted — releasing a QA account's spot gives it back.
CREATE OR REPLACE FUNCTION public.get_founding_offer_availability()
RETURNS TABLE (
  spot_limit INTEGER,
  claimed INTEGER,
  remaining INTEGER,
  sold_out BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ledger AS (
    SELECT COUNT(*)::INTEGER AS claimed
    FROM public.founding_offer_claims AS claim
    WHERE claim.offer_id = 'founding_20'
      AND claim.status = 'claimed'
  )
  SELECT 20, ledger.claimed, GREATEST(20 - ledger.claimed, 0), ledger.claimed >= 20
  FROM ledger;
$$;

-- ============================================================
-- 6. The operator release
-- ============================================================
-- Service-role only; documented in docs/operations/founding-offer.md. Sets the
-- claim to released and the linked grant's `revoked_at` — and nothing else on
-- the grant (see RELEASE above). The released account resolves to "no plan",
-- stays ineligible for a new claim (it has a plan_entitlements row), and cannot
-- get a 14-day trial (the one-trial index).
CREATE OR REPLACE FUNCTION public.release_founding_offer_spot(
  p_user_id UUID,
  p_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim_id UUID;
  v_status TEXT;
  v_entitlement_id UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'a founding offer release needs a reason';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('founding_offer_capacity', 0));

  SELECT claim.id, claim.status, claim.entitlement_id
    INTO v_claim_id, v_status, v_entitlement_id
  FROM public.founding_offer_claims AS claim
  WHERE claim.offer_id = 'founding_20'
    AND claim.user_id = p_user_id
  FOR UPDATE;

  IF v_claim_id IS NULL THEN
    RETURN 'not_claimed';
  END IF;

  IF v_status = 'released' THEN
    RETURN 'already_released';
  END IF;

  UPDATE public.founding_offer_claims AS claim
  SET status = 'released',
      released_at = NOW(),
      release_reason = btrim(p_reason)
  WHERE claim.id = v_claim_id;

  UPDATE public.plan_entitlements AS grant_row
  SET revoked_at = COALESCE(grant_row.revoked_at, NOW())
  WHERE grant_row.id = v_entitlement_id;

  RETURN 'released';
END;
$$;

-- ============================================================
-- 7. Function grants
-- ============================================================
-- Supabase grants EXECUTE on every new function to anon and authenticated by
-- default, and PostgREST publishes each one as an RPC. All three are
-- service-role only (src/__tests__/db/function-grants.test.ts, rule 1).
REVOKE ALL ON FUNCTION public.claim_founding_offer_spot(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_founding_offer_availability()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_founding_offer_spot(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_founding_offer_spot(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_founding_offer_availability() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_founding_offer_spot(UUID, TEXT) TO service_role;
