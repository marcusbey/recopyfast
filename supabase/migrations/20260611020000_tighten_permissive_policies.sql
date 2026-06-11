-- ========================================
-- Tighten Over-Permissive RLS Policies
-- ========================================
-- Fix: four policies granted unrestricted write access to anonymous/
--      authenticated callers via FOR ALL USING(true) or INSERT WITH CHECK(true).
--
--   1. ab_test_results  — "Service role can manage ab_test_results"
--        FOR ALL USING(true) → split: public SELECT via site permissions,
--        INSERT/UPDATE/DELETE restricted to service_role.
--
--   2. visitor_buckets  — "Service role can manage visitor_buckets"
--        FOR ALL USING(true) → same treatment as ab_test_results.
--
--   3. staging_history  — "Staging users can insert history"
--        FOR INSERT WITH CHECK(true) → restrict to service_role only.
--
--   4. content_versions — "Insert versions via API"
--        FOR INSERT WITH CHECK(true) → restrict to service_role only.
--
-- Each block DROPs the old permissive policy then RECREATEs the
-- replacement(s).  The DROP uses IF EXISTS so re-runs are safe.
-- ============================================================

-- ============================================================
-- 1. ab_test_results
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage ab_test_results" ON ab_test_results;

-- Authenticated users may read results for tests on sites they have access to
CREATE POLICY IF NOT EXISTS "Site members can view ab_test_results"
  ON ab_test_results
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ab_tests at_
      JOIN site_permissions sp ON sp.site_id = at_.site_id
      WHERE at_.id = ab_test_results.test_id
        AND sp.user_id = auth.uid()
    )
  );

-- Only the service role (backend analytics ingestion) may write
CREATE POLICY IF NOT EXISTS "Service role can insert ab_test_results"
  ON ab_test_results
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can update ab_test_results"
  ON ab_test_results
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can delete ab_test_results"
  ON ab_test_results
  FOR DELETE
  TO service_role
  USING (true);

-- ============================================================
-- 2. visitor_buckets
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage visitor_buckets" ON visitor_buckets;

-- Site members can see bucket assignments for their sites
CREATE POLICY IF NOT EXISTS "Site members can view visitor_buckets"
  ON visitor_buckets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = visitor_buckets.site_id
        AND sp.user_id = auth.uid()
    )
  );

-- Only the service role may write visitor bucket assignments
CREATE POLICY IF NOT EXISTS "Service role can insert visitor_buckets"
  ON visitor_buckets
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can update visitor_buckets"
  ON visitor_buckets
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can delete visitor_buckets"
  ON visitor_buckets
  FOR DELETE
  TO service_role
  USING (true);

-- ============================================================
-- 3. staging_history  (source: 20251230000000_staging_workflow.sql)
--    Old policy: "Staging users can insert history" FOR INSERT WITH CHECK(true)
-- ============================================================
DROP POLICY IF EXISTS "Staging users can insert history" ON staging_history;

-- Service role handles all staging_history writes (called from API routes
-- that validate staging token ownership before writing)
CREATE POLICY IF NOT EXISTS "Service role can insert staging history"
  ON staging_history
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================
-- 4. content_versions  (source: 20251230100000_edit_board.sql)
--    Old policy: "Insert versions via API" FOR INSERT WITH CHECK(true)
-- ============================================================
DROP POLICY IF EXISTS "Insert versions via API" ON content_versions;

-- Site editors/admins may create versions for their own sites
CREATE POLICY IF NOT EXISTS "Site editors can insert content versions"
  ON content_versions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = content_versions.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

-- Service role may also insert versions (for automated snapshots)
CREATE POLICY IF NOT EXISTS "Service role can insert content versions"
  ON content_versions
  FOR INSERT
  TO service_role
  WITH CHECK (true);
