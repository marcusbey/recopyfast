-- s119 (ADR 075): a developer's changed source is flagged against the override,
-- never silently won or lost.
--
-- WHAT BROKE. Reported on r/SideProject on 2026-10-21 by a developer evaluating
-- ReCopyFast for client sites: the page said "5 to 10", the client published
-- "5 to 11", the developer then deployed "5 to 9". The embed kept writing
-- "5 to 11" over the deploy forever, and nobody was told. Visitors must keep the
-- override (un-publishing it on a deploy is the same silent surprise in the
-- other direction); the developer must be told and decide.
--
-- Additive only: three nullable columns, no default (every existing row reads
-- as "baseline = original_content, no drift"), two service-role functions and a
-- replaced trigger body. Rolling the application back leaves this harmless.

ALTER TABLE public.content_elements
  ADD COLUMN IF NOT EXISTS source_baseline TEXT,
  ADD COLUMN IF NOT EXISTS source_drift_content TEXT,
  ADD COLUMN IF NOT EXISTS source_drift_detected_at TIMESTAMPTZ;

COMMENT ON COLUMN public.content_elements.source_baseline IS
  'ADR 075: the authored text the override is measured against. NULL means original_content. Moved only by a site admin''s "Keep override".';
COMMENT ON COLUMN public.content_elements.source_drift_content IS
  'ADR 075: the live authored text last reported by the widget when it differs from the baseline on an edited row. NULL = no open drift.';
COMMENT ON COLUMN public.content_elements.source_drift_detected_at IS
  'ADR 075: when source_drift_content was last set to a new value.';

