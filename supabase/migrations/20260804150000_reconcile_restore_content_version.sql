-- ========================================
-- The rollback function the schema declares is not the one that exists
-- ========================================
-- `POST /api/edit-board/history/[versionId]` called
-- `restore_content_version(p_site_id, p_version_id, p_restored_by)` and got
-- PGRST202 every single time:
--
--   Could not find the function public.restore_content_version(
--     p_restored_by, p_site_id, p_version_id) in the schema cache
--   Perhaps you meant public.restore_content_version(p_restored_by, p_version_id)
--
-- PostgREST resolves RPC by NAMED arguments, so one extra argument is not a
-- loose fit — it is a miss. Rollback returned 500 for every caller, always.
--
-- Nobody noticed because the route was reachable only with a staging invite
-- token: the signed-in owner was refused before ever getting far enough to hit
-- the broken call, and the previous QA register listed version history and
-- rollback as simply "untested". Giving the owner a first-party path is what
-- made the defect visible.
--
-- WHY THE CODE MOVED TO THE DATABASE'S SIGNATURE AND NOT THE REVERSE
-- ------------------------------------------------------------------
-- The live function is the better design and is already correct. It takes
-- (p_version_id, p_restored_by), reads `site_id` out of the version row itself,
-- takes a "Pre-restore snapshot" before overwriting anything, and writes to
-- `staging_content` so a restore still has to be published. A caller-supplied
-- p_site_id would add nothing it cannot derive, and would introduce a way for
-- the two to disagree.
--
-- WHY THIS MIGRATION EXISTS AT ALL
-- --------------------------------
-- Migration 20251230100000_edit_board.sql declares the three-argument form. No
-- database has it — production has the two-argument one — so the repository and
-- production described different schemas. That is precisely the split F-1
-- recorded for `billing_customers`, where a fresh database would have allowed
-- what production refused. A developer running the migrations from scratch
-- would have got a three-argument function and a route that calls two, and the
-- bug would have flipped direction rather than disappeared.
--
-- This states the live (correct) shape explicitly, so both converge. The DROP
-- is deliberate: leaving both would make the name ambiguous, and PostgREST
-- refuses to choose between overloads.
-- ========================================

DROP FUNCTION IF EXISTS restore_content_version(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION restore_content_version(
  p_version_id UUID,
  p_restored_by TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_site_id UUID;
  v_snapshot JSONB;
  v_element_id TEXT;
  v_element_data JSONB;
  v_new_version_id UUID;
BEGIN
  SELECT site_id, snapshot INTO v_site_id, v_snapshot
  FROM content_versions WHERE id = p_version_id;

  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'Version not found';
  END IF;

  -- Snapshot the current state first, so a restore is itself undoable.
  SELECT create_content_version(
    v_site_id, p_restored_by, 'Pre-restore snapshot', 'restore'
  ) INTO v_new_version_id;

  -- Restores land in STAGING, never straight onto the live page: rolling back
  -- is an edit like any other and still has to be published deliberately.
  FOR v_element_id, v_element_data IN SELECT * FROM jsonb_each(v_snapshot)
  LOOP
    UPDATE content_elements
    SET staging_content = v_element_data->>'content',
        staging_updated_at = NOW(),
        updated_at = NOW()
    WHERE site_id = v_site_id AND element_id = v_element_id;
  END LOOP;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION restore_content_version(UUID, TEXT) TO authenticated;
