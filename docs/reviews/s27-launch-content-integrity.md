# Review — Story s27-launch-content-integrity (re-review after fix)

Fresh-context anti-hallucination re-review of `git diff origin/main...feature/s27-launch-content-integrity`
at `529b686` (fix commit, after merging `origin/main` in `7b8c242`). The previous review of `ae57dcb`
blocked the story with 1 critical and 4 majors. This reviewer did not write the code and changed no
source file. Every mutation below was restored with `git checkout -- <file>` and proven clean with
`git diff --exit-code` before this file was written.

## Verdict

The blocking defect is fixed. A no-op restore followed by a publish now changes nothing, which I
reproduced on real SQL. Attribute absence survives capture, discovery, restore, publish and
hydration. Page-scoped reads no longer truncate under PostgREST's 1,000-row cap. I proved this
against a real PostgREST with `db-max-rows = 1000`. The page filter is injection-safe, the staging
save is atomic, and the new functions follow the grant precedent. The XSS boundary is unchanged since
the fuzzed version: `validation.ts` and the widget guard have no diff since `ae57dcb`.

**No critical remains.** Two majors are open:

- **N1 (new, introduced by the fix).** Widget publish is now page-scoped. The publish dialog does not
  say so, and no site-wide path is left. A site-wide restore followed by a publish therefore
  goes live on one page only.
- **M2 (deferred by the operator).** The SPA reused-node problem is still open. N1 also makes it
  worse.

Several guards the fix relies on are not caught by any test (see Neutralization).

## Prior findings → status

| Prior | Status | Evidence |
|---|---|---|
| **C1** restore stages `""` and publish pushes it | **Fixed** | `20260924030000_content_page_path.sql:280-307` stages only snapshot keys whose value differs from published. `create_content_version` (`20260924010000:135-138`) already stripped nulls. Reviewer SQL repro (4 elements: `p`, `a` without href, `img` without alt, `a` with href): after restore, both publish RPCs return **0 rows**, **0 history rows**, and metadata is byte-identical. The DB test asserts 0 webhooks (`after` not called). Neutralizing the restore filter turns 1 test red. |
| **M1** 1,000-row cap on content reads | **Fixed for public, staging and preview reads.** Residuals in N3, N4, N5. | `src/lib/content/paged-elements.ts:18-36` does ordered `(element_id, id)` `range()` pages of 1,000 (= `max_rows` in `supabase/config.toml:22`). Results against a real PostgREST 14 (`db-max-rows=1000`) + postgrest-js + the branch's helper are below the table. |
| **M2** SPA reused nodes keep the landing page id | **Open, deferred by the operator (major).** Worse since the fix. | Unchanged at `recopyfast.src.js:837-838` and `:2684-2688`: a reused node keeps its stamped id *and* the landing page's `page_path`. Preview and publish are now filtered by the current route, so an edit made after client navigation is left out of that route's preview and publish. On `ae57dcb` it was at least published. |
| **M3** discovery drops elements on invalid attributes | **Fixed** | `src/app/api/content/[siteId]/route.ts:132-154` validates href and alt separately and omits only the bad value. Alt whitespace is collapsed (`:148`). The link editor sends `href` only when it changed (`recopyfast.src.js:4641-4643`). Covered by the embed tests for `sms:+14165550123` and `javascript:void(0)` (text-only edit sends no `href`, keeps the authored href) and by the discovery-fidelity test. All four guards go red when neutralized. |
| **M4** absent attributes captured as `""` | **Fixed** | Capture uses `hasAttribute` (`recopyfast.src.js:2697-2698`). Hydration only sets a string value (`:3629-3639`). The image editor sends `alt` only when it changed (`:5004`). Both guards go red when neutralized. |
| m1 path normalization | **Fixed within the declared contract** | `normalizedPagePath()` (`:796-800`) folds `/index.html?` and trailing slashes and runs `decodeURI`. Reds under neutralization: 4 for the index fold, 4 for decoding. `.html` suffix, hash and query aliases are deferred in the plan. |
| m2 non-atomic staging save | **Fixed.** Test gap in N4. | `save_staging_content_atomic` (`20260924030000:17-116`) is called at `staging/content/[siteId]/route.ts:279-291`. A history failure rolls back (DB test). I ran a deterministic two-session lock probe: with `FOR UPDATE` the history chain is `null→B`, `B→C`; without it, both rows are `create` with `previous_content = null`. |
| m3 diagnostics and comments | **Partial (minor N7)** | The why-comment and the load warning are back (`:3702`). Other messages were cut to fit the byte budget. |
| m4 realtime and webhooks lack attributes | **Fixed** | `server/index.js:410-416` forwards only string `href`/`alt`. Publish RPC rows carry `attributes` (`20260924030000:242`), and the webhook payload uses those rows (`publish/route.ts:214`). |
| m5 page provenance invisible | **Fixed** | `ContentElementCard.tsx` shows the page, or "All pages" when it is NULL. Pre-migration rows also show "All pages". |

