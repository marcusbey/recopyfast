-- ========================================
-- ReCopyFast Staging Workflow Migration
-- ========================================
-- Adds staging/publishing workflow with email-verified access control
-- Execute in Supabase SQL Editor after the complete_database_setup migration

-- ========================================
-- CONTENT ELEMENTS: Add Staging Columns
-- ========================================

-- Add staging and publishing columns
ALTER TABLE content_elements
ADD COLUMN IF NOT EXISTS staging_content TEXT,
ADD COLUMN IF NOT EXISTS published_content TEXT,
ADD COLUMN IF NOT EXISTS staging_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS staging_updated_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES auth.users(id);

-- Migrate existing data: current_content becomes published_content
-- This preserves all existing content as the "live" version
UPDATE content_elements
SET published_content = current_content
WHERE published_content IS NULL AND current_content IS NOT NULL;

-- ========================================
-- STAGING ACCESS: Email-Verified Access Tokens
-- ========================================

CREATE TABLE IF NOT EXISTS staging_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE NOT NULL,

  -- Access type: 'invite' = specific email, 'link' = shareable link
  access_type TEXT NOT NULL CHECK (access_type IN ('invite', 'link')),

  -- Email handling:
  -- For 'invite': email set at creation, must match to verify
  -- For 'link': email captured when user first accesses
  email TEXT,
  email_verified BOOLEAN DEFAULT false,
  verification_code TEXT,
  verification_expires_at TIMESTAMP WITH TIME ZONE,

  -- Authentication token (cryptographically random)
  token TEXT UNIQUE NOT NULL,

  -- Permissions array: view, edit, publish, admin
  permissions TEXT[] DEFAULT ARRAY['edit'] CHECK (
    permissions <@ ARRAY['view', 'edit', 'publish', 'admin']::TEXT[]
  ),

  -- Metadata
  label TEXT, -- Human-readable label: "Marketing Team" or "john@example.com"
  created_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by UUID REFERENCES auth.users(id),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for staging_access
CREATE INDEX IF NOT EXISTS idx_staging_access_token ON staging_access(token);
CREATE INDEX IF NOT EXISTS idx_staging_access_site ON staging_access(site_id, is_active);
CREATE INDEX IF NOT EXISTS idx_staging_access_email ON staging_access(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staging_access_expires ON staging_access(expires_at) WHERE is_active = true;

-- ========================================
-- STAGING HISTORY: Track All Staging Changes
-- ========================================

CREATE TABLE IF NOT EXISTS staging_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_element_id UUID REFERENCES content_elements(id) ON DELETE CASCADE,
  staging_access_id UUID REFERENCES staging_access(id) ON DELETE SET NULL,

  -- Content snapshot
  previous_content TEXT,
  new_content TEXT,

  -- Who made the change
  user_email TEXT NOT NULL,

  -- Change metadata
  action TEXT CHECK (action IN ('create', 'update', 'publish', 'revert')) DEFAULT 'update',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staging_history_element ON staging_history(content_element_id);
CREATE INDEX IF NOT EXISTS idx_staging_history_access ON staging_history(staging_access_id);

-- ========================================
-- ROW LEVEL SECURITY POLICIES
-- ========================================

-- Enable RLS
ALTER TABLE staging_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging_history ENABLE ROW LEVEL SECURITY;

-- Staging Access Policies

-- Site admins can view all staging access for their sites
CREATE POLICY "Site admins can view staging access" ON staging_access
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = staging_access.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

-- Site admins can create staging access
CREATE POLICY "Site admins can create staging access" ON staging_access
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = staging_access.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

-- Site admins can update staging access (revoke, etc.)
CREATE POLICY "Site admins can update staging access" ON staging_access
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = staging_access.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

-- Staging History Policies

-- Site admins can view staging history
CREATE POLICY "Site admins can view staging history" ON staging_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM content_elements ce
      JOIN site_permissions sp ON sp.site_id = ce.site_id
      WHERE ce.id = staging_history.content_element_id
      AND sp.user_id = auth.uid()
      AND sp.permission = 'admin'
    )
  );

