# Research — Story s10-impression-history

> **Warning, recorded per instruction:** `docs/reviews/stories.md` ends `Max severity: major` /
> `Stories ready: no`. The story breakdown has not passed `/ks-stories-review` clean. Operator
> confirmed proceeding anyway. This research treats `docs/stories.md`'s `s10` text as the
> target, but see "Traps & constraints" for one review finding (a stale `prd.md` cross-reference
> that used to point a different story's open decision at "s10") that **no longer reproduces** —
> checked against the current `docs/prd.md`, not assumed fixed.

## The five structuring facts

1. **The story's own anchor is probably the wrong table.** `s10`'s agentic notes say "join
   against" the version history exposed by `src/app/api/edit-board/history/route.ts`
   (`content_versions`) — but that table is populated only by an explicit "Save Current
   Version" button click (`recopyfast.src.js:5963-5982`, label `'Manual snapshot'`) or by the
   style-apply flow s04 is deleting. It is **not** written on ordinary edits. The table that
   actually gets a row on every real content change is `content_history`, populated by an
   `AFTER INSERT OR UPDATE` trigger on `content_elements`
   (`supabase/migrations/20260809130000_content_history_definer_and_delete_split.sql:106-108`),
   which also fires on publish (`publish_staging_content_atomic`,
   `supabase/migrations/20260803020000_restore_atomic_publish.sql:79-90`, updates
   `content_elements.current_content`). See "Anchor points" for the full comparison.
2. **`s10` depends entirely on a story that doesn't exist yet.** `s09-section-impressions` has
   no code today — confirmed no `IntersectionObserver` in `public/embed/`, no impression table
   in `supabase/migrations/`, no impression route under `src/app/api/`. `s10`'s "aggregate on
   write" design and its data model are unconstrained until `s09` fixes the raw event shape.
3. **The existing "per day" bucketing precedent is undocumented UTC, not a stated timezone.**
   `src/lib/analytics/tracker.ts:308` derives a trend's `date` via
   `activity.timestamp.split("T")[0]` on an ISO-8601 string — which is UTC because
   `new Date().toISOString()` is always UTC and Postgres returns `timestamptz` columns
   serialized the same way. `site_analytics.date` is a bare `DATE` column
   (`supabase/migrations/20250817000000_complete_database_setup.sql:292`) with no timezone
   annotation at all. Nothing in the codebase names "UTC" as a decision; it is only implicit
   in how strings get sliced. `s10`'s AC "the aggregation timezone are documented configuration
   values, not literals in code" is not satisfied by precedent — precedent is itself an
   undocumented literal.
4. **No pruning/retention cron exists to copy.** `vercel.json` schedules exactly one job
   (`/api/cron/generate-blog-post`). `/api/cron/ab-test-lifecycle` exists as a route
   (`src/app/api/cron/ab-test-lifecycle/route.ts`) but is **not** in `vercel.json` — it is
   unscheduled dead infrastructure, same "built, not reachable" pattern the stories file warns
   about elsewhere. It is nonetheless the best available idempotency reference: it checks
   current status before acting and does not error the whole run on one test's failure — worth
   copying that per-item try/catch shape for the pruning job, not the scheduling (which is
   simply absent and would need to be added to `vercel.json`).
5. **The header dependency graph implies `s10` gates `s12`; `s10`'s own Dependencies section and
   `s12`'s own Dependencies section both disagree.** `stories.md:61-63` draws
   `s09 ─> s10 ─┐ ... └─> s12`, but `s12`'s "Dependencies" line names only `s11` and `s09`
   (`stories.md:626-627`), and `s10`'s own "Dependencies" line names only `s09`
   (`stories.md:538`). The stories-review already flagged this exact edge as spurious (m1,
   `docs/reviews/stories.md:176`). Net effect for this story: **`s10` is not on `s12`'s critical
   path** — plan and execute it without worrying about downstream A/B-results consumers.

## Target story

`s10-impression-history` (`docs/stories.md:521-550`) — **"As a marketer I want a section's
impressions over time alongside when its copy changed so that I can tell whether my edit did
anything."**

Complexity as scored in the file: **3** — "aggregation and read models over data `s09` already
collects." Dependencies: `s09-section-impressions` only.

### Acceptance criteria (verbatim, numbered for reference)

1. Per-section impressions are queryable by day over a 90-day window.
2. The timeline marks points at which that section's content changed, sourced from existing
   version history.
3. Raw impression events older than the retention window are pruned by a scheduled job, and
   pruning never removes daily aggregates.
4. Aggregation is idempotent: running it twice over the same period produces identical totals.
5. A section with zero impressions shows as zero, distinct from "not tracked."
6. Retention window and the aggregation timezone are documented configuration values, not
   literals in code.

## Current state of the code

- **`s09` is entirely unbuilt.** No `IntersectionObserver` anywhere in `public/embed/` (grep
  confirmed; the only repo hits are `src/components/landing/InteractiveHero.tsx`,
  `src/components/three/sky/SkyBackground.tsx`, `public/demo-site/scripts.js` — all unrelated
  marketing-surface code, exactly as `s09`'s own agentic notes already say). No impression table
  exists in `supabase/migrations/`. No `/api/impressions*` or similar route exists.
- **A naming collision to be aware of, not a premise problem:** `public/embed/recopyfast.src.js`
  already has a method literally named `trackImpressions()` (line 3113), but it is A/B-test
  variant "view" event tracking (`event_type: 'view'` posted to `/ab-tests/track`,
  `sendTrackEvent` at line 3163), unrelated to per-section marketing impressions. `s09`/`s10`
  must not be confused with or accidentally extend this pipeline; it writes to `ab_test_results`
  and `visitor_buckets`/`conversion_events`, not anything `s09`/`s10` would own.
- **Version/content-history machinery, verified against the running schema, not the story's
  gloss on it:**
  - `content_versions` (`supabase/migrations/20251230100000_edit_board.sql:53-73`): one row per
    **manual, whole-site snapshot**. Columns: `id, site_id, version_number, snapshot (JSONB —
    the whole site's elements), created_by, description, elements_changed (a count, not a list
    of which elements), change_type, created_at`. Written only by the `create_content_version`
    RPC, called from exactly two places:
    `src/app/api/edit-board/styles/apply/route.ts:172` (style-apply — being removed by `s04`)
    and `src/app/api/edit-board/history/route.ts:212` (the "Save Current Version" button,
    `recopyfast.src.js:5963-5982`, an explicit user action). **Ordinary inline edits never call
    it.**
  - `content_history` (`supabase/migrations/20250817000000_complete_database_setup.sql:42-49`,
    trigger reconciled in `20260809130000`): one row per **actual content_elements row change**
    — `id, content_element_id (FK → content_elements.id), content, changed_by (auth.users FK),
    change_type ('create'|'update'|'delete'), created_at`. Populated automatically by
    `log_content_change()`, `AFTER INSERT OR UPDATE` / `BEFORE DELETE` on `content_elements`
    (`20260809130000_content_history_definer_and_delete_split.sql:106-112`). This fires on
    **every** publish, because `publish_staging_content_atomic` updates
    `content_elements.current_content`
    (`supabase/migrations/20260803020000_restore_atomic_publish.sql:79-90`) and the trigger
    condition is `OLD.current_content IS DISTINCT FROM NEW.current_content`.
  - `staging_history` (`supabase/migrations/20251230000000_staging_workflow.sql:77-93`): one row
    per **staging→publish transition specifically**, written explicitly (not by trigger) inside
    `publish_staging_content_atomic`'s CTE
    (`20260803020000_restore_atomic_publish.sql:62-77`) — `content_element_id,
    staging_access_id, previous_content, new_content, user_email, action
    ('create'|'update'|'publish'|'revert'), created_at`.
  - None of these three tables carries `site_id` or the text `element_id` directly on the
    history row — all key on `content_elements.id` and require a join through
    `content_elements` to reach `site_id`/`element_id` (the identity `s09`'s impressions will
    presumably also key on, per `s09`'s own note to reuse `content_elements.element_id` /
    `computeStableElementId`).
  - `VersionHistoryPanel.tsx` **is** live and **is** rendered at `SiteDetailView.tsx:374`
    (import at `:32`) — the story's specific claim about this component is accurate. It is
    UI for `content_versions` only (fetches `/api/edit-board/history`), so "the panel is real"
    does not make `content_versions` the right join target for a complete per-edit timeline.
- **Cron / scheduling:** `vercel.json` has one entry
  (`/api/cron/generate-blog-post`, `0 14 * * *`). `src/app/api/cron/ab-test-lifecycle/route.ts`
  exists, checks `Authorization: Bearer ${CRON_SECRET}`, and is a reasonable idempotency
  reference (per-item try/catch, re-reads status after acting rather than trusting its own
  write) — but it is not scheduled anywhere, so there is no working example of a *scheduled*
  job in this codebase to copy end-to-end; adding one to `vercel.json` is itself part of this
  story's or a sibling's job.
- **Retention/config precedent:** `src/lib/config/production.ts` already has a `retention:
  number // days` pattern used for other data classes (values 7, 14, 30 at lines 134, 217,
  277) — a real, in-repo shape to extend rather than invent.
- **Day-bucketing precedent:** `src/lib/analytics/tracker.ts:calculateTrends` (`:303-332`)
  buckets `user_activity_logs` rows into days via `activity.timestamp.split("T")[0]` — i.e.
  UTC calendar day, implicitly, via ISO-string slicing. `site_analytics.date` is a bare `DATE`
  column with no zone. There is no explicit "we bucket in UTC" statement anywhere in the repo.
- **Ingest auth precedent for anything `s09`/`s10` add:** `src/lib/security/ingest-auth.ts`
  (`authorizeIngestRequest`) accepts either a site token or a first-party Supabase session —
  the shape `s09`'s notes point to. `s10` itself is dashboard-read-only (no new public ingest
  surface of its own), so it more likely reuses `authorizeFirstPartyEditorAccess` /
  `authorizeFirstPartySiteRequest` (the pattern `history/route.ts` already uses) than
  `authorizeIngestRequest`.

## Anchor points

| Concern | File | State |
|---|---|---|
| Per-edit history (trigger, comprehensive) | `supabase/migrations/20250817000000_complete_database_setup.sql:42-49`, `20260809130000_content_history_definer_and_delete_split.sql:72-112` | Live, fires on every `content_elements` change including publish |
| Publish-specific history | `supabase/migrations/20251230000000_staging_workflow.sql:77-93`, written by `20260803020000_restore_atomic_publish.sql:62-77` | Live, fires only on staging→publish |
| Manual whole-site snapshots (what the story's notes point at) | `supabase/migrations/20251230100000_edit_board.sql:53-73` | Live but sparse — user-triggered only |
| Version list API | `src/app/api/edit-board/history/route.ts` | Live, reads `content_versions` |
| Version detail/restore API | `src/app/api/edit-board/history/[versionId]/route.ts` | Live, reads/writes `content_versions` |
| Version panel UI | `src/components/dashboard/VersionHistoryPanel.tsx`, rendered `SiteDetailView.tsx:374` | Confirmed live and rendered — story's premise here is TRUE |
| Cron config | `vercel.json` | One scheduled job; `ab-test-lifecycle` exists but unscheduled |
| Retention config precedent | `src/lib/config/production.ts:56,134,217,277` | `retention: number` pattern already exists, different domain |
| Day-bucket precedent | `src/lib/analytics/tracker.ts:303-332` | Implicit UTC via ISO-string slice, undocumented |
| Element identity | `content_elements` (`site_id, element_id, language, variant` unique) | Confirmed shape; `content_history`/`staging_history` key on the row's UUID `id`, not the text `element_id`, so a join through `content_elements` is required either way |
| Impression tracking (s09) | — | Does not exist. No file to anchor to. |

## Verified APIs / functions

- `GET /api/edit-board/history?siteId=&limit=&offset=` — lists `content_versions`, paginated,
  auth via first-party session or staging token (`route.ts:32-128`). Returns
  `elements_changed` as a **count**, not the list of which elements — cannot itself answer "did
  *this* section change at *this* timestamp" without also reading `snapshot`.
- `GET /api/edit-board/history/[versionId]` — one version's full snapshot
  (`[versionId]/route.ts:64-149`).
- `POST /api/edit-board/history` — creates a `content_versions` row via `create_content_version`
  RPC, called only by the manual "Save Current Version" action.
- `publish_staging_content_atomic(p_site_id, p_element_ids, p_published_by, p_user_email)` —
  the function that actually moves content live; the point after which an impression change
  would be attributable to "did the edit do anything." Returns `TABLE(element_id, content)`.
- `authorizeFirstPartyEditorAccess(siteId, 'view'|'edit')` — the auth call `s10`'s dashboard
  read endpoint should reuse (matches `history/route.ts`'s own pattern), not
  `authorizeIngestRequest` (that's for public write endpoints, which `s10` does not add).
- No impression read/write function exists to verify — depends on `s09`.

## Traps & constraints

- **The join-target trap (the story's biggest risk).** If `s10` is implemented literally as its
  agentic notes say — "join against [`/api/edit-board/history`]; do not record a second edit
  timeline" — the resulting "when did copy change" markers will only appear on the rare manual
  "Save Current Version" clicks (and, until `s04` removes it, style-apply), not on ordinary
  edits or publishes. That fails the acceptance criterion in spirit even while satisfying it in
  letter, because the actual user flow ("I edited a headline, did impressions change") produces
  publishes that write to `content_history`/`staging_history`, not `content_versions`. This
  needs a decision **before** `/ks-plan`: join `content_history` (broadest — covers create/
  update/delete on every `content_elements` row) or `staging_history` (narrower — publish
  events specifically, which is arguably the more correct "went live" marker since impressions
  are also visitor-facing/post-publish). Either is a real, populated table; `content_versions`
  alone is not.
- **Timezone — confirmed as flagged, with a concrete resolution path.** No explicit timezone
  decision exists anywhere in the repo. The one precedent (`tracker.ts:308`) is de facto UTC by
  accident of `toISOString()`. `s10` should make this an explicit, documented UTC choice (matching
  the accidental precedent rather than contradicting it) and put it in a named config constant,
  not invent a per-customer/site timezone with no existing requirement for one.
- **Idempotent aggregation vs. cron retries.** `AGENTS.md` and `architecture.md` both state cron
  platforms retry and every job must be idempotent. The only in-repo example
  (`ab-test-lifecycle`) is idempotent by virtue of checking status before acting, not by an
  upsert-with-conflict-key pattern. `s10`'s daily aggregate table will need a real
  `UNIQUE(site_id, element_id, day)` (or similar) + `ON CONFLICT` upsert, or a delete-then-insert
  transaction — there is no existing "aggregate into daily buckets, safe under retry" code to
  copy verbatim; it must be written from the general principle only.
- **Pruning vs. aggregates — ordering matters.** AC 3 requires raw events to be prunable without
  touching daily aggregates, which means aggregation must complete (and be durable) strictly
  before the pruning job's cutoff reaches events that haven't been aggregated yet. If both are
  cron jobs, their relative scheduling/ordering is a real correctness constraint the story does
  not spell out — flag as a planning decision, not an implementation detail.
- **No cron is scheduled in `vercel.json` today besides the blog post job.** Adding pruning (and
  possibly aggregation, if not done inline on write) requires a `vercel.json` edit, which is a
  shared file — coordinate if `s09`, `s11`/`s12` (unscheduled `ab-test-lifecycle`) or others are
  touching it concurrently.
- **The header-graph `s10 → s12` edge does not exist in either story's own Dependencies
  section**, and the stories-review already flagged it as spurious (`docs/reviews/stories.md:176`,
  finding "m1"). Treat `s10`'s only real dependency as `s09`.
- **A stale-`prd.md`-reference finding in the review does NOT reproduce.** The review
  (`docs/reviews/stories.md:101-113`, finding "M1") states `prd.md:434-435` contained *"`s10`
  assumes agency-only, single invoice. Confirm before `s10` reaches `/ks-plan`"* — a leftover
  from the pre-renumbering id (old `s10` = new `s13-agency-plan`). **Checked against the current
  `docs/prd.md`: this text now correctly reads `s13-agency-plan`** (`prd.md:445`), and a full
  grep of `prd.md` for `s06`–`s10` finds only correct, current references (`prd.md:429,432,440`).
  Whoever fixes `stories.md`'s other majors before shipping should know this specific one is
  already resolved in `prd.md`; do not re-fix it and do not treat `/ks-plan` for this story as
  gated on an agency/invoice decision — that decision belongs to `s13`, not `s10`.
- **Jest's global `IntersectionObserver` mock is a no-op** (`jest.setup.js:177-182`) — irrelevant
  to `s10` directly (that's `s09`'s widget code), but if `s10`'s tests exercise anything that
  transitively imports widget-adjacent test fixtures, the same "passes vacuously" risk applies
  to any assertion resting on that mock.
- **`changed_by` on `content_history` is `auth.users(id)`**, populated via `auth.uid()` inside a
  `SECURITY DEFINER` trigger. Non-account editors (staging-token sessions, the product's primary
  editing path per `AGENTS.md`) are not Supabase-authenticated, so `auth.uid()` is very likely
  `NULL` for their edits. This does not block `s10` (only the timestamp matters for the
  timeline), but if any acceptance criterion or a later story wants "who changed it" on the
  timeline, that attribution is currently unreliable for the majority-case editor (non-account
  grant holders).

## Open questions

- **What shape does `s09` actually produce — raw events only, or pre-aggregated per-day counts
  already?** `s09`'s own agentic notes say "impressions need their own batched endpoint writing
  pre-aggregated counts" — which, if built that way, would mean some of `s10`'s "aggregate on
  write into daily buckets" is already `s09`'s job, and `s10` might only add the *history join*
  and *pruning*, not aggregation itself. This cannot be resolved without `s09` existing; flag
  for `/ks-plan` rather than guessed here.
- **Does `s09` key impressions by `content_elements.element_id` (text) or by
  `content_elements.id` (UUID)?** Affects whether `s10`'s join to `content_history`/
  `staging_history` (which key on the UUID) is direct or needs an extra hop through
  `content_elements`. `s09`'s notes say "reuse `content_elements.element_id`" but don't commit
  to which column impressions themselves will store.
- **`content_history` vs `staging_history` as the join target — not resolved here on purpose.**
  Both are real, both are trigger/RPC-populated (not manual), and the story's own text ("sourced
  from existing version history") is ambiguous between them and `content_versions`. This is a
  planning decision with product-visible consequences (does the timeline show every edit, or
  only published edits) and should be made explicit in `/ks-plan`, not inferred silently by
  whichever table an implementer finds first.
- **Where does the 90-day query window's data live once pruning has run — does "prune raw events
  outside the retention window" mean the retention window can be shorter than 90 days (leaving
  only aggregates to answer the 90-day query), or must raw events survive 90 days regardless of
  a shorter configured retention?** The AC treats "queryable by day over a 90-day window" and
  "retention window... a configuration value" as separate criteria without stating their
  relationship. If retention is configured below 90 days, AC 1 must be answerable from daily
  aggregates alone — which is likely the intent ("aggregate on write... read-time aggregation
  over raw impressions will not survive the first customer with real traffic") but is not stated
  as a constraint tying the two ACs together.
- **Not settled: whether `s09` will ship before or independently reach `s10`'s implementation
  window**, i.e., whether this story can start at all before `s09`'s schema is real. Sequencing,
  not a code question — noted so `/ks-plan` doesn't assume `s09`'s tables exist.

## Real complexity

**3, matching `docs/stories.md`.** This is genuinely aggregation/read-model work: no widget byte
budget, no new third-party integration, no new public ingest surface (reads go through the
existing first-party-editor-access pattern). The real cost is in getting three things exactly
right — which existing table is the true change timeline (a design decision this research
surfaces but does not make), a timezone that is explicit rather than accidental, and a
retry-safe aggregation/pruning pair — none of which individually pushes this past a 3. The
dependency on `s09` not yet existing is a sequencing risk, not a complexity multiplier: it
constrains *when* this can be planned in detail, not how hard the work is once `s09` lands.
No split proposed.

## Split proposal

Not applicable — complexity is 3, not 5.
