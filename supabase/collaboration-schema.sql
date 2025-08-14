-- Collaboration System Schema for ReCopyFast
-- This schema adds team collaboration features including invitations, enhanced permissions, and team management

-- Teams table - represents groups of users working together
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  billing_plan TEXT DEFAULT 'free' CHECK (billing_plan IN ('free', 'starter', 'pro', 'enterprise')),
  max_members INTEGER DEFAULT 5,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Team members table - manages users in teams with roles
CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'editor' CHECK (role IN ('viewer', 'editor', 'manager', 'owner')) NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  invited_by UUID REFERENCES auth.users(id),
  UNIQUE(team_id, user_id)
);

-- Team invitations table - manages pending team invitations
CREATE TABLE team_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'editor' CHECK (role IN ('viewer', 'editor', 'manager')) NOT NULL,
  invited_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days') NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(team_id, email)
);

-- Update sites table to include team ownership
ALTER TABLE sites ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE sites ADD COLUMN created_by UUID REFERENCES auth.users(id);

-- Update site_permissions to include more granular permissions and team context
DROP TABLE IF EXISTS site_permissions;
CREATE TABLE site_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'editor' CHECK (role IN ('viewer', 'editor', 'manager', 'owner')) NOT NULL,
  permissions JSONB DEFAULT '{}', -- granular permissions for specific content sections
  granted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  -- Either user_id or team_id must be set, but not both
  CHECK ((user_id IS NOT NULL AND team_id IS NULL) OR (user_id IS NULL AND team_id IS NOT NULL)),
  UNIQUE(site_id, user_id),
  UNIQUE(site_id, team_id)
);

-- Content editing sessions table - for real-time collaboration tracking
CREATE TABLE content_editing_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_element_id UUID REFERENCES content_elements(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  ended_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(content_element_id, user_id)
);

-- Collaborative notifications table
CREATE TABLE collaboration_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('invitation', 'permission_change', 'content_edit', 'team_update', 'site_shared')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Activity log table - for team activity tracking
CREATE TABLE team_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL, -- 'site', 'team', 'member', 'invitation', 'content'
  resource_id UUID,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create indexes for better performance
CREATE INDEX idx_teams_owner_id ON teams(owner_id);
CREATE INDEX idx_team_members_team_id ON team_members(team_id);
CREATE INDEX idx_team_members_user_id ON team_members(user_id);
CREATE INDEX idx_team_invitations_team_id ON team_invitations(team_id);
CREATE INDEX idx_team_invitations_email ON team_invitations(email);
CREATE INDEX idx_team_invitations_token ON team_invitations(token);
CREATE INDEX idx_team_invitations_expires_at ON team_invitations(expires_at);
CREATE INDEX idx_sites_team_id ON sites(team_id);
CREATE INDEX idx_sites_created_by ON sites(created_by);
CREATE INDEX idx_site_permissions_site_id ON site_permissions(site_id);
CREATE INDEX idx_site_permissions_user_id ON site_permissions(user_id);
CREATE INDEX idx_site_permissions_team_id ON site_permissions(team_id);
CREATE INDEX idx_content_editing_sessions_element_id ON content_editing_sessions(content_element_id);
CREATE INDEX idx_content_editing_sessions_user_id ON content_editing_sessions(user_id);
CREATE INDEX idx_collaboration_notifications_user_id ON collaboration_notifications(user_id);
CREATE INDEX idx_collaboration_notifications_type ON collaboration_notifications(type);
CREATE INDEX idx_team_activity_log_team_id ON team_activity_log(team_id);
CREATE INDEX idx_team_activity_log_user_id ON team_activity_log(user_id);
CREATE INDEX idx_team_activity_log_created_at ON team_activity_log(created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_editing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_activity_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for teams table
CREATE POLICY "Users can view teams they are members of" ON teams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = teams.id
      AND team_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Team owners can update their teams" ON teams
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Authenticated users can create teams" ON teams
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());

