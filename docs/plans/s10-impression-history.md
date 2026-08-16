---
validated: no
---
# Plan — Story s10-impression-history

Branch: `feature/s10-impression-history`
Research: `docs/research/s10-impression-history.md` — read it first; this plan does not repeat it.

## Target story

**s10-impression-history** (`docs/stories.md`) — *"As a marketer I want a section's impressions
over time alongside when its copy changed so that I can tell whether my edit did anything."*
Complexity **3**, confirmed by research (no widget byte budget, no new third-party integration,
no new public ingest surface — reads go through the existing first-party-editor-access pattern).

Acceptance criteria, verbatim:

1. Per-section impressions are queryable by day over a 90-day window.
2. The timeline marks points at which that section's content changed, sourced from existing
   version history.
3. Raw impression events older than the retention window are pruned by a scheduled job, and
   pruning never removes daily aggregates.
4. Aggregation is idempotent: running it twice over the same period produces identical totals.
5. A section with zero impressions shows as zero, distinct from "not tracked."
6. Retention window and the aggregation timezone are documented configuration values, not
   literals in code.

Design: `docs/designs/s10-impression-history.md` — one `Dialog` (`max-w-3xl`), opened from the
section's row in the content list `s09` owns. Composes `Dialog`, `Select`, `Metric`, `Skeleton`,
`EmptyState`, `Alert` from `src/components/ui/`; the chart itself is hand-composed SVG over
design tokens because **no chart primitive exists in the system** — confirmed by
`/ks-design`, carried here as a gap to compose around, not to invent a new primitive for.

### Dependency status — read before starting any task

**`s09-section-impressions` has no code today.** No `IntersectionObserver` in `public/embed/`,
no impression table, no impression route (research, both `s09`'s and `s10`'s, confirmed
independently). `s10`'s own research states this plainly: *"s10's 'aggregate on write' design
and its data model are unconstrained until s09 fixes the raw event shape."* This plan does not
invent that shape. What it does instead:

- **Assumption this plan makes, stated so it can be checked against `s09` when `s09` is real:**
  a raw table exists — called `impression_events` below, name **not confirmed** — carrying at
  minimum `site_id`, `element_id` (text, matching `content_elements.element_id`), a page-scope
  dimension, and an event timestamp. This follows `s09`'s own research recommendation (its open
  question 1: "carry a normalised pathname on the impression row") for the page dimension, and
  AC 3/4 of *this* story ("raw impression events... pruned," "aggregation is idempotent") for
  the rest — those two criteria are only meaningful if a raw, prunable table exists to aggregate
  from.
- **This assumption is not free of tension.** `s09`'s own research (trap 6) recommends the
  opposite: *"Plan a per-(site, element, day, page) upsert-and-increment [at ingest], not an
  append-only event row, or s10's pruning story inherits an unprunable table."* If `s09` is
  built that way, there is no raw table for Tasks 3–4 below to aggregate or prune, and AC 3 as
  written does not apply. **This is `s09`'s decision, not this plan's** — it owns the ingest
  endpoint. Recorded here as an open question, not resolved by inventing `s09`'s schema.
- **Consequence for execution, not for planning.** Tasks 1, 2, 5, 6, 7 below do not depend on
  `impression_events` existing and can be built and tested today. Tasks 3 and 4 target the raw
  table and cannot be verified end-to-end — their tests need a real table to run against —
  until `s09` lands. `/ks-execute` should sequence accordingly: land 1-2-5-6-7 first, revisit
  3-4 once `s09`'s migration exists on `main` or on this branch, and strike them if `s09` ships
  upsert-only ingest instead.

## Tasks (ordered)

**1. Config: retention window and timezone as named constants**
New file `src/lib/config/impression-history.ts`. Exports `IMPRESSION_HISTORY_TIMEZONE = "UTC"`
(documented as an explicit choice matching the codebase's one existing precedent —
`src/lib/analytics/tracker.ts:308`'s accidental UTC-via-`toISOString()` slice — rather than
inventing a new one), `IMPRESSION_RAW_RETENTION_DAYS` (default 30, overridable via
`process.env.IMPRESSION_RAW_RETENTION_DAYS`, following the `retention: number // days` pattern
already in `src/lib/config/production.ts:56,134,217,277`), and
`IMPRESSION_HISTORY_WINDOW_DAYS = 90` (the query window AC 1 names — independent of retention,
per the research's open question: raw retention may be shorter than the query window, which is
exactly why the window must be answerable from `impression_daily_counts` alone, never from raw
events).
*Test:* `src/__tests__/lib/config/impression-history.test.ts` — asserts the three exported
values and their types, asserts the env override for retention, and asserts no other file in
this story's diff contains a literal `30`, `90`, or `"UTC"` outside this module (grep-based
assertion, mirroring how other config-literal rules are enforced in this repo).
*Satisfies:* AC 6.

