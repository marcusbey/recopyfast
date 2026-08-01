-- ========================================
-- Missing Tables: Audit & Analytics
-- ========================================
-- audit_logs, compliance_reports, api_usage and conversion_events are queried
-- by application code but existed only in the loose
-- supabase/analytics-schema.sql, which `supabase db push` never runs.
-- ========================================

-- ============================================================
-- audit_logs   (src/lib/audit/logger.ts:47, :256)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  -- TEXT, not UUID: logger.ts writes endpoint paths here for api_* actions.
  resource_id TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- getLogs() orders by timestamp DESC and filters on user_id / resource_type /
-- resource_id / action.
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_timestamp ON audit_logs(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Reads go through the service-role AuditLogger; authenticated users may only
-- ever see rows about themselves.
DROP POLICY IF EXISTS "Users can view their own audit logs" ON audit_logs;
CREATE POLICY "Users can view their own audit logs"
  ON audit_logs
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage audit logs" ON audit_logs;
CREATE POLICY "Service role can manage audit logs"
  ON audit_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- compliance_reports
--   write: src/lib/audit/logger.ts:373 (service role)
--   read : src/app/api/audit/compliance/route.ts:144 (anon key + user session)
-- ============================================================
-- site_id is nullable: generateComplianceReport() passes an optional siteId
-- even though src/types/index.ts declares ComplianceReport.site_id required.
CREATE TABLE IF NOT EXISTS compliance_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('gdpr', 'soc2', 'hipaa', 'custom')),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  report_data JSONB NOT NULL,
  period_start TIMESTAMP WITH TIME ZONE,
  period_end TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'generated' CHECK (status IN ('generated', 'reviewed', 'approved', 'exported')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_reports_created_at ON compliance_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_site_id ON compliance_reports(site_id);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_generated_by ON compliance_reports(generated_by);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_type ON compliance_reports(report_type);

ALTER TABLE compliance_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view reports they generated" ON compliance_reports;
CREATE POLICY "Users can view reports they generated"
  ON compliance_reports
  FOR SELECT
  USING (generated_by = auth.uid());

DROP POLICY IF EXISTS "Site admins can view site compliance reports" ON compliance_reports;
CREATE POLICY "Site admins can view site compliance reports"
  ON compliance_reports
  FOR SELECT
  USING (
    site_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = compliance_reports.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission = 'admin'
    )
  );

DROP POLICY IF EXISTS "Service role can manage compliance reports" ON compliance_reports;
CREATE POLICY "Service role can manage compliance reports"
  ON compliance_reports
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- api_usage   (src/lib/analytics/tracker.ts:345)
-- ============================================================
CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  response_time INTEGER,   -- milliseconds
  request_size INTEGER,    -- bytes
  response_size INTEGER,   -- bytes
  ip_address INET,
  user_agent TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_key_timestamp ON api_usage(api_key_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_timestamp ON api_usage(timestamp DESC);

ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view usage for their own API keys" ON api_usage;
CREATE POLICY "Users can view usage for their own API keys"
  ON api_usage
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM api_keys ak
      WHERE ak.id = api_usage.api_key_id
        AND ak.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage api usage" ON api_usage;
CREATE POLICY "Service role can manage api usage"
  ON api_usage
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- conversion_events   (src/lib/analytics/tracker.ts:114)
-- ============================================================
CREATE TABLE IF NOT EXISTS conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('trial_start', 'subscription', 'upgrade', 'churn')
  ),
  value DECIMAL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversion_events_site_created
  ON conversion_events(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversion_events_user_id ON conversion_events(user_id);

ALTER TABLE conversion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view conversion events" ON conversion_events;
CREATE POLICY "Site members can view conversion events"
  ON conversion_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = conversion_events.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage conversion events" ON conversion_events;
CREATE POLICY "Service role can manage conversion events"
  ON conversion_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
