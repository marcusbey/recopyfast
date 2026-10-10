# Review — s35-activation-checklist (re-review after fix)

Reviewed commit: `6481a2dd5657a9735c50b3d63173d1d3d20752b8` (draft PR #33)
Fix diff: `git diff e361c35..6481a2d` (13 source/test files, 4 story docs)
Story diff: `git diff origin/main...HEAD`, where `origin/main` is `c3b2b28`
Date: 25 September 2026

## Scope and verdict

This is a fresh-context `/ks-review` re-review. The first review of `e361c35` allowed ship with
four majors and eight minors. This pass checks each prior finding against the fix commit. It
also re-runs the prior mutations and reviews the whole story diff again against:
- the plan, including the operator-prevalidated fix scope F1–F12
- the research and design
- AGENTS.md
- ADRs 002, 005, 006, 007 and 027

**Ship allowed. All four majors are resolved.** No finding remains above minor.
- **ADR 002.** The route now reads only through the signed-in user's RLS client.
- **IDOR guard.** Every prior IDOR-shaped mutation now turns a test red.
- **"Live" state.** It now requires an editor who can publish, and its copy states only what
  the data proves.
- **Invite dialog.** It survives both completion and refresh errors.

What remains:
- Guards that no test catches. The worst is a dismissal assertion that the fix itself made
  vacuous.
- Small a11y and UX gaps.
- One rate-limit ordering trade-off.

## Prior findings → status

| # | Prior finding (severity) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | ADR 002: service-role reads on a signed-in route (major) | **Resolved** | `route.ts:4` imports only `createClient`. All reads use that client (`:96-118`). The RLS path is verified below. |
| 2 | IDOR guard untested (major) | **Resolved** | The filter-aware fake is at `route.test.ts:109-198`. M6b, M6, M5 and M7 are now red (1, 18, 9 and 1 tests). |
| 3 | "Live" claims more than the data proves (major) | **Resolved** | See the notes below this table. |
| 4 | Invite dialog unmounts with its delivery feedback (major) | **Resolved** | See the notes below this table. The invite→refetch wiring is still untested (finding N3). |
| 5 | "Install detected" means current liveness (minor) | **Resolved, no migration** | `installed` is `status === "live" \|\| typeof live_at === "string"` (`route.ts:145-147`). Both columns already exist (`20260817001000_sites_install_status.sql:27-28`), so the milestone lives on `sites` and the story adds 0 migrations. M11 is red. M12 survives (N5). |
| 6 | Token copy overstates domain binding (minor) | **Resolved** | `SiteDetailView.tsx:405-409` now says "checks it against the requesting page's origin and accepts browser requests only when it matches your registered domain". That is accurate. D3 is red. |
| 7 | More guards no test catches (minor) | **Resolved, with one new regression** | H3, H4, D1 and D2 are now red. The vacuous assertion in `page.activation.test.tsx` was replaced (`:64-68`). A new vacuous assertion was introduced, see N1. |
| 8 | Overview request volume (minor) | **Resolved / deferred as planned** | See the notes below this table. |
| 9 | Accessibility and wording (minor) | **Mostly resolved** | See the notes below this table. Residual gaps are in N9. |
| 10 | Story docs stale (minor) | **Resolved** | `stories.md`, plan `:29-57` and research `:25-33` now state the real delivery. One residual item is in N10. |
| 11 | `refresh` vs `refetch` (minor) | **Resolved** | The hook returns `refetch` (`useSiteActivation.ts:43,192`). No `refresh` consumer remains. |
| 12 | Unplanned `SiteDetailView` key (minor) | **Resolved** | `sites/page.tsx` now only passes `userId={user?.id}`, and the page-level key is gone. The identity key sits on the checklist element instead (`SiteDetailView.tsx:304-313`). That is planned isolation. S1 is red. |

Notes on the rows above:

- **Row 3 ("Live" state).**
  - Step 2 now counts only an active editor with `publish` or `admin` in `permissions`
    (`route.ts:110`). This matches `normalizePermissions` (`lib/auth/editor-access.ts:86-90`),
    where `admin` implies `publish`.
  - The Live copy (`ActivationChecklist.tsx:254-257`) reads: "Site installed, an active invited
    editor has Publish permission, and an edit has been published".
  - The checklist dialog preselects Publish (`:349`).
  - Mutations: M8 (2 red), M9, C8, C7 (2 red) and E3.
- **Row 4 (invite dialog).**
  - The Dialog now sits outside every state branch (`ActivationChecklist.tsx:323-355`).
  - On close, focus returns to the trigger, or to the region when the trigger is gone
    (`:329-337`).
  - A revoke triggers a refetch (`SiteEditorsCard.tsx:359`).
  - Mutations: C4 (2 red), C5 and E1.
- **Row 8 (request volume).**
  - The hook polls every 60 s (`useSiteActivation.ts:17`), with one tab-return trigger through
    `visibilitychange` only (`:129-140`).
  - The limiter is per user and site: `${userId}:${siteId}` (`route.ts:56-62`).
  - Batching is explicitly deferred (plan `:37`, research `:31`).
  - Mutations: H5, H6 (4 red) and H7.
- **Row 9 (accessibility).**
  - Each incomplete row now shows "Not yet" (`:309-311`).
  - The heading is "Get {site} publishing" (`:267-269`).
  - The error title names the site (`:234-236`), and the buttons carry the site in their labels.
  - C9 is red.

### Step 3 definition against the copy

Step 3 is "any `staging_history.action = 'publish'` row joined to this site's
`content_elements`" (`route.ts:112-117`). An owner's own publish from "Open site in edit mode"
counts. The step label is "An edit published" (`:186`), and the Live copy never says the invited
editor made that publish.

This matches the plan (`:27`, "It does not attribute the publish to an invited editor"), the
design (`:16`) and the research (`:27`). The copy is truthful.

### The RLS path

I checked this against the migrations, not against a live database.

- **Admin gate.** Users can read their own `site_permissions` rows:
  `USING (user_id = auth.uid())` (`20260804130000_restore_missing_rls_policies.sql:71-74`).
  - `UNIQUE(user_id, site_id)` (`20250817000000_complete_database_setup.sql:58`) keeps
    `.maybeSingle()` safe.
  - Only an `admin` row passes (`route.ts:72`).
- **`sites`.** "Users can view sites they have permission to", for any permission level
  (`20250817000000:443-450`).
  - `status` and `live_at` inherit the table grants (`20260817001000:20-24`).
  - `api_key` is not selected.
- **`site_editors`.** Admins can read it: `user_has_site_permission(site_id, ARRAY['admin'])`
  (`20260818000000_repair_aborted_migrations.sql:1277-1282`). The helper is at `:328-344`, and
  the `authenticated` SELECT grant at `:1599`.
  - `permissions` is `TEXT[]` (`20260801100000_editor_access_2fa.sql:54`), so PostgREST's `ov`
    operator applies.
- **`staging_history`.** Admins can read it through `content_elements` joined with
  `site_permissions` where `permission = 'admin'` (`20251230000000_staging_workflow.sql:144-153`).
  The `authenticated` SELECT grant is kept (`20260818010000:66-74`).
  - The `content_elements!inner` embed is allowed by its SELECT policy (`20250817000000:452-459`).
- **Non-admins are refused:**
  - A `view` or `edit` collaborator gets **403** (M3 is red).
  - A signed-in user with no row on the site gets **403**.
  - A `site_editors` editor gets **401**: editors never hold a Supabase session
    (`20260818000000:1270-1272`).
  - Team-only grants (`user_id` NULL) get 403. `/api/sites` also only mints install credentials
    from `user_id` rows (`api/sites/route.ts:25-28,169-170`), so no checklist mounts for them.
    The two routes are consistent.
- **Defence in depth.** Suppose the admin gate regressed:
  - A `view` user would get empty `site_editors` and `staging_history` reads (both policies are
    admin-only).
  - A stranger's `sites` read would return no row, so the route answers 500.
  - Neither case leaks another tenant's facts.

## Verification performed

- **Targeted suites.** I ran the 7 story suites through the CI-placeholder wrapper (exact `ci`
  job values from `.github/workflows/ci.yml`; no dotenv file in the worktree). Result:
  **7/7 suites, 123/123 tests passed.**
- **Full Jest.** Same wrapper, run as `--ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`:
  - Suites: **239 total, 237 passed, 2 skipped, 0 failed.**
  - Tests: **3183 total, 3145 passed, 38 skipped, 0 failed.**
  - This matches the plan's claim (`:50`).
  - The DB-backed suites (`src/__tests__/db/*`) are not registered under the placeholders.
- **Lint and format.**
  - `eslint` on the 13 changed `src/` files: 0 errors, 1 inherited warning
    (`sites/__tests__/page.test.tsx:125`).
  - `prettier --check`: all files formatted.
- **CI.** `gh pr checks 33`: every check passes. Runs `36126400595` and `36126400811` both report
  `headSha 6481a2d`. The passing checks are:
  - Lint, Test & Build
  - TypeScript Type-Check incl. tests
  - E2E (Playwright)
  - Realtime server production audit
  - Vercel

  The PR is draft, open and `MERGEABLE`. I did not run `build`, the embed check or `audit:prod`
  locally. I rely on CI for those.
- **References checked:**
  - `enforceRateLimit` options `identifier`, `identifierType: "user"` and `onStoreFailure`
    (`lib/api/rate-limit.ts:38-57,91`)
  - the `IP_GENERAL` preset (`lib/security/rate-limiter.ts:434`)
  - `PostgrestFilterBuilder.overlaps(column, value[])` (postgrest-js `.d.ts:68-69`)
  - `requireUuid`
  - `normalizePermissions`
  - `CardTitle`, which renders `h3` (`ui/card.tsx:93-97`)
  - `Alert`, which has `role="alert"` (`ui/alert.tsx:34`)
- **Plan versus diff.** F1–F12 each map to code and tests.
  - Nothing in the fix diff falls outside the operator fix scope.
  - The revoke refetch and `InviteEditorForm` `autoFocus`/`initialPermissions` are both covered
    by F4 and the design (`:12`).
  - There is no migration, no embed change and no new dependency.

### Mutation proof

I ran 48 mutations, one at a time, through a scripted runner. For each one I checked that the
edit applied (non-empty `git diff`), ran the owning suite(s), restored the file with
`git checkout`, and confirmed `git diff --exit-code` on that file.

The final `git status` shows only this review file. **43 were killed and 5 survived.**

| Area | Mutations (red tests) | Survived |
| --- | --- | --- |
| Route (16) | M6b permission lookup drops site scope (1) · M6 `site_id`←`userId` (18) · M5 `sites` read by wrong id (9) · M7 any site's dismissal (1) · M1 drop `revoked_at` (1) · M3 any permission passes (1) · M4 drop `action=publish` (1) · M8 drop publish `overlaps` (2) · M9 `publish` only, not `admin` (1) · M10 drop publish site filter (1) · M11 `status` only (1) · M13 `onStoreFailure: "allow"` (1) · M14 limiter keyed on IP (1) · M15 drop editor site filter (1) · M16 POST writes whole metadata (1) | **M12**: `installed` = `live_at` only (0) |
| Hook (9) | H1 dismissal no longer retires in-flight GET (1) · H2 drop stale-identity guard (2) · H3 poll after completion (1) · H4 start interval while hidden (1) · H4b keep interval when hidden (1) · H5 re-add `focus` refetch (1) · H6 15 s interval (4) · H7 no refetch on return (1) · H8 no cleanup on unmount (2) | — |
| Checklist (11) | C1 drop host check (1) · C3 dismissal beats completion (1) · C4 Dialog inside branches (2) · C5 no region focus fallback (1) · C6 invite does not refetch (2) · C7 no Publish preselect (2) · C8 old Live copy (1) · C9 no "Not yet" (1) · C10 keep `opener` (1) | **C2**: dismissed checklist renders (0) · **C11**: drop protocol check (0) |
| Detail/editors/form/pages (12) | D1 non-admin sees checklist (1) · D2 pre-rotation snippet (1) · D3 old token copy (1) · E1 revoke skips `onEditorChange` (1) · E3 drop `initialPermissions` (1) · F1 global default gains Publish (3) · F3 drop `autoFocus` (1) · P1 overview drops credential filter (1) · P2 overview five-row limit (1) · S1 detail loses `userId` (1) | **E2**: invite skips `onEditorChange` (0) · **F2**: post-invite reset drops Publish (0) |

## Findings (all minor)

**N1. The dismissal test is vacuous again, and the fix caused it.**
- `ActivationChecklist.test.tsx:206-223` asserts
  `queryByText("Get your client publishing")` is absent.
- The fix renamed the heading to "Get {siteName} publishing" (`ActivationChecklist.tsx:268`), so
  that string is never rendered.
- At `e361c35` the heading matched and C2 was killed. Now C2 (render a dismissed incomplete
  checklist) keeps 17/17 green.
- The shipped code is correct (`:262`). Persistent dismissal is a story acceptance criterion
  that the plan says is tested.
- Fix: assert that the region has no heading, for example
  `queryByRole("heading", { name: "Get Client Site publishing" })`.

**N2. The edit-URL protocol guard is untested.**
- C11 removes `url.protocol` checking (`ActivationChecklist.tsx:57`) and nothing fails. The
  `javascript:alert(1)` case is rejected by the host check, because its hostname is `""`.
- `new URL("javascript://client.example.com/%0aalert(1)")` parses with hostname
  `client.example.com`. Checked in Node 20.
- So only `:57` stops a `javascript:` navigation of the pre-opened `about:blank` popup, and that
  popup shares the dashboard's origin.
- The URL comes from the first-party `/api/edit-sessions/create`, so this is defence in depth.
  Add that URL to the unsafe-URL `it.each` (`:442-459`).

**N3. Invite→refetch and the post-invite reset are untested.**
- **E2.** Dropping `onEditorChange?.()` after a successful invite (`SiteEditorsCard.tsx:259`)
  keeps every suite green. `ActivationChecklist.test.tsx` mocks `SiteEditorsCard` entirely, and
  `SiteEditorsCard.test.tsx` asserts the callback only for revoke. F4's "invite itself can
  complete the checklist" depends on this line.
- **F2.** Resetting to `DEFAULT_PERMISSIONS` instead of `initialPermissions` after a successful
  invite (`InviteEditorForm.tsx:81`) also survives. A second invite from the checklist dialog
  would then silently drop Publish.

**N4. Invites and editor lists do not sync between the two editor surfaces on site detail.**
- `SiteDetailView.tsx:337` still renders its own `SiteEditorsCard` without `onEditorChange`.
- Inviting through that card does not refetch the checklist. Step 2 stays "Not yet" until the
  next 60 s poll or a tab return.
- Inviting through the checklist dialog leaves that page card's list stale until remount.
- Fix: pass a refetch bridge, or lift the editors state.

**N5. A site that is `live` with a null `live_at` is untested.**
- M12 (drop `status === "live"`, keep only `live_at`) survives.
- `site-status.ts:75-81` documents that live rows with no usable report date exist after the
  backfill (`20260817001000:68-78` sets `live_at = MIN(created_at)`).
- Add `["live", null, true]` to the `it.each` at `route.test.ts:308-314`.

**N6. The unauthenticated path is now unmetered.**
- The limiter moved after `getUser()` (`route.ts:31-63`), and the "missing session" test pins
  that order (`route.test.ts:266-275`).
- It is still before the admin check, and `regenerate-snippet` does the same.
- However, AGENTS.md `:125` says "Rate limit before authorization… a limiter behind it never
  sees the flood". `sites/register` (`:31`) and `editor/editors` (`:191`) keep a pre-auth
  flood limiter *in addition to* the post-auth one. This route dropped its pre-auth limiter.
- The impact is small: a forged cookie costs one GoTrue call. Consider restoring a generous
  pre-auth IP bucket (fail-open is defensible there) next to the per-user/site one.

**N7. Step 2 does not explain its Publish requirement.**
- An owner who already invited an edit-only client sees "Invite a client — Not yet"
  (`ActivationChecklist.tsx:171-184`), with no reason given.
- Re-inviting the same address with Publish works: an active editor is re-saved without a seat
  charge (`api/editor/editors/route.ts:234-243`). But the checklist never tells the owner to do
  that.
- Suggestion: "Invite a client with Publish permission", or helper text.

**N8. The committed review file is still the one-line placeholder.**
- The branch carries `docs/reviews/s35-activation-checklist.md` = "pending independent review"
  (added in `e361c35`). The real review exists only in the working tree.
- Commit this file before merge, as #30 did for s27, s31 and s33. Otherwise main records a
  placeholder as the review.

**N9. Accessibility residuals.**
- **Label in Name (WCAG 2.5.3).** Three accessible names do not contain their visible label:

  | Visible label | Accessible name |
  | --- | --- |
  | "Open site in edit mode" | "Open {site} in edit mode" (`:191`) |
  | "Try again" | "Try activation again for {site}" (`:242`) |
  | "Dismiss checklist" | "Dismiss activation checklist for {site}" (`:276`) |

  Voice-control users who speak the visible text may miss them. Keep the visible words
  contiguous, for example "Open site in edit mode: {site}".
- **Empty regions.** A dismissed incomplete site leaves an empty `role="region"` labelled
  "Activation for {site}" (`:212-217`) inside the overview's `space-y-4` section
  (`dashboard/page.tsx:195`). That adds an empty landmark and, likely, blank vertical gaps. Not
  rendered in a browser.
- **Many alerts at once.** Each card's error is still `role="alert"`, so an outage announces N
  alerts on the overview.

## Out of scope, flagged for a separate check (not counted in this verdict)

`sites.api_key` is hidden only by a column-level REVOKE
(`20260813120000_hide_sites_api_key.sql:15-17`). The route's comment (`route.ts:94-95`) restates
that premise.

In PostgreSQL, a column-level REVOKE does not override a table-level SELECT grant. Supabase's
default privileges attach table-level grants to `authenticated` at creation, a fact the
repository itself notes (`20260818000000:1587-1590`). No migration revokes table-level SELECT on
`sites` and re-grants columns, and no DB test asserts the column privilege.

If the table-level grant exists, `api_key` (the HMAC secret) is readable over PostgREST by any
collaborator. This story neither reads nor worsens that, but it needs a check on the real
database:

```sql
SELECT has_table_privilege('authenticated', 'public.sites', 'SELECT'),
       has_column_privilege('authenticated', 'public.sites', 'api_key', 'SELECT');
```

## Could not verify

- **Real PostgREST and Postgres.** Only a filter-aware fake exercised these queries.
  - Untested against a real database: `.overlaps` on `TEXT[]`, the `content_elements!inner`
    embed under RLS, and the cost of the per-row `staging_history` policy (no index on
    `action`).
  - *Human gesture:* on the local Supabase stack, call `GET /api/sites/<id>/activation` as an
    admin, a `view` collaborator and a stranger, and expect 200, 403 and 403. As the admin,
    check the booleans for four cases:
    - a revoked-only editor
    - an edit-only editor, then the same editor re-saved with Publish
    - an attribute-only publish
    - a publish on another site
  - Run `EXPLAIN ANALYZE` on the publish existence read.
- **GoTrue merge semantics.** Whether `updateUser({ data })` merges into `user_metadata` is still
  only mocked.
  - *Human gesture:* set a profile name, dismiss site A, reload. The name should persist, A
    should stay hidden and B should still show.
- **Browser behaviour.** Never rendered in a browser:
  - Radix focus return after the invite completes the checklist
  - the popup opening as a tab or a window (window-mode return does not fire
    `visibilitychange` now that `focus` is gone)
  - clipboard permission
  - spacing on the overview with dismissed sites
  - *Human gesture:* in Chrome and Safari:
    1. Invite as the last step and check that the delivery/fallback notice stays and focus
       returns.
    2. Open edit mode, publish, return to the tab, and check that step 3 flips.
    3. Dismiss two sites and look at the overview.
- **The end-to-end edit round trip.** Never run as a whole: edit session → `rcf_edit_token` →
  `/api/staging/publish` → `staging_history` → checklist.
- **Accessibility.** No screen-reader or voice-control pass (N9).
- **Invite email delivery.** Mocked throughout.
- **Build, embed freshness and gzip, `audit:prod`.** Not run locally. I rely on green CI at
  `6481a2d` and on the plan's recorded gates.
- **DB-backed Jest suites** (`rls-policies`, `sites-install-status`, `function-grants`). Not
  registered under the CI placeholders.
- **The five-minute activation goal.** Not measured, as the plan states.

Max severity: minor
Ship allowed: yes