**2. Migration: `impression_daily_counts` table, with its RLS policy in the same file**
New file `supabase/migrations/<timestamp>_impression_daily_counts.sql` (ADR 002 — RLS lands in
the same migration that creates the table, not a follow-up). Shape:
`id uuid pk default gen_random_uuid()`, `site_id uuid references sites(id) on delete cascade`,
`element_id text not null`, `page_path text not null default ''` (placeholder for `s09`'s
page-scope decision — kept `not null default ''` rather than nullable so the unique constraint
below stays enforceable; Postgres treats every `NULL` as distinct in a unique index, which would
silently admit duplicate buckets), `day date not null`, `count integer not null default 0 check
(count >= 0)`, `created_at`/`updated_at timestamptz default now()`.
`UNIQUE (site_id, element_id, page_path, day)` — the idempotency key Task 3 upserts against.
RLS: `SELECT` for any caller holding a `site_permissions` row on `site_id` (mirrors
`content_elements`'s existing owner-scoped read policy); no `INSERT`/`UPDATE`/`DELETE` policy
for `authenticated` or `anon` — only `service_role` (which bypasses RLS) writes, matching the
corrected pattern `20260611020000_tighten_permissive_policies.sql` established after
`content_history`/`staging_history` were once `FOR ALL USING (true)`.
*Test:* extend `src/__tests__/db/rls-policies.test.ts`'s schema-wide assertions (new table is
covered automatically by its list-wide checks: RLS enabled, no unconditional write policy, no
RLS-enabled-zero-policy table) plus one dedicated test in the same file asserting the specific
`SELECT`-only-via-`site_permissions` shape, following `src/__tests__/api/sites/share-rls.test.ts`
as the per-table precedent. Gated by `describeDb` (`src/__tests__/db/db-harness.ts`) — runs only
against a real local Postgres, same as every other RLS test in this repo.
*Satisfies:* foundation for AC 1, 3, 4; the `count = 0` row vs. absent row is the literal
mechanism behind AC 5.

**3. Aggregation cron: idempotent recompute-and-upsert** — *targets `s09`'s raw table; see
Dependency status above. Build and unit-test the pure function now; the route needs a real
`impression_events` table to integration-test.*
New `src/lib/impressions/aggregate.ts` exporting `aggregateImpressionDay(supabase, day: string)`
(UTC calendar day, `IMPRESSION_HISTORY_TIMEZONE`). For each `(site_id, element_id, page_path)`
combination that has **ever** had a raw event, for each day from that combination's first-ever
event through today: compute `COUNT(*)` from `impression_events` for that exact bucket and
`INSERT ... ON CONFLICT (site_id, element_id, page_path, day) DO UPDATE SET count =
EXCLUDED.count, updated_at = now()`. **Recompute-and-replace, never increment** — an increment
is not idempotent under cron retry (AC 4 fails the moment a retry double-counts); replacing with
a freshly computed `COUNT(*)` produces the same row whether the job runs once or five times.
The "first-ever event marks day zero of tracking" rule is what makes a day before an element was
tracked stay **absent** from the table (→ "not tracked") while a day at or after it with zero
events gets an explicit `count = 0` row (→ "tracked, zero") — see "The point everything turns
on."
New `src/app/api/cron/impression-aggregate/route.ts`, `CRON_SECRET` bearer-token auth pattern
copied from `src/app/api/cron/ab-test-lifecycle/route.ts`, per-bucket `try`/`catch` so one bad
row does not fail the run (same source).
*Test:* `src/__tests__/lib/impressions/aggregate.test.ts` — seed a fixture `impression_events`
table (or a stubbed query layer, if the real table cannot yet be created — see note below), run
`aggregateImpressionDay` twice over the same day, assert byte-identical resulting rows (AC 4);
assert a day with fixture rows but zero matching a specific element gets `count: 0`, not a
missing row; assert a day before that element's first event has no row at all.
*Satisfies:* AC 1, 3 (aggregation completing before pruning reaches a period — see Run
interdicts), 4, 5.

