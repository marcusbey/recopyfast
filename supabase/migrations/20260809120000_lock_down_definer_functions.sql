-- ========================================
-- A-3 / A-5 — the nine SECURITY DEFINER functions still reachable with the
-- published anon key, and the default that keeps re-opening them
-- ========================================
-- 20260805190000_lock_down_content_version_rpcs.sql closed exactly this hole for
-- `create_content_version` and `restore_content_version`, and its header states
-- the rule that makes the REVOKE the fix rather than a mitigation:
--
--   "Postgres grants EXECUTE to PUBLIC on every new function, so the REVOKE
--    FROM PUBLIC is what actually closes this; revoking the named roles alone
--    would leave the implicit grant behind."
--
-- That migration named two functions. Nine more were left behind, and every one
-- of them is a SECURITY DEFINER function in `public`, which means (a) PostgREST
-- publishes it as an RPC endpoint reachable by any browser holding the anon key,
-- and (b) it runs as its owner, so RLS on the tables it writes does not apply.
-- None of them asks who is calling.
--
-- A-3 — content. `revert_staging_content` overwrites `staging_content` with
-- `published_content` for every element of a site in one call, with no history
-- row: total silent destruction of unpublished work. `publish_staging_content`
-- and `publish_staging_content_atomic` push any tenant's drafts live. The only
-- argument any of them needs is a site id, and site ids are public — every
-- customer's embed snippet carries theirs in plain text.
--
-- A-5 — wallet. `add_tickets` and `consume_tickets` take the account they act on
-- as a caller-supplied `user_uuid` that is never compared to `auth.uid()`: mint
-- your own balance, or drain someone else's. The idempotency guard added by
-- 20260731009000:118-119 keys on a payment-intent argument the caller also
-- supplies, so it does not constrain a caller who supplies none.
--
-- Four more the audit's invariant found that its prose did not:
-- `get_user_ticket_balance`, `purge_expired_editor_artifacts`,
-- `update_site_analytics` and `update_translation_coverage`.
--
-- WHY LOCK THE WALLET DOWN RATHER THAN DROP IT
-- -------------------------------------------
-- The three wallet functions are orphaned today — 20260802020000 collapsed
-- spending onto `credit_purchases`, and a search of `src/`, `server/` and
-- `scripts/` finds no caller of any of them. Dropping them is therefore also
-- available, and is the eventual cleanup. It is deliberately not done here: a
-- REVOKE is reversible and a DROP is not, and the exposure is closed either way.
-- Locking them down first means the security fix does not have to wait on
-- proving that no unversioned dashboard, SQL editor snippet or cron job in the
-- Supabase project calls them, which this repository cannot answer.
--
-- CALLERS, CHECKED BEFORE REVOKING
-- --------------------------------
-- Revoking from `authenticated` breaks any caller using a user-scoped client.
-- Every remaining caller of these nine already holds the service role:
--
--   publish_staging_content_atomic  src/app/api/staging/publish/route.ts:110-112
--                                     → createServiceRoleClient()
--                                   server/index.js:1075
--                                     → createClient(url, SUPABASE_SERVICE_ROLE_KEY)
--                                       (server/index.js:153-156)
--   update_site_analytics           src/lib/analytics/tracker.ts:395
--                                     → this.supabase, built at :34-36 with
--                                       SUPABASE_SERVICE_ROLE_KEY
--   the other seven                 no caller in src/, server/ or scripts/
--
-- Both publish routes authorise above the RPC call, so the grant was surface
-- with no purpose — the same conclusion 20260805190000 reached for its two.
--
-- ONE ASSUMPTION, STATED RATHER THAN LEFT IMPLICIT
-- -----------------------------------------------
-- REVOKE has no IF EXISTS, so each statement below requires its function to be
-- present, and aborts the migration if it is not. That holds for every function
-- named here against this repository's migration set — the audit's invariant was
-- run on a scratch database with these migrations applied and found all twelve —
-- and it is the same assumption 20260805190000 makes.
--
-- It is worth naming because this schema has known drift:
-- 20260731008000_rls_policies_for_locked_tables.sql is recorded as having
-- aborted in production, and it is the only migration that creates
-- `user_has_site_permission` and `user_is_team_member`. The reason that is not
-- treated as a hazard here is that 20260801100000:113-128,263-283 creates RLS
-- policies whose expressions call `user_has_site_permission` — a policy cannot be
-- created against a function that does not exist, so if that later migration
-- applied, the function is there. If this migration nonetheless fails on one of
-- these names in some environment, the answer is to repair the migration that
-- should have created it, not to make the REVOKE conditional: a function that is
-- absent cannot be exposed, but one that is present and unrevoked can.
-- ========================================