**M1 evidence (real PostgREST, reviewer seed).** Site A has 30 pages of 60 rows each, 40 shared
rows, one 2,345-row page and 60 `fr` rows. Site B has 5 rows on `/page-1`.

- A pre-fix-style read returns 1,000 of 4,233 rows, so the cap is real in this harness.
- The legacy read (no `page_path`) returns 4,233 rows, all unique.
- All 30 pages: **0 mismatches**. Each page gets its 60 rows plus the 40 shared rows, with no rows
  from another page, none from site B, and no duplicates.
- The 2,345-row page returns 2,385 of 2,385 rows.
- `fr` returns its 60 rows.
- Sixteen adversarial paths each returned exactly their own 3 rows and nothing from another page:
  `/a,b`, `/a)b(c`, `/a.b`, `/a'b`, `/a"b`, `/a&b=c`, `null`, `/ sp `, `/*`, `/is.null`, `eq./x`,
  `/ünï`, `/a%2Fb`, `/or=(page_path.is.null)`, `/a;b`, `/a+b`. A 6,000-character path also works.
- There is no `.or()` string anywhere. Page and shared rows are separate `.eq()` / `.is(null)`
  queries, and the POST `page_path` is a type-checked, bound RPC parameter.

## Findings

### Major

**N1: Widget publish is now page-scoped, without saying so. Drafts on other pages, including those
staged by a restore, silently stay unpublished.**

The preview GET and the publish POST both send the current path (`recopyfast.src.js:2378`, `:2416`).
The RPC publishes that page plus shared rows (`20260924030000:184-188`). The widget has no
site-wide publish left.

`restore_content_version` still stages every page (`:278-311`), and the edit board then reports
"Restored N elements" (`:6285`).

Reviewer SQL repro:

1. Edits on `/a` and `/b` are published.
2. The older version is restored.
3. A publish with `page_path='/a'` publishes only the `/a` row.

The `/b` image stays staged (`/h.png`) while `/h2.png` stays live, so the live site is left half
restored. The dialog reports "Published 1 change(s) successfully!" (`:2424`). After that, `/a` shows
"No pending changes to publish." (`:2385`), even though other pages still hold drafts.

On `main`, publish was site-wide. Nothing is lost: each page's drafts can still be published from
that page. This is still a silent change to a core flow, and restore→publish is the exact flow C1
was about.

This is also plan drift. The "Publish confirmation alignment" section is an author amendment
outside the operator-validated F1–F8 list, and no ADR records the new publish semantics. ADR 027
predates `page_path`.

Fix: choose one explicitly.

- Keep POST site-wide and make the preview site-wide. It is paginated and editor-only.
- Or keep scoped publish, show "N on this page, M on other pages" in the dialog, and give restore a
  site-wide publish.

If the operator treats site-wide publish as a contract, this finding blocks the ship.

**M2 (deferred by the operator): SPA reused nodes.** Status is in the table above. It stays open, and
N1's scoping makes its consequence worse. Follow-up per the plan.

### Minor

- **N2: Discovery stores `page_path` unvalidated** (`src/app/api/content/[siteId]/route.ts:165-166`).
  Every other discovered field is capped and control-checked; this one has no length cap, no
  control-character check and no shape check (`decodeURI` turns `%0A` into a real newline).
  - A path with an index entry over ~2.7 KB fails the btree limit of
    `idx_content_elements_site_page_path`. Reproduced: "index row size 3232 exceeds btree version 4
    maximum 2704". That makes the whole page's discovery upsert return 500.
  - The server also cannot check that `page_path` matches the path hashed into the id. A caller with
    the public site token can file a not-yet-discovered id under a different page, which hides it
    from that page's reads. This is comparable to the existing ability to pre-seed rows.
  - AGENTS.md "Validation" asks for size caps and control-character handling. Validate the value,
    and null or skip it on failure.
