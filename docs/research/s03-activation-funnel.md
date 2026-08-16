# Research — Story s03-activation-funnel

> **Review gate warning.** `docs/reviews/stories.md` ends `Stories ready: no` (max severity:
> major, dated as the second-pass review of `stories.md` revision `6f11b3f`). None of the six
> majors or eight minors in that review touch `s03` by name, and `s03`'s own prior finding
> (m7 — three independent edit-activity read models) is recorded there as **closed**: `s03` AC 8
> makes `account_milestones` the single source, `s14`/`s15` declare they read from it. Operator
> confirmed proceeding with research despite the gate. This is a warning, not a block.

## Premise verdict

**True, with one gap the story does not disclose.** Every assertion the story and its agentic
notes make was checked against code and holds:

- `account_milestones` does not exist anywhere in the 43 files under `supabase/migrations/`, nor
  anywhere in `src/` — confirmed by a zero-hit grep across both. The PRD's primary success metric
  is genuinely uninstrumented.
- `tracker.ts` does carry two dead bindings at the cited locations (see Fact 2 below), matching
  the story's claim, with one small terminology nuance noted there.
- `analytics/track/route.ts` accepts exactly the five action types the story lists, verbatim.
- The non-account attribution trap is real and independently confirmed by tracing the write path,
  not just the type union (see Fact 4 below).

**The gap:** the story's agentic notes list `src/app/api/analytics/track/route.ts` under
"Existing" as if it were the live edit-tracking pipeline. It is not — `content_edit` is a type the
route *accepts* but nothing in the codebase ever *sends*. The real, currently-firing edit write
path is `/api/staging/content/[siteId]` (PUT), which the story's agentic notes never mention. An
implementer who takes "Existing: ... analytics/track/route.ts" at face value and wires milestone 4
off `user_activity_logs.action_type = 'content_edit'` will ship a milestone that never fires for
anyone, account holder or grant holder alike, and the failure will be silent (an empty-but-valid
funnel, not an error).

---

## The five structuring facts (five one-liners with file:line)

1. `account_milestones` does not exist — zero hits across `supabase/migrations/*.sql` (43 files)
   and `src/**` (verified by grep, not memory).
2. `src/lib/analytics/tracker.ts:222` — `const { data: siteAnalytics } = await this.supabase.from("site_analytics")...` is destructured and never read again in `getDashboardData`; dead. `tracker.ts:390-391` — `updateSiteAnalytics(date: string = new Date().toISOString().split("T")[0])`: `date` is accepted but never referenced in the body (`tracker.ts:395` calls `this.supabase.rpc("update_site_analytics")` with no arguments). Note: `date` is an unused *parameter*, not a block-scoped local — the story's "two dead locals" phrasing is imprecise but the dead-code finding is correct and lint would flag both.
3. `src/app/api/analytics/track/route.ts:29-35` — `ACTION_TYPES` is exactly `["page_view", "content_edit", "login", "logout", "api_call"]`, confirmed verbatim. But `ClientAnalytics.trackContentEdit` (`tracker.ts:477-497`, the only code that would ever POST `action: "content_edit"`) has **zero callers** anywhere in `src/` or `public/embed/` — confirmed by grep. The ingest path for content edits is dead in production.
4. The real edit-write path, `PUT /api/staging/content/[siteId]:246-256`, inserts into `staging_history` with `staging_access_id` and `user_email`, never `user_id`, for a "staging" `EditorAccess` (`editor-access.ts:270-284`, `.userId` is not set on that branch). The only `EditorAccess` kind that *does* carry `.userId` is `"edit-session"` (`editor-access.ts:315-327`), and `EditSessionManager.createEditSession` (`edit-sessions.ts:59-75`) refuses to mint one unless the caller already holds a `site_permissions` row for that `userId` — i.e. edit-sessions are an account holder's own session, never a true non-account grant. So every genuine grant-holder edit reaches storage with no `user_id` at all.
5. Site ownership is not a column anywhere reachable from a grant-holder edit: `staging_history` has no `site_id` (only `content_element_id`), so deriving the owning account requires `staging_history.content_element_id → content_elements.site_id → site_permissions WHERE role = 'admin'`. Consistent with `docs/architecture.md:159-161` / ADR 002: ownership is an `admin` row in `site_permissions`, never a column on `sites`.

---

## Target story

**s03-activation-funnel — measure time-to-first-edit** (`docs/stories.md:198-233`)

As the operator of RecopyFast, I want the signup → first-edit funnel instrumented so I can tell
whether the product's primary claim is true.

Complexity (as written): **3** — "read models and event plumbing over existing data."

