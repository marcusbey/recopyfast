-- ========================================
-- Collaboration Schema Alignment: site_permissions
-- ========================================
-- The canonical migration (20250817000000_complete_database_setup.sql) created
-- site_permissions as (user_id, site_id, permission).  The collaboration feature
-- — which owns team_activity_log / collaboration_notifications /
-- content_editing_sessions, created in the next migration — writes and reads
-- three more columns that only ever existed in the loose
-- supabase/collaboration-schema.sql file:
--
--   • team_id     — src/app/api/sites/[siteId]/share/route.ts:146
--   • role        — src/app/api/sites/[siteId]/share/route.ts:147
--   • granted_by  — src/app/api/sites/[siteId]/share/route.ts:148
--
-- PostgREST embed hints also require the FK to be named exactly
-- site_permissions_team_id_fkey:
--   • src/app/api/sites/[siteId]/share/route.ts:258
--   • src/lib/collaboration/permissions.ts:109
--
-- All additions are additive and nullable so existing rows and the `permission`
-- based code paths (bulk/*, staging/*, ab-tests/*, api-keys/*, …) keep working.
--
-- NOTE FOR FOLLOW-UP: `permission` ('view'|'edit'|'admin') and `role`
-- ('viewer'|'editor'|'manager'|'owner') are parallel representations of the same
-- grant.  Both are populated below, but application code should converge on one.
-- ========================================

-- Both spellings of the grant column, so this migration is a no-op against a
-- database built from either the canonical migration or the loose schema file.
ALTER TABLE site_permissions ADD COLUMN IF NOT EXISTS permission TEXT;
ALTER TABLE site_permissions ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE site_permissions ADD COLUMN IF NOT EXISTS team_id UUID;
ALTER TABLE site_permissions ADD COLUMN IF NOT EXISTS granted_by UUID;

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS — guard with a DO block.
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

-- One grant per (site, team).  Partial so the existing UNIQUE(user_id, site_id)
-- constraint on user grants is untouched.
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_permissions_site_team_unique
  ON site_permissions(site_id, team_id)
  WHERE team_id IS NOT NULL;

-- Keep the two representations consistent for existing rows.
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