- **N3: Pagination stops at the first short page** (`paged-elements.ts:32`). That is correct only
  while PostgREST `max_rows` ≥ 1,000. Reproduced with `db-max-rows=500`: the legacy read returns
  500 of 4,233 rows and the big page 540 of 2,385, with no error. Pages are separate HTTP requests
  and use OFFSET, so they are not one snapshot: an insert during paging duplicates a boundary row
  and a delete can skip one. Fix: loop until an empty page (or use keyset on `(element_id, id)`),
  and run the page and shared queries in parallel. Each visitor read is now at least 2 sequential
  round trips.
- **N4: Several fix guards have no test that bites.** Measured below:
  - The dedicated pagination suite (`page-scoped-reads.test.ts`) stays green with pagination
    removed. Its mock returns every row when `range` is absent (`:59`). The 4 reds came from mock
    shape in `route.test.ts`.
  - The SQL test "concurrent atomic saves serialize…" (`content-attributes-lifecycle.test.ts:749`)
    stays green with `FOR UPDATE` removed, in 3 of 3 runs. The two calls do not actually overlap.
  - The Jest A-17 test re-flipped by this fix (`content-concurrent-write.test.ts:58-95`) passes
    against a fake RPC queue that serializes by construction. The fix is real: my deterministic
    two-session probe shows it. But neither repo test proves it.
  - These all stay at 0 red: the value comparison in publish SQL, the equal-value filter in save,
    and the TS preview and staging-GET value comparison.
  - The SQL suite is not run in CI (`RCF_TEST_DB_URL` unset). CI E2E only exercises NULL-page rows.
- **N5: Other content reads are still unbounded and capped at 1,000:** bulk export
  (`src/app/api/bulk/export/route.ts:71-74`), `sites/[siteId]/content-elements`, and the element-id
  fetch in `/api/sites`. Page-scoped identity makes crossing 1,000 routine, so bulk export would
  silently drop rows. Reuse `fetchPageScopedRows`.
- **N6: Deploy order is a hard dependency.** The public GET now selects `page_path`. If the app ships
  before `20260924010000` and `20260924030000`, every public read fails, and so do discovery and
  staging saves. The widget degrades to authored copy on every install. Migrations are applied by
  hand, so apply both before merging (see the ship checklist).
- **N7: Copy and diagnostics trimmed for bytes.** This is what remains of m3.
  - The data-URI why-comment now sits *after* its check (`recopyfast.src.js:4992-5000`).
  - An empty URL field alerts "Use an image URL (data: unsupported)." and no longer points users to
    "Upload New Image".
  - `set data-api-url.` and `Save failed.` replaced the explanatory messages.
  - Every visitor's public read now carries the editor-token query (`:802-804`), `?rcf_token=`.
    With `rcf_token` but no `rcf_staging`, the staging token goes to the public route's URL.
  - Headroom is 10 B for the widget and 60 B for the bundle, so the next widget story has no room.
- **N8: Restore does not revert attributes added after a snapshot.** Keys absent from the snapshot
  are left alone. This is the deliberate trade-off that fixes C1, asserted at
  `content-attributes-lifecycle.test.ts:1004`. It is documented nowhere else: not in the ADR, the
  research, or the UI.

## Launcher hard-checks

1. **Pagination.**
   - With `max_rows = 1000` no page truncates (proven above).
   - Order `(element_id, id)` is a total order (`id` is a UUID PK), so the sequence is
     deterministic.
   - Page size 1,000 = `max_rows` 1,000. That is fragile (N3).
   - Offset pages are not snapshot-consistent (N3).
2. **Path normalization.**
   - The server never normalizes; it stores and filters what the widget sends.
   - Discovery (`:2668`, `:3129`), hydration (`:3685`), polling (`:5503`), preview (`:2378`) and
     publish (`:2416`) all use the one `normalizedPagePath()`, so they are equivalent by
     construction.
   - Non-widget writers (v1 API, bulk import) leave `page_path` NULL, which means shared.
   - A visitor on `/pricing` does not receive `/about` rows (30-page probe: 0 foreign rows).