**4. Pruning cron: delete raw events past retention, never touch aggregates** — *same caveat
as Task 3.*
New `src/app/api/cron/impression-prune/route.ts`. `DELETE FROM impression_events WHERE
occurred_at < now() - (IMPRESSION_RAW_RETENTION_DAYS || ' days')::interval`. Same `CRON_SECRET`
auth. No code path in this file or Task 3's touches `impression_daily_counts` with `DELETE` or
`UPDATE ... SET count = count - ...` — the two tables are structurally independent, so pruning
cannot regress an aggregate by construction, not by discipline alone.
*Test:* seed raw rows at ages spanning the retention boundary plus a `impression_daily_counts`
row for the same bucket, run the prune route, assert old raw rows are gone, recent raw rows
remain, and the aggregate row's `count` is byte-for-byte unchanged.
*Satisfies:* AC 3.

**5. Read API: daily counts + change markers for one section**
New `src/app/api/impressions/[siteId]/[elementId]/history/route.ts`. `GET`, query params
`range` (`7`|`30`|`90`, default `90`, validated via `src/lib/api/validation.ts` — no zod, ADR
003) and optional `page` (page_path filter). Auth: `authorizeFirstPartyEditorAccess(siteId,
"view")` (the pattern `src/app/api/edit-board/history/route.ts` already uses — not
`authorizeIngestRequest`, since this route has no site-token write path) **plus** an entitlement
check: resolve the site's owner via `resolveSiteOwnerId` (`src/lib/feature-gating/
permissions.ts:155` — currently module-private; export it rather than duplicating it, a
one-line visibility change, with a test confirming existing callers are unaffected), then
`getEffectivePlan(ownerId)` / `hasAnyEntitlement` (`src/lib/billing/entitlements.ts`). An
unentitled site's owner gets `403`, matching AC 7 of `s09` — this route is a second place that
criterion must hold, since a guessed URL bypasses whatever the dashboard list hides client-side.
Data: resolve `content_elements.id` for `(site_id, element_id)` (default `language`/`variant`),
query `impression_daily_counts` for the window (join per ADR 006), and separately query
`content_history` for that `content_elements.id` within the same window for change markers (ADR
006 — **not** `content_versions`, **not** `staging_history`). Response shape: `{ days: [{day,
count, tracked}], changes: [{at}], range, timezone: "UTC" }` — `tracked: false` for an absent
day, `tracked: true, count: 0` for a real zero.
*Test:* `src/__tests__/api/impressions/history.test.ts` — 401 with no auth, 403 for a caller
with no grant on the site, 403 for an entitled-caller-but-unentitled-site (trial expired /
never subscribed), 200 with correct `days` array (including the tracked/not-tracked split) for
each `range` value, change markers sourced only from `content_history` fixture rows — a
`content_versions`-only fixture (manual snapshot, no matching `content_history` row) must
**not** appear in `changes`, proving ADR 006's decision rather than asserting it.
*Satisfies:* AC 1, 2, 5, 6 (response carries `timezone` explicitly, never assumed by the
caller).

**6. Dashboard: `ImpressionHistoryDialog`**
New `src/components/dashboard/ImpressionHistoryDialog.tsx` and
`src/hooks/useImpressionHistory.ts` (the `{ data, loading, error, refetch }` shape from
`src/hooks/useSites.ts` — a non-ok response is an error state, never an empty result). Renders
per `docs/designs/s10-impression-history.md`: `Dialog`/`DialogContent` `max-w-3xl` (the
`VersionPreviewDialog.tsx` width-override precedent), header (label + `font-mono` selector),
controls row (`Select` range + `Metric` total with `hint` stating the date span and
`IMPRESSION_HISTORY_TIMEZONE`), inline SVG chart (solid `--accent-solid` bar for a tracked day
with a count, a 2px `--text-muted` tick for tracked-zero, a diagonal-stripe `<pattern>` column
over `--surface-2`/`--line` for not-tracked, a `--tone-accent-*` diamond + hairline stem for a
change marker), caption line reading the config constants (never a hardcoded `"30"`/`"90"`),
legend, correlation-caveat copy line. Four states: `Skeleton` (chart-shaped bars, not a
spinner), `EmptyState` (every day in range is not-tracked), `Alert variant="destructive"` +
retry, success.
*Test:* `src/components/dashboard/__tests__/ImpressionHistoryDialog.test.tsx` (RTL) — loading
renders `Skeleton`, not a spinner; error renders `Alert` and its retry action calls `refetch`;
empty (API returns all `tracked: false`) renders `EmptyState`, not a chalky all-hatched chart;
success renders the `Metric` total matching the API's summed counts, renders at least one
visually distinct node for a `tracked:true,count:0` day versus a `tracked:false` day (assert via
`title`/`data-*` attribute, per the design's native-`title`-attribute fallback — no tooltip
primitive exists to build a real one), renders one marker per `changes` entry, and asserts the
caption text contains the retention/timezone values sourced from props/response, not a literal.
*Satisfies:* AC 5, 6 (surfaced in UI); composes only `src/components/ui/` primitives, no new one
added.

**7. Schedule the two cron jobs**
Edit `vercel.json`: add `/api/cron/impression-aggregate` and `/api/cron/impression-prune`
entries. Aggregation frequent relative to retention (`0 * * * *`, hourly) so pruning's cutoff
never reaches an un-aggregated period even under a missed run or two; pruning daily
(`30 3 * * *`, off the existing blog-post job's `14:00` slot). Research flags `vercel.json` as a
shared file other in-flight stories may touch — this task's diff is additive (two new array
entries), not a restructure, to minimize conflict surface.
*Test:* a small config-shape test parsing `vercel.json` and asserting both paths are present
with valid five-field cron syntax and that the aggregate job's schedule interval is smaller than
`IMPRESSION_RAW_RETENTION_DAYS` (imported from Task 1's config, not restated) — encodes the
ordering guarantee as an assertion rather than only as a comment.
*Satisfies:* AC 3 (pruning only runs meaningfully once aggregation is scheduled to keep up).

## Run interdicts

- Retention days, the query window, and the timezone are read from
  `src/lib/config/impression-history.ts` everywhere; grep the diff for a literal `30`, `90`, or
  `"UTC"` outside that file and Task 1's test — none should appear.
- `impression_daily_counts`'s migration file contains its `ENABLE ROW LEVEL SECURITY` and its
  policies; no follow-up migration adds them later.
- No `authenticated`- or `anon`-reachable `INSERT`/`UPDATE`/`DELETE` policy exists on
  `impression_daily_counts` — only `service_role` (bypassing RLS) writes it.
- The change-marker query reads `content_history` only; grep the diff for `content_versions` or
  `staging_history` outside ADR 006's own text — neither should appear as a query target.
- Task 3's upsert sets `count = EXCLUDED.count` (a replace), never `count = count + ...` (an
  increment) — re-run the aggregation test twice in the same test body and diff the two result
  sets; they must be identical, not summed.
- Task 4's `DELETE` statement names only the raw events table; no file in this story's diff
  issues a `DELETE` or a `count`-decrementing `UPDATE` against `impression_daily_counts`.
- `GET /api/impressions/[siteId]/[elementId]/history` returns 403 for both "no grant on this
  site" and "grant exists but site is unentitled" — two different reasons, both before any row
  is read.
- The dialog's chart distinguishes a `tracked:true,count:0` day from a `tracked:false` day with
  two different DOM nodes/attributes, not the same node with a different number.

## The point everything turns on

**AC 5's "zero, distinct from not-tracked" is implemented as a rule, not a field `s09` hands
over: a `(site, element, page)` combination is "tracked" starting the UTC day of its first-ever
raw event, and every day from then on gets an explicit `impression_daily_counts` row — `count:
0` included — while every day before that stays absent from the table entirely.** That rule
lives in Task 3's aggregation function and nowhere else; the read API and the dialog only render
"row exists" vs. "row absent," they do not re-derive tracking status.

**Where this could be wrong:** the rule assumes "tracking started" is defined by data (first
observed event), which is the only signal a raw-events table can give without `s09` supplying
anything extra. If `s09` instead defines tracking start by *entitlement* (the day the site
became Pro/trialling) or by *feature rollout* (the day impressions shipped for that account) —
either is plausible and neither is decided in `s09`'s own research — a site that was entitled
but genuinely had zero visitors on day one would show as "not tracked" under this plan's rule
instead of "tracked, zero," which is the exact distinction AC 5 exists to get right. This is not
fixable inside `s10` alone: it needs `s09` to either confirm "first event" is an acceptable
proxy, or to supply an explicit tracking-start signal (e.g., a per-site `impressions_enabled_at`
timestamp) for `s10` to key off instead. Flagged for reconciliation when `s09` is planned, not
guessed here.

## Files touched

- `src/lib/config/impression-history.ts` — new
- `src/__tests__/lib/config/impression-history.test.ts` — new
- `supabase/migrations/<timestamp>_impression_daily_counts.sql` — new
- `src/__tests__/db/rls-policies.test.ts` — extended
- `src/lib/impressions/aggregate.ts` — new
- `src/app/api/cron/impression-aggregate/route.ts` — new
- `src/__tests__/lib/impressions/aggregate.test.ts` — new
- `src/app/api/cron/impression-prune/route.ts` — new
- `src/__tests__/api/cron/impression-prune.test.ts` — new
- `src/app/api/impressions/[siteId]/[elementId]/history/route.ts` — new
- `src/__tests__/api/impressions/history.test.ts` — new
- `src/lib/feature-gating/permissions.ts` — `resolveSiteOwnerId` exported (visibility only)
- `src/components/dashboard/ImpressionHistoryDialog.tsx` — new
- `src/hooks/useImpressionHistory.ts` — new
- `src/components/dashboard/__tests__/ImpressionHistoryDialog.test.tsx` — new
- `vercel.json` — two cron entries added
- `src/__tests__/config/vercel-json.test.ts` — new (or extended, if a config-shape test already
  exists — check at execution time)
- `docs/decisions/009-impression-history-change-timeline-source.md` — new, already written by
  this plan

## Test strategy

- **Unit** — config constants (Task 1), the aggregation function's idempotency and
  tracked/not-tracked boundary (Task 3), a dedicated timezone test that sets `process.env.TZ` to
  a non-UTC zone for that one test file and asserts the day boundary is still computed in UTC
  (proves the config is honored, not just declared).
- **DB / RLS** — `describeDb`-gated (`src/__tests__/db/db-harness.ts`), real local Postgres
  only, following `rls-policies.test.ts` and `share-rls.test.ts`'s existing shape (Task 2).
- **API integration** — auth (401/403 × 2 reasons), entitlement gating, response shape and the
  `content_history`-not-`content_versions` proof (Task 5); cron auth + delete/upsert behavior
  (Tasks 3-4, blocked on `s09`'s raw table per Dependency status).
- **Component (RTL)** — all four states plus the zero-vs-not-tracked visual distinction (Task
  6), asserting on structure/attributes, not snapshots.
- **Config shape** — `vercel.json` cron entries and the aggregate-more-frequent-than-retention
  invariant (Task 7).
- No test is modified to accommodate this story's behavior; `jest.setup.js`'s global
  `IntersectionObserver` no-op mock is irrelevant here (that risk belongs to `s09`'s widget
  code, not this story's dashboard/API surface).

## Definition of Done

- Tasks 1, 2, 5, 6, 7 implemented, tested and green independently of `s09`.
- Tasks 3, 4 implemented and unit-tested against a fixture/stub now; integration-verified
  against a real `impression_events` table once `s09` lands — struck from this story's scope
  (not silently shipped unverified) if `s09` ships upsert-only ingest instead, per Dependency
  status above.
- `docs/decisions/009-impression-history-change-timeline-source.md` committed with this story's
  branch.
- All six acceptance criteria map to at least one passing test named above.
- `lint`, `type-check`, `format:check`, `build`, `test` all green (AGENTS.md Definition of Done).
- Migration includes its RLS policy in the same file (AGENTS.md non-negotiable 6); never edits
  an applied migration (non-negotiable 5).
- No new component added to `src/components/ui/`; the chart's SVG composition is confined to
  `ImpressionHistoryDialog.tsx`, reusable later if a real chart primitive is ever built (per the
  design doc's own note that this composition is disposable by design).
- `/ks-review` passed, no open critical finding, before `/ks-ship`.
