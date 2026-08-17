---
validated: yes
---
# Plan — Story s03-activation-funnel

Branch: `feature/s03-activation-funnel`
Research: `docs/research/s03-activation-funnel.md` — read it first; this plan does not repeat it.

## Target story

**s03-activation-funnel — measure time-to-first-edit** (`docs/stories.md:305-341`).

As the operator of RecopyFast, instrument the signup → first-edit funnel so the PRD's primary
success metric (time-to-first-edit < 5 min) is falsifiable instead of assumed.

Acceptance criteria:
- [ ] AC1 — Four timestamps persist per account: account confirmed, first site registered,
  first verified install, first persisted content update.
- [ ] AC2 — Time-to-first-edit is queryable as p50 and p90 over an arbitrary date range.
- [ ] AC3 — Step-to-step drop-off is queryable: how many accounts reached each of the four
  steps.
- [ ] AC4 — Each timestamp is written exactly once per account and is never overwritten by a
  later event, asserted by a test that replays a duplicate event.
- [ ] AC5 — Accounts that predate this story are marked `unmeasurable` and excluded from
  p50/p90, asserted by a test that an unmeasurable account contributes to no percentile.
- [ ] AC6 — Edits by non-account grant holders are attributed to the site's owning account,
  and separately countable as non-account edits.
- [ ] AC7 — The funnel is readable at `/dashboard/analytics` without running SQL by hand.
- [ ] AC8 — `account_milestones` is the single source for account-level edit activity; `s14`
  and `s15` read from it (and from the attribution helper this story exports) rather than
  re-aggregating the activity log.

Complexity: 4 (re-scored at research from 3). Dependencies: `s01-trial-signup`,
`s02-install-verified` — see Task 5 and "The point everything turns on" for how this plan
handles `s02` not yet being built.

## Tasks (ordered)

1. **Migration — `account_milestones` schema.** New file
   `supabase/migrations/<ts>_account_milestones.sql`: table
   (`account_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`,
   `account_confirmed_at`, `first_site_registered_at`, `first_verified_install_at`,
   `first_persisted_content_update_at` — all `timestamptz`, nullable,
   `unmeasurable boolean NOT NULL DEFAULT false`, `created_at timestamptz NOT NULL DEFAULT
   now()`); RLS shaped like `checkout_reservations`
   (`supabase/migrations/20260813130000_checkout_reservations.sql`) — `authenticated` may
   `SELECT` its own row only, `service_role` holds `ALL`, no write grant to `authenticated`;
   a `BEFORE UPDATE` trigger (`account_milestones_preserve_once`) that clamps any of the four
   timestamp columns back to `OLD` when already non-null (see ADR 006); a one-time backfill
   marking every account with `auth.users.created_at` before a literal cutoff constant
   (this migration's authored date, written as an explicit ISO literal in the migration, not
   derived from `now()`) as `unmeasurable = true`.
   **Verify:** `src/__tests__/db/account-milestones.test.ts` (new, `describeDb` harness) —
   schema exists with the five expected columns; the `BEFORE UPDATE` trigger preserves a
   first-written value across a second `UPDATE` with a different timestamp (the DB-level half
   of AC4); an `authenticated`-role client can `SELECT` its own row and not another account's.

2. **Migration — capture milestone 1 from `auth.users`.** New file
   `supabase/migrations/<ts+1>_account_milestones_confirm_trigger.sql`: a
   `SECURITY DEFINER` function `capture_account_confirmed()` plus
   `AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW WHEN
   (NEW.email_confirmed_at IS NOT NULL)`, upserting
   `(NEW.id, NEW.email_confirmed_at)` into `account_milestones`. Explicit `REVOKE`/`GRANT`
   on the function following the `20260809120000_lock_down_definer_functions.sql` pattern
   (no `PUBLIC`/`anon`/`authenticated` EXECUTE). Extend
   `src/__tests__/db/db-harness.ts` with a `createAccount` helper (inserts a minimal
   `auth.users` row, tracks it for `afterAll` cleanup — cascades into `account_milestones` via
   the FK) alongside the existing `createSite`.
   **Verify:** `src/__tests__/db/account-milestones-confirm-trigger.test.ts` (new) — inserting
   an unconfirmed account writes no `account_milestones` row; updating `email_confirmed_at`
   from `NULL` to a timestamp writes exactly that timestamp; inserting an account with
   `email_confirmed_at` already set (the OAuth path) also captures it, on `INSERT` rather than
   `UPDATE` — both paths named explicitly in ADR 006's "Watch."

