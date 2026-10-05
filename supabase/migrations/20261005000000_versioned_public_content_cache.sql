-- Give every public content generation an unguessable database-owned identity.
--
-- Redis invalidation cannot be correct if it relies on application DEL calls:
-- a process can die after Postgres commits and before DEL, and an older reader
-- can refill the deleted key after the write. Rotating this UUID in the same
-- transaction as content_elements makes every older key unreachable instead.
-- The Redis cache remains optional; this migration is the source of truth.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS public_content_revision UUID;

ALTER TABLE public.sites
  ALTER COLUMN public_content_revision SET DEFAULT gen_random_uuid();

UPDATE public.sites
SET public_content_revision = gen_random_uuid()
WHERE public_content_revision IS NULL;

ALTER TABLE public.sites
  ALTER COLUMN public_content_revision SET NOT NULL;

COMMENT ON COLUMN public.sites.public_content_revision IS
  'Server-only generation token rotated transactionally by content_elements statement triggers.';

-- `sites` has no table-level web SELECT after s38, but make the new column's
-- decision explicit. A future privilege repair must not silently add this
-- server coordination token to the authenticated metadata allowlist.
REVOKE SELECT (public_content_revision)
  ON TABLE public.sites FROM PUBLIC, anon, authenticated;
REVOKE INSERT (public_content_revision)
  ON TABLE public.sites FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (public_content_revision)
  ON TABLE public.sites FROM PUBLIC, anon, authenticated;
REVOKE REFERENCES (public_content_revision)
  ON TABLE public.sites FROM PUBLIC, anon, authenticated;

-- Lock every affected site in UUID order before rotating. The explicit lock
-- order prevents two multi-site statements from taking the same set in
-- opposite orders. It does not claim global deadlock freedom for arbitrary
-- transactions that already hold unrelated row locks.
CREATE OR REPLACE FUNCTION public.rotate_public_content_revisions(
  p_site_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(array_length(p_site_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  PERFORM sites.id
  FROM public.sites AS sites
  WHERE sites.id = ANY(p_site_ids)
  ORDER BY sites.id
  FOR UPDATE;

  UPDATE public.sites
  SET public_content_revision = gen_random_uuid()
  WHERE id = ANY(p_site_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_public_content_revision_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.rotate_public_content_revisions(
    ARRAY(
      SELECT DISTINCT inserted.site_id
      FROM inserted_content_rows AS inserted
      WHERE inserted.site_id IS NOT NULL
    )
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_public_content_revision_after_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Conservative by design: draft-only and no-op updates rotate too. This
  -- avoids a second, drifting definition of which columns are public and keeps
  -- future write paths correct at the cost of cache hits while editors work.
  PERFORM public.rotate_public_content_revisions(
    ARRAY(
      SELECT affected.site_id
      FROM (
        SELECT old_rows.site_id
        FROM old_content_rows AS old_rows
        WHERE old_rows.site_id IS NOT NULL
        UNION
        SELECT new_rows.site_id
        FROM new_content_rows AS new_rows
        WHERE new_rows.site_id IS NOT NULL
      ) AS affected
    )
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_public_content_revision_after_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.rotate_public_content_revisions(
    ARRAY(
      SELECT DISTINCT deleted.site_id
      FROM deleted_content_rows AS deleted
      WHERE deleted.site_id IS NOT NULL
    )
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_public_content_revision_after_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- TRUNCATE has no transition rows. Rotate every remaining site so no
  -- previously cached payload can represent the now-empty table.
  PERFORM public.rotate_public_content_revisions(
    ARRAY(SELECT sites.id FROM public.sites AS sites)
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS rotate_public_content_revision_insert
  ON public.content_elements;
CREATE TRIGGER rotate_public_content_revision_insert
AFTER INSERT ON public.content_elements
REFERENCING NEW TABLE AS inserted_content_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.rotate_public_content_revision_after_insert();

DROP TRIGGER IF EXISTS rotate_public_content_revision_update
  ON public.content_elements;
CREATE TRIGGER rotate_public_content_revision_update
AFTER UPDATE ON public.content_elements
REFERENCING OLD TABLE AS old_content_rows NEW TABLE AS new_content_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.rotate_public_content_revision_after_update();

DROP TRIGGER IF EXISTS rotate_public_content_revision_delete
  ON public.content_elements;
CREATE TRIGGER rotate_public_content_revision_delete
AFTER DELETE ON public.content_elements
REFERENCING OLD TABLE AS deleted_content_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.rotate_public_content_revision_after_delete();

DROP TRIGGER IF EXISTS rotate_public_content_revision_truncate
  ON public.content_elements;
CREATE TRIGGER rotate_public_content_revision_truncate
AFTER TRUNCATE ON public.content_elements
FOR EACH STATEMENT
EXECUTE FUNCTION public.rotate_public_content_revision_after_truncate();

REVOKE ALL ON FUNCTION public.rotate_public_content_revisions(UUID[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_public_content_revision_after_insert()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_public_content_revision_after_update()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_public_content_revision_after_delete()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_public_content_revision_after_truncate()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rotate_public_content_revisions(UUID[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_public_content_revision_after_insert()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_public_content_revision_after_update()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_public_content_revision_after_delete()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_public_content_revision_after_truncate()
  TO service_role;