3. **Security.**
   - No `.or()` filter string; values are URL-encoded equality and proven with the 16 adversarial
     paths.
   - The POST path is a bound parameter.
   - The only abuse surface is N2.
4. **Postgres functions.** Checked for all three new or replaced functions and `restore_content_version`:
   - `SECURITY DEFINER`: yes (`prosecdef = t`).
   - `search_path` pinned: yes (`public, pg_temp`).
   - ACL: owner plus `service_role` only.
   - REVOKE PUBLIC/anon/authenticated, then GRANT `service_role`, as in `20260805190000`.
   - Every read and write is keyed by `p_site_id` inside the function. Per the `20260805190000`
     precedent ("grants, not a check inside the function"), the tenant boundary is the
     service-role-only grant plus the route's authorization before the RPC.
   - Migration replayed twice cleanly.
5. **Byte budget.** See Verification. It matches Codex's figures exactly.
6. **Flipped marker.**
   - The code fix is real (lock probe).
   - Its tests do not bite (N4).
   - Nothing was weakened:
     - `test.failing` markers: 8 removed (7 original A-14/A-26 plus the A-17 audit chain) and 0 added.
     - Skip markers are unchanged and there is no `.only`.
     - Assertions removed from modified tests were re-targeted to the RPC boundary, not dropped
       (for example `content-device-grant`: `staging_content` → `p_staging_content`,
       `user_email` → `p_user_email`).
   - The A-17 lost-update marker is still failing.

## Plan compliance and repo rules

F1–F8 are all present. Drift:

- **N1:** scoped publish is outside the validated amendments.
- Public reads now carry the editor-token query (N7).
- `content-elements` selects `page_path`. This is harmless.

"Multi-step writes go through a Postgres function" is now satisfied. The AGENTS.md validation rule
is violated by N2. No accepted ADR is contradicted:

- 002: RLS and grants.
- 003: no zod.
- 004 and 022: realtime still broadcasts only and never writes; the rooms are unchanged.
- 010: the webhook is still an `after()` marker.

ADR 027 does not describe `page_path` or scoped publish (N1).

## Verification (run by the reviewer)

CI placeholder env from `.github/workflows/ci.yml`, via a clean `env -i` runner. No `.env` and no
production credentials.

- **Full Jest (Node 20.15.1):** 215 passed / 1 skipped suites; 2,815 passed / 36 skipped / 2,851
  tests. This matches the claim.
- **Targeted suites** (api/content, api/staging, embed, websocket, app/dashboard,
  components/dashboard): 37 suites, 505 tests passed.
- **SQL lifecycle:** 16/16 on a reviewer-owned loopback PostgreSQL 16.10 scratch cluster, and green
  again inside every unmutated mutation run. The cluster was stopped and deleted afterwards.
- **Static checks:** `tsc --noEmit` exit 0. ESLint on changed `src` files exit 0. Prettier clean.
- **`node scripts/build-embed.mjs --check`:** artifact fresh, exit 0. Ceilings unchanged.

  | Node | Bundle (max 46,681) | Widget (max 33,865) | Transport |
  |---|---|---|---|
  | 20.15.1 | 46,621 | 33,855 | 13,141 |
  | 24.14.0 | 46,621 | 33,855 | 13,141 |
  | 25.6.1 | 46,484 | 33,731 | 13,122 |

- **`gh pr checks 24`:** all pass on `529b686`: E2E (Playwright, local Supabase with the full
  migration chain), Lint/Test/Build, TypeScript incl. tests, realtime audit, Vercel. The PR is a
  draft.
- **Integrity:** the prior verdict's SHA-256 was `7f2111…6df346` before this rewrite, as the plan
  states.

## Neutralization

Each run was restored with `git checkout -- <file>` and checked clean with `git diff --exit-code`.
The final tree check excluding this file is clean. "+8" means the 8 byte-gate tests that go red for
a stale artifact.

