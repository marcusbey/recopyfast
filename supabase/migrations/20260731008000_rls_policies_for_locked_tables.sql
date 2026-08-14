-- ========================================
-- RLS: policies for tables that had RLS enabled but NO policies
-- ========================================
-- 20250817000000_complete_database_setup.sql runs
--   ALTER TABLE … ENABLE ROW LEVEL SECURITY
-- on twelve tables but only writes policies for seven.  RLS with zero policies
-- denies everything to anon/authenticated, so these five plus content_history
-- were fully invisible to the app's user-scoped (anon-key) clients:
--
--   site_permissions, team_members, teams, team_invitations,
--   domain_verifications, content_history
--
-- site_permissions is the severe one.  It is queried by 25 source files, and —
-- because RLS applies recursively inside policy subqueries — every
--   EXISTS (SELECT 1 FROM site_permissions …)
-- in 20260611010000_rls_hardening.sql, 20260611020000_tighten_permissive_policies.sql
-- and 20260731007000_rls_analytics_and_ab_tests.sql evaluated to FALSE for real
-- users.  Site-scoped RLS across the whole schema was therefore not "strict",
-- it was a total lockout, masked only by the routes that use the service-role key.
--
-- Verified with `SET ROLE authenticated` against a from-scratch build: before
-- this migration a user holding an 'admin' grant saw 0 rows in site_permissions,
-- sites, ab_tests, ab_test_variants, site_analytics and performance_metrics.
--
-- Membership checks are wrapped in SECURITY DEFINER helpers because the natural
-- policy ("you may read the rows of teams you belong to") is self-referential
-- and PostgreSQL rejects it with "infinite recursion detected in policy".
-- ========================================

-- ============================================================
-- Helper functions (SECURITY DEFINER → bypass RLS on the lookup itself)
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_has_site_permission(
  p_site_id UUID,
  p_levels  TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM site_permissions sp
    WHERE sp.site_id = p_site_id
      AND sp.user_id = auth.uid()
      AND sp.permission = ANY(p_levels)
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_team_member(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = p_team_id
      AND tm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_team_role(
  p_team_id UUID,
  p_roles   TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = p_team_id
      AND tm.user_id = auth.uid()
      AND tm.role = ANY(p_roles)
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_has_site_permission(UUID, TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_is_team_member(UUID)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_team_role(UUID, TEXT[])       TO authenticated, service_role;

-- ============================================================
-- site_permissions
-- ============================================================
-- Reading your own grants must be a plain, non-recursive predicate: it is what
-- every other site-scoped policy in the schema depends on.
DROP POLICY IF EXISTS "Users can view their own site permissions" ON site_permissions;
CREATE POLICY "Users can view their own site permissions"
  ON site_permissions
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view team site permissions" ON site_permissions;
CREATE POLICY "Users can view team site permissions"
  ON site_permissions
  FOR SELECT
  USING (
    team_id IS NOT NULL
    AND public.user_is_team_member(team_id)
  );

-- src/app/api/sites/[siteId]/share/route.ts:141 and :3xx create and revoke
-- grants under the caller's own session, having already checked admin rights in
-- application code.  The helper re-checks it in the database.
DROP POLICY IF EXISTS "Site admins can grant site permissions" ON site_permissions;
CREATE POLICY "Site admins can grant site permissions"
  ON site_permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_site_permission(site_id, ARRAY['admin']));

DROP POLICY IF EXISTS "Site admins can update site permissions" ON site_permissions;
CREATE POLICY "Site admins can update site permissions"
  ON site_permissions
  FOR UPDATE
  TO authenticated
  USING (public.user_has_site_permission(site_id, ARRAY['admin']))
  WITH CHECK (public.user_has_site_permission(site_id, ARRAY['admin']));

DROP POLICY IF EXISTS "Site admins can revoke site permissions" ON site_permissions;
CREATE POLICY "Site admins can revoke site permissions"
  ON site_permissions
  FOR DELETE
  TO authenticated
  USING (
    user_id IS NOT NULL
    AND granted_by IS NOT NULL
    AND public.user_has_site_permission(site_id, ARRAY['admin'])
  );

DROP POLICY IF EXISTS "Service role can manage site permissions" ON site_permissions;
CREATE POLICY "Service role can manage site permissions"
  ON site_permissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- teams
-- ============================================================
DROP POLICY IF EXISTS "Members can view their teams" ON teams;
CREATE POLICY "Members can view their teams"
  ON teams
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR public.user_is_team_member(id)
  );

DROP POLICY IF EXISTS "Authenticated users can create teams" ON teams;
CREATE POLICY "Authenticated users can create teams"
  ON teams
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Team owners can update their teams" ON teams;
CREATE POLICY "Team owners can update their teams"
  ON teams
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Team owners can delete their teams" ON teams;
CREATE POLICY "Team owners can delete their teams"
  ON teams
  FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage teams" ON teams;
CREATE POLICY "Service role can manage teams"
  ON teams
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- team_members
-- ============================================================
-- Required by the membership gate in
-- src/app/api/teams/[teamId]/activity/route.ts:24 — without it that route
-- returns 403 for every user, including team owners.
DROP POLICY IF EXISTS "Members can view team membership" ON team_members;
CREATE POLICY "Members can view team membership"
  ON team_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.user_is_team_member(team_id)
  );

DROP POLICY IF EXISTS "Team managers can add members" ON team_members;
CREATE POLICY "Team managers can add members"
  ON team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- accepting your own invitation (api/teams/invitations/accept/route.ts)
    user_id = auth.uid()
    OR public.user_has_team_role(team_id, ARRAY['manager', 'owner'])
  );

