-- Hide sites.api_key from PostgREST roles.
--
-- The column is the HMAC secret used to mint data-site-token. RLS on `sites`
-- is row-level only, so any collaborator (including view) could
--   GET /rest/v1/sites?select=id,api_key
-- with the published anon key and their session, then mint tokens forever.
--
-- Column REVOKE is what actually removes it from the PostgREST schema for
-- those roles. service_role keeps SELECT: every server-side mint
-- (authorizeSiteRequest, GET /api/sites for admins, register) already uses it.
--
-- Does not change the HTTP contract: GET /api/sites never returned api_key
-- in the JSON body. It stops the PostgREST bypass.

REVOKE SELECT (api_key) ON TABLE public.sites FROM PUBLIC;
REVOKE SELECT (api_key) ON TABLE public.sites FROM anon;
REVOKE SELECT (api_key) ON TABLE public.sites FROM authenticated;

GRANT SELECT (api_key) ON TABLE public.sites TO service_role;
