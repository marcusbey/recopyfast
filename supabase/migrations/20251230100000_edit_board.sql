-- ========================================
-- ReCopyFast Edit Board Migration
-- ========================================
-- Adds copy styles, content versions, themes, and languages
-- for the centralized Edit Board panel
-- Depends on: 20251230000000_staging_workflow.sql

-- ========================================
-- COPY STYLES: Global Writing Style Presets
-- ========================================

CREATE TABLE IF NOT EXISTS copy_styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,

  -- Style definition
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL, -- AI prompt for style transformation

  -- Preset styles have NULL site_id (available to all)
  is_preset BOOLEAN DEFAULT false,

  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default preset styles (available to all sites)
INSERT INTO copy_styles (site_id, name, description, prompt, is_preset) VALUES
  (NULL, 'Professional', 'Formal business tone with authority',
   'Rewrite this content in a professional, formal business tone. Be concise, authoritative, and credible. Use industry-appropriate language.', true),
  (NULL, 'Casual', 'Friendly and conversational',
   'Rewrite this content in a casual, friendly conversational tone. Be approachable, warm, and relatable. Use everyday language.', true),
  (NULL, 'Urgent', 'Creates urgency and drives action',
   'Rewrite this content to create urgency and encourage immediate action. Use active voice, time-sensitive language, and clear calls to action.', true),
  (NULL, 'Technical', 'Precise and detailed',
   'Rewrite this content in a precise technical tone. Be accurate, detailed, and use appropriate technical terminology while remaining accessible.', true),
  (NULL, 'Playful', 'Fun and engaging',
   'Rewrite this content in a playful, fun tone. Use wit, humor where appropriate, and engaging language that delights the reader.', true),
  (NULL, 'Minimalist', 'Ultra-concise and direct',
   'Rewrite this content to be ultra-concise. Remove all unnecessary words. Keep only the essential message. Be direct and impactful.', true);

-- Index for copy_styles
CREATE INDEX IF NOT EXISTS idx_copy_styles_site ON copy_styles(site_id);
CREATE INDEX IF NOT EXISTS idx_copy_styles_preset ON copy_styles(is_preset) WHERE is_preset = true;

-- ========================================
-- CONTENT VERSIONS: Full Site Snapshots for History
-- ========================================

CREATE TABLE IF NOT EXISTS content_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE NOT NULL,

  -- Version info
  version_number INT NOT NULL,

  -- Full snapshot of all elements: { elementId: { content, elementType, selector } }
  snapshot JSONB NOT NULL,

  -- Who and why
  created_by TEXT, -- email of user
  description TEXT, -- "Applied Professional style", "Restored version 5", etc.

  -- Change summary
  elements_changed INT DEFAULT 0,
  change_type TEXT CHECK (change_type IN ('manual', 'style_apply', 'language_switch', 'theme_apply', 'restore', 'bulk_edit')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(site_id, version_number)
);

-- Indexes for content_versions
CREATE INDEX IF NOT EXISTS idx_content_versions_site ON content_versions(site_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_content_versions_created ON content_versions(site_id, created_at DESC);

-- ========================================
-- SITE THEMES: Event-Based Content Overrides
-- ========================================

CREATE TABLE IF NOT EXISTS site_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE NOT NULL,

  -- Theme definition
  name TEXT NOT NULL,
  description TEXT,

  -- Content overrides: { elementId: overrideContent }
  content_overrides JSONB DEFAULT '{}'::jsonb,

  -- Future: component additions (banners, popups, etc.)
  component_additions JSONB DEFAULT '[]'::jsonb,

  -- Style customizations (colors, fonts, etc.)
  style_overrides JSONB DEFAULT '{}'::jsonb,

  -- Activation
  is_active BOOLEAN DEFAULT false,

  -- Scheduling (optional)
  schedule_start TIMESTAMP WITH TIME ZONE,
  schedule_end TIMESTAMP WITH TIME ZONE,

  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for site_themes
CREATE INDEX IF NOT EXISTS idx_site_themes_site ON site_themes(site_id);
CREATE INDEX IF NOT EXISTS idx_site_themes_active ON site_themes(site_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_site_themes_schedule ON site_themes(schedule_start, schedule_end) WHERE schedule_start IS NOT NULL;

-- ========================================
-- SITE LANGUAGES: Translation Management
-- ========================================

CREATE TABLE IF NOT EXISTS site_languages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE NOT NULL,

  -- Language info
  language_code TEXT NOT NULL, -- 'en', 'fr', 'es', 'de', etc.
  language_name TEXT NOT NULL, -- 'English', 'French', 'Spanish', etc.

  -- Default language flag
  is_default BOOLEAN DEFAULT false,

  -- Translations: { elementId: translatedContent }
  translations JSONB DEFAULT '{}'::jsonb,

  -- Translation status
  translation_coverage DECIMAL(5,2) DEFAULT 0, -- Percentage of elements translated
  last_translated_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(site_id, language_code)
);

-- Indexes for site_languages
CREATE INDEX IF NOT EXISTS idx_site_languages_site ON site_languages(site_id);
CREATE INDEX IF NOT EXISTS idx_site_languages_default ON site_languages(site_id, is_default) WHERE is_default = true;

-- ========================================
-- ROW LEVEL SECURITY POLICIES
-- ========================================

-- Enable RLS
ALTER TABLE copy_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_languages ENABLE ROW LEVEL SECURITY;

-- Copy Styles Policies

-- Everyone can view preset styles
CREATE POLICY "Anyone can view preset styles" ON copy_styles
  FOR SELECT USING (is_preset = true);

-- Site members can view custom styles
CREATE POLICY "Site members can view custom styles" ON copy_styles
  FOR SELECT USING (
    site_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = copy_styles.site_id
      AND site_permissions.user_id = auth.uid()
    )
  );

