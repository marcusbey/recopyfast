-- ========================================
-- Anyone holding the public anon key could roll back anyone's site
-- ========================================
-- `create_content_version` and `restore_content_version` are SECURITY DEFINER,
-- so they run as their owner and RLS on `content_elements` and
-- `content_versions` does not apply to what they do. Neither asks who is
-- calling: restore derives `site_id` from the version row and overwrites that
-- site's `staging_content`; create takes `p_site_id` from the caller.
--
-- Both were executable by PUBLIC, and explicitly by `anon` and `authenticated`:
--
--   create_content_version  | =X/postgres, anon=X/postgres, authenticated=X/...
--   restore_content_version | =X/postgres, anon=X/postgres, authenticated=X/...
--
-- PostgREST exposes every function in `public` as an RPC endpoint, so that ACL
-- is reachable from any browser with the anon key — which is published in the
-- client bundle by design. Confirmed against production before this migration:
--
--   POST /rest/v1/rpc/restore_content_version  {"p_version_id": "000...000"}
--   → 400 {"code":"P0001","message":"Version not found"}
--
-- "Version not found" is raised INSIDE the function body. The call was not
-- refused; it ran, and only stopped because that id does not exist. With a real
-- version id it would have overwritten another tenant's draft content and left
-- a "Pre-restore snapshot" in their history. `create_content_version` is worse
-- to reach: it takes a site id, and site ids are public — every customer's
-- embed snippet carries theirs.
--
-- The permission checks in `/api/edit-board/history*` are real, and were never
-- the problem. They simply were not the only way in.
--
-- WHY GRANTS AND NOT A CHECK INSIDE THE FUNCTION
-- ---------------------------------------------
-- Every caller in this codebase already uses the service-role client — the two
-- API routes, the styles route, and server/index.js — because these functions
-- have always been server-side machinery. Nothing signs in as `authenticated`
-- and calls them. So the grant was not enabling a use case; it was surface with
-- no purpose, and removing it is the whole fix rather than a mitigation.
--
-- An `auth.uid()` check inside the body would also have to special-case the
-- service role (whose uid is null), which means the security of the function
-- would rest on correctly identifying its own caller — the thing the grant
-- already decides, more simply and one layer earlier.
--
-- Note that Postgres grants EXECUTE to PUBLIC on every new function, so the
-- REVOKE FROM PUBLIC is what actually closes this; revoking the named roles
-- alone would leave the implicit grant behind.
-- ========================================

REVOKE ALL ON FUNCTION create_content_version(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION restore_content_version(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION create_content_version(UUID, TEXT, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION restore_content_version(UUID, TEXT)
  TO service_role;
