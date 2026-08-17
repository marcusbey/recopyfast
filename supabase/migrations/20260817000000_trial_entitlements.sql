-- s01 — the 14-day Pro trial, modelled as a time-boxed grant (ADR 014).
--
-- The trial is NOT a new plan. `loadPlanCatalogue` maps every active row before
-- returning any of them and throws on any id outside the
-- SubscriptionPlanId/OneTimeProductId unions (src/lib/stripe/plans.ts:206-236,
-- :283-288), so a single `trial` row would take down /api/pricing, every
-- checkout and every feature gate in the same request — not just the pricing
-- feed. The database agrees independently: plans_only_one_time_grants forbids
-- grants_plan_id on a kind='subscription' row, forcing a trial row into exactly
-- the branch that throws.
--
-- So the trial reuses the row shape a Lifetime Pro purchase already writes into
-- plan_entitlements — {plan_id: 'pro'} — and differs in only two ways: it is
-- tagged source = 'trial', and it stops counting on a date.

-- ============================================================
-- 1. A grant that can lapse
-- ============================================================
-- Nullable, and NULL keeps meaning "never expires". Every existing lifetime row
-- therefore needs no backfill, and a missed backfill cannot silently revoke a
-- $199 purchase. This is also the shape `credit_purchases.expires_at` already
-- has, so `spendableFilter()`'s `expires_at.is.null,expires_at.gt.<now>` filter
-- transfers to it verbatim.
ALTER TABLE public.plan_entitlements
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.plan_entitlements.expires_at IS
  'When this grant stops entitling. NULL = never (a lifetime purchase or a support comp). Filtered inside readEffectivePlanId''s query, never checked after it — see ADR 014.';

-- ============================================================
-- 2. One trial per account, ever
-- ============================================================
-- AC 6 is a uniqueness constraint, not a code check. Both server-side sign-in
-- touchpoints (/auth/callback and /auth/confirm) fire on EVERY sign-in, not
-- just the first, and two concurrent sign-ins can both pass an application-level
-- "have they trialled?" read before either writes. Postgres is the only place
-- that can answer this once.
--
-- Partial on source = 'trial' so it constrains nothing else: an account may
-- still hold several lifetime/comp grants, which readGrantedPlanIds relies on.
-- It also survives site deletion, because nothing about a site touches this
-- table — "delete every site and start a fresh trial" is closed by construction.
--
-- Deliberately NOT scoped to `revoked_at IS NULL`: a revoked trial is a spent
-- trial. Making the index partial on revocation too would let a revocation hand
-- out a second free 14 days.
CREATE UNIQUE INDEX IF NOT EXISTS plan_entitlements_one_trial_per_user
  ON public.plan_entitlements (user_id) WHERE source = 'trial';

-- ============================================================
-- 3. RLS
-- ============================================================
-- No policy change. plan_entitlements already carries RLS with SELECT-own for
-- `authenticated` and writes reserved to service_role
-- (20260802000000_plans_catalog.sql:242-260); those policies are row-scoped and
-- cover the new column with no restatement. A trial row is worth 14 days of Pro,
-- so it is written by a server route as service_role for the same reason a
-- lifetime grant is — never from the browser.
