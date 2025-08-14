-- Analytics and Advanced Features Schema
-- Usage Analytics Tables

-- Site Analytics table for tracking site-level metrics
CREATE TABLE site_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  page_views INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  avg_load_time DECIMAL DEFAULT 0,
  bounce_rate DECIMAL DEFAULT 0,
  conversion_rate DECIMAL DEFAULT 0,
  total_edits INTEGER DEFAULT 0,
  active_editors INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(site_id, date)
);

-- User Activity Tracking
CREATE TABLE user_activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, -- 'page_view', 'content_edit', 'login', 'logout', 'api_call'
  resource_type TEXT, -- 'content_element', 'site', 'user', 'team'
  resource_id TEXT,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Performance Metrics
CREATE TABLE performance_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL, -- 'load_time', 'edit_time', 'api_response_time'
  value DECIMAL NOT NULL,
  metadata JSONB DEFAULT '{}',
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Conversion Tracking
CREATE TABLE conversion_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL, -- 'trial_start', 'subscription', 'upgrade', 'churn'
  value DECIMAL, -- monetary value if applicable
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Bulk Operations Tables

-- Bulk Operation Jobs
CREATE TABLE bulk_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL, -- 'import', 'export', 'batch_update', 'sync'
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  configuration JSONB DEFAULT '{}',
  result_data JSONB DEFAULT '{}',
  error_log TEXT[],
  scheduled_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Content Templates
CREATE TABLE content_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  template_data JSONB NOT NULL,
  category TEXT DEFAULT 'general',
  is_public BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Enhanced Content Features

-- Content Versions (Enhanced)
CREATE TABLE content_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_element_id UUID REFERENCES content_elements(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  branch_name TEXT DEFAULT 'main',
  parent_version_id UUID REFERENCES content_versions(id),
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(content_element_id, version_number)
);

-- A/B Testing
CREATE TABLE ab_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'completed', 'paused')),
  traffic_split DECIMAL DEFAULT 0.5 CHECK (traffic_split BETWEEN 0 AND 1),
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  success_metric TEXT NOT NULL, -- 'conversion_rate', 'engagement', 'click_through'
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- A/B Test Variants
CREATE TABLE ab_test_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_id UUID REFERENCES ab_tests(id) ON DELETE CASCADE,
  content_element_id UUID REFERENCES content_elements(id) ON DELETE CASCADE,
  variant_name TEXT NOT NULL, -- 'control', 'variant_a', 'variant_b'
  content TEXT NOT NULL,
  traffic_percentage DECIMAL DEFAULT 0 CHECK (traffic_percentage BETWEEN 0 AND 100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- A/B Test Results
CREATE TABLE ab_test_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_id UUID REFERENCES ab_tests(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES ab_test_variants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT,
  event_type TEXT NOT NULL, -- 'view', 'click', 'conversion'
  value DECIMAL DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Content Approval Workflows
CREATE TABLE approval_workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  steps JSONB NOT NULL, -- Array of approval steps with roles
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Content Approval Requests
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_element_id UUID REFERENCES content_elements(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES approval_workflows(id) ON DELETE CASCADE,
  proposed_content TEXT NOT NULL,
  current_step INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  comments TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Content Scheduling
CREATE TABLE scheduled_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_element_id UUID REFERENCES content_elements(id) ON DELETE CASCADE,
  scheduled_content TEXT NOT NULL,
  publish_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'published', 'cancelled', 'failed')),
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  published_at TIMESTAMP WITH TIME ZONE
);

-- Enterprise Features

