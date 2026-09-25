-- ========================================
-- Explicit column allowlists for credential-bearing tables (s38)
-- ========================================
--
-- 20260813120000 tried to hide sites.api_key with a column-level REVOKE.
-- PostgreSQL privileges are additive: Supabase had already granted SELECT on
-- the whole table, and that broader privilege continued to authorize every
-- column. A collaborator who passed the sites RLS policy could therefore read
-- the HMAC key through PostgREST and mint site tokens.
--
-- The repair order is load-bearing: remove the table privilege first, clear
-- any explicit column ACL left by prior attempts, then grant the complete
-- reviewed nonsecret list. These lists are deliberately static. A future
-- column receives no application SELECT until its migration decides whether it
-- is safe and updates the catalogue invariant beside this migration.

-- sites: application users only read metadata. Every write is service-scoped;
-- there is no anon/authenticated write RLS policy to preserve.
REVOKE ALL PRIVILEGES ON TABLE public.sites FROM PUBLIC, anon, authenticated;
REVOKE SELECT (
  id, domain, name, api_key, created_at, updated_at, status, live_at,
  last_reported_at, last_mismatch_domain, last_mismatch_at
) ON TABLE public.sites FROM PUBLIC, anon, authenticated;
REVOKE INSERT (
  id, domain, name, api_key, created_at, updated_at, status, live_at,
  last_reported_at, last_mismatch_domain, last_mismatch_at
) ON TABLE public.sites FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (
  id, domain, name, api_key, created_at, updated_at, status, live_at,
  last_reported_at, last_mismatch_domain, last_mismatch_at
) ON TABLE public.sites FROM PUBLIC, anon, authenticated;
REVOKE REFERENCES (
  id, domain, name, api_key, created_at, updated_at, status, live_at,
  last_reported_at, last_mismatch_domain, last_mismatch_at
) ON TABLE public.sites FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, domain, name, created_at, updated_at, status, live_at,
  last_reported_at, last_mismatch_domain, last_mismatch_at
) ON TABLE public.sites TO authenticated;

-- webhooks.secret is recoverable by design so the dispatcher can sign a
-- delivery. The HTTP contract shows it once at creation and lists only the
-- prefix thereafter; site-member RLS must not make the stored value readable.
REVOKE SELECT ON TABLE public.webhooks FROM PUBLIC, anon, authenticated;
REVOKE SELECT (
  id, site_id, url, events, secret, is_active, last_triggered_at,
  failure_count, max_failures, created_by, created_at, updated_at,
  secret_prefix, coalesce_window_seconds, pending_event_type, pending_payload,
  pending_dispatch_at
) ON TABLE public.webhooks FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, site_id, url, events, is_active, last_triggered_at, failure_count,
  max_failures, created_by, created_at, updated_at, secret_prefix,
  coalesce_window_seconds, pending_event_type, pending_payload,
  pending_dispatch_at
) ON TABLE public.webhooks TO authenticated;

-- API-key plaintext is never stored. The hash still has no dashboard purpose:
-- callers identify a key by key_prefix, while service code alone validates a
-- presented key against key_hash.
REVOKE SELECT ON TABLE public.api_keys FROM PUBLIC, anon, authenticated;
REVOKE SELECT (
  id, user_id, name, key_hash, key_prefix, scopes, rate_limit_per_minute,
  is_active, last_used_at, expires_at, created_at, updated_at, site_id
) ON TABLE public.api_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, user_id, name, key_prefix, scopes, rate_limit_per_minute, is_active,
  last_used_at, expires_at, created_at, updated_at, site_id
) ON TABLE public.api_keys TO authenticated;

-- Device hashes support service-side validation. Site admins only need device
-- row identity and lifecycle metadata to count or revoke remembered devices.
REVOKE SELECT ON TABLE public.editor_device_grants
  FROM PUBLIC, anon, authenticated;
REVOKE SELECT (
  id, site_editor_id, grant_hash, user_agent_hash, ip_prefix, origin_hash,
  expires_at, revoked_at, revoked_reason, rotated_from, last_used_at, created_at
) ON TABLE public.editor_device_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, site_editor_id, ip_prefix, expires_at, revoked_at, revoked_reason,
  rotated_from, last_used_at, created_at
) ON TABLE public.editor_device_grants TO authenticated;

-- Supabase normally provisions service_role with broad defaults, but migration
-- correctness must not depend on an environment-specific default ACL. This is
-- the sole application role allowed to recover the hidden values and to retain
-- each table's existing mutation contract.
GRANT ALL PRIVILEGES ON TABLE
  public.sites,
  public.webhooks,
  public.api_keys,
  public.editor_device_grants
TO service_role;