DROP POLICY IF EXISTS "Team managers can update members" ON team_members;
CREATE POLICY "Team managers can update members"
  ON team_members
  FOR UPDATE
  TO authenticated
  USING (public.user_has_team_role(team_id, ARRAY['manager', 'owner']))
  WITH CHECK (public.user_has_team_role(team_id, ARRAY['manager', 'owner']));

DROP POLICY IF EXISTS "Team managers can remove members" ON team_members;
CREATE POLICY "Team managers can remove members"
  ON team_members
  FOR DELETE
  TO authenticated
  USING (
    -- leaving a team yourself
    user_id = auth.uid()
    OR public.user_has_team_role(team_id, ARRAY['manager', 'owner'])
  );

DROP POLICY IF EXISTS "Service role can manage team members" ON team_members;
CREATE POLICY "Service role can manage team members"
  ON team_members
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- team_invitations
-- ============================================================
-- The email comparison reads the JWT rather than auth.users so the policy does
-- not depend on the auth schema being readable by `authenticated`.
DROP POLICY IF EXISTS "Invitees can view their invitations" ON team_invitations;
CREATE POLICY "Invitees can view their invitations"
  ON team_invitations
  FOR SELECT
  USING (
    lower(email) = lower(auth.jwt() ->> 'email')
    OR public.user_has_team_role(team_id, ARRAY['manager', 'owner'])
  );

DROP POLICY IF EXISTS "Team managers can create invitations" ON team_invitations;
CREATE POLICY "Team managers can create invitations"
  ON team_invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_team_role(team_id, ARRAY['manager', 'owner']));

DROP POLICY IF EXISTS "Invitees and managers can update invitations" ON team_invitations;
CREATE POLICY "Invitees and managers can update invitations"
  ON team_invitations
  FOR UPDATE
  TO authenticated
  USING (
    lower(email) = lower(auth.jwt() ->> 'email')
    OR public.user_has_team_role(team_id, ARRAY['manager', 'owner'])
  )
  WITH CHECK (
    lower(email) = lower(auth.jwt() ->> 'email')
    OR public.user_has_team_role(team_id, ARRAY['manager', 'owner'])
  );

DROP POLICY IF EXISTS "Team managers can cancel invitations" ON team_invitations;
CREATE POLICY "Team managers can cancel invitations"
  ON team_invitations
  FOR DELETE
  TO authenticated
  USING (public.user_has_team_role(team_id, ARRAY['manager', 'owner']));

DROP POLICY IF EXISTS "Service role can manage team invitations" ON team_invitations;
CREATE POLICY "Service role can manage team invitations"
  ON team_invitations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- domain_verifications  (site-scoped)
-- ============================================================
DROP POLICY IF EXISTS "Site members can view domain verifications" ON domain_verifications;
CREATE POLICY "Site members can view domain verifications"
  ON domain_verifications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = domain_verifications.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Site admins can manage domain verifications" ON domain_verifications;
CREATE POLICY "Site admins can manage domain verifications"
  ON domain_verifications
  FOR ALL
  TO authenticated
  USING (public.user_has_site_permission(site_id, ARRAY['admin']))
  WITH CHECK (public.user_has_site_permission(site_id, ARRAY['admin']));

DROP POLICY IF EXISTS "Service role can manage domain verifications" ON domain_verifications;
CREATE POLICY "Service role can manage domain verifications"
  ON domain_verifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- content_history  (scoped through content_elements → sites)
-- ============================================================
-- The log_content_change() trigger from
-- 20250817000000_complete_database_setup.sql inserts here.  Triggers run with
-- the privileges of the invoking user, so without an INSERT policy every
-- content_elements write by a normal user fails on the trigger's insert.
DROP POLICY IF EXISTS "Site members can view content history" ON content_history;
CREATE POLICY "Site members can view content history"
  ON content_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM content_elements ce
      JOIN site_permissions sp ON sp.site_id = ce.site_id
      WHERE ce.id = content_history.content_element_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Site editors can append content history" ON content_history;
CREATE POLICY "Site editors can append content history"
  ON content_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM content_elements ce
      WHERE ce.id = content_history.content_element_id
        AND public.user_has_site_permission(ce.site_id, ARRAY['edit', 'admin'])
    )
  );

DROP POLICY IF EXISTS "Service role can manage content history" ON content_history;
CREATE POLICY "Service role can manage content history"
  ON content_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
