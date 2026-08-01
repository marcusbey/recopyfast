-- ========================================
-- Missing Tables: Collaboration
-- ========================================
-- team_activity_log, collaboration_notifications and content_editing_sessions
-- are queried by application code but existed only in the loose
-- supabase/collaboration-schema.sql, which `supabase db push` never runs.
-- A database built from migrations/ alone 500s on those routes.
--
-- team_activity vs team_activity_log
-- ----------------------------------
-- 20250817000000_complete_database_setup.sql created a *different* table named
-- team_activity (activity_type / entity_type / entity_id / metadata).  No
-- application code references it — the only reader/writer is
-- src/app/api/teams/[teamId]/activity/route.ts:44, which queries
-- team_activity_log (action / resource_type / resource_id / details) and
-- embeds via the FK name team_activity_log_user_id_fkey.
-- Resolution: create team_activity_log to match the code.  team_activity is
-- left in place (it may hold production rows and 20260611010000_rls_hardening
-- attaches policies to it) but is superseded — see supabase/README.md.
-- ========================================

-- ============================================================
-- team_activity_log
-- ============================================================
CREATE TABLE IF NOT EXISTS team_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- FK name is load-bearing: PostgREST resolves the embed hint
  -- `auth.users!team_activity_log_user_id_fkey` against it.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_activity_log_team_created
  ON team_activity_log(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_activity_log_user_id
  ON team_activity_log(user_id);

ALTER TABLE team_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members can view team activity log" ON team_activity_log;
CREATE POLICY "Team members can view team activity log"
  ON team_activity_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_activity_log.team_id
        AND tm.user_id = auth.uid()
    )
  );

-- Members of the team may append their own activity rows; everything else is
-- service-role only (matches the write pattern in 20260611010000_rls_hardening).
DROP POLICY IF EXISTS "Team members can append their own activity" ON team_activity_log;
CREATE POLICY "Team members can append their own activity"
  ON team_activity_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_activity_log.team_id
        AND tm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage team activity log" ON team_activity_log;
CREATE POLICY "Service role can manage team activity log"
  ON team_activity_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- collaboration_notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS collaboration_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN ('invitation', 'permission_change', 'content_edit', 'team_update', 'site_shared')
  ),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- src/app/api/notifications/route.ts filters by user_id, orders by created_at
-- DESC and optionally filters read_at IS NULL.
CREATE INDEX IF NOT EXISTS idx_collaboration_notifications_user_created
  ON collaboration_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collaboration_notifications_unread
  ON collaboration_notifications(user_id)
  WHERE read_at IS NULL;

ALTER TABLE collaboration_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own notifications" ON collaboration_notifications;
CREATE POLICY "Users can view their own notifications"
  ON collaboration_notifications
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own notifications" ON collaboration_notifications;
CREATE POLICY "Users can update their own notifications"
  ON collaboration_notifications
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own notifications" ON collaboration_notifications;
CREATE POLICY "Users can delete their own notifications"
  ON collaboration_notifications
  FOR DELETE
  USING (user_id = auth.uid());

-- Notifications are written *for other people* by the sharing / invitation
-- routes, which run under the caller's anon-key session.  Restrict that to
-- users who already have a relationship with the recipient rather than
-- WITH CHECK (true), which would be an open notification-spam vector.
DROP POLICY IF EXISTS "Collaborators can notify related users" ON collaboration_notifications;
CREATE POLICY "Collaborators can notify related users"
  ON collaboration_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- self-notification (src/app/api/teams/invitations/accept/route.ts:133)
    user_id = auth.uid()
    -- actor and recipient share a team
    OR EXISTS (
      SELECT 1
      FROM team_members tm_actor
      JOIN team_members tm_target ON tm_target.team_id = tm_actor.team_id
      WHERE tm_actor.user_id = auth.uid()
        AND tm_target.user_id = collaboration_notifications.user_id
    )
    -- actor administers a site the recipient has a direct grant on
    OR EXISTS (
      SELECT 1
      FROM site_permissions sp_actor
      JOIN site_permissions sp_target ON sp_target.site_id = sp_actor.site_id
      WHERE sp_actor.user_id = auth.uid()
        AND sp_actor.permission = 'admin'
        AND sp_target.user_id = collaboration_notifications.user_id
    )
    -- actor administers a site shared with a team the recipient belongs to
    OR EXISTS (
      SELECT 1
      FROM site_permissions sp_actor
      JOIN site_permissions sp_team
        ON sp_team.site_id = sp_actor.site_id
       AND sp_team.team_id IS NOT NULL
      JOIN team_members tm ON tm.team_id = sp_team.team_id
      WHERE sp_actor.user_id = auth.uid()
        AND sp_actor.permission = 'admin'
        AND tm.user_id = collaboration_notifications.user_id
    )
  );

DROP POLICY IF EXISTS "Service role can manage notifications" ON collaboration_notifications;
CREATE POLICY "Service role can manage notifications"
  ON collaboration_notifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- content_editing_sessions
-- ============================================================
-- NOTE: collaboration-schema.sql declared UNIQUE(content_element_id, user_id).
-- That contradicts src/lib/collaboration/permissions.ts:287-301, which ends the
-- previous session (sets ended_at) and then INSERTs a *new* row for the same
-- (element, user) pair — the unique constraint would reject the second row.
-- The code wins: the uniqueness is enforced only over *active* sessions.
CREATE TABLE IF NOT EXISTS content_editing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_element_id UUID NOT NULL REFERENCES content_elements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_editing_sessions_active_unique
  ON content_editing_sessions(content_element_id, user_id)
  WHERE ended_at IS NULL;

-- permissions.ts:210 filters element + ended_at IS NULL + last_activity window.
CREATE INDEX IF NOT EXISTS idx_content_editing_sessions_active
  ON content_editing_sessions(content_element_id, last_activity)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_content_editing_sessions_user_id
  ON content_editing_sessions(user_id);

ALTER TABLE content_editing_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own editing sessions" ON content_editing_sessions;
CREATE POLICY "Users can manage their own editing sessions"
  ON content_editing_sessions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Other collaborators must be able to *see* an element is locked.
DROP POLICY IF EXISTS "Site members can view editing sessions" ON content_editing_sessions;
CREATE POLICY "Site members can view editing sessions"
  ON content_editing_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM content_elements ce
      JOIN site_permissions sp ON sp.site_id = ce.site_id
      WHERE ce.id = content_editing_sessions.content_element_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage editing sessions" ON content_editing_sessions;
CREATE POLICY "Service role can manage editing sessions"
  ON content_editing_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
