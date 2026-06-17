-- Performance: composite index for the embed widget's bootstrap read.
--
-- The hot path (GET /api/content/[siteId] and /api/v1/content) filters
--   WHERE site_id = $1 AND language = $2 AND variant = $3
-- which is run on every page load of every embedded site.
--
-- The existing UNIQUE(site_id, element_id, language, variant) constraint index
-- cannot serve this query efficiently: element_id is the SECOND column, so once
-- site_id is matched Postgres still has to scan all of a site's rows because the
-- query does not constrain element_id. On a large multi-tenant site this degrades
-- to a per-site sequential scan.
--
-- A dedicated (site_id, language, variant) index lets the planner satisfy the
-- whole predicate from the index.
--
-- NOTE: plain CREATE INDEX (not CONCURRENTLY) — Supabase runs each migration inside
-- a transaction block, and CONCURRENTLY is illegal there. This takes a brief
-- SHARE lock on writes; acceptable during the deploy window for this table's size.
CREATE INDEX IF NOT EXISTS idx_content_elements_site_lang_variant
  ON content_elements (site_id, language, variant);
