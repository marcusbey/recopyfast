-- Security schema updates for domain verification and rate limiting

-- Domain verification table
CREATE TABLE domain_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  verification_method TEXT CHECK (verification_method IN ('dns', 'file')),
  verification_token TEXT NOT NULL,
  verification_code TEXT NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(site_id, domain)
);

-- Rate limiting table for API usage tracking
CREATE TABLE rate_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  identifier TEXT NOT NULL, -- Could be user_id, ip_address, or api_key
  identifier_type TEXT CHECK (identifier_type IN ('user', 'ip', 'api_key')),
  endpoint TEXT NOT NULL,
  requests_count INTEGER DEFAULT 1,
  window_start TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  window_end TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(identifier, endpoint, window_start)
);

-- API keys with rate limiting configuration
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  key_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  last_used_at TIMESTAMP WITH TIME ZONE,
  requests_per_minute INTEGER DEFAULT 60,
  requests_per_hour INTEGER DEFAULT 1000,
  requests_per_day INTEGER DEFAULT 10000,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Security events log
CREATE TABLE security_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL CHECK (event_type IN ('rate_limit_exceeded', 'invalid_domain', 'xss_attempt', 'suspicious_activity')),
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address INET,
  user_agent TEXT,
  endpoint TEXT,
  payload JSONB,
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create indexes for performance
CREATE INDEX idx_domain_verifications_site_id ON domain_verifications(site_id);
CREATE INDEX idx_domain_verifications_domain ON domain_verifications(domain);
CREATE INDEX idx_domain_verifications_token ON domain_verifications(verification_token);
CREATE INDEX idx_rate_limits_identifier ON rate_limits(identifier);
CREATE INDEX idx_rate_limits_endpoint ON rate_limits(endpoint);
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start, window_end);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_site_id ON api_keys(site_id);
CREATE INDEX idx_security_events_type ON security_events(event_type);
CREATE INDEX idx_security_events_severity ON security_events(severity);
CREATE INDEX idx_security_events_created_at ON security_events(created_at);

-- Enable RLS
ALTER TABLE domain_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for domain_verifications
CREATE POLICY "Users can view domain verifications for their sites" ON domain_verifications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = domain_verifications.site_id
      AND site_permissions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage domain verifications for their sites" ON domain_verifications
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = domain_verifications.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission IN ('admin')
    )
  );

-- RLS Policies for api_keys
CREATE POLICY "Users can view API keys for their sites" ON api_keys
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = api_keys.site_id
      AND site_permissions.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage API keys for their sites" ON api_keys
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = api_keys.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

-- RLS Policies for security_events (read-only for site owners)
CREATE POLICY "Users can view security events for their sites" ON security_events
  FOR SELECT USING (
    site_id IS NULL OR EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = security_events.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission IN ('admin')
    )
  );

-- RLS Policies for rate_limits (system managed, limited access)
CREATE POLICY "System can manage rate limits" ON rate_limits
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Add triggers for updated_at
CREATE TRIGGER update_domain_verifications_updated_at BEFORE UPDATE ON domain_verifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rate_limits_updated_at BEFORE UPDATE ON rate_limits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up expired rate limit entries
CREATE OR REPLACE FUNCTION cleanup_expired_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits WHERE window_end < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Function to log security events
CREATE OR REPLACE FUNCTION log_security_event(
  p_event_type TEXT,
  p_site_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_endpoint TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT NULL,
  p_severity TEXT DEFAULT 'medium'
)
RETURNS UUID AS $$
DECLARE
  event_id UUID;
BEGIN
  INSERT INTO security_events (
    event_type, site_id, user_id, ip_address, user_agent, endpoint, payload, severity
  ) VALUES (
    p_event_type, p_site_id, p_user_id, p_ip_address, p_user_agent, p_endpoint, p_payload, p_severity
  ) RETURNING id INTO event_id;
  
  RETURN event_id;
END;
$$ LANGUAGE plpgsql;

-- Add domain verification status to sites table
ALTER TABLE sites ADD COLUMN domain_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE sites ADD COLUMN domain_verified_at TIMESTAMP WITH TIME ZONE;

-- Update sites table with trigger for domain verification
CREATE OR REPLACE FUNCTION update_site_verification_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_verified = TRUE AND OLD.is_verified = FALSE THEN
    UPDATE sites 
    SET domain_verified = TRUE, domain_verified_at = NOW()
    WHERE id = NEW.site_id;
  ELSIF NEW.is_verified = FALSE AND OLD.is_verified = TRUE THEN
    UPDATE sites 
    SET domain_verified = FALSE, domain_verified_at = NULL
    WHERE id = NEW.site_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER domain_verification_status_trigger
  AFTER UPDATE ON domain_verifications
  FOR EACH ROW EXECUTE FUNCTION update_site_verification_status();