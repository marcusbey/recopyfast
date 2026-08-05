-- ========================================
-- The snapshot the repository builds cannot be restored by the repository
-- ========================================
-- Companion to 20260804150000_reconcile_restore_content_version.sql, and the
-- same defect in the other direction: that migration reconciled the RESTORE
-- half to production, and left the half that WRITES the snapshot untouched.
--
-- Production's `create_content_version` keys the snapshot by `element_id`:
--
--   SELECT jsonb_object_agg(element_id, jsonb_build_object(...))
--
-- which is exactly what the reconciled restore matches on
-- (`WHERE site_id = v_site_id AND element_id = v_element_id`), and why rollback
-- demonstrably works against the live database — `qa:journey` 5e.3 edits the
-- draft after the snapshot and asserts the draft comes back.
--
-- Migration 20251230100000_edit_board.sql declares a different function under
-- the same name. It keys the snapshot by the ROW ID:
--
--   SELECT jsonb_object_agg(id::text, jsonb_build_object(
--     'content', ..., 'elementType', element_type, 'selector', selector))
--
-- Against a database provisioned from this repository, every key in the
-- snapshot is therefore a UUID while the restore looks for an `element_id` like
-- `qa-headline`. The UPDATE matches zero rows for every entry, the function
-- still `RETURN TRUE`, and the route returns 200 — a customer is told their
-- rollback succeeded and nothing changed. That is precisely the finding Devin
-- raised on the restore migration: right about this repository, and not about
-- production, because the two describe different databases.
--
-- It is worse than a silent no-op, in fact. `element_type` is not a column of
-- `content_elements` — not in production, and not created by any migration
-- here. plpgsql resolves column references at execution, so on a fresh database
-- the first call raises `column "element_type" does not exist` and version
-- history never records anything at all.
--
-- This states production's (working) definition explicitly, so a database
-- created from these migrations writes snapshots the restore can read. Same
-- rule as F-1 and the restore reconciliation: where the repository and the live
-- schema disagree, the disagreement is the bug.
-- ========================================

CREATE OR REPLACE FUNCTION create_content_version(
  p_site_id UUID,
  p_created_by TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_change_type TEXT DEFAULT 'manual'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_version_id UUID;
  v_version_number INT;
  v_snapshot JSONB;
  v_elements_count INT;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version_number
  FROM content_versions WHERE site_id = p_site_id;

  -- Keyed by element_id, the identifier the widget assigns and the restore
  -- matches on. `original_content` closes the COALESCE so an element that has
  -- only ever been discovered still snapshots as its authored copy rather than
  -- as NULL.
  SELECT jsonb_object_agg(
    element_id,
    jsonb_build_object(
      'content', COALESCE(staging_content, published_content, current_content, original_content),
      'elementType', metadata->>'type',
      'selector', selector
    )
  ) INTO v_snapshot
  FROM content_elements
  WHERE site_id = p_site_id;

  SELECT COUNT(*) INTO v_elements_count
  FROM content_elements WHERE site_id = p_site_id;

  INSERT INTO content_versions (
    site_id, version_number, snapshot, created_by,
    description, elements_changed, change_type
  ) VALUES (
    p_site_id, v_version_number, COALESCE(v_snapshot, '{}'::jsonb), p_created_by,
    p_description, v_elements_count, p_change_type
  )
  RETURNING id INTO v_version_id;

  RETURN v_version_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_content_version(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION create_content_version(UUID, TEXT, TEXT, TEXT) TO service_role;
