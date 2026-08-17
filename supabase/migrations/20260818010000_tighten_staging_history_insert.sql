-- ============================================================
-- staging_history: close an unauthenticated cross-tenant INSERT
-- ============================================================
-- Found 2026-08-17 by a standing security audit, then confirmed against the
-- live database rather than inferred from these files. Measured state:
--
--   policy "Staging users can insert history"  cmd=INSERT  roles=PUBLIC
--                                              WITH CHECK (true)
--   GRANT INSERT/UPDATE/DELETE/TRUNCATE ON staging_history TO anon, authenticated
--
-- WITH CHECK (true) to PUBLIC, combined with an INSERT grant to **anon**, means
-- the write needed no account at all: the anon key ships in every page bundle
-- by design (NEXT_PUBLIC_SUPABASE_ANON_KEY), and `content_element_id` is
-- returned by GET /api/content/[siteId]. Anyone could POST straight to PostgREST
-- and forge edit-audit rows against another tenant's content, attributed to any
-- address they chose, bypassing the API entirely.
--
-- `staging_history` had **0 rows** at the time of the fix, so nothing was
-- exploited. RLS was on the whole time — RLS was not the hole; a permissive
-- policy plus an over-broad grant was.
--
-- ── Why it was live ────────────────────────────────────────────────────────
-- This is not a new mistake. `20260611020000_tighten_permissive_policies.sql`
-- section 3 (:108-121) fixes exactly this, and that file is marked applied in
-- the ledger. It never ran: its FIRST executable statement (:27) is
-- `DROP POLICY IF EXISTS ... ON ab_test_results`, and `ab_test_results` did not
-- exist in production until 2026-08-17. `IF EXISTS` guards the policy, not the
-- relation, so the statement raised 42P01, the whole file rolled back inside its
-- transaction, and the ledger recorded success anyway.
--
-- `20260818000000_repair_aborted_migrations.sql:115-118` folded in that file's
-- ab_test_results/visitor_buckets half and, understandably, not this one. This
-- migration is the remainder. Section 4 (content_versions) is NOT replayed here:
-- that table was verified already tight — service_role ALL, authenticated SELECT
-- only, no permissive INSERT.
--
-- ── Why the test suite could not catch it ──────────────────────────────────
-- `src/__tests__/db/rls-policies.test.ts:57-90` asserts this exact shape and is
-- correct. It runs against a LOCAL Supabase built by replaying the files, where
-- 20260611020000 applies cleanly because ab_test_results exists by then. A test
-- built from the same files can never see a marked-applied-but-aborted
-- production state. `scripts/check-schema.mjs` misses it too: it counts policies,
-- and a permissive policy still counts as one.
--
-- The instrument that does find it is a catalogue query for permissive write
-- policies (polcmd IN ('a','w','d','*') AND with_check/qual = 'true'). Run
-- against production, it returned exactly this one row across all 57 tables —
-- so the blast radius is this table alone, not a class of drift.
-- ============================================================

-- 1. Replace the permissive policy with a service_role-scoped one.
--    Every write to this table comes from src/app/api/staging/content/[siteId],
--    which uses the service-role client after validating staging-token
--    ownership. Nothing legitimate loses access.
DROP POLICY IF EXISTS "Staging users can insert history" ON staging_history;

DROP POLICY IF EXISTS "Service role can insert staging history" ON staging_history;
CREATE POLICY "Service role can insert staging history"
  ON staging_history
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 2. Revoke the grants that made the policy reachable.
--    Defence in depth: with the policy fixed, these grants alone are not
--    sufficient — but they are not needed either, and leaving them means the
--    next permissive policy on this table is immediately exploitable again.
--    SELECT is kept for `authenticated`: the "Site admins can view staging
--    history" policy scopes it through site_permissions and the dashboard
--    depends on it. `anon` keeps nothing — its auth.uid() is NULL, so that
--    policy already returns zero rows for it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON staging_history FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON staging_history FROM authenticated;
REVOKE SELECT ON staging_history FROM anon;

-- 3. Postconditions. Fail loudly inside the transaction rather than leaving a
--    half-applied state marked as success — the exact failure mode that put
--    this policy in production for two months.
DO $$
DECLARE
  permissive_count int;
  anon_write_count int;
BEGIN
  SELECT count(*) INTO permissive_count
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relname = 'staging_history'
    AND p.polcmd IN ('a', 'w', 'd', '*')
    AND (p.polroles = '{0}'
         OR EXISTS (SELECT 1 FROM pg_roles r
                    WHERE r.oid = ANY (p.polroles)
                      AND r.rolname IN ('anon', 'authenticated')));

  IF permissive_count > 0 THEN
    RAISE EXCEPTION
      'staging_history still has % write policy(ies) reachable by anon/authenticated/PUBLIC',
      permissive_count;
  END IF;

  SELECT count(*) INTO anon_write_count
  FROM information_schema.role_table_grants
  WHERE table_name = 'staging_history'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  IF anon_write_count > 0 THEN
    RAISE EXCEPTION
      'staging_history still grants % write privilege(s) to anon/authenticated',
      anon_write_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'staging_history'
      AND p.polname = 'Service role can insert staging history'
  ) THEN
    RAISE EXCEPTION 'staging_history lost its service_role INSERT policy';
  END IF;
END $$;
