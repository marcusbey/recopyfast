-- A persisted install status for `sites`, plus the timestamps of its transitions.
--
-- WHAT THIS REPLACES. `sites` had no status column at all. Every "status" an
-- owner ever saw was recomputed on the spot by GET /api/sites:
--   status: elementsCount && elementsCount > 0 ? "active" : "verifying"
-- A count is a snapshot, not an event. It cannot say *when* a site first
-- reported (s03 needs that timestamp), and it cannot tell "never installed"
-- apart from "installed months ago, has since gone quiet" — the two states an
-- owner most needs distinguished, because only one of them is their problem.
--
-- ONLY TWO VALUES ARE EVER STORED, and the CHECK below is what keeps it that
-- way. `stale` is computed at read time by resolveEffectiveSiteStatus()
-- (src/lib/sites/site-status.ts) from `last_reported_at` and a configurable
-- window. Storing it would create exactly the thing the story forbids: a value
-- some later code path could gate content delivery or editing on. Nothing can
-- gate on a value that is never written. Full rationale and the rejected
-- alternatives (a cron-flipped `stale`, a second `installStatus` field beside
-- the old vocabulary) are in docs/decisions/006-site-status-persisted-state-machine.md.
--
-- NO NEW RLS POLICY, deliberately. This is an ALTER on `sites`, which already
-- carries row-level security and its policies; ADR 002's rule is that a table
-- is never CREATEd without them, and no table is created here. The new columns
-- are not secrets — unlike `api_key`, which 20260813120000 had to REVOKE at
-- column level — so they inherit the table's existing grants unchanged.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'awaiting-install',
  ADD COLUMN IF NOT EXISTS live_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_mismatch_domain TEXT,
  ADD COLUMN IF NOT EXISTS last_mismatch_at TIMESTAMPTZ;

COMMENT ON COLUMN public.sites.status IS
  'Install state machine: awaiting-install until the first authorized content report, live thereafter. Never holds stale — that is derived at read time.';
COMMENT ON COLUMN public.sites.live_at IS
  'When the site first flipped to live. Written once and never overwritten.';
COMMENT ON COLUMN public.sites.last_reported_at IS
  'Last authorized request that proved the embed script is still running. Drives the read-time stale computation.';
COMMENT ON COLUMN public.sites.last_mismatch_domain IS
  'Last origin host that presented this site''s token from a domain other than the registered one, and was refused.';
COMMENT ON COLUMN public.sites.last_mismatch_at IS
  'When that refusal happened.';

-- Named and dropped-if-present so re-running this file on a database that has
-- already seen it is not an error. Forward-only still applies: this file is
-- never edited once applied.
ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_status_check;

ALTER TABLE public.sites
  ADD CONSTRAINT sites_status_check
  CHECK (status IN ('awaiting-install', 'live'));

-- THE BACKFILL, and why it is not optional.
--
-- Without it every site whose script has been reporting for weeks flips to
-- "awaiting install" the moment this ships: the column defaults to
-- awaiting-install, and the only thing that would ever move it is a *future*
-- report — which a fully-discovered page never sends, because the widget stops
-- reporting element ids the server already holds. A working customer would be
-- told to install a script that has been running since launch.
--
-- The set marked `live` here must equal SELECT DISTINCT site_id FROM
-- content_elements exactly — no more, no fewer. That is the same fact the old
-- computed "active" already relied on; this makes it persistent instead of
-- recomputed, and dates it from the earliest row so `live_at` is the real first
-- contact rather than the day of this deployment.
UPDATE public.sites AS s
SET status = 'live',
    live_at = first_report.first_seen_at,
    last_reported_at = first_report.first_seen_at
FROM (
  SELECT site_id, MIN(created_at) AS first_seen_at
  FROM public.content_elements
  WHERE site_id IS NOT NULL
  GROUP BY site_id
) AS first_report
WHERE first_report.site_id = s.id;

-- The sites list filters by status on every dashboard load.
CREATE INDEX IF NOT EXISTS idx_sites_status ON public.sites(status);