-- WHY THE ROW-VERSION TRIGGER LEARNS ABOUT THESE COLUMNS (s81 interplay).
--
-- content_elements.updated_at is the compare-and-set token the Changes page
-- quotes for Discard (20261012122000): an owner reviews a row, and the write is
-- refused if the row moved since. The trigger bumps that token on EVERY update.
-- A drift report is written by a VISITOR'S page view — any visitor, at any
-- moment — so if it bumped the token, an owner reviewing that very row on the
-- Changes page would be refused with "changed since you looked" although the
-- copy, the draft and the attributes they reviewed are byte-for-byte the same.
-- On an element with steady traffic that refusal would repeat on every retry.
--
-- So an UPDATE whose ONLY effect is on the three source-drift columns keeps the
-- old token. The comparison is the whole row minus those columns and
-- updated_at, so ANY other change — copy, draft, metadata, published_at, a
-- staging timestamp — still bumps it exactly as before; and a statement that
-- changes nothing at all also still bumps it, because the source columns must
-- actually differ for the exception to apply (save_staging_content_atomic run
-- twice in one transaction writes identical values and must still get two
-- tokens — staging-content-cas.test.ts). "Use new source" rewrites the copy, so
-- it bumps the token and invalidates a stale Discard, which is what it should
-- do. The resolution itself has its own compare-and-set (expectedObserved).
--
-- Everything else — SECURITY INVOKER, the pinned pg_catalog search_path, the
-- GREATEST monotonic rule, no direct EXECUTE grant — is unchanged from
-- 20261012122000; staging-content-cas.test.ts asserts those properties.
CREATE OR REPLACE FUNCTION public.set_content_element_updated_at_monotonic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF (NEW.source_baseline, NEW.source_drift_content, NEW.source_drift_detected_at)
       IS DISTINCT FROM
     (OLD.source_baseline, OLD.source_drift_content, OLD.source_drift_detected_at)
     AND (to_jsonb(NEW) - ARRAY[
           'updated_at', 'source_baseline', 'source_drift_content',
           'source_drift_detected_at'
         ])
       = (to_jsonb(OLD) - ARRAY[
           'updated_at', 'source_baseline', 'source_drift_content',
           'source_drift_detected_at'
         ])
  THEN
    NEW.updated_at = OLD.updated_at;
    RETURN NEW;
  END IF;

  NEW.updated_at = GREATEST(
    clock_timestamp(),
    OLD.updated_at + INTERVAL '1 microsecond',
    NEW.updated_at
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_content_element_updated_at_monotonic() IS
  'Maintains content_elements.updated_at as a strictly increasing row-version token (s81). An update touching only the ADR 075 source-drift columns keeps the token (s119).';

REVOKE ALL ON FUNCTION public.set_content_element_updated_at_monotonic()
  FROM PUBLIC, anon, authenticated, service_role;

-- record_content_source_drift — called by POST /api/content/:siteId after the
-- discovery upsert, with the validated reports `[{element_id, content}]`.
--
-- ONE STATEMENT, and every decision is made inside the UPDATE against the
-- locked row, not in an earlier CTE: under READ COMMITTED a concurrent "Keep
-- override" can move source_baseline between a pre-read and the write, and
-- PostgreSQL re-evaluates an UPDATE's own WHERE and SET on the newest row
-- version, never a CTE's snapshot.
--
-- EDITED means what the widget means (recopyfast.src.js applyRow): it writes
-- page text only when current_content (= published ?? original) differs from
-- original_content. An unedited row is never written by the widget, so the
-- developer's deploy already shows and there is nothing to flag. That is also
-- what bounds a forged report (ADR 075 "Trust"): it can only reach a row a
-- client really edited, and it changes nothing a visitor sees.
--
-- Only `en`/`default`: the only rows discovery writes and the only rows a
-- visitor's GET without query parameters reads.
--
-- Malformed members are ignored rather than raised: the caller is a best-effort
-- side path of discovery, and the widget must degrade, never break.
CREATE OR REPLACE FUNCTION public.record_content_source_drift(
  p_site_id UUID,
  p_reports JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed INTEGER := 0;
BEGIN
  IF p_site_id IS NULL OR jsonb_typeof(p_reports) IS DISTINCT FROM 'array' THEN
    RETURN 0;
  END IF;

  WITH reported AS (
    SELECT DISTINCT ON (report ->> 'element_id')
      report ->> 'element_id' AS element_id,
      report ->> 'content' AS content
    FROM jsonb_array_elements(p_reports) AS report
    WHERE jsonb_typeof(report) = 'object'
      AND jsonb_typeof(report -> 'element_id') = 'string'
      AND jsonb_typeof(report -> 'content') = 'string'
    ORDER BY report ->> 'element_id'
  )
  UPDATE public.content_elements ce
  SET
    source_drift_content = CASE
      WHEN reported.content IS NOT DISTINCT FROM
        COALESCE(ce.source_baseline, ce.original_content)
        THEN NULL
      ELSE reported.content
    END,
    source_drift_detected_at = CASE
      WHEN reported.content IS NOT DISTINCT FROM
        COALESCE(ce.source_baseline, ce.original_content)
        THEN NULL
      ELSE now()
    END
  FROM reported
  WHERE ce.site_id = p_site_id
    AND ce.element_id = reported.element_id
    AND ce.language = 'en'
    AND ce.variant = 'default'
    AND COALESCE(ce.published_content, ce.original_content)
      IS DISTINCT FROM ce.original_content
    -- Write only when something changes: a reverted source clears an open
    -- drift; a new source differs from the one already recorded. A repeat
    -- report is therefore a zero-row no-op and keeps the first detection time.
    AND CASE
      WHEN reported.content IS NOT DISTINCT FROM
        COALESCE(ce.source_baseline, ce.original_content)
        THEN ce.source_drift_content IS NOT NULL
          OR ce.source_drift_detected_at IS NOT NULL
      ELSE ce.source_drift_content IS DISTINCT FROM reported.content
    END;

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

COMMENT ON FUNCTION public.record_content_source_drift(UUID, JSONB) IS
  'ADR 075: records or clears source drift on edited en/default rows of one site from widget discovery reports. Service role only. Returns rows changed.';

-- resolve_content_source_drift — POST /api/content/source-drift, after the
-- ADR 037/042 chain has established a signed-in site admin of p_site_id.
--
-- Returns resolved | conflict | missing | pending; the route maps them to
-- 200 / 409 / 404 / 409.
--
-- - missing: no such row on this site, or no open drift (an unedited row with a
--   leftover drift has nothing to resolve: the page already shows its source).
-- - conflict: the drift the admin looked at is not the one stored now — a newer
--   observation landed in between. They must see the new text before choosing.
-- - keep: the override stays; the deployed text becomes the baseline. No copy
--   changes, so no staging_history row and no CAS-token bump (trigger above).
-- - drop: the row is re-discovered at the deployed text. It is no longer
--   edited, so the widget stops writing it and the page shows the deploy. A
--   non-pending draft (staging_content equal to the old published copy) moves
--   with it, otherwise it would surface as a pending draft that re-publishes
--   the override. Refused while a draft is pending — publish or discard first,
--   the same "pending" the Changes view derives (20261012122000).
CREATE OR REPLACE FUNCTION public.resolve_content_source_drift(
  p_site_id UUID,
  p_content_element_id UUID,
  p_resolution TEXT,
  p_expected_observed TEXT,
  p_user_email TEXT,
  p_user_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.content_elements%ROWTYPE;
  v_is_pending BOOLEAN;
BEGIN
  IF p_resolution IS NULL OR p_resolution NOT IN ('keep', 'drop') THEN
    RAISE EXCEPTION 'unknown source drift resolution: %', p_resolution
      USING ERRCODE = '22023';
  END IF;

  SELECT ce.* INTO v_row
  FROM public.content_elements ce
  WHERE ce.id = p_content_element_id
    AND ce.site_id = p_site_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_row.source_drift_content IS NULL
    OR COALESCE(v_row.published_content, v_row.original_content)
      IS NOT DISTINCT FROM v_row.original_content
  THEN
    RETURN 'missing';
  END IF;

  IF p_expected_observed IS NULL
    OR v_row.source_drift_content <> p_expected_observed
  THEN
    RETURN 'conflict';
  END IF;

  IF p_resolution = 'keep' THEN
    UPDATE public.content_elements
    SET
      source_baseline = v_row.source_drift_content,
      source_drift_content = NULL,
      source_drift_detected_at = NULL
    WHERE id = v_row.id;
    RETURN 'resolved';
  END IF;

  v_is_pending :=
    (
      v_row.staging_content IS NOT NULL
      AND v_row.staging_content IS DISTINCT FROM v_row.published_content
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_each(CASE
        WHEN jsonb_typeof(v_row.metadata -> 'staging_attributes') = 'object'
          THEN v_row.metadata -> 'staging_attributes'
        ELSE '{}'::jsonb
      END) AS attribute
      WHERE (COALESCE(v_row.metadata, '{}'::jsonb) - 'staging_attributes')
        -> attribute.key IS DISTINCT FROM attribute.value
    );

  IF v_is_pending THEN
    RETURN 'pending';
  END IF;

  UPDATE public.content_elements
  SET
    original_content = v_row.source_drift_content,
    published_content = v_row.source_drift_content,
    current_content = v_row.source_drift_content,
    staging_content = CASE
      WHEN v_row.staging_content IS NULL THEN NULL
      ELSE v_row.source_drift_content
    END,
    source_baseline = NULL,
    source_drift_content = NULL,
    source_drift_detected_at = NULL,
    published_at = now(),
    published_by = p_user_id
  WHERE id = v_row.id;

  INSERT INTO public.staging_history (
    content_element_id,
    previous_content,
    new_content,
    previous_metadata,
    new_metadata,
    user_email,
    action
  )
  VALUES (
    v_row.id,
    v_row.published_content,
    v_row.source_drift_content,
    v_row.metadata,
    v_row.metadata,
    COALESCE(NULLIF(p_user_email, ''), 'unknown'),
    'revert'
  );

  RETURN 'resolved';
END;
$$;

COMMENT ON FUNCTION public.resolve_content_source_drift(
  UUID, UUID, TEXT, TEXT, TEXT, UUID
) IS
  'ADR 075: a site admin keeps the override (baseline := observed) or drops it (row re-discovered at the observed text, staging_history revert). Service role only. Returns resolved, conflict, missing or pending.';

-- Supabase grants new public-schema functions to anon and authenticated by
-- default, and PostgREST publishes every one as an RPC. Both are SECURITY
-- DEFINER content writers (ADR 042): revoke every web path, including the
-- service role, then grant back the one reviewed principal.
REVOKE ALL ON FUNCTION public.record_content_source_drift(UUID, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_content_source_drift(UUID, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.resolve_content_source_drift(
  UUID, UUID, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_content_source_drift(
  UUID, UUID, TEXT, TEXT, TEXT, UUID
) TO service_role;
