-- Transactional staging publish path used by /api/staging/publish and Socket.io.

ALTER TABLE edit_sessions
DROP CONSTRAINT IF EXISTS edit_sessions_permissions_check;

ALTER TABLE edit_sessions
ADD CONSTRAINT edit_sessions_permissions_check
CHECK (permissions <@ ARRAY['view', 'edit', 'publish', 'admin']::TEXT[]);

CREATE OR REPLACE FUNCTION publish_staging_content_atomic(
  p_site_id UUID,
  p_element_ids TEXT[] DEFAULT NULL,
  p_published_by UUID DEFAULT NULL,
  p_user_email TEXT DEFAULT 'unknown'
)
RETURNS TABLE(element_id TEXT, content TEXT) AS $$
DECLARE
  v_published_at TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
  RETURN QUERY
  WITH changed AS (
    SELECT
      ce.id,
      ce.element_id,
      ce.published_content,
      ce.staging_content
    FROM content_elements ce
    WHERE ce.site_id = p_site_id
      AND ce.staging_content IS NOT NULL
      AND ce.staging_content IS DISTINCT FROM ce.published_content
      AND (
        p_element_ids IS NULL
        OR ce.element_id = ANY(p_element_ids)
      )
    FOR UPDATE
  ),
  history AS (
    INSERT INTO staging_history (
      content_element_id,
      previous_content,
      new_content,
      user_email,
      action
    )
    SELECT
      changed.id,
      changed.published_content,
      changed.staging_content,
      COALESCE(p_user_email, 'unknown'),
      'publish'
    FROM changed
    RETURNING content_element_id
  ),
  updated AS (
    UPDATE content_elements ce
    SET
      published_content = changed.staging_content,
      current_content = changed.staging_content,
      staging_content = NULL,
      staging_updated_at = NULL,
      published_at = v_published_at,
      published_by = p_published_by,
      updated_at = v_published_at
    FROM changed
    WHERE ce.id = changed.id
      AND EXISTS (
        SELECT 1
        FROM history
        WHERE history.content_element_id = changed.id
      )
    RETURNING ce.element_id, ce.published_content
  )
  SELECT updated.element_id, updated.published_content
  FROM updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION publish_staging_content_atomic(UUID, TEXT[], UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION publish_staging_content_atomic(UUID, TEXT[], UUID, TEXT) TO authenticated;
