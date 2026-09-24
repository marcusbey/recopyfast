-- Editor invitation mail is sent only when an address moves from no access (or
-- revoked access) to active access. The previous route inferred that transition
-- with a SELECT before its upsert. Two requests could both observe "inactive"
-- and send twice, while a failed lookup was deliberately indistinguishable from
-- "not found" and could send to an already-active editor.
--
-- Serialize one site/email pair inside the write and return the transition as
-- part of the same result. The advisory lock is transaction-scoped, so it is
-- released on success or failure without cleanup. This is server machinery:
-- the dashboard route calls it with the service role after requireSiteAdmin.
CREATE OR REPLACE FUNCTION public.activate_site_editor(
  p_site_id     UUID,
  p_email       TEXT,
  p_permissions TEXT[],
  p_invited_by  UUID
)
RETURNS TABLE (
  id           UUID,
  site_id      UUID,
  email        TEXT,
  permissions  TEXT[],
  created_at   TIMESTAMPTZ,
  did_activate BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_email TEXT := lower(trim(p_email));
  editor_row public.site_editors%ROWTYPE;
  became_active BOOLEAN := FALSE;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_site_id::TEXT || ':' || normalized_email, 0)
  );

  SELECT se.*
    INTO editor_row
    FROM public.site_editors AS se
   WHERE se.site_id = p_site_id
     AND lower(se.email) = normalized_email
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.site_editors (
      site_id,
      email,
      permissions,
      invited_by
    )
    VALUES (
      p_site_id,
      normalized_email,
      p_permissions,
      p_invited_by
    )
    RETURNING * INTO editor_row;

    became_active := TRUE;
  ELSE
    became_active := editor_row.revoked_at IS NOT NULL;

    UPDATE public.site_editors AS se
       SET permissions = p_permissions,
           invited_by = p_invited_by,
           revoked_at = NULL
     WHERE se.id = editor_row.id
    RETURNING se.* INTO editor_row;
  END IF;

  RETURN QUERY
  SELECT
    editor_row.id,
    editor_row.site_id,
    editor_row.email,
    editor_row.permissions,
    editor_row.created_at,
    became_active;
END;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC on new functions unless it is revoked.
-- The route has already authenticated and authorised the site admin; exposing
-- this service-role write through PostgREST would bypass that guard.
REVOKE ALL ON FUNCTION public.activate_site_editor(UUID, TEXT, TEXT[], UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_site_editor(UUID, TEXT, TEXT[], UUID)
  TO service_role;