3. **Shared write helper.** New `src/lib/analytics/account-milestones.ts` — exports the
   `MilestoneColumn` union (`first_site_registered_at" | "first_verified_install_at" |
   "first_persisted_content_update_at"` — milestone 1 is DB-only, never called from here) and
   `recordAccountMilestone(accountId: string, milestone: MilestoneColumn, at?: Date):
   Promise<void>`, wrapping a single `.upsert({ account_id, [milestone]: at }, { onConflict:
   "account_id" })` on the service-role client. One place the column-name mapping lives, used
   by every app-level call site.
   **Verify:** unit test with a mocked Supabase client asserting the upsert payload shape and
   `onConflict` target for each milestone.

4. **Wire milestones 2 and 4 into their existing write paths**, using Task 3's helper.
   - `src/app/api/sites/register/route.ts`: after the `site_permissions` insert succeeds,
     call `recordAccountMilestone(user.id, "first_site_registered_at")`.
   - `src/app/api/staging/content/[siteId]/route.ts` `PUT`: after the `staging_history`
     insert succeeds, resolve the owning account(s) via
     `site_permissions WHERE site_id = :siteId AND permission = 'admin'` (the site id is
     already in scope — no need to go through `content_elements`) and call
     `recordAccountMilestone(ownerId, "first_persisted_content_update_at")` for each admin
     row (handles the rare multi-admin site without extra branching).
   **Verify:** integration test on `sites/register` asserting the milestone lands on first
   registration; integration test on the staging PUT route asserting the milestone lands on
   the first save and is **not** changed by a second save with a later timestamp — the
   application-layer half of AC4's duplicate-replay requirement, alongside Task 1's DB-level
   version.

