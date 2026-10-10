-- ========================================
-- Repair: api_keys.site_id is missing in production
-- ========================================
-- Found on 2026-09-25 by the s38 preflight, before applying
-- 20260925120000_sites_api_key_column_grants.sql. Production's migration ledger
-- lists 20260611030000_api_keys_site_scoping as applied, yet
-- information_schema shows api_keys without site_id. It is the same "aborted
-- but marked applied" failure docs/ship-order.md records for the 2026-08
-- repair: the ledger is not proof that a statement ran.
--
-- Two consequences, both live until this runs:
--   1. /api/api-keys inserts and selects site_id, so every key operation errors.
--   2. The s38 grants name api_keys.site_id in their column lists, so that
--      migration aborts on this database. This file is timestamped just before it
--      so a fresh `db push` applies them in the right order.
--
-- Never edit 20260611030000 (applied migrations are immutable); this restates
-- its two idempotent statements instead. On any database where the column
-- already exists both are no-ops.

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.sites(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_api_keys_site_id
  ON public.api_keys(site_id);