| Neutralized | Red |
|---|---|
| Pagination removed (single request, no `range`) | 4, all mock-shape in `route.test.ts`; **0** in `page-scoped-reads` |
| Public GET `page_path` equality dropped | 1 |
| Widget capture: absent → `""` | 1 +8 |
| Widget hydration: absent → `""` | 1 +8 |
| Link editor always sends `href` | 2 +8 |
| Discovery drops element on bad href | 1 |
| Discovery alt whitespace normalization removed | 1 |
| `/index.html?` fold removed | 4 +8 |
| `decodeURI` removed | 4 +8 |
| SQL restore value filter removed | 1 |
| SQL publish value compare → key presence | **0** |
| Both SQL compares neutralized | 1 |
| SQL save equal-value filter removed | **0** |
| SQL save `FOR UPDATE` removed (3 runs) | **0 / 0 / 0** |
| SQL publish page scope → `TRUE` | 1 |
| TS preview value compare → key presence | **0** |
| TS staging-GET value compare → key presence | **0** |

## Evidence boundary (not verified)

- **No real browser.** The widget ran only in jsdom. A human should load the candidate bundle on a
  real three-page static site (`/`, `/index.html`, `/about/`):
  - edit on two pages, publish from one, and see what the dialog says (N1);
  - restore a version and publish;
  - then repeat on a React Router SPA across client navigation (M2).
- **Real schema only via CI.** I ran the migrations on a minimal schema, not the full Supabase chain.
  CI E2E applied the full chain and passed, but I did not run it, and its fixtures only use NULL
  `page_path` rows. Run `supabase db reset` locally and try page-local rows through the real
  PostgREST.
- **Production `max_rows` not inspected.** N3 depends on it being ≥ 1,000. Check the project's API
  settings.
- **Not exercised:** webhook consumers with the new `attributes` key, Socket.IO fan-out between real
  clients, the dashboard's Page column as rendered, and screen-reader output. No remote database was
  touched and no migration was applied remotely.
- **Ship checklist:** apply `20260924010000` and `20260924030000` before the app deploys (N6).

## Delta review 4998607

