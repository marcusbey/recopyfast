-- Page provenance and reviewer repairs for s27 launch content integrity.
--
-- Computed widget ids are page-local, while author-declared data-rcf-id values
-- are shared across pages. NULL retains the latter meaning and also keeps every
-- pre-migration row visible to scoped reads. The application paginates both
-- branches explicitly because PostgREST otherwise truncates at 1,000 rows.

ALTER TABLE public.content_elements
  ADD COLUMN IF NOT EXISTS page_path TEXT;

CREATE INDEX IF NOT EXISTS idx_content_elements_site_page_path
  ON public.content_elements (site_id, page_path);

-- Save the draft and its audit row in one transaction. The previous route did
-- these as two service-role round trips, so a history failure returned 500
-- after the customer's draft had already committed.
CREATE OR REPLACE FUNCTION public.save_staging_content_atomic(
  p_site_id UUID,
  p_element_id TEXT,
  p_language TEXT,
  p_variant TEXT,
  p_staging_content TEXT,
  p_attribute_patch JSONB DEFAULT '{}'::jsonb,
  p_staging_access_id UUID DEFAULT NULL,
  p_user_email TEXT DEFAULT 'unknown'
)
RETURNS TABLE(content_element_id UUID, updated_at TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
  RETURN QUERY
  WITH locked AS (
    SELECT
      ce.id,
      ce.staging_content,
      COALESCE(ce.metadata, '{}'::jsonb) AS previous_metadata,
      COALESCE(
        CASE
          WHEN jsonb_typeof(ce.metadata->'staging_attributes') = 'object'
            THEN ce.metadata->'staging_attributes'
        END,
        '{}'::jsonb
      ) || COALESCE(p_attribute_patch, '{}'::jsonb) AS proposed_attributes
    FROM public.content_elements ce
    WHERE ce.site_id = p_site_id
      AND ce.element_id = p_element_id
      AND ce.language = p_language
      AND ce.variant = p_variant
    FOR UPDATE
  ),
  prepared AS (
    SELECT
      locked.*,
      COALESCE((
        SELECT jsonb_object_agg(attribute.key, attribute.value)
        FROM jsonb_each(locked.proposed_attributes) AS attribute
        WHERE (locked.previous_metadata - 'staging_attributes')->attribute.key
          IS DISTINCT FROM attribute.value
      ), '{}'::jsonb) AS effective_attributes
    FROM locked
  ),
  updated AS (
    UPDATE public.content_elements ce
    SET
      staging_content = p_staging_content,
      metadata = CASE
        WHEN prepared.effective_attributes = '{}'::jsonb
          THEN prepared.previous_metadata - 'staging_attributes'
        ELSE jsonb_set(
          prepared.previous_metadata - 'staging_attributes',
          '{staging_attributes}',
          prepared.effective_attributes,
          true
        )
      END,
      staging_updated_at = v_now,
      updated_at = v_now
    FROM prepared
    WHERE ce.id = prepared.id
    RETURNING
      ce.id,
      prepared.staging_content AS previous_content,
      prepared.previous_metadata,
      ce.metadata AS new_metadata
  ),
  history AS (
    INSERT INTO public.staging_history (
      content_element_id,
      staging_access_id,
      previous_content,
      new_content,
      previous_metadata,
      new_metadata,
      user_email,
      action
    )
    SELECT
      updated.id,
      p_staging_access_id,
      updated.previous_content,
      p_staging_content,
      updated.previous_metadata,
      updated.new_metadata,
      COALESCE(p_user_email, 'unknown'),
      CASE WHEN updated.previous_content IS NULL THEN 'create' ELSE 'update' END
    FROM updated
    RETURNING staging_history.content_element_id
  )
  SELECT history.content_element_id, v_now
  FROM history;
END;
$$;

-- Keep the established two-column RPC contract for existing server callers.
-- Attribute drafts count only when their VALUE differs from the published
-- value; merely carrying a key is not a content change.
CREATE OR REPLACE FUNCTION public.publish_staging_content_atomic(
  p_site_id UUID,
  p_element_ids TEXT[] DEFAULT NULL,
  p_published_by UUID DEFAULT NULL,
  p_user_email TEXT DEFAULT 'unknown'
)
RETURNS TABLE(element_id TEXT, content TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT published.element_id, published.content
  FROM public.publish_staging_content_with_attributes_atomic(
    p_site_id,
    p_element_ids,
    p_published_by,
    p_user_email,
    NULL
  ) AS published;
END;
$$;

-- The HTTP publisher uses this additive contract so content.updated webhooks
-- can describe href/alt changes. The original function above remains available
-- to older callers with its exact signature and return type.
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
      AND (
        p_page_path IS NULL
        OR ce.page_path = p_page_path
        OR ce.page_path IS NULL
      )
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

CREATE OR REPLACE FUNCTION public.restore_content_version(
  p_version_id UUID,
  p_restored_by TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_site_id UUID;
  v_snapshot JSONB;
  v_element_id TEXT;
  v_element_data JSONB;
  v_snapshot_attributes JSONB;
  v_staged_attributes JSONB;
  v_new_version_id UUID;
BEGIN
  SELECT site_id, snapshot INTO v_site_id, v_snapshot
  FROM public.content_versions WHERE id = p_version_id;

  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'Version not found';
  END IF;

  SELECT public.create_content_version(
    v_site_id, p_restored_by, 'Pre-restore snapshot', 'restore'
  ) INTO v_new_version_id;

  FOR v_element_id, v_element_data IN SELECT * FROM jsonb_each(v_snapshot)
  LOOP
    v_snapshot_attributes := CASE
      WHEN jsonb_typeof(v_element_data->'attributes') = 'object'
        THEN v_element_data->'attributes'
      ELSE '{}'::jsonb
    END;

    SELECT COALESCE(jsonb_object_agg(attribute.key, attribute.value), '{}'::jsonb)
      INTO v_staged_attributes
    FROM public.content_elements ce
    CROSS JOIN LATERAL jsonb_each(v_snapshot_attributes) AS attribute
    WHERE ce.site_id = v_site_id
      AND ce.element_id = v_element_id
      AND (COALESCE(ce.metadata, '{}'::jsonb) - 'staging_attributes')->attribute.key
        IS DISTINCT FROM attribute.value;

    UPDATE public.content_elements
    SET
      staging_content = v_element_data->>'content',
      metadata = CASE
        WHEN v_staged_attributes = '{}'::jsonb
          THEN COALESCE(metadata, '{}'::jsonb) - 'staging_attributes'
        ELSE jsonb_set(
          COALESCE(metadata, '{}'::jsonb) - 'staging_attributes',
          '{staging_attributes}',
          v_staged_attributes,
          true
        )
      END,
      staging_updated_at = NOW(),
      updated_at = NOW()
    WHERE site_id = v_site_id AND element_id = v_element_id;
  END LOOP;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.save_staging_content_atomic(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_staging_content_atomic(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.publish_staging_content_atomic(UUID, TEXT[], UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_staging_content_atomic(UUID, TEXT[], UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.publish_staging_content_with_attributes_atomic(
  UUID, TEXT[], UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_staging_content_with_attributes_atomic(
  UUID, TEXT[], UUID, TEXT, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.restore_content_version(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_content_version(UUID, TEXT)
  TO service_role;
