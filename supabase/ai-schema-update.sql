-- AI Features Schema Updates for ReCopyFast
-- Run this after the main schema.sql

-- AI usage tracking table
CREATE TABLE ai_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  feature_type TEXT NOT NULL CHECK (feature_type IN ('translation', 'suggestion', 'optimization')),
  tokens_used INTEGER NOT NULL DEFAULT 0,
  cost_estimate DECIMAL(10,4), -- Cost in USD
  request_data JSONB, -- Store request parameters
  response_data JSONB, -- Store response data (without content for privacy)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- AI suggestions history table
CREATE TABLE ai_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_element_id UUID REFERENCES content_elements(id) ON DELETE CASCADE,
  original_text TEXT NOT NULL,
  suggested_text TEXT NOT NULL,
  suggestion_type TEXT NOT NULL, -- 'improve', 'shorten', 'expand', 'optimize'
  tone TEXT DEFAULT 'professional',
  was_applied BOOLEAN DEFAULT FALSE,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  applied_at TIMESTAMP WITH TIME ZONE
);

-- Language variants table (enhanced content_elements for translations)
-- This extends the existing content_elements table metadata
-- Add indexes for better performance with AI features
CREATE INDEX idx_content_elements_language ON content_elements(language);
CREATE INDEX idx_content_elements_variant ON content_elements(variant);
CREATE INDEX idx_content_elements_metadata ON content_elements USING gin(metadata);
CREATE INDEX idx_ai_usage_site_id ON ai_usage(site_id);
CREATE INDEX idx_ai_usage_feature_type ON ai_usage(feature_type);
CREATE INDEX idx_ai_usage_created_at ON ai_usage(created_at);
CREATE INDEX idx_ai_suggestions_content_element_id ON ai_suggestions(content_element_id);
CREATE INDEX idx_ai_suggestions_was_applied ON ai_suggestions(was_applied);

-- Add columns to existing tables to support AI features
ALTER TABLE content_elements 
ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS translation_source_id UUID REFERENCES content_elements(id),
ADD COLUMN IF NOT EXISTS ai_confidence_score DECIMAL(3,2); -- 0.00 to 1.00

-- Add AI-related metadata to sites table
ALTER TABLE sites 
ADD COLUMN IF NOT EXISTS ai_features_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS ai_usage_limit INTEGER DEFAULT 1000, -- Monthly token limit
ADD COLUMN IF NOT EXISTS ai_settings JSONB DEFAULT '{}';

-- Function to track AI usage
CREATE OR REPLACE FUNCTION track_ai_usage(
  p_site_id UUID,
  p_user_id UUID,
  p_feature_type TEXT,
  p_tokens_used INTEGER,
  p_cost_estimate DECIMAL DEFAULT NULL,
  p_request_data JSONB DEFAULT NULL,
  p_response_data JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  usage_id UUID;
BEGIN
  INSERT INTO ai_usage (
    site_id,
    user_id,
    feature_type,
    tokens_used,
    cost_estimate,
    request_data,
    response_data
  ) VALUES (
    p_site_id,
    p_user_id,
    p_feature_type,
    p_tokens_used,
    p_cost_estimate,
    p_request_data,
    p_response_data
  ) RETURNING id INTO usage_id;
  
  RETURN usage_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get AI usage statistics
CREATE OR REPLACE FUNCTION get_ai_usage_stats(
  p_site_id UUID,
  p_period_days INTEGER DEFAULT 30
) RETURNS TABLE (
  feature_type TEXT,
  total_requests INTEGER,
  total_tokens INTEGER,
  total_cost DECIMAL,
  avg_tokens_per_request DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    au.feature_type,
    COUNT(*)::INTEGER as total_requests,
    SUM(au.tokens_used)::INTEGER as total_tokens,
    SUM(au.cost_estimate) as total_cost,
    AVG(au.tokens_used) as avg_tokens_per_request
  FROM ai_usage au
  WHERE au.site_id = p_site_id
    AND au.created_at > NOW() - INTERVAL '1 day' * p_period_days
  GROUP BY au.feature_type
  ORDER BY total_requests DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to check if site has reached AI usage limit
CREATE OR REPLACE FUNCTION check_ai_usage_limit(
  p_site_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  usage_limit INTEGER;
  current_usage INTEGER;
BEGIN
  -- Get the site's usage limit
  SELECT ai_usage_limit INTO usage_limit
  FROM sites WHERE id = p_site_id;
  
  -- Get current month's usage
  SELECT COALESCE(SUM(tokens_used), 0) INTO current_usage
  FROM ai_usage
  WHERE site_id = p_site_id
    AND created_at >= DATE_TRUNC('month', NOW());
  
  -- Return true if under limit, false if over
  RETURN current_usage < usage_limit;
END;
$$ LANGUAGE plpgsql;

-- RLS Policies for AI tables
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

-- AI Usage policies
CREATE POLICY "Users can view AI usage for their sites" ON ai_usage
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ai_usage.site_id
      AND sp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create AI usage records for their sites" ON ai_usage
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = ai_usage.site_id
      AND sp.user_id = auth.uid()
      AND sp.permission IN ('edit', 'admin')
    )
  );

-- AI Suggestions policies
CREATE POLICY "Users can view AI suggestions for their content" ON ai_suggestions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM content_elements ce
      JOIN site_permissions sp ON sp.site_id = ce.site_id
      WHERE ce.id = ai_suggestions.content_element_id
      AND sp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create AI suggestions for their content" ON ai_suggestions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM content_elements ce
      JOIN site_permissions sp ON sp.site_id = ce.site_id
      WHERE ce.id = ai_suggestions.content_element_id
      AND sp.user_id = auth.uid()
      AND sp.permission IN ('edit', 'admin')
    )
  );

-- Create view for AI analytics
CREATE VIEW ai_analytics AS
SELECT 
  s.id as site_id,
  s.name as site_name,
  COUNT(au.id) as total_ai_requests,
  SUM(au.tokens_used) as total_tokens,
  SUM(au.cost_estimate) as total_cost,
  COUNT(DISTINCT DATE(au.created_at)) as active_days,
  au.feature_type,
  DATE_TRUNC('day', au.created_at) as usage_date
FROM sites s
LEFT JOIN ai_usage au ON s.id = au.site_id
WHERE au.created_at >= NOW() - INTERVAL '30 days'
GROUP BY s.id, s.name, au.feature_type, DATE_TRUNC('day', au.created_at)
ORDER BY usage_date DESC;

-- Grant permissions
GRANT SELECT ON ai_analytics TO authenticated;
GRANT EXECUTE ON FUNCTION track_ai_usage TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_usage_stats TO authenticated;
GRANT EXECUTE ON FUNCTION check_ai_usage_limit TO authenticated;

-- Sample data for testing (optional - remove in production)
-- INSERT INTO ai_usage (site_id, user_id, feature_type, tokens_used, cost_estimate)
-- SELECT 
--   (SELECT id FROM sites LIMIT 1),
--   (SELECT id FROM auth.users LIMIT 1),
--   'suggestion',
--   150,
--   0.003;

COMMENT ON TABLE ai_usage IS 'Tracks AI feature usage for billing and analytics';
COMMENT ON TABLE ai_suggestions IS 'Stores AI-generated content suggestions and their application status';
COMMENT ON FUNCTION track_ai_usage IS 'Records AI feature usage for analytics and billing';
COMMENT ON FUNCTION get_ai_usage_stats IS 'Returns AI usage statistics for a site within a period';
COMMENT ON FUNCTION check_ai_usage_limit IS 'Checks if a site has exceeded its AI usage limit';