-- ----------------------------------------
-- A-3 — staging content
-- ----------------------------------------
REVOKE ALL ON FUNCTION publish_staging_content(UUID, UUID[], UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION publish_staging_content(UUID, UUID[], UUID)
  TO service_role;

REVOKE ALL ON FUNCTION revert_staging_content(UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION revert_staging_content(UUID, UUID[])
  TO service_role;

REVOKE ALL ON FUNCTION publish_staging_content_atomic(UUID, TEXT[], UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION publish_staging_content_atomic(UUID, TEXT[], UUID, TEXT)
  TO service_role;

-- ----------------------------------------
-- A-5 — ticket wallet
-- ----------------------------------------
-- `add_tickets` is redefined by 20260731009000:92 with the same signature as
-- 20260617001000:81, so there is one function and one ACL to revoke.
REVOKE ALL ON FUNCTION add_tickets(UUID, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_tickets(UUID, INTEGER, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION consume_tickets(UUID, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION consume_tickets(UUID, INTEGER, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION get_user_ticket_balance(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_user_ticket_balance(UUID)
  TO service_role;

-- ----------------------------------------
-- Housekeeping and analytics
-- ----------------------------------------
-- 20260801100000:517-518 already revoked this one FROM PUBLIC and granted
-- service_role. That leaves the `anon` and `authenticated` grants Supabase's
-- default privileges attach at creation, which is why the invariant still
-- reports it. The REVOKE below is idempotent and closes those two.
REVOKE ALL ON FUNCTION public.purge_expired_editor_artifacts()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_editor_artifacts()
  TO service_role;

-- Same shape: 20260731005000:187 granted service_role and nothing else, so the
-- only grants left to remove are the ones nobody wrote.
REVOKE ALL ON FUNCTION update_site_analytics()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_site_analytics()
  TO service_role;

REVOKE ALL ON FUNCTION update_translation_coverage(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_translation_coverage(UUID)
  TO service_role;

-- ----------------------------------------
-- The three RLS predicates — `authenticated` STAYS
-- ----------------------------------------
-- These are the SECURITY DEFINER predicates the RLS policies themselves call.
-- An RLS policy expression is evaluated with the *querying* role's privileges,
-- so revoking EXECUTE from `authenticated` does not harden them — it breaks
-- every site-scoped policy in the schema. Measured on a scratch database rather
-- than assumed (docs/QA-PRODUCTION-AUDIT-2026-08-07.md, A-3):
--
--   REVOKE EXECUTE ON FUNCTION public.user_has_site_permission(uuid, text[])
--     FROM PUBLIC, anon, authenticated;
--   SET ROLE authenticated;
--   SELECT count(*) FROM site_editors;
--   -- ERROR: permission denied for function user_has_site_permission
--
-- `anon` and PUBLIC are forbidden here exactly as for the nine above. PUBLIC in
-- particular is a wildcard that silently covers every role added in future, and
-- 20260731008000:83-85 / 20260801200000:149 only ever intended
-- `authenticated, service_role`.
--
-- Revoking from PUBLIC does not disturb the explicit `authenticated` grant, and
-- the GRANT is repeated below so the intended end state is stated here in full
-- rather than inferred from three migrations.
REVOKE ALL ON FUNCTION public.user_has_site_permission(UUID, TEXT[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_site_permission(UUID, TEXT[])
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_is_team_member(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_is_team_member(UUID)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_has_team_role(UUID, TEXT[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_team_role(UUID, TEXT[])
  TO authenticated, service_role;

-- ----------------------------------------
-- The root cause: the default is exposure
-- ----------------------------------------
-- Everything above is retrospective. It closes eleven functions and says nothing
-- about the twelfth, because Supabase ships
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
--
-- and Postgres itself grants EXECUTE to PUBLIC on every new function. So the
-- next SECURITY DEFINER function anybody adds is reachable with the anon key the
-- moment it is created, with no migration saying so — which is how nine of these
-- got here. Removing the defaults makes a new function private until a migration
-- deliberately grants it, so a missed REVOKE is no longer a silent exposure.
--
-- `service_role` is left in place: it is the role every server-side caller in
-- this repository holds.
--
-- Two limits worth stating plainly rather than discovering later:
--
--   1. Default privileges are per-granting-role. The form below alters them for
--      the role running this migration — `postgres` in a Supabase project, which
--      is also the role that created every function above. A function created by
--      some other role still picks up that role's defaults.
--   2. This changes nothing about functions that already exist. It is the guard
--      for the next one, and `src/__tests__/db/function-grants.test.ts` is what
--      catches it if this guard is ever undone.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
