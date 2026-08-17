-- ========================================
-- The seventeen tables six aborted migrations never actually created
-- ========================================
-- This is a REPAIR, not a duplicate. Every CREATE TABLE below already exists,
-- word for word, in a migration file that is recorded as APPLIED in
-- supabase_migrations.schema_migrations. None of those tables exists in the
-- database. Read that sentence twice before concluding this file is redundant.
--
-- MEASURED, NOT INFERRED
-- ----------------------
-- 2026-08-17, live read-only query against production over the IPv4 pooler
-- (`node scripts/check-schema.mjs`, plus a pg_catalog probe for functions and
-- columns). The public schema holds 40 tables. These seventeen are absent:
--
--   ab_test_results, visitor_buckets,
--   collaboration_notifications, content_editing_sessions, team_activity_log,
--   api_usage, audit_logs, compliance_reports, conversion_events,
--   blog_posts, bulk_operations, webhooks, webhook_deliveries,
--   site_editors, editor_verification_codes, editor_device_grants,
--   editor_handoffs
--
-- Every one of them is queried by code that ships on `main` today, so each
-- absence is a live runtime failure, not dead weight. It has gone unnoticed
-- because production holds one user, four sites and zero content elements —
-- nobody has exercised the paths that touch them. `site_editors` alone is read
-- by nine source files and is the product's wedge.
--
-- The six files that should have created them, all marked applied:
--
--   20260127_ab_testing_v2                        ab_test_results, visitor_buckets
--   20260731001000_missing_tables_collaboration   collaboration_notifications,
--                                                 content_editing_sessions,
--                                                 team_activity_log
--   20260731002000_missing_tables_audit_analytics api_usage, audit_logs,
--                                                 compliance_reports,
--                                                 conversion_events
--   20260731004000_missing_tables_integrations    blog_posts, bulk_operations,
--                                                 webhooks, webhook_deliveries
--   20260801100000_editor_access_2fa              site_editors,
--                                                 editor_verification_codes,
--                                                 editor_device_grants,
--                                                 editor_handoffs
--   20260731000000_collaboration_schema_alignment creates no table, but adds
--                                                 three columns to
--                                                 site_permissions that are
--                                                 also absent — see section 1.
--
-- That sixth file is a NEW finding. docs/quality/qa-register.md names five;
-- the probe found site_permissions holding exactly (id, user_id, site_id,
-- permission, created_at) with none of 20260731000000's indexes or constraints,
-- so it too aborted in full and is nonetheless in the ledger.
--
-- WHY THEY ARE ALL EMPTY RATHER THAN PARTIAL
-- ------------------------------------------
-- Supabase wraps each migration in a single transaction. One 42P01/42703/42883
-- anywhere in the file rolls the entire file back, while the ledger row that
-- says "applied" is written outside that transaction. The signature is exactly
-- what the probe shows: not some tables from a file, but none of them.
--
-- WHY WE GO FORWARD INSTEAD OF REPLAYING THEM
-- -------------------------------------------
-- 1. They will never run again. The ledger says applied, so `supabase db push`
--    skips them forever. Un-marking them is an operator action with its own
--    blast radius, and it would not help: three of the six still cannot succeed
--    (see below), so a replay would abort again and re-record success again —
--    reproducing the exact scar that created this situation.
-- 2. AGENTS.md non-negotiable 5: never edit an applied migration. Forward-only.
-- 3. This file is additive and re-runnable end to end: IF NOT EXISTS on every
--    table and index, DROP POLICY IF EXISTS before every CREATE POLICY, a
--    duplicate_object trap around every ADD CONSTRAINT. There is no
--    CREATE POLICY IF NOT EXISTS in PostgreSQL — that omission is what made
--    20250817000000 unreplayable and started all of this.
--
-- WHICH OF THE SIX STILL COULD NOT RUN TODAY, AND WHY
-- ---------------------------------------------------
-- Worth recording, because it is the argument against a replay and it names the
-- traps this file had to route around:
--
--   20260731001000  its collaboration_notifications INSERT policy joins
--                   site_permissions on `team_id`, and that column does not
--                   exist — because 20260731000000 rolled back first. A chain:
--                   one abort caused the next. Fixed here by section 1 running
--                   before section 4.
--                   It also declares content_editing_sessions.session_token
--                   DEFAULT encode(gen_random_bytes(16),'hex'). pgcrypto lives
--                   in the `extensions` schema on this project, and
--                   20260801200000:290-296 records that form failing the CLI
--                   push with "function gen_random_bytes(integer) does not
--                   exist" and taking the whole file with it. Substituted below.
--   20260801100000  its first site_editors policy calls
--                   public.user_has_site_permission(), which does not exist —
--                   only 20260731008000 creates it, and that file aborted too.
--                   Fixed here by section 2.
--   20260127        creates ab_test_results REFERENCES ab_tests, which did not
--                   exist at the time. It does now (20260801200000 created it,
--                   and the probe confirms all twenty of its columns), so this
--                   one is unblocked; the tables are still absent.
--   20260731002000  would apply cleanly against the schema as measured today.
--   20260731004000  the same.
--   20260731000000  the same.
--
-- The last three are the honest answer to "why did it abort": it cannot be
-- reconstructed from the current schema, and it does not need to be. What is
-- measured is that their objects are absent and their ledger rows are present.
-- Not needing to know is precisely the advantage of a forward repair.
--
-- WHAT IS FOLDED IN, AND WHY IT HAS TO BE
-- ---------------------------------------
-- These seventeen tables are absent from the whole chain that followed, not
-- just from their own era. Any later migration that ALTERs them either aborted
-- on the same 42P01 or ran as a no-op, and every one of those is marked applied
-- too. So whatever they intended has to be baked in here or the schema will not
-- match what the application expects:
--
--   20260611020000  replaces 20260127's FOR ALL USING(true) policies on
--                   ab_test_results and visitor_buckets — which, having no TO
--                   clause, granted every role including `anon` full write.
--                   Only the tightened set is created below.
--   20260731000000  the three site_permissions columns (section 1).
--   20260731008000  user_has_site_permission / user_is_team_member (section 2).
--
-- Each folded-in item is attributed inline to the migration it came from, in
-- the style of 20260801200000_missing_base_tables.sql, which is this file's
-- model and solved the same problem for ten other tables.
--
-- TWO ITEMS THAT UNBLOCK SECURITY WORK
-- ------------------------------------
-- Two migrations on `main` have never been applied because their dry run fails
-- against the missing objects (qa-register.md, "The two that could not be
-- applied"):
--
--   20260809120000_lock_down_definer_functions
--     needs public.purge_expired_editor_artifacts() — section 7.
--     ALSO needs public.user_is_team_member() — section 2.
--   20260813140000_site_permissions_delete_per_row
--     needs site_permissions.granted_by — section 1.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT FIX
-- ----------------------------------------
-- Named so the gap is recorded rather than rediscovered:
--
--   • update_site_analytics() and update_translation_coverage() are ALSO absent
--     (probed). 20260809120000 revokes EXECUTE on both at :138 and :143, before
--     it reaches the two names this file supplies, so it will still fail until
--     they exist. update_site_analytics belongs to 20260731005000, which aborted
--     as well and also never added the site_analytics / user_activity_logs
--     columns its body writes — recreating the function without those columns
--     would produce something that creates cleanly and raises at call time.
--     That is a second repair, for 20260731005000/006000/007000, and it is out
--     of this file's scope on purpose.
--   • The rest of 20260801100000's intent that acts on `staging_access`, an
--     existing table with live rows: the deactivation of email-less
--     access_type='link' rows, and the reject_self_claim_staging_access trigger
--     that retires that path at the database. Both change behaviour on a table
--     outside the seventeen. Measured today: 3 staging_access rows, all with an
--     email, all expired, 0 self-claim rows — so the deactivation is a no-op
--     and the decision is cheap whenever it is taken.
--   • 20260801100000's CSPRNG rewrite of generate_verification_code(). The
--     existing random()-based version is live; the replacement body calls
--     gen_random_bytes() under SET search_path = public, pg_temp, which excludes
--     the `extensions` schema pgcrypto lives in. Shipping it here would swap a
--     weak function for a broken one. It needs a schema-qualified call, which is
--     a change to that migration's text and therefore its own decision.
-- ========================================

-- ============================================================
-- 0. Preflight
-- ============================================================
-- Every foreign key below points at a table this file does not create, and two
-- triggers call a function it does not define. All were verified present by the
-- 2026-08-17 probe, but asserting it up front turns a missing prerequisite into
-- one legible error instead of a 42P01 from whichever CREATE TABLE happens to
-- hit it first. The whole file is one transaction, so raising here leaves the
-- database exactly as it was.
DO $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_table   TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.sites',
    'public.content_elements',
    'public.site_permissions',
    'public.api_keys',
    'public.teams',
    'public.team_members',
    'public.ab_tests',
    'public.ab_test_variants'
  ] LOOP
    IF to_regclass(v_table) IS NULL THEN
      v_missing := array_append(v_missing, v_table);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'Cannot repair the aborted migrations: prerequisite table(s) absent: %',
      array_to_string(v_missing, ', ');
  END IF;

  -- webhooks and blog_posts attach an updated_at trigger to it
  -- (20250817000000:499). Absent, CREATE TRIGGER fails with 42883 halfway
  -- through section 6 rather than here.
  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION
      'Cannot repair the aborted migrations: public.update_updated_at_column() is absent (20250817000000:499)';
  END IF;
