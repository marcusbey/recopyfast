-- A-4 — DELETE on site_permissions must be per-row, not per-site.
--
-- 20260731008000 created
--   USING (user_has_site_permission(site_id, ARRAY['admin']))
-- which lets any admin delete any row of that site, including the creator's,
-- over PostgREST with their own JWT. The HTTP handler now refuses that, but
-- the policy is still the live grant if that migration applied.
--
-- A per-row predicate has to name the row. granted_by IS NOT NULL is the
-- creator marker (registration writes null; share always sets granted_by).
-- user_id IS NOT NULL names the row's subject so a site-scoped USING cannot
-- sneak back in.

DROP POLICY IF EXISTS "Site admins can revoke site permissions"
  ON public.site_permissions;
DROP POLICY IF EXISTS "Site admins can revoke non-creator permissions"
  ON public.site_permissions;

CREATE POLICY "Site admins can revoke non-creator permissions"
  ON public.site_permissions
  FOR DELETE
  TO authenticated
  USING (
    user_id IS NOT NULL
    AND granted_by IS NOT NULL
    AND public.user_has_site_permission(site_id, ARRAY['admin'])
  );
