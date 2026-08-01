-- ========================================
-- RLS Hardening, Round 2: analytics + A/B testing tables
-- ========================================
-- 20260611010000_rls_hardening.sql covered the billing/collaboration gaps but
-- left five tables with no RLS at all.  Without RLS, Supabase's default grants
-- on the public schema let any holder of the public anon key read — and in most
-- cases write — every row in them:
--
--   ab_tests, ab_test_variants, performance_metrics, site_analytics,
--   user_activity_logs
--
-- Ownership follows the established model: site scope flows through
-- site_permissions → sites, and service-role write paths get explicit policies
-- so the backend keeps working.  Idempotent: DROP POLICY IF EXISTS precedes
-- every CREATE POLICY and ENABLE ROW LEVEL SECURITY is safe to re-run.
--
-- Callers verified before writing these policies:
--   • /api/ab-tests/*            anon key + user session  → needs user policies
--   • /api/ab-tests/active|bucket service-role client     → bypasses RLS
--   • /api/analytics/*           service-role tracker     → bypasses RLS
-- ========================================

-- ============================================================
-- site_analytics  (site-scoped, written by the analytics cron/tracker)
-- ============================================================
ALTER TABLE site_analytics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view site analytics" ON site_analytics;
CREATE POLICY "Site members can view site analytics"
  ON site_analytics
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = site_analytics.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage site analytics" ON site_analytics;
CREATE POLICY "Service role can manage site analytics"
  ON site_analytics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- performance_metrics  (site-scoped, written by AnalyticsTracker)
-- ============================================================
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view performance metrics" ON performance_metrics;
CREATE POLICY "Site members can view performance metrics"
  ON performance_metrics
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = performance_metrics.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage performance metrics" ON performance_metrics;
CREATE POLICY "Service role can manage performance metrics"
  ON performance_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- user_activity_logs  (site-scoped rows that also name a user)
-- ============================================================
ALTER TABLE user_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own activity" ON user_activity_logs;
CREATE POLICY "Users can view their own activity"
  ON user_activity_logs
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Site members can view site activity" ON user_activity_logs;
CREATE POLICY "Site members can view site activity"
  ON user_activity_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = user_activity_logs.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage user activity logs" ON user_activity_logs;
CREATE POLICY "Service role can manage user activity logs"
  ON user_activity_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- ab_tests  (site-scoped; the dashboard routes use the anon key)
-- ============================================================
ALTER TABLE ab_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view ab_tests" ON ab_tests;
CREATE POLICY "Site members can view ab_tests"
  ON ab_tests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ab_tests.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Site editors can create ab_tests" ON ab_tests;
CREATE POLICY "Site editors can create ab_tests"
  ON ab_tests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ab_tests.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Site editors can update ab_tests" ON ab_tests;
CREATE POLICY "Site editors can update ab_tests"
  ON ab_tests
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ab_tests.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ab_tests.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

-- Needed by the rollback path in /api/ab-tests/route.ts:196, which deletes the
-- test it just created when variant insertion fails.
DROP POLICY IF EXISTS "Site editors can delete ab_tests" ON ab_tests;
CREATE POLICY "Site editors can delete ab_tests"
  ON ab_tests
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ab_tests.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Service role can manage ab_tests" ON ab_tests;
CREATE POLICY "Service role can manage ab_tests"
  ON ab_tests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- ab_test_variants  (scoped through the parent test's site)
-- ============================================================
ALTER TABLE ab_test_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view ab_test_variants" ON ab_test_variants;
CREATE POLICY "Site members can view ab_test_variants"
  ON ab_test_variants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM ab_tests t
      JOIN site_permissions sp ON sp.site_id = t.site_id
      WHERE t.id = ab_test_variants.test_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Site editors can create ab_test_variants" ON ab_test_variants;
CREATE POLICY "Site editors can create ab_test_variants"
  ON ab_test_variants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ab_tests t
      JOIN site_permissions sp ON sp.site_id = t.site_id
      WHERE t.id = ab_test_variants.test_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Site editors can update ab_test_variants" ON ab_test_variants;
CREATE POLICY "Site editors can update ab_test_variants"
  ON ab_test_variants
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM ab_tests t
      JOIN site_permissions sp ON sp.site_id = t.site_id
      WHERE t.id = ab_test_variants.test_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ab_tests t
      JOIN site_permissions sp ON sp.site_id = t.site_id
      WHERE t.id = ab_test_variants.test_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Site editors can delete ab_test_variants" ON ab_test_variants;
CREATE POLICY "Site editors can delete ab_test_variants"
  ON ab_test_variants
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM ab_tests t
      JOIN site_permissions sp ON sp.site_id = t.site_id
      WHERE t.id = ab_test_variants.test_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Service role can manage ab_test_variants" ON ab_test_variants;
CREATE POLICY "Service role can manage ab_test_variants"
  ON ab_test_variants
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
