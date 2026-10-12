-- s81: Discard may update only the exact content_elements row version the
-- owner reviewed. Other editor callers keep the established unconditional
-- save_staging_content_atomic contract.
--
-- WHY A NEW FUNCTION. PostgREST resolves RPCs by name and argument set. An
-- overload of save_staging_content_atomic would make omission/defaults part of
-- that resolution and could route an old caller to the conditional shape. A
-- separately named function keeps both contracts explicit: this one always
-- requires p_expected_updated_at; the old one remains last-write-wins.
--
-- WHY updated_at, NOT staging_updated_at. Discard rebuilds the draft from the
-- current live text and live href/alt. A publish, bulk write or attribute write
-- can therefore invalidate what the owner reviewed without moving
-- staging_updated_at. The row-wide updated_at is the version of that complete
-- snapshot.
--
-- WHY A CONTENT-SPECIFIC TIMESTAMP TRIGGER. The inherited BEFORE UPDATE
-- trigger calls shared update_updated_at_column(), which assigns transaction-
-- start NOW() and overwrites any value an UPDATE supplied. Two successful
-- writes inside one transaction therefore receive the same token, so the first
-- token can be reused. Do not change that shared function for every unrelated
-- table. Replace only content_elements' trigger with a monotonic version:
-- wall-clock time, the requested value, or one microsecond after the prior
-- token, whichever is greatest. RETURNING below observes the post-trigger value.
CREATE OR REPLACE FUNCTION public.set_content_element_updated_at_monotonic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.updated_at = GREATEST(
    clock_timestamp(),
    OLD.updated_at + INTERVAL '1 microsecond',
    NEW.updated_at
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_content_element_updated_at_monotonic() IS
  'Maintains content_elements.updated_at as a strictly increasing row-version token. Table-specific for s81; unrelated tables retain update_updated_at_column().';

REVOKE ALL ON FUNCTION public.set_content_element_updated_at_monotonic()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS update_content_elements_updated_at
  ON public.content_elements;
CREATE TRIGGER update_content_elements_updated_at
  BEFORE UPDATE ON public.content_elements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_content_element_updated_at_monotonic();

-- Preserve the established unconditional RPC's two-column contract while
-- making its value truthful under the new trigger. Its old body returned the
-- local v_now. The inherited trigger used to store that same transaction time;
-- the monotonic content trigger can store a later value, so returning v_now
-- would hand a caller a token that is stale before the response leaves. Return
-- the UPDATE's post-trigger value instead. Everything else stays byte-for-byte
-- equivalent to the applied 20260924030000 definition.
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
      ce.updated_at AS saved_updated_at,
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
  SELECT history.content_element_id, updated.saved_updated_at
  FROM history
  JOIN updated ON updated.id = history.content_element_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_staging_content_atomic(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_staging_content_atomic(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.save_staging_content_compare_and_set(
  p_site_id UUID,
  p_element_id TEXT,
  p_language TEXT,
  p_variant TEXT,
  p_staging_content TEXT,
  p_expected_updated_at TIMESTAMP WITH TIME ZONE,
  p_attribute_patch JSONB,
  p_staging_access_id UUID,
  p_user_email TEXT
)
RETURNS TABLE(
  save_status TEXT,
  content_element_id UUID,
  updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH locked AS MATERIALIZED (
    SELECT
      ce.id,
      ce.staging_content,
      ce.updated_at AS current_updated_at,
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
  prepared AS MATERIALIZED (
    SELECT
      locked.*,
      COALESCE((
        SELECT jsonb_object_agg(attribute.key, attribute.value)
        FROM jsonb_each(locked.proposed_attributes) AS attribute
        WHERE (locked.previous_metadata - 'staging_attributes')->attribute.key
          IS DISTINCT FROM attribute.value
      ), '{}'::jsonb) AS effective_attributes,
      -- Supply a monotonic candidate; the table-specific BEFORE UPDATE trigger
      -- above owns the final invariant and RETURNING observes its actual token.
      GREATEST(
        clock_timestamp(),
        locked.current_updated_at + INTERVAL '1 microsecond'
      ) AS next_updated_at
    FROM locked
    WHERE locked.current_updated_at IS NOT DISTINCT FROM p_expected_updated_at
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
      staging_updated_at = prepared.next_updated_at,
      updated_at = prepared.next_updated_at
    FROM prepared
    WHERE ce.id = prepared.id
    RETURNING
      ce.id,
      ce.updated_at AS saved_updated_at,
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
  SELECT
    'saved'::text,
    updated.id,
    updated.saved_updated_at
  FROM updated
  JOIN history ON history.content_element_id = updated.id

  UNION ALL

  SELECT
    'conflict'::text,
    locked.id,
    locked.current_updated_at
  FROM locked
  WHERE locked.current_updated_at IS DISTINCT FROM p_expected_updated_at

  UNION ALL

  SELECT
    'missing'::text,
    NULL::uuid,
    NULL::timestamp with time zone
  WHERE NOT EXISTS (SELECT 1 FROM locked);
END;
$$;

COMMENT ON FUNCTION public.save_staging_content_compare_and_set(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMP WITH TIME ZONE, JSONB, UUID, TEXT
) IS
  'Service-only conditional staging save. Locks one content row, compares content_elements.updated_at, then updates draft and history atomically; returns saved, missing, or conflict.';

-- Supabase grants new public-schema functions broadly by default. This is a
-- SECURITY DEFINER content writer, so revoke every web/public path (including
-- the service role before granting back the one reviewed principal).
REVOKE ALL ON FUNCTION public.save_staging_content_compare_and_set(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMP WITH TIME ZONE, JSONB, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_staging_content_compare_and_set(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMP WITH TIME ZONE, JSONB, UUID, TEXT
) TO service_role;

-- The CAS token must be read in the same statement/snapshot as the copy it
-- versions. The Changes route used to read the view first and metadata in a
-- later query; taking a token from that second query could pair new metadata's
-- timestamp with stale text and let stale text pass CAS. Append updated_at to
-- the security-invoker view itself. It is appended (rather than inserted among
-- existing columns) because CREATE OR REPLACE VIEW may add columns only at the
-- end without changing the established projection identities.
DO $migration$
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE WARNING
      'content_changes not updated: PostgreSQL % has no security_invoker views, and ADR 054 forbids a definer view',
      current_setting('server_version');
    RETURN;
  END IF;

  EXECUTE $view$
    CREATE OR REPLACE VIEW public.content_changes
    WITH (security_invoker = true)
    AS
    SELECT
      ce.id,
      ce.site_id,
      ce.element_id,
      ce.page_path,
      ce.selector,
      ce.language,
      ce.variant,
      ce.metadata ->> 'type' AS element_type,
      ce.original_content,
      ce.published_content,
      ce.staging_content,
      ce.created_at,
      CASE
        WHEN state.is_pending THEN 'pending'
        WHEN ce.published_content IS DISTINCT FROM ce.original_content
          OR ce.published_at IS NOT NULL THEN 'published'
        ELSE 'original'
      END AS change_state,
      CASE
        WHEN state.is_pending THEN ce.staging_updated_at
        ELSE COALESCE(ce.published_at, ce.updated_at)
      END AS changed_at,
      latest.user_email AS changed_by,
      latest.action AS last_action,
      concat_ws(
        ' ',
        ce.original_content,
        ce.published_content,
        ce.staging_content,
        ce.page_path
      ) AS search_text,
      ce.updated_at
    FROM public.content_elements ce
    CROSS JOIN LATERAL (
      SELECT
        (
          ce.staging_content IS NOT NULL
          AND ce.staging_content IS DISTINCT FROM ce.published_content
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_each(CASE
            WHEN jsonb_typeof(ce.metadata -> 'staging_attributes') = 'object'
              THEN ce.metadata -> 'staging_attributes'
            ELSE '{}'::jsonb
          END) AS attribute
          WHERE (COALESCE(ce.metadata, '{}'::jsonb) - 'staging_attributes') -> attribute.key
            IS DISTINCT FROM attribute.value
        ) AS is_pending
    ) state
    LEFT JOIN LATERAL (
      SELECT sh.user_email, sh.action
      FROM public.staging_history sh
      WHERE sh.content_element_id = ce.id
      ORDER BY sh.created_at DESC
      LIMIT 1
    ) latest ON true
  $view$;

  EXECUTE $comment$
    COMMENT ON VIEW public.content_changes IS
      'One row per content element with its change state and row-wide updated_at version, derived in the same snapshot. security_invoker: the caller''s RLS applies. ADR 054; ADR 067.'
  $comment$;

  EXECUTE 'REVOKE ALL ON public.content_changes FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'GRANT SELECT ON public.content_changes TO authenticated, service_role';
END
$migration$;