A fresh-context delta review of `git diff 529b686..4998607 -- . ':!docs/stories.md'`. Merge-only
changes from `6ffc3d9` (PRs #23 and #25) were ignored; the story's own delta is commit `4998607`.
This reviewer did not write the code and changed no source file. Before this section was appended,
the file's SHA-256 was `de2958b5…2499`, the value the plan records, so it had not been edited
since the last review. Every mutation was restored with `git checkout -- <file>` and proven clean
with `git diff --exit-code`. The final tree check, excluding this file, is clean.

### Verdict

**N1 is fixed.** Publish is site-wide again: in the POST route, in the SQL function, and in the
widget. Reads stay page-scoped. N2, N3, N4 and N5 are fixed, and every guard the last review
listed now turns a test red. The new migration is sound, and it neither depends on nor conflicts
with `20260924020000` or `20260924050000`.

No new critical or major finding. M2 (SPA reused nodes) is still open and still deferred by the
operator. With site-wide publish back, its effect on publishing is back to where it was before
N1. The new findings below are all minor.

### Prior findings → status

| Prior | Status | Evidence |
|---|---|---|
| **N1** scoped publish | **Fixed** | The POST no longer passes `p_page_path` (`publish/route.ts:173-187`). `20260924060000` recreates the function without the page predicate; its body is otherwise identical to the `030000` version (diffed). The widget POST sends `{ siteId }` only. The preview GET reads the whole site and returns `currentPageChanges` / `otherPageChanges`. The dialog shows "N changes on this page, M on other pages" and falls back to "N site changes" for mixed versions. Publish stays enabled when only other pages have drafts. The prior repro is re-run below. |
| **N2** unvalidated `page_path` | **Fixed** | `src/lib/content/page-path.ts` checks: string, leading `/`, no raw `?`/`#`, no C0/C1 control characters, and at most 1,024 characters and 1,024 UTF-8 bytes (well under the 2,704 B btree limit). Discovery skips only the offending element (`content/[siteId]/route.ts:137-145`); the rest of the page upserts. The error strings are static and never echo the value. The widget's `decodeURI` output is not decoded or folded again, so `/%`, `/%20` and `/index.html` keep their scopes. |
| **N3** pagination stops early | **Fixed** | `paged-elements.ts:20-42` loops until an empty page, advances by the rows actually received, and orders by `(element_id, id)`, which is a total order. The page and shared queries run in parallel. It was proven against a real PostgREST with `db-max-rows=500` (below). **Residual:** offset pages are still not one snapshot (the PR body says so). |
| **N4** guards not tested | **Fixed** | Each guard now turns at least 1 test red. The new SQL lock test waits for a `Lock` wait event, then asserts the history chain. It went red on 3 of 3 runs with `FOR UPDATE` removed. Counts are below. |
| **N5** other unbounded reads | **Fixed** | Bulk export, `sites/[siteId]/content-elements` and the `/api/sites` element-id fetch all use `fetchPageScopedRows`, with their filters unchanged. Reverting any one caller to a single read turns its cap-500 test red. |
| **N6** deploy order | **Open (documented)** | The PR body lists `010000` → `030000` → `060000` as operator pre-deploy steps. See D4 for the out-of-order apply. |
| **N7** trimmed copy | **Mostly fixed** | The public read no longer carries `?rcf_token=` (`recopyfast.src.js:804`, `staged && token`). This matches `main`, whose public read never carried it. The why-comment is above the data-URI check, and there are separate messages for an empty field and for a data URL. The content-load warning is back to `main`'s wording. **Residual:** `set data-api-url.` and `Save failed.` are still there. The publish modal lost its icon and its "make your staging changes live" subtitle to save bytes. Headroom is now 80 B for the bundle and 28 B for the widget. |
| **N8** restore leaves post-snapshot attributes | **Documented in research only** | The research's fix-mode-2 section states the trade-off. The ADR and the UI still do not. |
| **M2** SPA reused nodes | **Open, deferred by the operator (major)** | Unchanged. |

**N1 reproduction (reviewer SQL, PostgreSQL 14.17 loopback scratch cluster).** Four rows: `/a`
text, `/b` image with alt, `/c` link with href, and one shared nav row. Take a snapshot, stage
edits on every page, publish everything, then restore the snapshot. Then publish once with
`p_page_path='/a'`:

- Without `060000`: only `a-copy` and `shared-nav` go live. `/b` keeps `/h2.png` live with
  `/h.png` staged, and the `/c` href stays staged. This is the prior N1.
- With `060000`: all 4 rows go live, including the attribute-only `/c` href and the `/b` alt. No
  drafts remain.

The route-level SQL test "restore followed by Publish from /a makes every page live" drives the
real POST and preview handlers against real SQL and asserts `2 / 1 / 1` counts.

**N3 evidence (PostgREST 14.16, `db-max-rows=500`, postgrest-js, the branch's
`fetchPageScopedRows`).** The seed is 30 pages of 60 rows, 40 shared rows, a 2,345-row `/big`
page, 60 `fr` rows, 9 adversarial paths, and a second site.

- All 30 pages: **0 mismatches**. Each read had no duplicates and no rows from another page or
  site.
- `/big`: 2,385 of 2,385 rows.
- Legacy all-site read: 4,212 of 4,212.
- `/pricing`, which has no page rows, got exactly the 40 shared rows.
- The same harness with the `529b686` helper returned 500 of 4,212 and 540 of 2,385, so the
  harness does detect truncation.

### Migration `20260924060000_restore_site_wide_publish.sql`

- **What it does:** `CREATE OR REPLACE` of `publish_staging_content_with_attributes_atomic`, keeping
  the same five-argument signature and `RETURNS TABLE`. `p_page_path` is now ignored. The
  two-column `publish_staging_content_atomic` already delegates with `NULL`, so both RPCs are
  site-wide.
- **Idempotent:** it was applied twice cleanly, both by me and in the suite's replay.
- **`SECURITY DEFINER`:** yes (`prosecdef = t`).
- **`search_path`:** pinned to `public, pg_temp`.
- **Grants:** ACL is owner plus `service_role` only. `anon` and `authenticated` have no EXECUTE.
  It uses `REVOKE … FROM PUBLIC, anon, authenticated` then `GRANT … TO service_role`, as in the
  `20260805190000` precedent.
- **Tenant check:** every read and write is keyed by `p_site_id`. The route authorizes before the
  RPC.
- **Out-of-order apply:** the object sets do not overlap.
  - `000000` touches `site_editors` and `activate_site_editor`.
  - `020000` and `050000` touch `checkout_pending_intents` and the four checkout-intent functions.
  - `010000`, `030000` and `060000` touch `content_elements`, `staging_history`,
    `content_versions`, and the save, publish, version and restore functions.
  - A cross-grep found no references in either direction.
  - `010000` and `030000` have no diff since `529b686`.

  Applying them after `020000`/`050000` is therefore safe, as long as the three s27 files keep
  their relative order.

### New findings (delta)

All minor.

- **D1: `/api/sites` failure behaviour changed, outside the plan** (`src/app/api/sites/route.ts:73-131`).
  - The element-id and history-stat errors now `throw` inside `Promise.all`. One site's stats
    failure now returns 500 for the whole dashboard site list. Before, the stats degraded to 0.
  - No test covers this path.
  - The plan asked to preserve output.
  - Cost per site is now every element page plus `ceil(ids/200)` sequential pairs of history
    queries. A SQL aggregate RPC would be one round trip.
- **D2: Read-side `page_path` rejections are untested.** Removing the 400 branch in the public GET,
  the staging GET or the preview GET turns **0** tests red each time. Also:
  - `normalizePagePath` only validates.
  - It returns its own result type instead of extending `ValidationResult<T>` in
    `src/lib/api/validation.ts`, which AGENTS.md "Validation" asks for.
- **D3: ADR number collision.** After merge `6ffc3d9` there are two ADR 027 files:
  - `027-page-scoped-identity-and-content-attributes.md` (s27).
  - `027-site-token-lifetime-and-key-rotation.md` (s29, already on `main`).

  The s27 plan and the s29 research both cite "ADR 027". Renumber the s27 ADR (029) before
  merge.
- **D4: The deploy note leaves out the out-of-order apply.** Production is already past
  `20260924050000`, so `supabase db push` will refuse the older `010000` and `030000` without
  `--include-all`, or an equivalent manual apply plus history insert. The PR body gives the order
  but not this.
- **D5: Vestigial code.**
  - The RPC keeps `p_page_path` and ignores it without saying so. No production caller ever
    sent it.
  - The POST still returns 400 for a non-string `page_path` that it then ignores.
  - The preview GET's `page`/`shared` builder branches can no longer be reached (it always passes
    `null`).