-- Site admins can create custom styles
CREATE POLICY "Site admins can create styles" ON copy_styles
  FOR INSERT WITH CHECK (
    site_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = copy_styles.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

-- Site admins can update/delete custom styles
CREATE POLICY "Site admins can update styles" ON copy_styles
  FOR UPDATE USING (
    site_id IS NOT NULL AND is_preset = false AND EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = copy_styles.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

CREATE POLICY "Site admins can delete styles" ON copy_styles
  FOR DELETE USING (
    site_id IS NOT NULL AND is_preset = false AND EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = copy_styles.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

-- Content Versions Policies

-- Site members can view versions
CREATE POLICY "Site members can view versions" ON content_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = content_versions.site_id
      AND site_permissions.user_id = auth.uid()
    )
  );

-- Anyone with edit access can create versions (via API)
CREATE POLICY "Insert versions via API" ON content_versions
  FOR INSERT WITH CHECK (true);

-- Site Themes Policies

-- Site members can view themes
CREATE POLICY "Site members can view themes" ON site_themes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = site_themes.site_id
      AND site_permissions.user_id = auth.uid()
    )
  );

-- Site admins can manage themes
CREATE POLICY "Site admins can create themes" ON site_themes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = site_themes.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

CREATE POLICY "Site admins can update themes" ON site_themes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = site_themes.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

CREATE POLICY "Site admins can delete themes" ON site_themes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = site_themes.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

-- Site Languages Policies

-- Site members can view languages
CREATE POLICY "Site members can view languages" ON site_languages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = site_languages.site_id
      AND site_permissions.user_id = auth.uid()
    )
  );

-- Site admins can manage languages
CREATE POLICY "Site admins can create languages" ON site_languages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = site_languages.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

CREATE POLICY "Site admins can update languages" ON site_languages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = site_languages.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

CREATE POLICY "Site admins can delete languages" ON site_languages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = site_languages.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission = 'admin'
    )
  );

-- ========================================
-- HELPER FUNCTIONS
-- ========================================

-- Function to create a content version snapshot
CREATE OR REPLACE FUNCTION create_content_version(
  p_site_id UUID,
  p_created_by TEXT,
  p_description TEXT DEFAULT NULL,
  p_change_type TEXT DEFAULT 'manual'
)
RETURNS UUID AS $$
DECLARE
  v_version_id UUID;
  v_version_number INT;
  v_snapshot JSONB;
  v_elements_count INT;
BEGIN
  -- Get next version number
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_version_number
  FROM content_versions
  WHERE site_id = p_site_id;

  -- Build snapshot from current staging content
  SELECT jsonb_object_agg(
    id::text,
    jsonb_build_object(
      'content', COALESCE(staging_content, published_content, current_content),
      'elementType', element_type,
      'selector', selector
    )
  )
  INTO v_snapshot
  FROM content_elements
  WHERE site_id = p_site_id;

  -- Count elements
  SELECT COUNT(*) INTO v_elements_count
  FROM content_elements WHERE site_id = p_site_id;

  -- Insert version
  INSERT INTO content_versions (
    site_id,
    version_number,
    snapshot,
    created_by,
    description,
    elements_changed,
    change_type
  ) VALUES (
    p_site_id,
    v_version_number,
    COALESCE(v_snapshot, '{}'::jsonb),
    p_created_by,
    p_description,
    v_elements_count,
    p_change_type
  )
  RETURNING id INTO v_version_id;

  RETURN v_version_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to restore a content version