-- RLS Policies for team_members table
CREATE POLICY "Team members can view team membership" ON team_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_members.team_id
      AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Team managers can manage team members" ON team_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_members.team_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('manager', 'owner')
    )
  );

-- RLS Policies for team_invitations table
CREATE POLICY "Team managers can manage invitations" ON team_invitations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_invitations.team_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('manager', 'owner')
    )
  );

CREATE POLICY "Users can view invitations sent to their email" ON team_invitations
  FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- RLS Policies for content_editing_sessions table
CREATE POLICY "Users can manage their own editing sessions" ON content_editing_sessions
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Team members can view editing sessions for accessible content" ON content_editing_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM content_elements ce
      JOIN sites s ON ce.site_id = s.id
      JOIN team_members tm ON s.team_id = tm.team_id
      WHERE ce.id = content_editing_sessions.content_element_id
      AND tm.user_id = auth.uid()
    )
  );

-- RLS Policies for collaboration_notifications table
CREATE POLICY "Users can manage their own notifications" ON collaboration_notifications
  FOR ALL USING (user_id = auth.uid());

-- RLS Policies for team_activity_log table
CREATE POLICY "Team members can view team activity" ON team_activity_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_activity_log.team_id
      AND tm.user_id = auth.uid()
    )
  );

-- Update existing RLS policies for sites table to include team permissions
DROP POLICY IF EXISTS "Users can view sites they have permission to" ON sites;
CREATE POLICY "Users can view sites they have permission to" ON sites
  FOR SELECT USING (
    -- Direct user permission
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = sites.id
      AND sp.user_id = auth.uid()
    )
    OR
    -- Team permission through team membership
    EXISTS (
      SELECT 1 FROM site_permissions sp
      JOIN team_members tm ON sp.team_id = tm.team_id
      WHERE sp.site_id = sites.id
      AND tm.user_id = auth.uid()
    )
    OR
    -- Site belongs to user's team
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = sites.team_id
      AND tm.user_id = auth.uid()
    )
  );

-- Update content_elements policies for team collaboration
DROP POLICY IF EXISTS "Users can view content for sites they have permission to" ON content_elements;
CREATE POLICY "Users can view content for sites they have permission to" ON content_elements
  FOR SELECT USING (
    -- Direct user permission
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = content_elements.site_id
      AND sp.user_id = auth.uid()
    )
    OR
    -- Team permission through team membership
    EXISTS (
      SELECT 1 FROM site_permissions sp
      JOIN team_members tm ON sp.team_id = tm.team_id
      WHERE sp.site_id = content_elements.site_id
      AND tm.user_id = auth.uid()
    )
    OR
    -- Site belongs to user's team
    EXISTS (
      SELECT 1 FROM team_members tm
      JOIN sites s ON tm.team_id = s.team_id
      WHERE s.id = content_elements.site_id
      AND tm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can edit content for sites they have edit permission to" ON content_elements;
CREATE POLICY "Users can edit content for sites they have edit permission to" ON content_elements
  FOR ALL USING (
    -- Direct user permission with edit or manager role
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = content_elements.site_id
      AND sp.user_id = auth.uid()
      AND sp.role IN ('editor', 'manager', 'owner')
    )
    OR
    -- Team permission through team membership with edit or manager role
    EXISTS (
      SELECT 1 FROM site_permissions sp
      JOIN team_members tm ON sp.team_id = tm.team_id
      WHERE sp.site_id = content_elements.site_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('editor', 'manager', 'owner')
      AND sp.role IN ('editor', 'manager', 'owner')
    )
    OR
    -- Site belongs to user's team and user has edit permissions
    EXISTS (
      SELECT 1 FROM team_members tm
      JOIN sites s ON tm.team_id = s.team_id
      WHERE s.id = content_elements.site_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('editor', 'manager', 'owner')
    )
  );