Acceptance criteria (verbatim, `stories.md:207-214`):
- [ ] Four timestamps persist per account: account confirmed, first site registered, first
  verified install, first persisted content update.
- [ ] Time-to-first-edit is queryable as p50 and p90 over an arbitrary date range.
- [ ] Step-to-step drop-off is queryable: how many accounts reached each of the four steps.
- [ ] Each timestamp is written exactly once per account and is never overwritten by a later
  event, asserted by a test that replays a duplicate event.
- [ ] Accounts that predate this story are marked `unmeasurable` and are excluded from p50/p90,
  and a test asserts an unmeasurable account contributes to no percentile.
- [ ] Edits by non-account grant holders are attributed to the site's owning account, and are
  separately countable as non-account edits.
- [ ] The funnel is readable at `/dashboard/analytics` without running SQL by hand.
- [ ] This story's `account_milestones` table is the single source for account-level edit
  activity; `s14` and `s15` read from it rather than re-aggregating the activity log.

Dependencies: `s01-trial-signup` (defines account start), `s02-install-verified` (defines the
install step).

---

## Current state of the code

- **`src/lib/analytics/tracker.ts`** (580 lines) — `AnalyticsTracker` class (service-role Supabase
  client) writes to `user_activity_logs`, `performance_metrics`, `conversion_events`, `api_usage`,
  and reads a dashboard aggregate (`getDashboardData`) scoped by `site_permissions`. `ClientAnalytics`
  is the browser-side POST helper; only `trackPageView` and `trackPerformance` are actually called
  anywhere in the app (verified — `trackContentEdit` has no callers).
- **`src/app/api/analytics/track/route.ts`** (221 lines) — public ingest route, dual-auth
  (`authorizeIngestRequest`: site-token *or* session), accepts the five action types, writes via
  `analytics.trackActivity`. `GET` serves the dashboard read (`getDashboardData`). Functionally
  correct and tested, but the `content_edit` branch is unreachable from production traffic today.
- **`src/app/dashboard/analytics/page.tsx`** (38 lines) — thin client wrapper: fetches `/api/sites`,
  renders `<AnalyticsDashboard sites={sites} />`. No funnel UI exists.
- **`src/components/dashboard/AnalyticsDashboard.tsx`** (573 lines) — three tabs only: `trends`,
  `sites`, `performance` (`AnalyticsDashboard.tsx:408-518`). No funnel/activation tab.
