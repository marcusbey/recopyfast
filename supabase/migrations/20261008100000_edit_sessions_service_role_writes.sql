-- ============================================================
-- edit_sessions: only the service role writes it (s68a, ADR 047)
-- ============================================================
-- THE INCIDENT (H1). An edit session is a bearer credential: whoever presents
-- `body.editToken` or `?rcf_edit_token=` is treated as its holder, and every
-- route that accepts one (staging publish, staging content, staging validate,
-- AI suggest, edit-session extend and validate) used to grant exactly the
-- permissions written INSIDE the row. The row was writable by its own holder:
--
--   "Users can create edit sessions for sites they have access to"
--   (20250817000000_complete_database_setup.sql:483-492)
--   FOR INSERT to PUBLIC
--   WITH CHECK (user_id = auth.uid() AND <an edit or admin row exists>)
--
-- It constrains WHO inserts, never WHAT. `anon` and `authenticated` also held
-- Supabase's default `arwdDxt` on the table; no migration granted it, none
-- revoked it. Reproduced on a fresh replay of these files on 2026-10-08: an
-- `edit` member's own JWT inserted
--
--   { permissions: ['admin'], expires_at: '2099-01-01' }
--
-- and the row was accepted. Presented with no cookie, it passed
-- `requireEditorPermission(access, "publish")` in POST /api/staging/publish
-- and published to the live site. The owner's read-only SQL of the same day
-- shows the same policy and the same grants in production.
--
-- WHY A REVOKE, AND NOT A TIGHTER WITH CHECK. A predicate comparing the
-- stored permissions with the member's level would close issuance and leave
-- the validator trusting a stored value — and the next path that writes this
-- row reopens the hole (20260803010000's header records a restore migration
-- that already reverted a fix on this exact table). ADR 047 moves authority
-- out of the row: the validator now intersects the row with the holder's LIVE
-- `site_permissions` row and refuses anything past 24 h from issue
-- (src/lib/auth/editor-access.ts). This migration closes the other half: the
-- application issues sessions through the service role
-- (EditSessionManager.createEditSession), so no web principal keeps a write.
--
-- WHAT THIS DOES.
--   1. Drops the INSERT policy.
--   2. Revokes INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER from
--      PUBLIC, `anon` and `authenticated`, and SELECT from PUBLIC and `anon`.
--      Enumerated, never `REVOKE ALL`: `authenticated` keeps SELECT, read
--      under the own-rows policy by GET /api/edit-sessions/active. `MAINTAIN`
--      is not named: it exists from PostgreSQL 17 only, and every migration is
--      also parsed on PostgreSQL 14 (scripts/run-db-invariants.mjs).
--   3. Grants `service_role` its DML explicitly — issuance, revoke, extend and
--      removal now lean on it. Idempotent where it already holds it.
--   4. Deactivates every active row the new validator would refuse: no holder
--      (`user_id` NULL — the old e2e seeds wrote those), a lifetime past
--      24 h from `created_at` (a directly inserted 2099 row), a `created_at`
--      more than 5 minutes in the future (review M1: the holder could write
--      it too, and a row dated 2099 had a negative age that never reached the
--      ceiling — the validator's skew tolerance is the same 5 minutes), or
--      permissions above the holder's live direct grant. A legitimate row
--      always has a holder, `expires_at <= created_at + 24 h` (create caps one
--      grant at 24 h, extend stops at the absolute 24 h ceiling), a
--      database-stamped `created_at` and permissions within the level it was
--      issued under. A legitimate admin since demoted or removed IS
--      deactivated — correct under ADR 047. `revoked_at` is kept when already
--      set, so a retry does not rewrite history.
--   5. Asserts the end state (postcondition): the push aborts, in its
--      transaction, if any write grant, column write grant or write policy
--      for a web principal survives.
--
-- PROOF. src/__tests__/db/edit-sessions-privileges.test.ts — catalogue, a
-- role-switched member INSERT refused with 42501, this file re-run twice over
-- planted rogue and legitimate rows, and (on the Supabase stack) a real GoTrue
-- JWT refused by PostgREST. Run by scripts/run-db-invariants.mjs and by the CI
-- e2e job, both with RCF_REQUIRE_TEST_DB=1.
--
-- DEPLOY ORDER: APPLICATION FIRST, THEN THIS MIGRATION — the s56 order. Old
-- code on this schema cannot issue sessions (its user-JWT insert is refused);
-- new code issues through the service role and validates against the live
-- grant on either schema. Runbook: docs/operations/edit-session-authority.md.
-- Rollback is a NEW forward migration re-creating the policy and the
-- `authenticated` INSERT grant — never an edit of this file.
-- ============================================================

-- 1. The member write policy.
DROP POLICY IF EXISTS "Users can create edit sessions for sites they have access to"
  ON public.edit_sessions;

-- 2. The web principals' privileges.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.edit_sessions
  FROM PUBLIC, anon, authenticated;

REVOKE SELECT ON public.edit_sessions FROM PUBLIC, anon;

GRANT SELECT ON public.edit_sessions TO authenticated;

-- 3. The one principal that writes it, explicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.edit_sessions TO service_role;

-- 4. Retire every session the validator would now refuse.
UPDATE public.edit_sessions s
   SET is_active = false,
       revoked_at = COALESCE(s.revoked_at, now())
 WHERE s.is_active
   AND (
     s.user_id IS NULL
     OR s.expires_at > s.created_at + interval '24 hours'
     OR s.created_at > now() + interval '5 minutes'
     OR NOT EXISTS (
       SELECT 1
         FROM public.site_permissions p
        WHERE p.site_id = s.site_id
          AND p.user_id = s.user_id
          AND (
            p.permission = 'admin'
            OR (p.permission = 'edit' AND s.permissions <@ ARRAY['view', 'edit']::TEXT[])
            OR (p.permission = 'view' AND s.permissions <@ ARRAY['view']::TEXT[])
          )
     )
   );

-- 5. Postcondition. Table privileges, column privileges (a column grant is a
-- write grant a table check misses — ADR 033) and write policies, for every
-- web principal. `public` is how has_*_privilege names the PUBLIC pseudo-role.
DO $$
DECLARE
  v_offenders TEXT;
BEGIN
  SELECT string_agg(o.offender, ', ' ORDER BY o.offender) INTO v_offenders
    FROM (
      SELECT w.role || ' ' || p.priv AS offender
        FROM (VALUES ('public'), ('anon'), ('authenticated')) AS w(role)
       CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                          ('REFERENCES'), ('TRIGGER')) AS p(priv)
       WHERE has_table_privilege(w.role, 'public.edit_sessions', p.priv)
      UNION ALL
      SELECT w.role || ' ' || p.priv || ' (column)'
        FROM (VALUES ('public'), ('anon'), ('authenticated')) AS w(role)
       CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('REFERENCES')) AS p(priv)
       WHERE has_any_column_privilege(w.role, 'public.edit_sessions', p.priv)
      UNION ALL
      SELECT 'policy ' || pol.polname
        FROM pg_policy pol
       WHERE pol.polrelid = 'public.edit_sessions'::regclass
         AND pol.polcmd IN ('a', 'w', 'd', '*')
         AND (
           pol.polroles = '{0}'
           OR EXISTS (
             SELECT 1 FROM unnest(pol.polroles) r
              WHERE pg_get_userbyid(r) IN ('anon', 'authenticated')
           )
         )
    ) AS o;

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'edit_sessions is still writable by a web principal: %', v_offenders;
  END IF;
END $$;