-- Audit Logs (Enhanced)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Compliance Reports
CREATE TABLE compliance_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_type TEXT NOT NULL, -- 'gdpr', 'soc2', 'hipaa', 'custom'
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  report_data JSONB NOT NULL,
  period_start TIMESTAMP WITH TIME ZONE,
  period_end TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'generated' CHECK (status IN ('generated', 'reviewed', 'approved', 'exported')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- White-label Customization
CREATE TABLE white_label_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  brand_name TEXT,
  logo_url TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  custom_css TEXT,
  custom_domain TEXT,
  favicon_url TEXT,
  contact_email TEXT,
  support_url TEXT,
  terms_url TEXT,
  privacy_url TEXT,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- API and Integration Features

-- API Keys Management
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  permissions JSONB DEFAULT '{}', -- Scoped permissions
  rate_limit INTEGER DEFAULT 1000, -- requests per hour
  last_used_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- API Usage Tracking
CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  response_time INTEGER, -- milliseconds
  request_size INTEGER, -- bytes
  response_size INTEGER, -- bytes
  ip_address INET,
  user_agent TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Webhooks
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL, -- Array of event types
  secret TEXT,
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMP WITH TIME ZONE,
  failure_count INTEGER DEFAULT 0,
  max_failures INTEGER DEFAULT 5,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Webhook Delivery Logs
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id UUID REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  response_time INTEGER, -- milliseconds
  attempt_number INTEGER DEFAULT 1,
  success BOOLEAN DEFAULT false,
  error_message TEXT,
  delivered_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Rate Limiting
CREATE TABLE rate_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create index for rate limiting cleanup
CREATE INDEX idx_rate_limits_key ON rate_limits(key);
CREATE INDEX idx_rate_limits_timestamp ON rate_limits(timestamp);

-- Indexes for Performance
CREATE INDEX idx_site_analytics_site_date ON site_analytics(site_id, date);
CREATE INDEX idx_user_activity_logs_user_id ON user_activity_logs(user_id);
CREATE INDEX idx_user_activity_logs_site_id ON user_activity_logs(site_id);
CREATE INDEX idx_user_activity_logs_timestamp ON user_activity_logs(timestamp);
CREATE INDEX idx_performance_metrics_site_id ON performance_metrics(site_id);
CREATE INDEX idx_performance_metrics_recorded_at ON performance_metrics(recorded_at);
CREATE INDEX idx_bulk_operations_user_id ON bulk_operations(user_id);
CREATE INDEX idx_bulk_operations_site_id ON bulk_operations(site_id);
CREATE INDEX idx_bulk_operations_status ON bulk_operations(status);
CREATE INDEX idx_content_versions_element_id ON content_versions(content_element_id);
CREATE INDEX idx_ab_tests_site_id ON ab_tests(site_id);
CREATE INDEX idx_ab_test_results_test_id ON ab_test_results(test_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_api_usage_api_key_id ON api_usage(api_key_id);
CREATE INDEX idx_api_usage_timestamp ON api_usage(timestamp);
CREATE INDEX idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);

-- Row Level Security
ALTER TABLE site_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_test_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE white_label_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Site Analytics - Users can view analytics for sites they have permission to
CREATE POLICY "Users can view site analytics for permitted sites" ON site_analytics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = site_analytics.site_id
      AND site_permissions.user_id = auth.uid()
    )
  );

-- Content Versions - Users can view versions for content they have access to
CREATE POLICY "Users can view content versions for permitted content" ON content_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM content_elements ce
      JOIN site_permissions sp ON ce.site_id = sp.site_id
      WHERE ce.id = content_versions.content_element_id
      AND sp.user_id = auth.uid()
    )
  );

-- API Keys - Users can only see their own API keys
CREATE POLICY "Users can only access their own API keys" ON api_keys
  FOR ALL USING (user_id = auth.uid());

-- Audit Logs - Users can view logs for sites they have admin access to
CREATE POLICY "Admins can view audit logs for their sites" ON audit_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      JOIN sites s ON sp.site_id = s.id
      WHERE sp.user_id = auth.uid()
      AND sp.permission = 'admin'
      AND (
        audit_logs.resource_type = 'site' AND audit_logs.resource_id = s.id::text
        OR audit_logs.resource_type = 'content_element' AND audit_logs.resource_id IN (
          SELECT ce.id::text FROM content_elements ce WHERE ce.site_id = s.id
        )
      )
    )
  );

-- Functions and Triggers

-- Function to update analytics daily
CREATE OR REPLACE FUNCTION update_site_analytics()
RETURNS void AS $$
DECLARE
  site_record RECORD;
  analytics_date DATE := CURRENT_DATE;
BEGIN
  FOR site_record IN SELECT id FROM sites LOOP
    INSERT INTO site_analytics (site_id, date, page_views, unique_visitors, total_edits, active_editors)
    SELECT 
      site_record.id,
      analytics_date,
      COUNT(CASE WHEN action_type = 'page_view' THEN 1 END),
      COUNT(DISTINCT CASE WHEN action_type = 'page_view' THEN user_id END),
      COUNT(CASE WHEN action_type = 'content_edit' THEN 1 END),
      COUNT(DISTINCT CASE WHEN action_type = 'content_edit' THEN user_id END)
    FROM user_activity_logs
    WHERE site_id = site_record.id
    AND DATE(timestamp) = analytics_date
    ON CONFLICT (site_id, date) DO UPDATE SET
      page_views = EXCLUDED.page_views,
      unique_visitors = EXCLUDED.unique_visitors,
      total_edits = EXCLUDED.total_edits,
      active_editors = EXCLUDED.active_editors,
      updated_at = TIMEZONE('utc', NOW());
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically log audit events
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    user_id, action, resource_type, resource_id, 
    old_values, new_values, timestamp
  ) VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id::text, OLD.id::text),
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    TIMEZONE('utc', NOW())
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Apply audit triggers to key tables
CREATE TRIGGER audit_sites_trigger
  AFTER INSERT OR UPDATE OR DELETE ON sites
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_content_elements_trigger
  AFTER INSERT OR UPDATE OR DELETE ON content_elements
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- Triggers for updated_at columns
CREATE TRIGGER update_content_templates_updated_at BEFORE UPDATE ON content_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ab_tests_updated_at BEFORE UPDATE ON ab_tests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_approval_workflows_updated_at BEFORE UPDATE ON approval_workflows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_approval_requests_updated_at BEFORE UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_white_label_configs_updated_at BEFORE UPDATE ON white_label_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();