- **Edit persistence (the part the story's notes omit):**
  - `PUT /api/staging/content/[siteId]` (`route.ts:113-273`) — the actual save-a-draft-edit path
    for both owners and grant holders, gated by `authorizeFirstPartyEditorAccess` (owner) or
    `validateEditorTokenFromRequest` (grant holder). Writes `content_elements.staging_content` and
    a `staging_history` row.
  - `POST /api/staging/publish` (`route.ts:32-150`) — the go-live path, calls the
    `publish_staging_content_atomic(p_site_id, p_element_ids, p_published_by, p_user_email)` RPC
    (`supabase/migrations/20260803020000_restore_atomic_publish.sql:35-94`), which writes
    `content_elements.published_content`/`published_by` and inserts into `content_history`.
  - Both routes resolve identity through `src/lib/auth/editor-access.ts`, which models exactly two
    `EditorAccess` kinds — `"staging"` (email-verified, no account) and `"edit-session"`
    (account holder's own browser session) — neither of which is a third "grant holder with a
    real account" case.
- **`src/app/api/sites/register/route.ts`** exists (not read line-by-line here) as the natural
  hook for milestone 2. No app-level signup/confirmation route exists — `src/app/api/auth/`
  contains only `logout`, `profile`, `session`; account confirmation is entirely Supabase Auth
  (GoTrue), with no app route to instrument.

---

## Anchor points

- `docs/stories.md:170` — s02 AC8: *"State and transition timestamps are readable via the sites
  API, so `s03` can consume them."* This story should **consume** s02's install-state timestamp
  for milestone 3, not re-derive "verified install" itself. s02 is not yet built; this is a real
  cross-story dependency, not just a listed one.
- `docs/stories.md:179-182` — s02's own agentic notes independently confirm the widget never calls
  `analytics/track`, corroborating Fact 3 above from a second angle.
- `src/app/api/staging/content/[siteId]/route.ts:246-256` and
  `src/app/api/staging/publish/route.ts:110-119` — the two candidate hook points for milestone 4;
  the story does not say which one is "the" first edit (see Open questions).
- `src/app/dashboard/analytics/page.tsx` + `AnalyticsDashboard.tsx:408-518` — where AC7's funnel
  view would be added; existing `Tabs`/`TabsList`/`TabsTrigger` pattern from `@/components/ui/tabs`
  is the composition point, per the repo's "compose from `src/components/ui/`" rule.
- `supabase/migrations/20260809120000_lock_down_definer_functions.sql:89-121` — the `REVOKE ALL`
  then explicit `GRANT EXECUTE` pattern every new `SECURITY DEFINER` function must follow if this
  story adds an RPC (e.g. an atomic write-once milestone writer or a percentile function).
- `src/lib/security/site-auth.ts` / ADR 002 (`docs/decisions/002-rls-tenant-boundary.md`) — the
  authorization pattern (explicit `authorizeSiteRequest`/`authorizeFirstPartySiteRequest` before
  any service-role data access) that a new milestone-write path must follow.

---

## Verified APIs / functions

- `AnalyticsTracker.trackActivity(params): Promise<void>` — `tracker.ts:94-121`, writes
  `user_activity_logs`.
- `AnalyticsTracker.getDashboardData(siteId?, dateRange?, ownerUserId?): Promise<AnalyticsDashboardData>`
  — `tracker.ts:172-298`, scoped via `resolveScopedSiteIds` (`tracker.ts:62-89`) against
  `site_permissions`.
- `authorizeIngestRequest(request, siteId): Promise<IngestAuthResult>` — `ingest-auth.ts:50-106`;
  returns `{ ok: true, mode: "site-token" }` (no `userId`) or `{ ok: true, mode: "session", userId }`.
- `authorizeFirstPartyEditorAccess(siteId, required): Promise<EditorAccess | null>` —
  `editor-access.ts:118-164`; always sets `userId` (it requires a Supabase session).
- `validateEditorTokenFromRequest({ request, siteId, body }): Promise<EditorAccessValidation>` —
  `editor-access.ts:330-360`; dispatches to `validateStagingEditorAccess` (no `userId`, ever) or
  `validateEditSessionAccess` (`userId` from `edit_sessions.user_id`, which is only ever populated
  by an account holder creating their own session — `edit-sessions.ts:59-75` requires an existing
  `site_permissions` row for that same `userId`).
- `publish_staging_content_atomic(p_site_id, p_element_ids, p_published_by, p_user_email)` — SQL
  function, `supabase/migrations/20260803020000_restore_atomic_publish.sql:35-94`; `p_published_by`
  is nullable UUID, populated from `EditorAccess.userId` when present (owner) or `null` (grant
  holder), exactly mirroring the `staging_history` attribution gap.

---

## Traps & constraints

- **The dead `content_edit` ingest path** (Fact 3). Do not instrument milestone 4 by watching
  `user_activity_logs`/`analytics/track` — nothing writes that row today. The real signal is a
  `staging_history` insert (draft-level "first edit") or a `content_history`/`published_by` write
  (publish-level "first edit"); see Open Question 1.
- **Non-account attribution requires a join, not a column** (Facts 4-5). Any milestone-writer or
  read-model query attributing a grant-holder edit to an account must join
  `staging_history.content_element_id → content_elements.site_id → site_permissions (role='admin')`.
  There is no shortcut column anywhere on the write path today.
- **No natural hook for milestone 1 ("account confirmed").** Supabase Auth (GoTrue) owns signup
  and confirmation entirely; `src/app/api/auth/` has no signup/confirm route to instrument. This
  will likely need either a Postgres trigger on `auth.users` (a different mechanism than every
  other route-based pattern in this codebase) or a "first authenticated dashboard visit" proxy —
  neither is free, and the story does not choose one.
- **Write-once + duplicate-event replay test** (AC4) has no existing precedent in this codebase to
  copy from — checked, no other table in the 43 migrations implements a "write once, never
  overwrite" timestamp constraint. Needs either a DB-level guard (e.g. an `UPDATE` trigger that
  rejects overwriting a non-null column, safer against concurrent writers since the write paths
  use the service-role client which bypasses RLS) or an application-level `WHERE column IS NULL`
  guard on the `UPDATE`/`UPSERT` — the latter is race-prone under concurrent requests unless paired
  with a unique constraint or `ON CONFLICT DO NOTHING` semantics.
- **`SECURITY DEFINER` lockdown precedent** (`20260809120000_lock_down_definer_functions.sql`) —
  any new RPC this story adds must ship its own `REVOKE ALL` + explicit `GRANT EXECUTE`, matching
  the pattern used for `publish_staging_content_atomic` and others. Two migrations already exist
  solely to retrofit this; do not add a tenth.
- **Backfill/`unmeasurable` marking is a one-time, forward-only migration decision** (AC5) — the
  cutoff (which accounts "predate this story") must be a fixed value baked into the migration, not
  a runtime comparison against "now," or every account will eventually be marked unmeasurable
  retroactively as the deploy date recedes. See Open Question 3.
- **Existing tests must not regress.** `src/__tests__/analytics/tracker.test.ts` exercises
  `trackActivity`/`content_edit` action-type behavior; cleaning the two dead locals in `tracker.ts`
  (an explicit ask in the story's agentic notes) must not change `getDashboardData`'s observable
  return shape.
- **Consumer contract.** `s14` and `s15` are stated (both in `stories.md` and in the stories-review's
  "m7 — closed" disposition) to read `account_milestones` directly rather than re-aggregating. This
  story's table/column shape is therefore a public contract for two not-yet-planned stories — changing
  it later is not free. Keep the schema narrow and additive, as the story's own notes already say.

---

## Open questions

1. **Which event is "first persisted content update" (AC1)?** The first `staging_history` insert
   (a draft save, `PUT /api/staging/content/[siteId]`) or the first publish
   (`POST /api/staging/publish` → `publish_staging_content_atomic`)? Both are "an edit" in the
   product's language; the PRD's "time-to-first-edit" framing leans toward the draft save (the
   moment someone actually typed and saved something), but the story does not say, and the two
   routes have different attribution shapes (`staging_history.user_email`/`staging_access_id` vs.
   `p_published_by`/`p_user_email` on publish). This materially changes which route gets
   instrumented.
2. **How is milestone 1 ("account confirmed") triggered**, given no app-level signup/confirm route
   exists to hook into? A Postgres trigger on `auth.users` is the only mechanism seen elsewhere in
   this codebase's problem space that would not require polling; not currently used anywhere in
   the 43 migrations, so there's no existing pattern to follow.
3. **What is the exact cutoff for "predates this story" (AC5)?** Needs a concrete timestamp
   (migration-run date, story-branch date, or PRD date) fixed at migration-write time, not derived
   at query time.
4. **Does AC6's "non-account grant holders" scope include the `"edit-session"` `EditorAccess`
   kind, or only `"staging"`?** Today `"edit-session"` access is only ever self-issued by an
   account holder (Fact 4), so in the current code the two are equivalent in practice — but the
   plan should say explicitly which `EditorAccess.kind` value gates the "non-account edit" counter,
   so a future change to `edit-session` issuance doesn't silently break the count.
5. **Where does p50/p90 computation run** — a new SQL function (subject to the `SECURITY DEFINER`
   lockdown pattern) or in-route JS over a bounded row set? Not specified by the story; both are
   viable, but the choice affects whether this story adds a tenth REVOKE/GRANT pair.

---

## Real complexity

**Re-scored: 4** (story states 3).

The story's own framing — "read models and event plumbing over existing data" — undercounts the
actual shape of the work once the code is read:

- A new table + a write-once constraint with no precedent to copy in 43 existing migrations
  (schema risk, not just plumbing).
- Four *separate* instrumentation points spread across three different subsystems with three
  different mechanisms: Supabase Auth (no app route — likely a DB trigger, a mechanism unused
  elsewhere in this codebase), the sites-register route, a not-yet-built s02 API surface (external
  dependency on another story), and the staging content/publish path (which itself requires the
  non-trivial `staging_history → content_elements → site_permissions` ownership join to get right).
- A backfill/migration decision (`unmeasurable` cutoff) that is easy to get subtly wrong (see Open
  Question 3) and cannot be corrected by a later migration without breaking the write-once
  guarantee.
- Two statistic queries (p50/p90 over an arbitrary range, step-to-step drop-off) plus new dashboard
  UI (AC7).
- A public data contract two other stories (`s14`, `s15`) already commit to consuming as-is.

None of this reaches a single "5"-grade axis on the PRD's own scale (`prd.md:129`: real-time,
migrations, external systems) — there is no real-time component and no third-party integration,
and while there is a migration, it is the same class of "new table" migration several existing
4-scored stories already carry. But the combination — schema + three-subsystem instrumentation +
a genuine cross-table ownership join + a one-shot backfill decision + being a locked contract for
two future stories — is materially more than a 3. It matches the review's own bar that every 4
"carries an explicit Risk paragraph"; this story should get one, with the risk being: **the
content-update milestone is instrumented against the wrong write path** (the dead `analytics/track`
ingest route instead of the live `staging_history`/`content_history` write path), which would ship
a funnel that silently reports zero or near-zero edits forever — the exact "unfalsifiable
activation claim" failure mode the story exists to close.

## Split proposal

Not applicable — rescored to 4, not 5. No split required.