5. **Milestone 3 (first verified install) — contract, not a guess.** Per research, `s02`
   ("state and transition timestamps are readable via the sites API, so `s03` can consume
   them" — `docs/stories.md` s02 AC8) is a declared dependency and is **not yet planned or
   built** in this repo (`docs/plans/s02-install-verified.md` does not exist). This task does
   not re-derive "verified install" from a proxy signal (that would duplicate `s02`'s
   ownership and risk disagreeing with it). At execution time:
   - If `docs/plans/s02-install-verified.md` exists and `s02`'s live-transition code path is
     shipped: wire `recordAccountMilestone(ownerId, "first_verified_install_at")` at that
     transition point, reading whichever column/API `s02` actually added (do not assume a
     name from this plan).
   - If not: stop, make no code change for this task, and record in the PR description that
     milestone 3 is unwired pending `s02`, per the Run interdicts below.
   **Verify (conditional):** if wired, an integration test at `s02`'s transition point
   asserting the milestone fires once, on the exact same shape as Task 4's tests.

6. **Shared edit-attribution helper**, for AC6 and for `s14`/`s15` reuse (AC8). New
   `src/lib/analytics/edit-attribution.ts` — a function that, given a site id or a date range,
   joins `staging_history.content_element_id → content_elements.site_id → site_permissions
   (permission = 'admin')` to resolve the owning account per row, and splits counts into
   account-holder edits vs. non-account edits using `staging_history.staging_access_id IS NOT
   NULL` as the discriminator (confirmed in research: this column is already set exactly when
   the edit came through a `staging` `EditorAccess`, i.e. a non-account grant holder — see
   `docs/research/s03-activation-funnel.md` Fact 4). Exported so `s14`/`s15` import this
   instead of re-deriving the same join independently (AC8).
   **Verify:** integration test seeding `staging_history` rows of both kinds against a
   fixture site and asserting the split counts and the resolved owning account are correct;
   a second fixture with two `admin` rows on one site asserts edits attribute to both owners.

7. **`GET /api/analytics/activation-funnel` route.** New file
   `src/app/api/analytics/activation-funnel/route.ts` — admin-gated using the existing
   `ADMIN_EMAILS` env allowlist / `app_metadata.role === "admin"` pattern from
   `src/app/api/audit/logs/route.ts:41-48` (this view spans every account; no
   `site_permissions` check can gate it). Validates `from`/`to` query params (extend
   `src/lib/api/validation.ts` with a small ISO-date validator rather than parsing inline, per
   ADR 003). Reads `account_milestones` rows whose `account_confirmed_at` falls in range,
   computes: per-step counts and drop-off (all four columns, `unmeasurable` rows **included**
   here — they did reach each step, only their *duration* is unmeasurable); p50/p90 minutes
   from `account_confirmed_at` to `first_persisted_content_update_at`, computed **only** over
   rows where `unmeasurable = false` and both endpoints are non-null; non-account edit share
   via Task 6's helper; the `unmeasurable` cohort count as its own figure.
   **Verify:** non-admin session gets 403; admin session against a seeded fixture gets correct
   funnel counts, correct drop-off, correct p50/p90 arithmetic, and — the AC5-required test —
   a fixture account with `unmeasurable = true` and both timestamps set is asserted to
   contribute to the funnel's step counts but to **neither** the p50 nor the p90 figure.

8. **Dashboard UI — Activation tab.** New `src/components/dashboard/ActivationFunnelPanel.tsx`
   composed from `SectionHeader`, `Card` (`variant="outline" padding="sm"`, four step tiles),
   `Metric` (p50, p90, non-account share, unmeasurable count), `IconTile`, `Badge`
   (attribution-bar legend), `Alert variant="destructive"` (error), `EmptyState`, `Skeleton`
   (step-card loading shape), two `Input type="date"` + `Button variant="outline" size="sm"`
   for the range — exactly `docs/designs/s03-activation-funnel.md`'s component table, no new
   primitive. Wired into `src/components/dashboard/AnalyticsDashboard.tsx` as a fourth
   `TabsTrigger value="activation"` alongside the existing three. The tab (and the panel's own
   fetch) checks the same admin gate as Task 7's route client-side and renders nothing
   (or a plain "not available" message, never a broken fetch) for a non-admin session.
   **Verify:** RTL component tests for loading / empty / error / success states per
   `docs/design-system.md`'s "every data view needs all four" rule, and a test that a
   non-admin session does not render the tab's data-fetching path.

9. **Clean the two dead locals in `src/lib/analytics/tracker.ts`** while in this file's
   neighborhood — `siteAnalytics` (destructured at `:222`, never read again) and the unused
   `date` parameter on `updateSiteAnalytics` (`:390-391`) — without changing
   `getDashboardData`'s observable return shape.
   **Verify:** `src/__tests__/analytics/tracker.test.ts` passes unchanged; `npm run lint`
   reports no unused-variable warning for either.

## Run interdicts

- `src/app/api/analytics/track/route.ts` diff stays empty — the funnel is a new, separate
  route; this story does not touch the existing per-tenant ingest/dashboard endpoint.
- `src/__tests__/db/function-grants.test.ts` passes unchanged — this story adds no
  PostgREST-reachable RPC function; if a reviewer sees a new row in that suite's allowlist,
  something went off-plan.
- `src/__tests__/analytics/tracker.test.ts` passes unchanged — Task 9 is cleanup only.
- No `zod` import anywhere in the diff (ADR 003); date-range validation extends
  `src/lib/api/validation.ts`.
- The existing three tabs in `AnalyticsDashboard.tsx` (Trends / Top Sites / Performance) and
  their data contract are untouched — only a fourth tab is added.
- Both new migrations are new files ordered after `20260813140000_site_permissions_delete_per_row.sql`;
  neither edits an applied migration.
- Task 5 does not fabricate a proxy signal for "verified install" (e.g. deriving it from
  `content_elements` row counts) if `s02` has not shipped by execution time — it stays a
  documented no-op instead.
- The Activation tab and `GET /api/analytics/activation-funnel` are reachable only via the
  `ADMIN_EMAILS` / `app_metadata.role === "admin"` gate — no `site_permissions`-based check
  substitutes for it anywhere in the diff.

## The point everything turns on

The plan stands on **one write-once mechanism enforced at the table** (ADR 006) rather than
at each caller: a `BEFORE UPDATE` trigger on `account_milestones` clamps every column back to
its first-written value, so all three (eventually four) writers — the `auth.users` trigger,
the two app-level call sites, and `s02`'s future call — inherit "exactly once" without having
to individually implement it.

Three places this could be wrong:

1. **Which event is "first persisted content update" (AC1).** This plan chooses the draft
   save (`PUT /api/staging/content/[siteId]`) over the publish
   (`POST /api/staging/publish`), on the reading that the PRD's "time-to-first-edit" is about
   the act of editing, not the separate, optional act of going live — many accounts may never
   click Publish during onboarding, and waiting for it would systematically inflate the
   funnel's headline number. If a reviewer reads "edit" in the PRD's activation sense as "went
   live," Task 4's second bullet moves to the publish route instead — a small, mechanical
   change to one call site, not a schema change.
2. **Milestone 3 is deliberately left unwired pending `s02` (Task 5).** This bets that `s02`
   lands, with a queryable install-state timestamp, before this story is actually executed —
   consistent with the dependency graph in `docs/stories.md`, but not true of this repository
   today (no `docs/plans/s02-install-verified.md` exists). If `s02` ships a different shape
   than a timestamp (e.g. a boolean with no "when"), Task 5 needs to be redone against
   whatever `s02` actually ships, not against this plan's assumption — check the real `s02`
   plan and code before starting Task 5, not this paragraph.
3. **The Activation tab is gated operator-only**, reusing the `ADMIN_EMAILS` pattern from
   `src/app/api/audit/logs/route.ts`, even though it lives on `/dashboard/analytics`, a page
   every signed-in customer can already reach. The story's own framing ("As the operator of
   RecopyFast") supports this, but a narrower reading — a site owner may see their *own*
   account's four timestamps, since that is not obviously sensitive to its own subject — is
   legitimate and would only loosen Task 7/8's check from "admin" to "admin OR the caller's
   own `account_id`," not remove it.

## Files touched

- `supabase/migrations/<ts>_account_milestones.sql` (new)
- `supabase/migrations/<ts+1>_account_milestones_confirm_trigger.sql` (new)
- `src/__tests__/db/account-milestones.test.ts` (new)
- `src/__tests__/db/account-milestones-confirm-trigger.test.ts` (new)
- `src/__tests__/db/db-harness.ts` (extend: `createAccount` helper)
- `src/lib/analytics/account-milestones.ts` (new)
- `src/lib/analytics/edit-attribution.ts` (new)
- `src/app/api/sites/register/route.ts` (wire milestone 2)
- `src/app/api/staging/content/[siteId]/route.ts` (wire milestone 4)
- `src/app/api/analytics/activation-funnel/route.ts` (new)
- `src/lib/api/validation.ts` (extend: ISO-date validator)
- `src/components/dashboard/ActivationFunnelPanel.tsx` (new)
- `src/components/dashboard/AnalyticsDashboard.tsx` (add fourth tab)
- `src/lib/analytics/tracker.ts` (dead-code cleanup only)
- `docs/decisions/007-account-milestones-write-once.md` (new, already written)
- Corresponding `__tests__` files for every new/changed route, lib module and component above.

## Test strategy

- **DB invariants** (`src/__tests__/db/`, `describeDb` harness, gated when no local Supabase
  is reachable): schema shape, the write-once `BEFORE UPDATE` trigger, RLS on
  `account_milestones`, and the `auth.users` capture trigger's `INSERT`/`UPDATE` paths.
- **Unit tests**: `recordAccountMilestone()` and the edit-attribution helper against a mocked
  Supabase client.
- **Integration tests**: milestone writes at `sites/register` and `staging/content/[siteId]`,
  each asserting write-once at the application layer (mirrors the DB-level assertion — both
  are required because a route could theoretically call the helper twice with different
  payloads and the DB trigger is the actual backstop, but the route test proves the call
  sites behave correctly under normal traffic); the funnel route's admin gate, funnel math,
  and the AC5 unmeasurable-excluded-from-percentile assertion.
- **Component tests** (RTL): the Activation tab's four states (loading/empty/error/success)
  and the non-admin hide path.
- **Regression, unchanged**: `src/__tests__/analytics/tracker.test.ts`,
  `src/__tests__/db/function-grants.test.ts`, `src/__tests__/lib/security/site-auth-origin.test.ts`.

## Definition of Done

- `lint`, `type-check`, `format:check`, `build`, `test` all green.
- `npx supabase start && npx jest src/__tests__/db` run at least once against a real local
  Postgres so the two new migrations' triggers and RLS are actually exercised, not left as a
  gated skip.
- `npm run build:embed -- --check` unaffected — this story touches no embed source, so the
  artifact must remain in sync with no rebuild needed.
- All eight acceptance criteria individually verified against a passing test, including the
  two that name a specific test explicitly (AC4's duplicate-replay, AC5's
  unmeasurable-excluded-from-percentile) — not merely implied by other coverage.
- Milestone 3 (Task 5) is either genuinely wired against shipped `s02` code, or explicitly
  documented as unwired-pending-`s02` in the PR description — never silently absent.
- ADR 006 lands on the branch.
- Review passed, no open critical issue; deployed per the repo's manual ship strategy.
