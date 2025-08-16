-- ========================================
-- EDIT SESSIONS SCHEMA
-- Secure authentication for website editing
-- ========================================

-- Edit sessions table
CREATE TABLE IF NOT EXISTS edit_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  permissions TEXT[] DEFAULT ARRAY['edit'] CHECK (
    permissions <@ ARRAY['view', 'edit', 'admin']
  ),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  ip_address INET,
  user_agent TEXT,
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_edit_sessions_token ON edit_sessions(token);
CREATE INDEX IF NOT EXISTS idx_edit_sessions_site_id ON edit_sessions(site_id);
CREATE INDEX IF NOT EXISTS idx_edit_sessions_user_id ON edit_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_edit_sessions_active_expires ON edit_sessions(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_edit_sessions_site_active ON edit_sessions(site_id, is_active);

-- Row Level Security
ALTER TABLE edit_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own edit sessions" ON edit_sessions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create edit sessions for sites they have access to" ON edit_sessions
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = edit_sessions.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission IN ('edit', 'admin')
    )
  );

CREATE POLICY "Users can update their own edit sessions" ON edit_sessions
  FOR UPDATE USING (user_id = auth.uid());

-- Function to auto-cleanup expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_edit_sessions()
RETURNS INTEGER AS $$
DECLARE
  cleanup_count INTEGER;
BEGIN
  UPDATE edit_sessions 
  SET is_active = false, updated_at = NOW()
  WHERE is_active = true 
  AND expires_at < NOW();
  
  GET DIAGNOSTICS cleanup_count = ROW_COUNT;
  RETURN cleanup_count;
END;
$$ LANGUAGE plpgsql;

-- Function to extend session expiry
CREATE OR REPLACE FUNCTION extend_edit_session(
  session_token TEXT,
  extension_hours INTEGER DEFAULT 2
)
RETURNS BOOLEAN AS $$
DECLARE
  max_extension_hours CONSTANT INTEGER := 24;
  actual_extension INTEGER;
BEGIN
  actual_extension := LEAST(extension_hours, max_extension_hours);
  
  UPDATE edit_sessions
  SET 
    expires_at = NOW() + (actual_extension || ' hours')::INTERVAL,
    updated_at = NOW()
  WHERE token = session_token
  AND is_active = true
  AND expires_at > NOW()
  AND user_id = auth.uid();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_edit_sessions_updated_at 
  BEFORE UPDATE ON edit_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Audit log for edit sessions (optional)
CREATE TABLE IF NOT EXISTS edit_session_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES edit_sessions(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created', 'used', 'extended', 'revoked', 'expired')),
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for audit log
CREATE INDEX IF NOT EXISTS idx_edit_session_audit_session_id ON edit_session_audit(session_id);
CREATE INDEX IF NOT EXISTS idx_edit_session_audit_action_created ON edit_session_audit(action, created_at);

-- Function to log session activity
CREATE OR REPLACE FUNCTION log_edit_session_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO edit_session_audit (session_id, action, ip_address, user_agent)
    VALUES (NEW.id, 'created', NEW.ip_address, NEW.user_agent);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.last_used_at IS DISTINCT FROM NEW.last_used_at THEN
      INSERT INTO edit_session_audit (session_id, action, ip_address, user_agent)
      VALUES (NEW.id, 'used', NEW.ip_address, NEW.user_agent);
    END IF;
    
    IF OLD.expires_at IS DISTINCT FROM NEW.expires_at AND NEW.expires_at > OLD.expires_at THEN
      INSERT INTO edit_session_audit (session_id, action)
      VALUES (NEW.id, 'extended');
    END IF;
    
    IF OLD.is_active = true AND NEW.is_active = false THEN
      INSERT INTO edit_session_audit (session_id, action)
      VALUES (NEW.id, CASE WHEN NEW.revoked_at IS NOT NULL THEN 'revoked' ELSE 'expired' END);
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger for session activity logging
CREATE TRIGGER edit_session_activity_trigger
  AFTER INSERT OR UPDATE ON edit_sessions
  FOR EACH ROW EXECUTE FUNCTION log_edit_session_activity();

-- Grant permissions for the API to access these functions
GRANT EXECUTE ON FUNCTION cleanup_expired_edit_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION extend_edit_session(TEXT, INTEGER) TO authenticated;