-- Anyone with staging access can insert history (via API, not direct)
CREATE POLICY "Staging users can insert history" ON staging_history
  FOR INSERT WITH CHECK (true);

-- ========================================
-- HELPER FUNCTIONS
-- ========================================

-- Function to generate secure staging token
CREATE OR REPLACE FUNCTION generate_staging_token()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(48), 'base64url');
END;
$$ LANGUAGE plpgsql;

-- Function to generate 6-digit verification code
CREATE OR REPLACE FUNCTION generate_verification_code()
RETURNS TEXT AS $$
BEGIN
  RETURN lpad(floor(random() * 1000000)::text, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to publish staging content to live
CREATE OR REPLACE FUNCTION publish_staging_content(
  p_site_id UUID,
  p_element_ids UUID[] DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  IF p_element_ids IS NULL THEN
    -- Publish all staging content for the site
    UPDATE content_elements
    SET
      published_content = staging_content,
      published_at = NOW(),
      published_by = p_user_id,
      updated_at = NOW()
    WHERE site_id = p_site_id
    AND staging_content IS NOT NULL
    AND (staging_content IS DISTINCT FROM published_content);
  ELSE
    -- Publish only specified elements
    UPDATE content_elements
    SET
      published_content = staging_content,
      published_at = NOW(),
      published_by = p_user_id,
      updated_at = NOW()
    WHERE site_id = p_site_id
    AND id = ANY(p_element_ids)
    AND staging_content IS NOT NULL;
  END IF;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to revert staging to published
CREATE OR REPLACE FUNCTION revert_staging_content(
  p_site_id UUID,
  p_element_ids UUID[] DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  IF p_element_ids IS NULL THEN
    UPDATE content_elements
    SET
      staging_content = published_content,
      staging_updated_at = NOW(),
      updated_at = NOW()
    WHERE site_id = p_site_id;
  ELSE
    UPDATE content_elements
    SET
      staging_content = published_content,
      staging_updated_at = NOW(),
      updated_at = NOW()
    WHERE site_id = p_site_id
    AND id = ANY(p_element_ids);
  END IF;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- TRIGGERS
-- ========================================

-- Auto-update updated_at for staging_access
CREATE OR REPLACE FUNCTION update_staging_access_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER staging_access_updated_at
  BEFORE UPDATE ON staging_access
  FOR EACH ROW
  EXECUTE FUNCTION update_staging_access_updated_at();

-- ========================================
-- GRANTS
-- ========================================

-- Grant access to authenticated users (RLS handles fine-grained access)
GRANT SELECT, INSERT, UPDATE ON staging_access TO authenticated;
GRANT SELECT, INSERT ON staging_history TO authenticated;
GRANT EXECUTE ON FUNCTION generate_staging_token() TO authenticated;
GRANT EXECUTE ON FUNCTION generate_verification_code() TO authenticated;
GRANT EXECUTE ON FUNCTION publish_staging_content(UUID, UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION revert_staging_content(UUID, UUID[]) TO authenticated;

-- ========================================
-- COMMENTS
-- ========================================

COMMENT ON TABLE staging_access IS 'Manages email-verified access tokens for staging environments';
COMMENT ON TABLE staging_history IS 'Audit trail of all changes made in staging mode';
COMMENT ON COLUMN content_elements.staging_content IS 'Draft content visible only in staging mode';
COMMENT ON COLUMN content_elements.published_content IS 'Live content visible on production site';
COMMENT ON COLUMN staging_access.access_type IS 'invite = specific email required, link = anyone with link can verify their email';
COMMENT ON COLUMN staging_access.permissions IS 'Array of: view (read-only), edit (make changes), publish (push to live), admin (full control)';
