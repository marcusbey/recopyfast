-- Restore the established site-wide Publish contract.
--
-- Story s27 added p_page_path to keep preview and publish scoped together, but
-- restore_content_version stages the whole site. A caller publishing from one
-- page could therefore leave the rest of a restored version silently staged.
-- Keep the five-argument signature for deployed callers, while deliberately
-- ignoring p_page_path so every Publish promotes every matching site draft.

CREATE OR REPLACE FUNCTION public.publish_staging_content_with_attributes_atomic(
  p_site_id UUID,
  p_element_ids TEXT[] DEFAULT NULL,
  p_published_by UUID DEFAULT NULL,
  p_user_email TEXT DEFAULT 'unknown',
  p_page_path TEXT DEFAULT NULL
)
RETURNS TABLE(element_id TEXT, content TEXT, attributes JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_published_at TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
  RETURN QUERY
  WITH prepared AS (
    SELECT
      ce.id,
      ce.element_id,
      ce.published_content,
      ce.staging_content,
      COALESCE(ce.metadata, '{}'::jsonb) AS previous_metadata,
      COALESCE((
        SELECT jsonb_object_agg(attribute.key, attribute.value)
        FROM jsonb_each(CASE
          WHEN jsonb_typeof(ce.metadata->'staging_attributes') = 'object'
            THEN ce.metadata->'staging_attributes'
          ELSE '{}'::jsonb
        END) AS attribute
        WHERE (COALESCE(ce.metadata, '{}'::jsonb) - 'staging_attributes')->attribute.key
          IS DISTINCT FROM attribute.value
      ), '{}'::jsonb) AS changed_attributes
    FROM public.content_elements ce
    WHERE ce.site_id = p_site_id
      AND (p_element_ids IS NULL OR ce.element_id = ANY(p_element_ids))
    FOR UPDATE
  ),
  changed AS (
    SELECT
      prepared.*,
      (prepared.previous_metadata - 'staging_attributes') ||
        prepared.changed_attributes AS published_metadata
    FROM prepared
    WHERE (
      prepared.staging_content IS NOT NULL
      AND prepared.staging_content IS DISTINCT FROM prepared.published_content
    ) OR prepared.changed_attributes <> '{}'::jsonb
  ),
  history AS (
    INSERT INTO public.staging_history (
      content_element_id,
      previous_content,
      new_content,
      previous_metadata,
      new_metadata,
      user_email,
      action
    )
    SELECT
      changed.id,
      changed.published_content,
      COALESCE(changed.staging_content, changed.published_content),
      changed.previous_metadata - 'staging_attributes',
      changed.published_metadata,
      COALESCE(p_user_email, 'unknown'),
      'publish'
    FROM changed
    RETURNING content_element_id
  ),
  updated AS (
    UPDATE public.content_elements ce
    SET
      published_content = COALESCE(changed.staging_content, changed.published_content),
      current_content = COALESCE(changed.staging_content, changed.published_content),
      metadata = changed.published_metadata,
      staging_content = NULL,
      staging_updated_at = NULL,
      published_at = v_published_at,
      published_by = p_published_by,
      updated_at = v_published_at
    FROM changed
    WHERE ce.id = changed.id
      AND EXISTS (
        SELECT 1 FROM history WHERE history.content_element_id = changed.id
      )
    RETURNING
      ce.element_id,
      ce.published_content,
      changed.changed_attributes AS attributes
  )
  SELECT updated.element_id, updated.published_content, updated.attributes
  FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_staging_content_with_attributes_atomic(
  UUID, TEXT[], UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_staging_content_with_attributes_atomic(
  UUID, TEXT[], UUID, TEXT, TEXT
) TO service_role;
