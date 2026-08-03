-- Restore the transactional publish function, which production never had.
--
-- `POST /api/staging/publish` answers 500 in production:
--
--   PGRST202: Could not find the function
--   public.publish_staging_content_atomic(p_element_ids, p_published_by,
--   p_site_id, p_user_email) in the schema cache
--   hint: Perhaps you meant to call public.publish_staging_content
--
-- Publishing is the second half of the product's central promise — edit the
-- copy, visitors see it — and it has been failing outright. The core E2E found
-- it on its first real run, after getting past two earlier defects: staging
-- validate, verify, content read and content write all answer 200, and then
-- publish 500s.
--
-- This is the same lost migration as 20260803010000. 20260617000000 defined
-- exactly two things, the edit_sessions constraint and this function, and
-- neither is present in production even though the migration is recorded as
-- applied. So the failure is not "a constraint got reverted"; an entire
-- migration's effects are missing while the ledger claims otherwise. Anything
-- else that migration would have done is already accounted for — those two
-- statements are its whole content — but the same question is worth asking of
-- every migration recorded between it and 20260801200000.
--
-- Production currently holds only the older, differently-shaped
-- `publish_staging_content(p_site_id uuid, p_element_ids uuid[], p_user_id
-- uuid)`. That one is left alone: it takes uuid[] element ids where this takes
-- text[], so it is a different function rather than an older version of this
-- one, and dropping it is a separate decision from making publish work.
--
-- The body below is copied verbatim from 20260617000000 rather than rewritten,
-- so that the two definitions cannot drift. `CREATE OR REPLACE` makes it safe
-- to run against a database that somehow already has it.

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