- **D6: The SQL harness teardown flakes, and this was already true before the delta.** In about
  1 run in 5, `DROP DATABASE … WITH (FORCE)` in `afterAll` kills a pool connection that is still
  closing. The suite then exits 1 with all tests green, from an unhandled `57P01`.
  - Rate: 1 in 5 at `529b686` and 1 in 5 at `4998607` in my clean repeats.
  - `pool.end()` resolves before the backends have closed.
  - This suite is not run in CI.
- **D7: Read cost.**
  - Every paged read now ends with an extra request that returns an empty page. A page-scoped
    visitor read is 4 PostgREST requests (two parallel chains of two).
  - Rows per read have no upper bound. Before, PostgREST's cap truncated them silently.
  - Shared rows seeded through discovery with the public site token now raise the cost of every
    visitor read without limit. Anyone with that token could already seed rows.
- **Nit:** the data-URI comment-order test passes if the comment is deleted, because `indexOf`
  returns -1.

### Plan compliance, repo rules, ADRs

- The N1–N7 checklist in the plan's "Fix mode 2" section is all present in the diff.
- Drift beyond the plan: D1, and the publish-modal DOM cut. The cut is disclosed in the research.
- N2 is "validate and normalize" in the plan's checklist but validate-only in the code. The plan's
  later paragraph explains why: a second decode is unsafe.
- AGENTS.md:
  - Forward-only migrations: yes. The earlier files are unedited and the fix is a new
    migration.
  - Control characters are never echoed.
  - No `console.log`.
  - No new `.skip`, `.only` or `.failing`.
  - Removed assertions were replaced with site-wide equivalents.
- No accepted ADR is contradicted. The s27 ADR says nothing about publish scope, and site-wide
  publish restores the contract that was in force before the story.

### Neutralization (delta)

- Baseline for the mutation set: 502 tests, 0 red. The set is the targeted `api/content`,
  `api/staging`, `api/bulk`, `api/sites`, `embed` and `app/api/sites` suites, plus the SQL
  lifecycle suite on scratch Postgres.
- Two DB-gated share-RLS audits (A-4, A-9) were excluded. They need the full Supabase schema and
  are unrelated to the story.
- "+8" means the 8 byte-gate tests that go red for a stale artifact.

