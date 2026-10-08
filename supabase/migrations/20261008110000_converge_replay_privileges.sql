-- ============================================================
-- A replayed database converges on production's privileges (s68a, M9, H2)
-- ============================================================
-- THE INCIDENT (M9). 20260731008000_rls_policies_for_locked_tables.sql
-- ABORTED in production (see 20260818000000's header), so its write policies
-- never existed there. Every database REPLAYED from these files — local, CI,
-- a branch database, a restore — has them, and three of them are
-- self-escalations. Reproduced on a fresh replay on 2026-10-08 with
-- role-switched SQL (`SET LOCAL ROLE authenticated` + `request.jwt.claims`):
--
--   - "Team managers can add members" (team_members, 20260731008000:201-210):
--     `WITH CHECK (user_id = auth.uid() OR …)` — any signed-in user inserted
--     themselves as `owner` of a team they had never been invited to.
--   - "Invitees and managers can update invitations" (team_invitations,
--     20260801200000:956-968): the invitee clause sits in WITH CHECK too, so
--     an invitee rewrote their own invitation to `role = 'manager'` on ANOTHER
--     team.
--   - "Site admins can update site permissions" (site_permissions,
--     20260731008000:117-123): a site-scoped USING, so a collaborator `admin`
--     ran `UPDATE site_permissions SET granted_by = <self>` with no WHERE and
--     stamped the creator's row. `granted_by IS NULL` is the creator marker
--     that the per-row DELETE policy (20260813140000) and the share route's
--     creator guard rely on; stamping it makes the creator revocable.
--
-- WHAT EXISTS WHERE.
--   Production: only "Invitees and managers can update invitations" (from the
--   applied 20260801200000). It is inert there — production's team_members has
--   no `authenticated` INSERT policy (20260804130000:214-222), so a rewritten
--   invitation cannot be accepted — but it is still a write the invitee should
--   not have. Every other DROP below is a no-op in production.
--   Replay: all six.
--
-- WHY DROP, NOT REPAIR. Teams are PRD graveyard (docs/prd.md:139-140: frozen,
-- no new work, superseded by the email-invite grant model). No live surface
-- writes these tables with a user JWT: the share route writes site_permissions
-- through the service role after its own authorisation (its module header),
-- and the teams accept route (src/app/api/teams/invitations/accept/route.ts)
-- is already non-functional in production and stays frozen. The one write a
-- manager legitimately keeps — updating an invitation of a team they manage —
-- is recreated with the manager/owner predicate alone. The per-row DELETE
-- policy of 20260813140000 is live in production, is not an escalation path,
-- and is kept.
--
-- H2 — THE DEFINER-FUNCTION INVARIANT, ASSERTED AT APPLY TIME. On a replay,
-- 20260809120000 revokes every listed SECURITY DEFINER function and
-- src/__tests__/db/function-grants.test.ts passes; production matches (owner's
-- read-only SQL, 2026-10-08). What was missing is enforcement: no CI step ran
-- that suite against a real database (s68a wires it into both replays), and
-- nothing asserted it where it matters most — on the production push. The
-- postcondition at the end of this file is that suite's invariant in SQL:
--   1. no SECURITY DEFINER function in `public` is executable by PUBLIC or
--      `anon`;
--   2. `authenticated` executes only the three RLS predicates, matched on full
--      identity (name AND argument types — function-grants.test.ts:81-85).
-- If production holds an offender, the push ABORTS in its transaction and
-- names it — the intended outcome. The runbook's step-0 read-only query
-- (docs/operations/edit-session-authority.md) predicts it before the push.
-- src/__tests__/db/replay-privilege-convergence.test.ts runs the block between
-- the markers below against a planted offender, so a block that silently
-- stopped matching cannot pass. Keep the markers.
--
-- `proacl` is coalesced with `acldefault`: a NULL ACL means EXECUTE to PUBLIC,
-- the most open state, and `aclexplode(NULL)` returns no rows.
-- ============================================================

-- 1. Replay-only member writes on team_members.
DROP POLICY IF EXISTS "Team managers can add members" ON public.team_members;
DROP POLICY IF EXISTS "Team managers can update members" ON public.team_members;
DROP POLICY IF EXISTS "Team managers can remove members" ON public.team_members;

-- 2. Replay-only admin writes on site_permissions. The service role writes
--    this table (share route, registration); its FOR ALL policy stays.
DROP POLICY IF EXISTS "Site admins can grant site permissions" ON public.site_permissions;
DROP POLICY IF EXISTS "Site admins can update site permissions" ON public.site_permissions;

-- 3. The invitation UPDATE: managers and owners of the team only, on both
--    sides of the write, so an invitation can be neither taken over nor moved
--    to a team its writer does not manage.
DROP POLICY IF EXISTS "Invitees and managers can update invitations" ON public.team_invitations;
DROP POLICY IF EXISTS "Team managers can update invitations" ON public.team_invitations;
CREATE POLICY "Team managers can update invitations"
  ON public.team_invitations
  FOR UPDATE
  TO authenticated
  USING (public.user_has_team_role(team_id, ARRAY['manager', 'owner']))
  WITH CHECK (public.user_has_team_role(team_id, ARRAY['manager', 'owner']));

-- 4. Postcondition (H2).
-- BEGIN definer-grant postcondition
DO $$
DECLARE
  v_offenders TEXT;
BEGIN
  SELECT string_agg(g.identity || ' -> ' || g.grantee, ', '
                    ORDER BY g.identity, g.grantee)
    INTO v_offenders
    FROM (
      SELECT p.proname || '(' || COALESCE(
               (SELECT string_agg(format_type(a.t, NULL), ', ' ORDER BY a.ord)
                  FROM unnest(p.proargtypes) WITH ORDINALITY AS a(t, ord)),
               ''
             ) || ')' AS identity,
             CASE WHEN acl.grantee = 0
                  THEN 'PUBLIC'
                  ELSE pg_get_userbyid(acl.grantee)
             END AS grantee
        FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(
               COALESCE(p.proacl, acldefault('f', p.proowner))
             ) AS acl
       WHERE p.prosecdef
         AND p.pronamespace = 'public'::regnamespace
         AND acl.privilege_type = 'EXECUTE'
         AND (
           acl.grantee = 0
           OR pg_get_userbyid(acl.grantee) IN ('anon', 'authenticated')
         )
    ) AS g
   WHERE g.grantee <> 'authenticated'
      OR g.identity NOT IN (
           'user_has_site_permission(uuid, text[])',
           'user_is_team_member(uuid)',
           'user_has_team_role(uuid, text[])'
         );

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'SECURITY DEFINER function(s) in public executable by a web principal outside the RLS-predicate allowlist: %',
      v_offenders;
  END IF;
END $$;
-- END definer-grant postcondition
