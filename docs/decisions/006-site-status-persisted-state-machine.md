# ADR 006 — A persisted two-value site status, with `stale` computed at read time

- Status: accepted
- Date: 2026-08-16
- Scope: story (`s02-install-verified`, travels with `feature/s02-install-verified`)

## Context

`sites` has no status column. `GET /api/sites` derives one fresh on every call:
`elementsCount > 0 ? "active" : "verifying"` (`src/app/api/sites/route.ts:117`), and
`SiteDetailView.tsx:91` independently derives `hasReportedContent` from the same count for a
second, differently-worded pair of badges ("Script Installation" / "API Connection"). Neither
is a state machine and neither carries a timestamp. `SiteStatus = "active" | "inactive" |
"verifying"` and its registry (`src/components/ui/status-badge.tsx:50-111`) are consumed in four
places (`SiteCard.tsx`, `SiteDetailView.tsx`, `dashboard/page.tsx`, `dashboard/sites/page.tsx`),
and `SiteDetailView.test.tsx` pins the exact label/description strings for all three values.

`s02`'s acceptance criteria need more than a relabeling: AC 2 needs a real transition ("the
first authenticated content report... flips to live") that fires once and never re-fires; AC 7
needs a site that has gone quiet to read differently from one that never reported, without ever
blocking it; AC 8 needs transition timestamps `s03` can read from the sites API. None of that is
expressible as a value recomputed from a `content_elements` count on every request — there is
nowhere to store *when* the flip happened, and nothing distinguishes "never reported" from "used
to report, has gone quiet."

## Decision

**Persist two values only: `awaiting-install` and `live`, plus the timestamps of their
transitions. `stale` is never written to the database — it is computed at read time from
`status = 'live'` and how old `last_reported_at` is.**

Migration (`supabase/migrations/20260816120000_sites_install_status.sql`) adds to `sites`:

- `status TEXT NOT NULL DEFAULT 'awaiting-install' CHECK (status IN ('awaiting-install', 'live'))`
- `live_at TIMESTAMPTZ` — set once, the first time `status` flips to `live`.
- `last_reported_at TIMESTAMPTZ` — bumped on every authenticated request that proves the script
  is still running (POST discovery, and GET content reads from the widget's own token, not the
  dashboard's session).
- `last_mismatch_domain TEXT`, `last_mismatch_at TIMESTAMPTZ` — the last domain that reported
  itself and was refused, per AC 4.

Existing rows are backfilled in the same migration: any site with at least one `content_elements`
row is set to `live`, with `live_at`/`last_reported_at` taken from that row's earliest
`created_at` — the same fact the old computed `"active"` already relied on, made persistent
instead of recomputed.

`resolveEffectiveSiteStatus()` (`src/lib/sites/site-status.ts`) is the single place staleness is
computed: `status !== 'live' → awaiting-install`; `status === 'live'` and `last_reported_at`
older than a configurable window (env-overridable, defaulting to 14 days) → `stale`; otherwise
`live`. `GET /api/sites` calls it once per site and returns the resolved value; every UI consumer
(`SiteCard`, `SiteDetailView`, `dashboard/page.tsx`, the new `SiteInstallationCard`) reads that
resolved string and never recomputes the window itself.

The existing `active` / `inactive` / `verifying` vocabulary is retired, not kept alongside the
new one. `SiteStatus` becomes `"awaiting-install" | "live" | "stale"` in
`src/components/ui/status-badge.tsx`, and the tests pinned to the old strings
(`SiteDetailView.test.tsx`, `dashboard/sites/page.test.tsx`) are rewritten as part of this
story's commit, documented in the PR per `AGENTS.md`'s rule against silently editing a test to
fit a behavior change.

## Considered options

- **Coexist: keep `active`/`inactive`/`verifying` for the list badge, add a separate
  `installStatus` field for the detail view's state machine.** Rejected. This is the exact
  dual-computation-of-the-same-fact bug the story exists to close —
  `SiteDetailView.tsx` already asks "has this site's script ever posted content?" twice, in two
  places, worded two different ways. Two status fields would still be one fact, still answered
  twice, and now `s18` and `s03` would each have to learn which of two fields to trust.
- **Persist `stale` too, flipped by a scheduled job.** Rejected. Staleness is a pure function of
  `now() - last_reported_at`; a cron adds a reconciliation window (a site can read as `live` for
  up to a full cron interval after it has actually gone stale) and a new scheduled dependency
  this story does not otherwise need. It also creates the one thing the story's own trap warns
  against: a *stored* `stale` value that some future code path could mistake for a gate. Nothing
  can gate on a value that is never written.
- **Keep computing `awaiting-install`/`live` from `content_elements` existence, as today, and
  only add the mismatch and timestamp columns.** Rejected. This is the original defect, not a
  fix for it: a `content_elements` count is a snapshot, not an event, so it cannot answer "when
  did this happen" for AC 8, and it re-runs a per-site count query on every list load that a
  persisted status removes.

## Consequences

**Easier.** One resolver function is the only place the staleness window is computed; every
consumer (present four, plus `s18`'s public pages later) reads an already-resolved string.
`s03` gets real timestamps to read instead of having to infer a milestone from a side effect on
`content_elements`.

**Harder.** The migration must backfill correctly or every already-reporting site regresses to
`awaiting-install` the moment this ships — the migration derives `live`/`live_at` from
`content_elements`' earliest row per site specifically to prevent that. Five assertions in
`SiteDetailView.test.tsx` pinned to the old vocabulary must be rewritten, not left disabled.

**Watch.** If a future story ever needs to query "which sites are stale" directly in SQL (a
digest, a cron, a dashboard-wide count) rather than through `GET /api/sites`, the read-time
computation in `resolveEffectiveSiteStatus` has to be ported to SQL or that story pays a query
per site to reuse the TypeScript resolver. Revisit this ADR if that need appears — nothing here
prevents deriving `stale` in SQL later; today no consumer needs to.
