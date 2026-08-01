-- ========================================
-- api_keys: Add site_id scoping column
-- ========================================
-- Fix: api_keys had no site_id column, making it impossible to scope
-- keys to a specific site.  This migration adds the optional FK and
-- a covering index for fast per-site lookups.
--
-- The column is nullable (NULL = key is user-scoped / all sites).
-- ON DELETE CASCADE ensures orphan rows are cleaned up automatically
-- when a site is deleted.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_api_keys_site_id
  ON api_keys(site_id);