END
$$;

-- ============================================================
-- 1. site_permissions — the columns 20260731000000 never added
-- ============================================================
-- FOLDED IN WHOLE from 20260731000000_collaboration_schema_alignment.sql,
-- which is in the ledger and whose four ADD COLUMNs are all absent (probed:
-- site_permissions is exactly id, user_id, site_id, permission, created_at).
--
-- This is not a courtesy. Two things in flight need it:
--
--   1. THIS FILE. The collaboration_notifications INSERT policy in section 4
--      joins site_permissions on `team_id`. Without the column, that CREATE
--      POLICY raises 42703 and rolls back the whole repair — which is exactly
--      how 20260731001000 died in the first place.
--   2. 20260813140000_site_permissions_delete_per_row, which has never been
--      applied because its dry run fails with `column "granted_by" does not
--      exist`. It is the A-4 per-row DELETE fix, i.e. security work.
--
-- site_permissions ALREADY EXISTS and holds live rows (2, both 'admin'), so
-- everything here is additive: ADD COLUMN IF NOT EXISTS, constraints guarded by
-- a duplicate_object trap, indexes IF NOT EXISTS.
--
-- `permission` is included for the same reason 20260731000000 included it — so
-- the file is a no-op against a database built from either the canonical
-- migration or the loose supabase/collaboration-schema.sql.
ALTER TABLE site_permissions ADD COLUMN IF NOT EXISTS permission TEXT;
ALTER TABLE site_permissions ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE site_permissions ADD COLUMN IF NOT EXISTS team_id UUID;
ALTER TABLE site_permissions ADD COLUMN IF NOT EXISTS granted_by UUID;

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS — guard with a DO block.
-- The constraint NAMES are load-bearing: PostgREST resolves the embed hints in
-- src/app/api/sites/[siteId]/share/route.ts:258 and
-- src/lib/collaboration/permissions.ts:109 against
-- site_permissions_team_id_fkey by name.
DO $$
BEGIN
  ALTER TABLE site_permissions
    ADD CONSTRAINT site_permissions_team_id_fkey
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE site_permissions
    ADD CONSTRAINT site_permissions_granted_by_fkey
      FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE site_permissions
    ADD CONSTRAINT site_permissions_role_check
      CHECK (role IS NULL OR role IN ('viewer', 'editor', 'manager', 'owner'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS idx_site_permissions_team_id ON site_permissions(team_id);

-- One grant per (site, team). Partial so the existing UNIQUE(user_id, site_id)
-- constraint on user grants is untouched.
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_permissions_site_team_unique
  ON site_permissions(site_id, team_id)
  WHERE team_id IS NOT NULL;

-- Keep the two representations of the same grant consistent for existing rows.
-- NOTE FOR FOLLOW-UP, carried over from 20260731000000:23-25: `permission`
-- ('view'|'edit'|'admin') and `role` ('viewer'|'editor'|'manager'|'owner') are
-- parallel spellings of one fact. Both are populated; the application should
-- converge on one.
UPDATE site_permissions
SET role = CASE permission
             WHEN 'view'  THEN 'viewer'
             WHEN 'edit'  THEN 'editor'
             WHEN 'admin' THEN 'owner'
           END
WHERE role IS NULL
  AND permission IS NOT NULL;

UPDATE site_permissions
SET permission = CASE role
                   WHEN 'viewer'  THEN 'view'
                   WHEN 'editor'  THEN 'edit'
                   WHEN 'manager' THEN 'admin'
                   WHEN 'owner'   THEN 'admin'
                 END
WHERE permission IS NULL
  AND role IS NOT NULL;

-- ============================================================
-- 2. The RLS predicates 20260731008000 never created
-- ============================================================
-- Both probed absent. Copied verbatim from
-- 20260731008000_rls_policies_for_locked_tables.sql:33-63, which aborted.
-- CREATE OR REPLACE is a no-op if some future repair of that file lands first,
-- and replacing a function leaves its ownership and privileges untouched.
--
-- SECURITY DEFINER is load-bearing on both: the natural predicate ("you may
-- read the rows of teams you belong to") is self-referential, and PostgreSQL
-- rejects it with "infinite recursion detected in policy". The definer context
-- does the lookup outside RLS.
--
-- user_has_site_permission is a hard prerequisite of THIS file: every policy in
-- section 7 calls it, and its absence is why 20260801100000 aborted.
-- user_is_team_member is not used here; it is created because
-- 20260809120000_lock_down_definer_functions:176 REVOKEs on it by name and
-- REVOKE has no IF EXISTS, so that security migration cannot be applied while
-- it is missing. That migration's own header states the rule being followed
-- here: "the answer is to repair the migration that should have created it, not
-- to make the REVOKE conditional".
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

-- Verbatim from 20260731008000:83-84. `authenticated` stays: an RLS policy
-- expression is evaluated with the querying role's privileges, so revoking it
-- would break every site-scoped policy rather than harden it (measured in
-- 20260809120000:149-166). Supabase's default privileges additionally grant
-- `anon` at creation time; 20260809120000:171-179 is what removes that, and
-- applying it is the next step after this file.
GRANT EXECUTE ON FUNCTION public.user_has_site_permission(UUID, TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_is_team_member(UUID)              TO authenticated, service_role;

-- ============================================================
-- 3. A/B DATA PLANE   (from 20260127_ab_testing_v2.sql)
-- ============================================================
-- src/app/api/ab-tests/track/route.ts, .../bucket/[siteId]/route.ts and
-- src/lib/ab-testing/lifecycle.ts:43 read and write both tables. Probed live
-- over PostgREST during s11a: both returned PGRST205 while the error hints
-- named other public tables, so the absence was real and not a schema-cache
-- artifact.
--
-- 20260127's ALTERs to ab_tests and ab_test_variants are NOT reproduced here.
-- 20260801200000 already folded them into those tables' CREATE TABLE, and the
-- probe confirms ab_tests carries target_element_id, auto_complete,
-- min_sample_size and confidence_threshold today. Repeating them would be
-- harmless but would misrepresent what is missing.

-- ------------------------------------------------------------
-- ab_test_results
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ab_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID REFERENCES ab_tests(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES ab_test_variants(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('view', 'click', 'conversion')),
  value DECIMAL DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  geo_country TEXT,
  geo_region TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atr_test_id ON ab_test_results(test_id);
CREATE INDEX IF NOT EXISTS idx_atr_variant_id ON ab_test_results(variant_id);
CREATE INDEX IF NOT EXISTS idx_atr_visitor_event ON ab_test_results(visitor_id, test_id, event_type);
CREATE INDEX IF NOT EXISTS idx_atr_recorded_at ON ab_test_results(recorded_at);

-- ------------------------------------------------------------
-- visitor_buckets
-- ------------------------------------------------------------
-- UNIQUE(visitor_id, test_id) is the whole point of the table: a visitor must
-- see the same variant on every visit, and the bucket route upserts on it.
CREATE TABLE IF NOT EXISTS visitor_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  test_id UUID REFERENCES ab_tests(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES ab_test_variants(id) ON DELETE CASCADE,
  geo_country TEXT,
  geo_region TEXT,
  bucketed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(visitor_id, test_id)
);

CREATE INDEX IF NOT EXISTS idx_vb_site_visitor ON visitor_buckets(site_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_vb_test_id ON visitor_buckets(test_id);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- 20260127 shipped both tables with a single
--   CREATE POLICY … FOR ALL USING (true) WITH CHECK (true)
-- and no TO clause, which in PostgreSQL means PUBLIC — every role, `anon`
-- included. That is an open door with the published key, and
-- 20260611020000_tighten_permissive_policies.sql:27-105 replaced it with the
-- split below: read for site members, writes for service_role only. Since that
-- file also aborted, only the tightened form is created here.
--
-- The DROP of the permissive name is kept from 20260611020000 even though the
-- table is new: it costs nothing and it means a hand-replay of 20260127 after
-- this file cannot silently reopen the hole.
ALTER TABLE ab_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_buckets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage ab_test_results" ON ab_test_results;

DROP POLICY IF EXISTS "Site members can view ab_test_results" ON ab_test_results;
CREATE POLICY "Site members can view ab_test_results"
  ON ab_test_results
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ab_tests at_
      JOIN site_permissions sp ON sp.site_id = at_.site_id
      WHERE at_.id = ab_test_results.test_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can insert ab_test_results" ON ab_test_results;
CREATE POLICY "Service role can insert ab_test_results"
  ON ab_test_results
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update ab_test_results" ON ab_test_results;
CREATE POLICY "Service role can update ab_test_results"
  ON ab_test_results
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can delete ab_test_results" ON ab_test_results;
CREATE POLICY "Service role can delete ab_test_results"
  ON ab_test_results
  FOR DELETE
  TO service_role
  USING (true);

DROP POLICY IF EXISTS "Service role can manage visitor_buckets" ON visitor_buckets;

DROP POLICY IF EXISTS "Site members can view visitor_buckets" ON visitor_buckets;
CREATE POLICY "Site members can view visitor_buckets"
  ON visitor_buckets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = visitor_buckets.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can insert visitor_buckets" ON visitor_buckets;
CREATE POLICY "Service role can insert visitor_buckets"
  ON visitor_buckets
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update visitor_buckets" ON visitor_buckets;
CREATE POLICY "Service role can update visitor_buckets"
  ON visitor_buckets
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can delete visitor_buckets" ON visitor_buckets;
CREATE POLICY "Service role can delete visitor_buckets"
  ON visitor_buckets
  FOR DELETE
  TO service_role
  USING (true);

-- ============================================================
-- 4. COLLABORATION   (from 20260731001000_missing_tables_collaboration.sql)
-- ============================================================

-- ------------------------------------------------------------
-- team_activity_log
-- ------------------------------------------------------------
-- Distinct from team_activity, which 20260801200000 created and which nothing
-- reads. The only reader/writer is
-- src/app/api/teams/[teamId]/activity/route.ts:44, and it queries this shape
-- (action / resource_type / resource_id / details).
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

-- ------------------------------------------------------------
-- collaboration_notifications
-- ------------------------------------------------------------
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
-- routes, which run under the caller's anon-key session. Restrict that to users
-- who already have a relationship with the recipient rather than
-- WITH CHECK (true), which would be an open notification-spam vector.
--
-- THIS IS THE POLICY THAT KILLED 20260731001000. Its fourth EXISTS reads
-- site_permissions.team_id, and that column does not exist in production —
-- 20260731000000 was supposed to add it and rolled back first, so this
-- CREATE POLICY raises 42703 and takes the whole file with it. Section 1 of
-- this file adds the column before we get here; do not reorder them.
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

-- ------------------------------------------------------------
-- content_editing_sessions
-- ------------------------------------------------------------
-- NOTE: collaboration-schema.sql declared UNIQUE(content_element_id, user_id).
-- That contradicts src/lib/collaboration/permissions.ts:287-301, which ends the
-- previous session (sets ended_at) and then INSERTs a *new* row for the same
-- (element, user) pair — the unique constraint would reject the second row.
-- The code wins: the uniqueness is enforced only over *active* sessions.
CREATE TABLE IF NOT EXISTS content_editing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_element_id UUID NOT NULL REFERENCES content_elements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 20260731001000:189 writes this DEFAULT as encode(gen_random_bytes(16),'hex').
  -- gen_random_bytes() comes from pgcrypto, which on this project is installed
  -- into the `extensions` schema and is not on the search_path the CLI push uses.
  -- 20260801200000:290-296 records that exact form failing with
  --   ERROR: function gen_random_bytes(integer) does not exist (SQLSTATE 42883)
  -- and, because a migration is one transaction, taking the whole file with it.
  -- A DEFAULT expression is resolved at CREATE TABLE time, so this is not a
  -- latent runtime problem — it is an abort, and quite possibly the second
  -- reason 20260731001000 never landed.
  --
  -- gen_random_uuid() is core PostgreSQL since 13 and needs no extension. One of
  -- them with the hyphens stripped is the same 32 lowercase hex characters and
  -- the same 128 bits the original produced, so the column's shape and
  -- unguessability are unchanged and no extension is depended upon.
  session_token TEXT UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
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

-- ============================================================
-- 5. AUDIT & ANALYTICS
--    (from 20260731002000_missing_tables_audit_analytics.sql)
-- ============================================================

-- ------------------------------------------------------------
-- audit_logs   (src/lib/audit/logger.ts:47, :256)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  -- TEXT, not UUID: logger.ts writes endpoint paths here for api_* actions.
  resource_id TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- getLogs() orders by timestamp DESC and filters on user_id / resource_type /
-- resource_id / action.
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_timestamp ON audit_logs(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Reads go through the service-role AuditLogger; authenticated users may only
-- ever see rows about themselves.
DROP POLICY IF EXISTS "Users can view their own audit logs" ON audit_logs;
CREATE POLICY "Users can view their own audit logs"
  ON audit_logs
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage audit logs" ON audit_logs;
CREATE POLICY "Service role can manage audit logs"
  ON audit_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- compliance_reports
--   write: src/lib/audit/logger.ts:373 (service role)
--   read : src/app/api/audit/compliance/route.ts:144 (anon key + user session)
-- ------------------------------------------------------------
-- site_id is nullable: generateComplianceReport() passes an optional siteId
-- even though src/types/index.ts declares ComplianceReport.site_id required.
CREATE TABLE IF NOT EXISTS compliance_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('gdpr', 'soc2', 'hipaa', 'custom')),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  report_data JSONB NOT NULL,
  period_start TIMESTAMP WITH TIME ZONE,
  period_end TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'generated' CHECK (status IN ('generated', 'reviewed', 'approved', 'exported')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_reports_created_at ON compliance_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_site_id ON compliance_reports(site_id);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_generated_by ON compliance_reports(generated_by);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_type ON compliance_reports(report_type);

ALTER TABLE compliance_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view reports they generated" ON compliance_reports;
CREATE POLICY "Users can view reports they generated"
  ON compliance_reports
  FOR SELECT
  USING (generated_by = auth.uid());

DROP POLICY IF EXISTS "Site admins can view site compliance reports" ON compliance_reports;
CREATE POLICY "Site admins can view site compliance reports"
  ON compliance_reports
  FOR SELECT
  USING (
    site_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = compliance_reports.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission = 'admin'
    )
  );

DROP POLICY IF EXISTS "Service role can manage compliance reports" ON compliance_reports;
CREATE POLICY "Service role can manage compliance reports"
  ON compliance_reports
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- api_usage   (src/lib/analytics/tracker.ts:345)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  response_time INTEGER,   -- milliseconds
  request_size INTEGER,    -- bytes
  response_size INTEGER,   -- bytes
  ip_address INET,
  user_agent TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_key_timestamp ON api_usage(api_key_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_timestamp ON api_usage(timestamp DESC);

ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view usage for their own API keys" ON api_usage;
CREATE POLICY "Users can view usage for their own API keys"
  ON api_usage
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM api_keys ak
      WHERE ak.id = api_usage.api_key_id
        AND ak.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage api usage" ON api_usage;
CREATE POLICY "Service role can manage api usage"
  ON api_usage
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- conversion_events   (src/lib/analytics/tracker.ts:114)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('trial_start', 'subscription', 'upgrade', 'churn')
  ),
  value DECIMAL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversion_events_site_created
  ON conversion_events(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversion_events_user_id ON conversion_events(user_id);

ALTER TABLE conversion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view conversion events" ON conversion_events;
CREATE POLICY "Site members can view conversion events"
  ON conversion_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = conversion_events.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage conversion events" ON conversion_events;
CREATE POLICY "Service role can manage conversion events"
  ON conversion_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 6. INTEGRATIONS   (from 20260731004000_missing_tables_integrations.sql)
-- ============================================================

-- ------------------------------------------------------------
-- webhooks   (src/lib/webhooks/manager.ts, src/app/api/webhooks/route.ts)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,
  secret TEXT,
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMP WITH TIME ZONE,
  failure_count INTEGER DEFAULT 0,
  max_failures INTEGER DEFAULT 5,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_site_active
  ON webhooks(site_id, is_active);
-- manager.ts:146 uses .contains("events", [eventType]) → array containment.
CREATE INDEX IF NOT EXISTS idx_webhooks_events ON webhooks USING GIN (events);

DROP TRIGGER IF EXISTS update_webhooks_updated_at ON webhooks;
CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view webhooks" ON webhooks;
CREATE POLICY "Site members can view webhooks"
  ON webhooks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = webhooks.site_id
        AND sp.user_id = auth.uid()
    )
  );

-- Secrets live in this table, so mutations are service-role only; the API
-- routes go through WebhookManager, which uses the service-role client.
DROP POLICY IF EXISTS "Service role can manage webhooks" ON webhooks;
CREATE POLICY "Service role can manage webhooks"
  ON webhooks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- webhook_deliveries   (src/lib/webhooks/manager.ts:250, :354, :398, :461)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  response_time INTEGER,  -- milliseconds
  attempt_number INTEGER DEFAULT 1,
  success BOOLEAN DEFAULT false,
  error_message TEXT,
  delivered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_delivered
  ON webhook_deliveries(webhook_id, delivered_at DESC);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view webhook deliveries" ON webhook_deliveries;
CREATE POLICY "Site members can view webhook deliveries"
  ON webhook_deliveries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM webhooks w
      JOIN site_permissions sp ON sp.site_id = w.site_id
      WHERE w.id = webhook_deliveries.webhook_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage webhook deliveries" ON webhook_deliveries;
CREATE POLICY "Service role can manage webhook deliveries"
  ON webhook_deliveries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- bulk_operations   (src/app/api/bulk/{import,update,export}/route.ts)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bulk_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK (
    operation_type IN ('import', 'export', 'batch_update', 'sync')
  ),
  status TEXT DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  ),
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  configuration JSONB DEFAULT '{}',
  result_data JSONB DEFAULT '{}',
  error_log TEXT[],
  scheduled_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- bulk/export/route.ts:278 filters operation_type + site_id (+ optional
-- user_id) ordered by created_at DESC.
CREATE INDEX IF NOT EXISTS idx_bulk_operations_site_type_created
  ON bulk_operations(site_id, operation_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_operations_user_id ON bulk_operations(user_id);
CREATE INDEX IF NOT EXISTS idx_bulk_operations_status ON bulk_operations(status);

ALTER TABLE bulk_operations ENABLE ROW LEVEL SECURITY;

-- The bulk routes run under the caller's anon-key session and check
-- site_permissions in application code before writing, so the policies mirror
-- that: read for any site member, write for editors/admins of the same site.
DROP POLICY IF EXISTS "Site members can view bulk operations" ON bulk_operations;
CREATE POLICY "Site members can view bulk operations"
  ON bulk_operations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = bulk_operations.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Site editors can create bulk operations" ON bulk_operations;
CREATE POLICY "Site editors can create bulk operations"
  ON bulk_operations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = bulk_operations.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Owners can update their bulk operations" ON bulk_operations;
CREATE POLICY "Owners can update their bulk operations"
  ON bulk_operations
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage bulk operations" ON bulk_operations;
CREATE POLICY "Service role can manage bulk operations"
  ON bulk_operations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- blog_posts
--   read : src/app/blog/[slug]/page.tsx:25  (public, anon key)
--   write: src/app/api/blog/generate/route.ts:274
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT,
  category TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_slug_status ON blog_posts(slug, status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_published
  ON blog_posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON blog_posts(category);

DROP TRIGGER IF EXISTS update_blog_posts_updated_at ON blog_posts;
CREATE TRIGGER update_blog_posts_updated_at BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- supabase/schema.sql shipped blog_posts with no RLS at all ("public (no RLS
-- needed for now)"). Without RLS, Supabase's default grants let anyone holding
-- the public anon key INSERT/UPDATE/DELETE blog posts, so RLS is enabled here:
-- published posts stay world-readable, drafts do not.
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Published blog posts are public" ON blog_posts;
CREATE POLICY "Published blog posts are public"
  ON blog_posts
  FOR SELECT
  USING (status = 'published');

-- Interactive-admin path of src/app/api/blog/generate/route.ts (it authorises on
-- app_metadata.role === 'admin' and then writes with the anon-key client).
--
-- ACTION REQUIRED, carried over verbatim from 20260731004000:225-229 because it
-- is still true: the *cron* path of that route authorises on CRON_SECRET and
-- therefore has no session — it runs as `anon` and will be rejected here.
-- src/app/api/blog/generate/route.ts:270 must switch to the service-role client
-- (createServiceRoleClient from @/lib/supabase/service) for scheduled runs.
DROP POLICY IF EXISTS "Admins can write blog posts" ON blog_posts;
CREATE POLICY "Admins can write blog posts"
  ON blog_posts
  FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Service role can manage blog posts" ON blog_posts;
CREATE POLICY "Service role can manage blog posts"
  ON blog_posts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 7. EDITOR ACCESS   (from 20260801100000_editor_access_2fa.sql)
-- ============================================================
-- The product's wedge, and the row of the register that matters most: nine
-- source files on `main` query site_editors — api/editor/editors,
-- api/editor/validate-grant, SiteEditorsCard, five modules under lib/auth/
-- (editor-directory, editor-grants, editor-handoff, editor-hub-session,
-- staging-access) and feature-gating/permissions. The table has never existed,
-- so every one of those paths fails at runtime.
--
-- The model, unchanged from 20260801100000's header:
--   DURABLE    site_editors               bob@example.com may edit example.com.
--   EPHEMERAL  editor_verification_codes -> editor_device_grants
--   TRANSFER   editor_handoffs            hub session -> first-party grant.
--
-- Secrets are stored hashed, never raw — same discipline as api_keys.key_hash.

-- ------------------------------------------------------------
-- site_editors — the durable allowlist
-- ------------------------------------------------------------
-- Keyed by email rather than auth.users.id on purpose: an editor is usually a
-- client's marketing contact who has no ReCopyFast account and never will. The
-- email IS the identity, and the emailed code is how we prove it.
CREATE TABLE IF NOT EXISTS site_editors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  -- Same vocabulary as staging_access.permissions and site_permissions so the
  -- existing normalisation in src/lib/auth/editor-access.ts keeps working.
  permissions TEXT[] NOT NULL DEFAULT ARRAY['edit']::TEXT[],
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE
);

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS; a duplicate_object trap is the
-- idempotent equivalent (same shape as 20260731010000_deferred_billing_constraints).
DO $$
BEGIN
  ALTER TABLE site_editors
    ADD CONSTRAINT site_editors_permissions_valid
      CHECK (
        permissions <@ ARRAY['view', 'edit', 'publish', 'admin']::TEXT[]
        AND array_length(permissions, 1) >= 1
      );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE site_editors
    ADD CONSTRAINT site_editors_email_lowercase
      CHECK (email = lower(email) AND position('@' IN email) > 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END
$$;

-- One row per (site, person). Re-inviting a revoked editor clears revoked_at on
-- the existing row rather than inserting a second one, so "is bob an editor of
-- this site?" is always a single unambiguous lookup. lower() in the index (not
-- just the CHECK) keeps that true even if a future writer bypasses the app.
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_editors_site_email_unique
  ON site_editors(site_id, lower(email));

-- The hub's cold-start query: "which sites may this email edit?"
CREATE INDEX IF NOT EXISTS idx_site_editors_email_active
  ON site_editors(lower(email))
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_site_editors_site_active
  ON site_editors(site_id)
  WHERE revoked_at IS NULL;

ALTER TABLE site_editors ENABLE ROW LEVEL SECURITY;

-- Only site admins manage the allowlist. Editors themselves never hold a
-- Supabase session, so they read nothing here directly — every editor-facing
-- read goes through the service-role API, which authenticates them by grant.
--
-- These four policies are why 20260801100000 aborted: they call
-- public.user_has_site_permission(), which 20260731008000 was supposed to create
-- and never did. Section 2 of this file creates it first.
DROP POLICY IF EXISTS "Site admins can view site editors" ON site_editors;
CREATE POLICY "Site admins can view site editors"
  ON site_editors
  FOR SELECT
  TO authenticated
  USING (public.user_has_site_permission(site_id, ARRAY['admin']));

DROP POLICY IF EXISTS "Site admins can invite site editors" ON site_editors;
CREATE POLICY "Site admins can invite site editors"
  ON site_editors
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_site_permission(site_id, ARRAY['admin']));

DROP POLICY IF EXISTS "Site admins can update site editors" ON site_editors;
CREATE POLICY "Site admins can update site editors"
  ON site_editors
  FOR UPDATE
  TO authenticated
  USING (public.user_has_site_permission(site_id, ARRAY['admin']))
  WITH CHECK (public.user_has_site_permission(site_id, ARRAY['admin']));

DROP POLICY IF EXISTS "Service role can manage site editors" ON site_editors;
CREATE POLICY "Service role can manage site editors"
  ON site_editors
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- editor_verification_codes — the ephemeral second factor
-- ------------------------------------------------------------
-- Deliberately NOT a column on site_editors. A code is an event, not a property
-- of the person: several may be in flight, each is consumed exactly once, and
-- none of them may leave a lasting mark. That is precisely the mistake
-- staging_access.email_verified made.
--
-- site_id NULL  = hub-scoped code (recopyfast.com/edit — Bob has not yet chosen
--                 a site, and telling him which sites exist before he proves the
--                 address would be an enumeration oracle).
-- site_id SET   = unlock-in-place code, issued from the widget on one site.
CREATE TABLE IF NOT EXISTS editor_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  -- HMAC of the code, never the code. A 6-digit code has only 10^6 preimages,
  -- so a plain digest would be trivially reversible from a database dump; the
  -- server-side key is what makes the stored value useless on its own.
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE editor_verification_codes
    ADD CONSTRAINT editor_verification_codes_email_lowercase
      CHECK (email = lower(email));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END
$$;

-- Lookup is always "the newest live code for this email in this scope".
CREATE INDEX IF NOT EXISTS idx_editor_verification_codes_lookup
  ON editor_verification_codes(email, site_id, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_editor_verification_codes_expires
  ON editor_verification_codes(expires_at);

ALTER TABLE editor_verification_codes ENABLE ROW LEVEL SECURITY;

-- No policy for authenticated/anon at all: these rows are live secrets and
-- nothing outside the service-role API has any business reading them. RLS with
-- a service-role-only policy denies everyone else by default.
DROP POLICY IF EXISTS "Service role can manage editor verification codes" ON editor_verification_codes;
CREATE POLICY "Service role can manage editor verification codes"
  ON editor_verification_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- editor_device_grants — remembered proof, one row per browser
-- ------------------------------------------------------------
-- Must come after site_editors: site_editor_id references it.
CREATE TABLE IF NOT EXISTS editor_device_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_editor_id UUID NOT NULL REFERENCES site_editors(id) ON DELETE CASCADE,
  -- SHA-256 of the full signed grant string. Mirrors api_keys.key_hash: the
  -- server can recognise a grant it issued but cannot reconstruct one.
  grant_hash TEXT NOT NULL UNIQUE,
  user_agent_hash TEXT,
  -- Truncated (/24 v4, /48 v6) and kept for audit only. NOT enforced: mobile
  -- clients change IP constantly and hard-binding would lock out honest editors
  -- far more often than it would stop a thief who already has the token.
  ip_prefix TEXT,
  -- The customer origin the grant was minted for. Enforced on every validate,
  -- so a grant copied out of localStorage on helloworld.com is inert anywhere
  -- else — including on recopyfast.com itself.
  origin_hash TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  -- 'rotated' | 'replay' | 'editor_revoked' | 'manual'. Distinguishing these
  -- matters: presenting a 'rotated' grant after its grace window is the signal
  -- that a token leaked, and triggers lineage-wide revocation.
  revoked_reason TEXT,
  rotated_from UUID REFERENCES editor_device_grants(id) ON DELETE SET NULL,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE editor_device_grants
    ADD CONSTRAINT editor_device_grants_revoked_reason_valid
      CHECK (
        revoked_reason IS NULL
        OR revoked_reason IN ('rotated', 'replay', 'editor_revoked', 'manual')
      );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END
$$;

-- Revocation sweeps ("kill every live grant for this editor") and the dashboard's
-- device list both filter on the parent plus liveness.
CREATE INDEX IF NOT EXISTS idx_editor_device_grants_editor_active
  ON editor_device_grants(site_editor_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_editor_device_grants_expires
  ON editor_device_grants(expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE editor_device_grants ENABLE ROW LEVEL SECURITY;

-- Admins may see and revoke the devices attached to their own site's editors.
-- grant_hash is never selected by the dashboard; it is not a secret in the
-- reversible sense but there is no reason to move it around either.
DROP POLICY IF EXISTS "Site admins can view editor device grants" ON editor_device_grants;
CREATE POLICY "Site admins can view editor device grants"
  ON editor_device_grants
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_editors se
      WHERE se.id = editor_device_grants.site_editor_id
        AND public.user_has_site_permission(se.site_id, ARRAY['admin'])
    )
  );

DROP POLICY IF EXISTS "Site admins can revoke editor device grants" ON editor_device_grants;
CREATE POLICY "Site admins can revoke editor device grants"
  ON editor_device_grants
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_editors se
      WHERE se.id = editor_device_grants.site_editor_id
        AND public.user_has_site_permission(se.site_id, ARRAY['admin'])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_editors se
      WHERE se.id = editor_device_grants.site_editor_id
        AND public.user_has_site_permission(se.site_id, ARRAY['admin'])
    )
  );

DROP POLICY IF EXISTS "Service role can manage editor device grants" ON editor_device_grants;
CREATE POLICY "Service role can manage editor device grants"
  ON editor_device_grants
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- editor_handoffs — hub -> customer site, single use, 60 seconds
-- ------------------------------------------------------------
-- The hub authenticates Bob on recopyfast.com, but the grant has to end up in
-- localStorage on helloworld.com, and third-party cookies cannot carry it there.
-- So the hub redirects with a one-shot code in the URL which the widget
-- immediately exchanges for a real grant. The code is worthless after that
-- exchange and after 60 seconds, which is what makes it safe to put in a URL
-- that lands in browser history and Referer headers.
CREATE TABLE IF NOT EXISTS editor_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_editor_id UUID NOT NULL REFERENCES site_editors(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  remember_device BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_editor_handoffs_expires
  ON editor_handoffs(expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE editor_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage editor handoffs" ON editor_handoffs;
CREATE POLICY "Service role can manage editor handoffs"
  ON editor_handoffs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- upsert_site_editor — invite, or restore a revoked editor
-- ------------------------------------------------------------
-- Called by live code: src/lib/auth/editor-directory.ts:146 issues
-- .rpc("upsert_site_editor", …). Probed absent, like everything else in
-- 20260801100000.
--
-- The uniqueness that matters is over (site_id, lower(email)), which is an
-- expression index. PostgREST's `onConflict` can only name plain columns, so the
-- conflict target is spelled out here instead of adding a second, redundant
-- unique index purely to satisfy the client library.
--
-- SECURITY INVOKER: called from the dashboard under the owner's own session, so
-- the site_editors RLS policies decide whether the caller may do this. The
-- service-role client bypasses RLS as usual.
CREATE OR REPLACE FUNCTION public.upsert_site_editor(
  p_site_id     UUID,
  p_email       TEXT,
  p_permissions TEXT[],
  p_invited_by  UUID
)
RETURNS site_editors
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  result site_editors;
BEGIN
  INSERT INTO site_editors (site_id, email, permissions, invited_by)
  VALUES (p_site_id, lower(trim(p_email)), p_permissions, p_invited_by)
  ON CONFLICT (site_id, (lower(email))) DO UPDATE
    SET permissions = EXCLUDED.permissions,
        invited_by  = EXCLUDED.invited_by,
        -- Restoring a revoked editor returns their standing permission, not
        -- their proof of identity: device grants stay revoked, so they verify
        -- again on next use.
        revoked_at  = NULL
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_site_editor(UUID, TEXT, TEXT[], UUID)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- purge_expired_editor_artifacts — housekeeping
-- ------------------------------------------------------------
-- REQUIRED BY 20260809120000_lock_down_definer_functions:131, which has never
-- been applied because its dry run fails with
--   function public.purge_expired_editor_artifacts() does not exist
-- REVOKE has no IF EXISTS, so that security migration cannot land until this
-- function is present. Verbatim from 20260801100000:486-518.
--
-- Consumed and expired ephemera have no audit value and would otherwise grow
-- without bound. Safe to call from a cron; returns rows removed.
CREATE OR REPLACE FUNCTION public.purge_expired_editor_artifacts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  removed INTEGER := 0;
  batch   INTEGER := 0;
BEGIN
  DELETE FROM editor_verification_codes
   WHERE expires_at < NOW() - INTERVAL '1 day';
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;

  DELETE FROM editor_handoffs
   WHERE expires_at < NOW() - INTERVAL '1 day';
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;

  -- Grants are kept 30 days past expiry: they are the audit trail for "which
  -- device edited this page", which outlives the grant's usefulness as a credential.
  DELETE FROM editor_device_grants
   WHERE expires_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS batch = ROW_COUNT;
  removed := removed + batch;

  RETURN removed;
END;
$$;

-- Verbatim from 20260801100000:517-518. This closes PUBLIC but NOT the `anon`
-- and `authenticated` grants that Supabase's default privileges attach at
-- creation — 20260809120000:131-134 is what removes those, and it is the next
-- migration to apply after this one. Stated rather than silently relied upon.
REVOKE ALL ON FUNCTION public.purge_expired_editor_artifacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_editor_artifacts() TO service_role;

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
-- Editors are not Supabase users, so `authenticated` here means the site owner
-- in the dashboard. RLS above narrows it to their own sites.
GRANT SELECT, INSERT, UPDATE ON site_editors TO authenticated;
GRANT SELECT, UPDATE ON editor_device_grants TO authenticated;

-- ------------------------------------------------------------
-- Migrate staging_access into site_editors
-- ------------------------------------------------------------
-- From 20260801100000:339-380, minus the two statements that WRITE to
-- staging_access — see "WHAT THIS FILE DELIBERATELY DOES NOT FIX" in the header.
-- What is kept is the half that populates one of the seventeen tables; what is
-- dropped is the half that changes an existing table's rows and behaviour.
--
-- Every staging_access row that names a real person becomes a durable editor,
-- which is what makes the cutover invisible to existing invitees: the tokens
-- they were sent stop being the credential, but their authorisation survives.
--
-- Rows WITHOUT an email cannot be migrated — there is no person to authorise.
--
-- Measured 2026-08-17: staging_access holds 3 rows, all with an email, all past
-- expires_at, so `sa.expires_at > NOW()` matches none of them and this block
-- migrates 0 rows today. It is kept because it is the repaired migration's own
-- intent, it is idempotent (ON CONFLICT DO NOTHING), and it is correct for any
-- environment where those rows are still live.
DO $$
DECLARE
  migrated INTEGER := 0;
BEGIN
  IF to_regclass('public.staging_access') IS NULL THEN
    RAISE NOTICE 'staging_access absent — nothing to migrate.';
    RETURN;
  END IF;

  INSERT INTO site_editors (site_id, email, permissions, invited_by, created_at)
  SELECT DISTINCT ON (sa.site_id, lower(sa.email))
         sa.site_id,
         lower(sa.email),
         COALESCE(sa.permissions, ARRAY['edit']::TEXT[]),
         sa.created_by,
         sa.created_at
  FROM staging_access sa
  WHERE sa.email IS NOT NULL
    AND position('@' IN sa.email) > 1
    AND sa.is_active
    AND sa.expires_at > NOW()
  ORDER BY sa.site_id, lower(sa.email), sa.created_at DESC
  ON CONFLICT (site_id, lower(email)) DO NOTHING;

  GET DIAGNOSTICS migrated = ROW_COUNT;

  RAISE NOTICE 'site_editors: % migrated from staging_access.', migrated;
END
$$;

-- ------------------------------------------------------------
-- Comments
-- ------------------------------------------------------------
COMMENT ON TABLE site_editors IS
  'Durable per-site editor allowlist keyed by email. Revoking a row here immediately invalidates every device grant beneath it.';
COMMENT ON TABLE editor_verification_codes IS
  'Single-use 6-digit second factor. Stored as an HMAC; a code is an event, never a lasting property of the editor.';
COMMENT ON TABLE editor_device_grants IS
  'Remembered proof-of-identity for one browser. Only the hash of the signed grant is stored; validation re-checks the parent site_editors row every time.';
COMMENT ON TABLE editor_handoffs IS
  'Single-use 60-second bearer code carrying an authenticated hub session onto the customer domain, where the widget exchanges it for a first-party grant.';
COMMENT ON COLUMN editor_device_grants.ip_prefix IS
  'Truncated client IP, recorded for audit. Deliberately not enforced — roaming mobile clients would be locked out constantly.';
COMMENT ON COLUMN editor_device_grants.origin_hash IS
  'SHA-256 of the customer origin the grant was minted for. Enforced on validate, so a copied grant is inert on any other origin.';

-- ============================================================
-- 8. Postcondition
-- ============================================================
-- Non-negotiable 6 of AGENTS.md: every tenant-scoped table gets an RLS policy in
-- the same migration that creates it. A table with RLS on and zero policies is a
-- total lockout; a table with RLS off is readable and writable by any holder of
-- the published anon key. As measured on 2026-08-17, all 40 existing tables have
-- RLS on with at least one policy — this file must not be the one that breaks
-- that invariant, so it asserts it about its own seventeen rather than trusting
-- the reader to check.
--
-- This runs inside the same transaction as everything above, so a failure here
-- rolls the whole repair back and nothing is half-applied.
DO $$
DECLARE
  v_bad   TEXT[] := ARRAY[]::TEXT[];
  v_table TEXT;
  v_rls   BOOLEAN;
  v_count INTEGER;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'ab_test_results', 'visitor_buckets',
    'team_activity_log', 'collaboration_notifications', 'content_editing_sessions',
    'audit_logs', 'compliance_reports', 'api_usage', 'conversion_events',
    'webhooks', 'webhook_deliveries', 'bulk_operations', 'blog_posts',
    'site_editors', 'editor_verification_codes', 'editor_device_grants',
    'editor_handoffs'
  ] LOOP
    SELECT c.relrowsecurity INTO v_rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_table;

    SELECT count(*) INTO v_count
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = v_table;

    IF v_rls IS DISTINCT FROM true OR v_count = 0 THEN
      v_bad := array_append(
        v_bad,
        format('%s (rls=%s, policies=%s)', v_table, COALESCE(v_rls::text, 'MISSING'), v_count)
      );
    END IF;
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION
      'Repair aborted: table(s) left without RLS and at least one policy: %',
      array_to_string(v_bad, ', ');
  END IF;

  RAISE NOTICE 'Repair complete: 17 tables created, all with RLS enabled and at least one policy.';
END
$$;