| Neutralized | Red |
|---|---|
| Pager: single request, no `range` | 15 (7 `page-scoped-reads`, 4 `route.test`, 1 export, 1 content-elements, 2 `/api/sites`) |
| Pager: stop on first short page (prior behaviour) | 11 |
| Pager: advance by requested size | 9 |
| SQL save `FOR UPDATE` removed (3 runs) | **1 / 1 / 1** (history chain: expected "Version B", got undefined) |
| SQL save equal-value filter removed | 1 |
| SQL publish (`060000`) value compare → key presence | 1 |
| SQL publish (`060000`) page scope re-added | 1 |
| TS preview value compare → key presence | 1 |
| TS staging-GET value compare → key presence | 1 |
| POST re-sends `p_page_path` | 1 |
| Preview GET scoped to the page again | 6 (incl. the SQL route test) |
| Discovery `page_path` validation bypassed | 7 |
| Control-character check removed | 1 |
| UTF-8 byte bound removed | 1 |
| Raw `?`/`#` rejection removed | 2 |
| Public GET / staging GET / preview GET 400 removed | **0 / 0 / 0** (D2) |
| Bulk export, content-elements, `/api/sites` ids unpaginated | 1 / 1 / 2 |
| Widget public read carries `rcf_token` again | 1 +8 |
| Widget POST re-sends `page_path` | 2 +8 |
| Dialog "this page" shows the site total | 2 +8 |
| Dialog disabled when the current page has 0 changes | 1 +8 |
| Data-URI check moved above its comment | 1 +8 |

### Verification (run by the reviewer)

CI placeholder env from `.github/workflows/ci.yml`, via an `env -i` runner. No `.env` and no
production credentials.

- **Full Jest (Node 20.15.1):** 223 passed / 2 skipped suites; 2,958 passed / 38 skipped / 2,996
  tests. This matches the claim.
- **Targeted suites** (`api/bulk|content|staging`, `api/sites`, `embed`, `app/api/sites`): 37
  suites, 460 passed / 2 skipped.
- **SQL lifecycle:** 18/18 on a reviewer-owned loopback PostgreSQL 14.17 scratch cluster (16 is
  not installed here). Five clean repeats: 18/18 each; one of the five exited 1 on D6. The
  cluster and PostgREST were stopped and their data deleted.
- **`node scripts/build-embed.mjs --check`** on Node 20.15.1 and 24.14.0: artifact fresh, bundle
  46,601 / 46,681 B, widget 33,837 / 33,865 B, transport 13,141 B. This matches the claim. No diff
  under `scripts/`, so the ceilings are unchanged.
- **ESLint on the changed `src` files:** 0 errors, and 1 warning that was already there
  (`request` unused in `sites/route.ts`).
- **`gh pr checks 24`:** all pass on `4998607`: E2E, Lint/Test/Build, TypeScript incl. tests,
  realtime audit, Vercel. The PR is still a draft.

### Evidence boundary (not verified)

- **No real browser.** The new publish dialog was only rendered in jsdom.
  - Load the candidate bundle on a real static site with `/a`, `/b` and `/c`.
  - Edit `/a` and `/b`, publish, restore the older version, then open Publish on `/a`. It should
    read "1 changes on this page, 1 on other pages" (shared rows count as this page).
  - Publish, then open `/b` in a fresh private window and check the restored copy and alt.
  - Repeat on an SPA for M2.
- **Real Supabase chain and gateway not run locally.** The SQL ran on PG 14 with a minimal schema;
  CI E2E ran the full chain but uses NULL-page rows only.
  - Run `supabase db push --include-all --dry-run` against staging. Confirm that only `010000`,
    `030000` and `060000` are pending.
  - Load the dashboard for a site with more than 200 elements that have history. Confirm the
    stats and that the `.in()` URLs (about 7.4 KB per 200-id batch) are not rejected by the
    gateway.
- **Production `max_rows`** is no longer a correctness input. It still sets the number of requests
  per read (D7).
- **Not exercised:** webhook consumers after a site-wide publish, Socket.IO fan-out, and any remote
  database. No migration was applied remotely.
- **Ship checklist:** apply `20260924010000`, `20260924030000`, `20260924060000` in that order
  (with `--include-all`) before the app and widget deploy. Renumber the s27 ADR (D3).

Max severity: major
Ship allowed: yes