CREATE OR REPLACE FUNCTION restore_content_version(
  p_site_id UUID,
  p_version_id UUID,
  p_restored_by TEXT
)
RETURNS INTEGER AS $$
DECLARE
  v_snapshot JSONB;
  v_element_id TEXT;
  v_content TEXT;
  v_updated_count INT := 0;
BEGIN
  -- Get the version snapshot
  SELECT snapshot INTO v_snapshot
  FROM content_versions
  WHERE id = p_version_id AND site_id = p_site_id;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'Version not found';
  END IF;

  -- Create a new version before restoring (so we can undo)
  PERFORM create_content_version(
    p_site_id,
    p_restored_by,
    'Auto-saved before restore',
    'restore'
  );

  -- Update each element's staging content from snapshot
  FOR v_element_id, v_content IN
    SELECT key, value->>'content'
    FROM jsonb_each(v_snapshot)
  LOOP
    UPDATE content_elements
    SET
      staging_content = v_content,
      staging_updated_at = NOW()
    WHERE id = v_element_id::uuid
    AND site_id = p_site_id;

    IF FOUND THEN
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;

  RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate translation coverage
CREATE OR REPLACE FUNCTION update_translation_coverage(p_language_id UUID)
RETURNS DECIMAL AS $$
DECLARE
  v_site_id UUID;
  v_total_elements INT;
  v_translated_elements INT;
  v_coverage DECIMAL;
BEGIN
  SELECT site_id INTO v_site_id
  FROM site_languages WHERE id = p_language_id;

  SELECT COUNT(*) INTO v_total_elements
  FROM content_elements WHERE site_id = v_site_id;

  SELECT COUNT(*) INTO v_translated_elements
  FROM site_languages sl, jsonb_object_keys(sl.translations) k
  WHERE sl.id = p_language_id;

  IF v_total_elements > 0 THEN
    v_coverage := (v_translated_elements::DECIMAL / v_total_elements::DECIMAL) * 100;
  ELSE
    v_coverage := 0;
  END IF;

  UPDATE site_languages
  SET translation_coverage = v_coverage
  WHERE id = p_language_id;

  RETURN v_coverage;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- TRIGGERS
-- ========================================

-- Auto-update updated_at for copy_styles
CREATE OR REPLACE FUNCTION update_copy_styles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER copy_styles_updated_at
  BEFORE UPDATE ON copy_styles
  FOR EACH ROW
  EXECUTE FUNCTION update_copy_styles_updated_at();

-- Auto-update updated_at for site_themes
CREATE OR REPLACE FUNCTION update_site_themes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER site_themes_updated_at
  BEFORE UPDATE ON site_themes
  FOR EACH ROW
  EXECUTE FUNCTION update_site_themes_updated_at();

-- Auto-update updated_at for site_languages
CREATE OR REPLACE FUNCTION update_site_languages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER site_languages_updated_at
  BEFORE UPDATE ON site_languages
  FOR EACH ROW
  EXECUTE FUNCTION update_site_languages_updated_at();

-- ========================================
-- GRANTS
-- ========================================

GRANT SELECT ON copy_styles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON copy_styles TO authenticated;
GRANT SELECT, INSERT ON content_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON site_themes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON site_languages TO authenticated;

GRANT EXECUTE ON FUNCTION create_content_version(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_content_version(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_translation_coverage(UUID) TO authenticated;

-- ========================================
-- COMMENTS
-- ========================================

COMMENT ON TABLE copy_styles IS 'Global and site-specific writing style presets for AI-powered content transformation';
COMMENT ON TABLE content_versions IS 'Full site content snapshots for version history and rollback';
COMMENT ON TABLE site_themes IS 'Event-based content overrides for holidays, sales, campaigns';
COMMENT ON TABLE site_languages IS 'Language translations for multi-language site support';

COMMENT ON COLUMN copy_styles.prompt IS 'AI prompt used to transform content to this style';
COMMENT ON COLUMN copy_styles.is_preset IS 'If true, this style is available to all sites';
COMMENT ON COLUMN content_versions.snapshot IS 'JSONB snapshot of all elements: { elementId: { content, elementType, selector } }';
COMMENT ON COLUMN content_versions.change_type IS 'What triggered this version: manual, style_apply, language_switch, theme_apply, restore, bulk_edit';
COMMENT ON COLUMN site_themes.content_overrides IS 'JSONB map of elementId to override content';
COMMENT ON COLUMN site_themes.component_additions IS 'Future: array of components to add (banners, popups)';
COMMENT ON COLUMN site_languages.translations IS 'JSONB map of elementId to translated content';
COMMENT ON COLUMN site_languages.translation_coverage IS 'Percentage of elements with translations (0-100)';
