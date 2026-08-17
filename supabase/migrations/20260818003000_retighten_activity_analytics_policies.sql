-- ========================================
-- Re-tighten the policies a replay widened, and drop the duplicates it left
-- ========================================
-- SELF-INFLICTED, 2026-08-17, and recorded plainly so the mechanism is not repeated.
--
-- `20260731007000_rls_analytics_and_ab_tests` was replayed against production as part
-- of the schema repair — it had aborted originally on a table that did not exist yet.
-- The replay worked, but that file writes its policies with **no `TO` clause**, which
-- in PostgreSQL means PUBLIC. `20260804130000_restore_missing_rls_policies` had since
-- rewritten the same policy names scoped `TO authenticated`. Replaying therefore
-- dropped-and-recreated the strict versions with the loose ones:
--
--   user_activity_logs  "Users can view their own activity"   {authenticated} → {public}
--   user_activity_logs  "Site members can view site activity"              {public}
--   site_analytics      "Site members can view site analytics"             {public}
--
-- and left duplicate service_role ALL policies on both tables, because the two
-- migrations named them differently for the same grant.
--
-- NO ROWS WERE EVER EXPOSED. Every predicate tests `auth.uid()`, which is NULL for
-- `anon`, so no row matches for an unauthenticated caller either way. This is a
-- widening of the DECLARED grant, not of the effective one — but a policy whose
-- declared role does not match its intent is a landmine for the next reader, and
-- duplicated policies are OR'd, so the loosest one silently wins any future edit.
--
-- THE GENERAL LESSON, worth more than this fix: replaying an aborted migration is
-- safe for what it CREATES and unsafe for what it REPLACES. A file written before a
-- later hardening will happily undo that hardening. Check for policy and grant
-- overlap before replaying, not only for whether the file runs.
-- ========================================

-- ----------------------------------------
-- site_analytics
-- ----------------------------------------
-- "Site members can view site analytics" (public, from 20260731007000) and "Users can
-- view analytics for their sites" (authenticated, from 20260804130000) carry BYTE-
-- IDENTICAL predicates — verified against pg_policies, not assumed. The public one is
-- therefore pure duplication with a looser declared role: drop it, keep the strict one.
DROP POLICY IF EXISTS "Site members can view site analytics" ON site_analytics;

-- Duplicate service_role ALL grant. 20260804130000's name is kept as the survivor,
-- since that is the migration whose intent currently governs this table.
DROP POLICY IF EXISTS "Service role can manage site analytics" ON site_analytics;

-- ----------------------------------------
-- user_activity_logs
-- ----------------------------------------
-- Both SELECT policies are genuinely distinct here — one is user-scoped, the other
-- site-scoped — so both are kept, and both are re-scoped TO authenticated.
DROP POLICY IF EXISTS "Users can view their own activity" ON user_activity_logs;
CREATE POLICY "Users can view their own activity"
  ON user_activity_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Site members can view site activity" ON user_activity_logs;
CREATE POLICY "Site members can view site activity"
  ON user_activity_logs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM site_permissions sp
     WHERE sp.site_id = user_activity_logs.site_id
       AND sp.user_id = auth.uid()
  ));

-- Duplicate service_role ALL grant, same reasoning as above.
DROP POLICY IF EXISTS "Service role can manage user activity logs" ON user_activity_logs;

-- ----------------------------------------
-- Postconditions
-- ----------------------------------------
DO $$
DECLARE
  v_loose TEXT;
  v_tbl   TEXT;
  v_n     INT;
BEGIN
  -- 1. No policy on either table may still be declared for PUBLIC.
  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname)
    INTO v_loose
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('user_activity_logs', 'site_analytics')
     AND 'public' = ANY (roles);

  IF v_loose IS NOT NULL THEN
    RAISE EXCEPTION 'Policies still declared TO PUBLIC: %', v_loose;
  END IF;

  -- 2. Exactly one service_role ALL policy per table — the duplicates are gone.
  FOREACH v_tbl IN ARRAY ARRAY['user_activity_logs', 'site_analytics'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = v_tbl
       AND cmd = 'ALL' AND 'service_role' = ANY (roles);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Expected exactly 1 service_role ALL policy on %, found %', v_tbl, v_n;
    END IF;
  END LOOP;

  -- 3. Neither table may be left without a policy — RLS on with none is a lockout.
  FOREACH v_tbl IN ARRAY ARRAY['user_activity_logs', 'site_analytics'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_policies WHERE schemaname = 'public' AND tablename = v_tbl;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'Table % has RLS enabled and no policies — total lockout', v_tbl;
    END IF;
  END LOOP;
END $$;
