-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sites table
CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Content elements table
CREATE TABLE content_elements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  element_id TEXT NOT NULL,
  selector TEXT NOT NULL,
  original_content TEXT,
  current_content TEXT,
  language TEXT DEFAULT 'en',
  variant TEXT DEFAULT 'default',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(site_id, element_id, language, variant)
);

-- Content history table (for versioning)
CREATE TABLE content_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_element_id UUID REFERENCES content_elements(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  change_type TEXT CHECK (change_type IN ('create', 'update', 'delete')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Site permissions
CREATE TABLE site_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  permission TEXT DEFAULT 'edit' CHECK (permission IN ('view', 'edit', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(user_id, site_id)
);

-- Create indexes for better performance
CREATE INDEX idx_content_elements_site_id ON content_elements(site_id);
CREATE INDEX idx_content_elements_element_id ON content_elements(element_id);
CREATE INDEX idx_content_history_element_id ON content_history(content_element_id);
CREATE INDEX idx_site_permissions_user_id ON site_permissions(user_id);
CREATE INDEX idx_site_permissions_site_id ON site_permissions(site_id);

-- Row Level Security (RLS)
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_permissions ENABLE ROW LEVEL SECURITY;

-- Policies for sites table
CREATE POLICY "Users can view sites they have permission to" ON sites
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = sites.id
      AND site_permissions.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can create sites" ON sites
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Policies for content_elements table
CREATE POLICY "Users can view content for sites they have permission to" ON content_elements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = content_elements.site_id
      AND site_permissions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can edit content for sites they have edit permission to" ON content_elements
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM site_permissions
      WHERE site_permissions.site_id = content_elements.site_id
      AND site_permissions.user_id = auth.uid()
      AND site_permissions.permission IN ('edit', 'admin')
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_sites_updated_at BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_elements_updated_at BEFORE UPDATE ON content_elements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to log content changes
CREATE OR REPLACE FUNCTION log_content_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO content_history (content_element_id, content, changed_by, change_type)
    VALUES (NEW.id, NEW.current_content, auth.uid(), 'create');
  ELSIF TG_OP = 'UPDATE' AND OLD.current_content IS DISTINCT FROM NEW.current_content THEN
    INSERT INTO content_history (content_element_id, content, changed_by, change_type)
    VALUES (NEW.id, NEW.current_content, auth.uid(), 'update');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO content_history (content_element_id, content, changed_by, change_type)
    VALUES (OLD.id, OLD.current_content, auth.uid(), 'delete');
  END IF;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for content history
CREATE TRIGGER content_change_trigger
  AFTER INSERT OR UPDATE OR DELETE ON content_elements
  FOR EACH ROW EXECUTE FUNCTION log_content_change();