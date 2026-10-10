-- Keep staged href/alt edits through history, publish, versions and restore.
--
-- Published attributes live at metadata.href / metadata.alt. Drafts live under
-- metadata.staging_attributes so the public content route can strip one key and
-- never expose an unapproved destination. These functions are SECURITY DEFINER
-- because the API authorizes the site before using its service-role client;
-- their grants therefore follow the service-role-only boundary established by
-- 20260805190000 and 20260809120000.

ALTER TABLE public.staging_history
  ADD COLUMN IF NOT EXISTS previous_metadata JSONB,
  ADD COLUMN IF NOT EXISTS new_metadata JSONB;

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
DECLARE
  v_published_at TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
  RETURN QUERY
  WITH changed AS (
    SELECT
      ce.id,
      ce.element_id,
      ce.published_content,
      ce.staging_content,
      COALESCE(ce.metadata, '{}'::jsonb) AS previous_metadata,
      (
        COALESCE(ce.metadata, '{}'::jsonb) - 'staging_attributes'
      ) || CASE
        WHEN jsonb_typeof(ce.metadata->'staging_attributes') = 'object'
          THEN ce.metadata->'staging_attributes'
        ELSE '{}'::jsonb
      END AS published_metadata
    FROM public.content_elements ce
    WHERE ce.site_id = p_site_id
      AND (
        (
          ce.staging_content IS NOT NULL
          AND ce.staging_content IS DISTINCT FROM ce.published_content
        )
        OR (
          jsonb_typeof(ce.metadata->'staging_attributes') = 'object'
          AND ce.metadata->'staging_attributes' <> '{}'::jsonb
        )
      )
      AND (
        p_element_ids IS NULL
        OR ce.element_id = ANY(p_element_ids)
      )
    FOR UPDATE
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
        SELECT 1
        FROM history
        WHERE history.content_element_id = changed.id
      )
    RETURNING ce.element_id, ce.published_content
  )
  SELECT updated.element_id, updated.published_content
  FROM updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_content_version(
  p_site_id UUID,
  p_created_by TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_change_type TEXT DEFAULT 'manual'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version_id UUID;
  v_version_number INT;
  v_snapshot JSONB;
  v_elements_count INT;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version_number
  FROM public.content_versions WHERE site_id = p_site_id;

  -- Keep the established element_id key shape. Its language/variant collision
  -- is audit finding A-15 and is deliberately not changed inside this story.
  SELECT jsonb_object_agg(
    element_id,
    jsonb_build_object(
      'content', COALESCE(staging_content, published_content, current_content, original_content),
      'elementType', metadata->>'type',
      'selector', selector,
      'attributes', jsonb_strip_nulls(jsonb_build_object(
        'href', COALESCE(metadata#>>'{staging_attributes,href}', metadata->>'href'),
        'alt', COALESCE(metadata#>>'{staging_attributes,alt}', metadata->>'alt')
      ))
    )
  ) INTO v_snapshot
  FROM public.content_elements
  WHERE site_id = p_site_id;

  SELECT COUNT(*) INTO v_elements_count
  FROM public.content_elements WHERE site_id = p_site_id;

  INSERT INTO public.content_versions (
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
    UPDATE public.content_elements
    SET
      staging_content = v_element_data->>'content',
      metadata = CASE
        -- Legacy snapshots predate attribute capture. Leaving metadata alone is
        -- the only backward-compatible interpretation of a missing key.
        WHEN v_element_data ? 'attributes' THEN jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{staging_attributes}',
          jsonb_build_object(
            'href', COALESCE(v_element_data#>>'{attributes,href}', ''),
            'alt', COALESCE(v_element_data#>>'{attributes,alt}', '')
          ),
          true
        )
        ELSE metadata
      END,
      staging_updated_at = NOW(),
      updated_at = NOW()
    WHERE site_id = v_site_id AND element_id = v_element_id;
  END LOOP;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_staging_content(
  p_site_id UUID,
  p_element_ids UUID[] DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE public.content_elements
  SET
    staging_content = published_content,
    metadata = COALESCE(metadata, '{}'::jsonb) - 'staging_attributes',
    staging_updated_at = NOW(),
    updated_at = NOW()
  WHERE site_id = p_site_id
    AND (p_element_ids IS NULL OR id = ANY(p_element_ids));

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_staging_content_atomic(UUID, TEXT[], UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_staging_content_atomic(UUID, TEXT[], UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.create_content_version(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_content_version(UUID, TEXT, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.restore_content_version(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_content_version(UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.revert_staging_content(UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_staging_content(UUID, UUID[])
  TO service_role;