-- Triggers for updated_at columns
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_site_permissions_updated_at BEFORE UPDATE ON site_permissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically add team owner as team member
CREATE OR REPLACE FUNCTION add_team_owner_as_member()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO team_members (team_id, user_id, role, invited_by)
  VALUES (NEW.id, NEW.owner_id, 'owner', NEW.owner_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER add_team_owner_trigger
  AFTER INSERT ON teams
  FOR EACH ROW EXECUTE FUNCTION add_team_owner_as_member();

-- Function to log team activity
CREATE OR REPLACE FUNCTION log_team_activity()
RETURNS TRIGGER AS $$
DECLARE
  team_id_val UUID;
  action_val TEXT;
  resource_type_val TEXT;
  resource_id_val UUID;
BEGIN
  -- Determine team_id and action based on table and operation
  IF TG_TABLE_NAME = 'team_members' THEN
    team_id_val := COALESCE(NEW.team_id, OLD.team_id);
    resource_type_val := 'member';
    resource_id_val := COALESCE(NEW.user_id, OLD.user_id);
    
    IF TG_OP = 'INSERT' THEN
      action_val := 'member_added';
    ELSIF TG_OP = 'UPDATE' THEN
      action_val := 'member_role_changed';
    ELSIF TG_OP = 'DELETE' THEN
      action_val := 'member_removed';
    END IF;
    
  ELSIF TG_TABLE_NAME = 'team_invitations' THEN
    team_id_val := COALESCE(NEW.team_id, OLD.team_id);
    resource_type_val := 'invitation';
    resource_id_val := COALESCE(NEW.id, OLD.id);
    
    IF TG_OP = 'INSERT' THEN
      action_val := 'invitation_sent';
    ELSIF TG_OP = 'UPDATE' AND NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN
      action_val := 'invitation_accepted';
    ELSIF TG_OP = 'DELETE' THEN
      action_val := 'invitation_cancelled';
    END IF;
    
  ELSIF TG_TABLE_NAME = 'sites' THEN
    team_id_val := COALESCE(NEW.team_id, OLD.team_id);
    resource_type_val := 'site';
    resource_id_val := COALESCE(NEW.id, OLD.id);
    
    IF TG_OP = 'INSERT' THEN
      action_val := 'site_created';
    ELSIF TG_OP = 'UPDATE' THEN
      action_val := 'site_updated';
    ELSIF TG_OP = 'DELETE' THEN
      action_val := 'site_deleted';
    END IF;
  END IF;

  -- Only log if we have a team_id and action
  IF team_id_val IS NOT NULL AND action_val IS NOT NULL THEN
    INSERT INTO team_activity_log (team_id, user_id, action, resource_type, resource_id)
    VALUES (team_id_val, auth.uid(), action_val, resource_type_val, resource_id_val);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create activity logging triggers
CREATE TRIGGER team_members_activity_trigger
  AFTER INSERT OR UPDATE OR DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION log_team_activity();

CREATE TRIGGER team_invitations_activity_trigger
  AFTER INSERT OR UPDATE OR DELETE ON team_invitations
  FOR EACH ROW EXECUTE FUNCTION log_team_activity();

CREATE TRIGGER sites_activity_trigger
  AFTER INSERT OR UPDATE OR DELETE ON sites
  FOR EACH ROW EXECUTE FUNCTION log_team_activity();

-- Function to clean up expired invitations
CREATE OR REPLACE FUNCTION cleanup_expired_invitations()
RETURNS void AS $$
BEGIN
  DELETE FROM team_invitations
  WHERE expires_at < NOW() AND accepted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to end inactive editing sessions
CREATE OR REPLACE FUNCTION cleanup_inactive_sessions()
RETURNS void AS $$
BEGIN
  UPDATE content_editing_sessions
  SET ended_at = NOW()
  WHERE ended_at IS NULL
  AND last_activity < NOW() - INTERVAL '30 minutes';
END;
$$ LANGUAGE plpgsql;