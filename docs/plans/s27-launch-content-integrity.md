---
validated: yes
---
# Plan — s27-launch-content-integrity

Validated by operator in the user task on 2026-09-24; scope and D2 pre-approved. User explicitly requests draft PR with review placeholder rather than a ship verdict.

## Decisions

D2: ACCEPT RE-KEYING, NO BACKFILL. Computed IDs will change on next scan. Production has zero real customers per operator; orphaned QA rows are accepted. Explicit author IDs remain page-independent. No compatibility lookup. See ADR 027.

Keep draft attributes in metadata.staging_attributes; published attributes remain metadata.href/alt. Staging reads overlay, public reads remove staging_attributes. Publish preview includes attribute-only drafts; revert discards pending attributes. Publish promotes atomically, history records prior/new metadata. Snapshot/restore includes href/alt and restores into staging. Omitted attributes preserve values; explicit empty strings clear them. Discovery captures authored attributes. Length caps: href 2048, alt 2000.

## Tasks

- [x] 1. Run setup root/server, capture existing audit red markers and lint baseline under CI placeholders.
- [x] 2. Test and implement normalized pathname hashing, explicit cross-page IDs and unchanged identity properties. Flip only A-14 markers.
- [x] 3. Test and implement bounded href/alt validation, discovery baseline, staging persistence/history, staging/public projections. Flip only A-26 markers.
- [x] 4. Add idempotent SQL migration for history metadata and publish/version/restore attribute handling with service-role-only grants; test actual SQL locally, including attribute-only publish, fresh read and restore.
- [x] 5. Test and implement widget hydration of href/alt including same-text edits and unsafe stored values; preserve existing lifecycle and editor behavior.
- [x] 6. Audit discovery/dashboard/bulk/A-B/impressions opaque-ID compatibility. Initial page-field omission is superseded by review fix F2/F6 below.
- [x] 7. Rebuild embed after source changes and verify freshness/ceilings, precommit, production build/typecheck, audit:prod, formatting. Record exact counts and limitations.
- [x] 8. Prepare the verified story diff and draft PR body with Why/What changed/Decisions/Verification/Risk & rollback. Review file is only pending independent review. Delivery after verification: commit, push feature branch, open DRAFT PR; final handoff records the commit and PR URL.

## Files / verification

Embed source and identity/hydration tests; staging and public content routes; API validation helper and tests; timestamped SQL migration and local DB lifecycle tests; story/research/plan/ADR docs. Backend and embed implementation ownership is separate. No new dependencies. All guard tests remain. No production credentials, remote database changes, merge, ready flag, or deployment.

## Gate repair discovered during installed hook replay

The unchanged bulk-import large-file test started its 1-second alert query before real FileReader completion. Under host load above 400 it repeatedly timed out; it passed alone. A test-only synchronization repair awaits the real read inside React act while retaining the same real file, every assertion, size threshold and default timeouts. No product code or test condition is weakened.

Node 25 uses a different gzip implementation than CI Node 20. Its initial byte pass was insufficient; the final widget must pass with the installed Node 20 runtime, matching CI, without increasing ceilings. Final gate evidence below is updated after those repairs.

The final main-CI gate leaves RCF_TEST_DB_URL unset. Since another lane started a separate RecopyFast stack on 54322 during hook replay, local auto-discovery is temporarily pointed to unused loopback port 55428 in an unstaged config copy; the exact config is restored before handoff. This reproduces the main CI job's absent-database condition without adopting another lane's stack. No test assertion, timeout, skip marker, or production code is changed for this isolation. The s27 SQL lifecycle runs separately on owned Postgres 55427 with its explicit URL; all 10 cases passed. No remote migration is performed.

## Initial implementation verification (superseded by review fix run)

- `npm run setup`: root and server dependency setup completed.
- `npm run precommit -- -- --maxWorkers=2 --workerIdleMemoryLimit=512MB`: exit 0; lint 0 errors / 39 inherited warnings; full TypeScript clean; Jest 214 passed suites / 1 skipped, 2,769 passed tests / 36 skipped (2,805 total). No skip marker added or guard removed.
- `npm run type-check:build`: exit 0.
- `npm run build`: exit 0 (production Next build).
- `npm run build:embed` followed by `node scripts/build-embed.mjs --check`: exit 0; final artifact fresh; Node 20.15.1 zlib level 9 bundle 46,640 / 46,681 B, widget 33,852 / 33,865 B, transport 13,141 B.
- `npm run format:check`: exit 0, all source files formatted.
- `npm run audit:prod`: exit 0, zero vulnerabilities.
- `RCF_TEST_DB_URL=postgresql://marcusbey@127.0.0.1:55427/postgres npm test -- --runInBand --testPathPatterns=content-attributes-lifecycle`: 1 suite / 10 tests passed against disposable Postgres 16; includes actual route handlers over SQL, old-RPC regression, migration replay, save/publish/fresh read/restore/republish and RPC grants. Scratch database dropped and local server stopped.
- Focused API regressions: 11 suites / 138 tests passed. Focused widget regressions: 2 suites / 26 tests passed. Final changed-widget-test ESLint and `git diff --check`: clean.

The full suite retains unrelated existing expected-failure audit markers and DB-gated checks. The s27 real-SQL suite was explicitly executed separately; no live browser/production release claim is made.

## Review fix scope — operator validated 2026-09-24

This fix run preserves the reviewer-owned blocked verdict unchanged and uncommitted.
The operator explicitly authorized the following amendments to the validated plan.

- [x] F1 (C1/M4): preserve attribute absence throughout capture, restore, staging, publish and hydration; compare draft values with published values. Reproduce unchanged four-element restore/publish with zero changed rows, history and webhook entries.
- [x] F2 (M1): new idempotent migration after 20260924020000 adds nullable page_path and (site_id,page_path) index. Computed IDs carry normalized paths, author IDs carry NULL. Public/staging/preview reads accept page_path, include NULL shared rows, and use deterministic order plus explicit pagination beyond 1,000 rows.
- [x] F3 (M3): discovery retains elements with invalid authored attributes, omits only those attributes, normalizes alt whitespace. Link editor sends href only when dirty; unsafe new values remain 400.
- [x] F4 (m1): normalize index.html/index.htm and percent encoding before hashing if budget permits; otherwise document the byte evidence.
- [x] F5 (m2): save staging and history in one service-role-only Postgres function with pinned search_path and grants per 20260805190000.
- [x] F6 (m4/m5): forward href/alt in realtime, include attribute changes in webhooks, show Page in dashboard content list (NULL = All pages).
- [x] F7 (m3): restore useful why-comments and concise diagnostics while finding widget byte offsets; never raise a ceiling.
- [x] F8: run local gates under CI placeholders, actual SQL on an owned loopback database, byte gates on Node 20 and 24, preserve review hash, commit fix(s27), push and update existing draft PR #24.

**M2 deferred by operator:** SPA client navigation/reused DOM nodes retains initial computed identity. This predates s27. Follow-up must distinguish authored and widget IDs and re-scope/reload after navigation with dedicated routing tests; no SPA tracking bytes in this fix. Hash/query routing and extensionless-vs-.html aliases other than index documents remain outside the accepted normalization contract.

API/widget interface: GET query parameter `page_path`; discovery element `page_path` string for computed IDs and null for authored IDs. Omitted path preserves legacy clients. Empty attribute strings are retained only when explicitly authored or intentionally edited; absence never synthesizes them.

## Regression marker and test-harness changes

The fix run flips one additional marker in `src/__tests__/api/staging/content-concurrent-write.test.ts`: `records what each edit actually replaced, not a stale read`. Atomic draft/history writes lock the row and record the actual predecessor; the real SQL concurrency test verifies that chain. The unrelated `refuses a write whose expectedUpdatedAt no longer matches the row` remains expected-failing. Original s27 markers remain flipped: four in `content-href.test.ts` (destination, alt, history, extra columns) and three declarations in `element-id-page-scope.test.ts` (cross-page ids, distinct rows, isolated hydration).

Existing Supabase test doubles were adapted to mandatory ordered/paginated queries and atomic RPC calls; authorization, CORS, limiter and business assertions remain. The failed-history response expectation now uses the atomic save's generic failure, while real PostgreSQL proves rollback. No guard was deleted, skipped or weakened.

## Final review fix verification — 2026-09-24

All commands used the exact main CI job placeholders from `.github/workflows/ci.yml` through a clean-environment runner. No `.env` was copied, no dependency setup was repeated, and no remote database or production service was used. `origin/main` (including #22 and #26) was merged before implementation continued; reviewer-owned verdict SHA-256 remains `7f211131a5175aec618cf7f6678b1a54a769915d656b68ce32437918996df346` and that file is excluded from the commit.

- `npm run precommit -- -- --maxWorkers=2 --workerIdleMemoryLimit=512MB`: exit 0; lint **0 errors / 39 inherited warnings**; full TypeScript clean; Jest **215 passed / 1 skipped suites**, **2,815 passed / 36 skipped tests**, **2,851 total**. Initial run exposed four older GET mock-chain failures, repaired by adding real ordered/ranged-query support without changing assertions; final full run is green.
- `npm run build`: exit 0, optimized production build. One full build at a time.
- `npm run type-check:build`: exit 0.
- `npm run format:check`: exit 0, all source files formatted.
- `npm run audit:prod`: exit 0, **0 vulnerabilities**.
- `~/.asdf/installs/nodejs/20.15.1/bin/node scripts/build-embed.mjs --check` and `~/.asdf/installs/nodejs/24.14.0/bin/node scripts/build-embed.mjs --check`: exit 0, artifact fresh. Both runtimes: **bundle 46,621 / 46,681 B**, **widget 33,855 / 33,865 B**, **transport 13,141 B**, Node zlib level 9. Ceilings unchanged; 10 B widget headroom remains.
- `RCF_TEST_DB_URL=postgresql://marcusbey@127.0.0.1:55427/postgres npm test -- --runInBand --testPathPatterns=src/__tests__/db/content-attributes-lifecycle.test.ts`: **1 suite / 16 tests passed** on owned loopback PostgreSQL **16.10**, including scoped preview/confirmation parity and preservation of another page's draft. The independent reviewer reran the preceding 15-case suite three consecutive times and the final 16-case suite once, all green. Includes four-element unchanged restore/publish => **0 rows / 0 history / 0 webhook callbacks**, absence, explicit clears, exact webhook attribute patches, both publish signatures, idempotent migration replay, RPC grants, forced-history-failure rollback, and concurrent history chain. Scratch PostgreSQL server stopped afterward.
- Targeted widget suite: **11 suites / 143 tests passed**. Targeted backend API suite: **11 suites / 141 tests passed**. Additional realtime/dashboard and existing-mock compatibility tests pass and are included in the final full suite.
- `git diff --check`: clean. No applied migration or embed ceiling edited. Original guards retained; only the additional truthful-history marker described above flipped during this fix.

Limits: the SQL fixture exercises the real forward migrations on a minimal schema, not the complete Supabase migration chain. No real-browser end-to-end, production deployment, remote migration, merge or ready transition is claimed. Existing DB-gated cases and unrelated expected-failure audit findings remain. Apply the new migration before deploying app code that calls the new RPCs; rollback app code first, keep additive database objects. M2 is explicitly deferred above. The reviewer-owned blocked verdict awaits its owner's reassessment.

## Fix mode 2 — operator validated 2026-09-24

The operator reverses the author-added page-scoped publish amendment: Publish is site-wide. Public hydration and staging editor reads remain page-scoped. The publish preview reads the entire site and reports current-page/shared versus other-page counts; its page_path is count context only. One Publish after restore makes all pages live.

- [x] N1: restore site-wide Publish and full-site preview with per-page count breakdown; reproduce published edits on /a and /b, restore older version, then Publish from /a and verify both pages live.
- [x] N2: validate and normalize discovery page_path, cap at 1024 and reject control characters; invalid path skips only its element.
- [x] N3: paginate until EMPTY, advance by actual returned row count, stable total ordering; cap-500 regression and parallel page/shared reads.
- [x] N4: tests must fail under removal of pagination, save FOR UPDATE, publish/save equal-value filters and preview/staging GET value comparisons. Prove SQL locking with deterministic overlapping sessions.
- [x] N5: reuse pagination for bulk export, site content-elements and /api/sites element fetch, preserving filters and output.
- [x] N7: data-URI why-comment above check; distinct empty-image message; public reads do not gain editor tokens. Preserve Node 20/24 byte ceilings with useful headroom.
- [x] N6 and delivery: PR body lists both 20260924010000 and 20260924030000 as required operator-applied pre-deploy migrations and forward correction 20260924060000. Required gates, fix(s27) commit, push existing PR #24 and leave draft.

The review file is owned by the independent reviewer, remains byte-identical and uncommitted (SHA-256 de2958b56f7859e3f109a908335f51b35ee7cbd32f9a65017ed51292c12b2499). Existing unrelated guards and expected-failure markers remain intact. No production operations. The leader owns documentation, final gates, commit and PR; implementation agents own bounded source/test slices.

Independent backend review caught a non-idempotent second decode of widget-normalized paths: browser `/%25` becomes `/%`, while `/%2520` becomes `/%20`. The server must validate these canonical values without another URI decode. Regression coverage checks discovery/public/staging/preview parity for both; actual control characters remain rejected per element. This corrects the N2 implementation without adding widget bytes.

## Fix mode 2 regression evidence

- Pager neutralization (single capped read): **4/4 dedicated pagination tests red**, restored green. The query doubles enforce max_rows=500 even when range is absent.
- SQL/TS guard neutralizations: **1 red each** for removed save FOR UPDATE, save equal-value filter, publish equal-value comparison, staging GET value comparison, and preview value comparison. Reintroducing SQL page scoping produces **1 red**. Every temporary mutation was restored.
- Real owned PostgreSQL 16 lifecycle: **18/18 tests passed**, repeated independently. Includes exact two-page restore/publish, no-op restore, absence, explicit clears, grants, replay, rollback and deterministic overlapping save/history chain. Cluster stopped and verified inactive.
- Widget: **12 suites / 151 tests passed**; initial new tests showed **6 failures** before the changes.
- Pagination/discovery/bulk/sites: **13 suites / 222 passed / 2 existing skipped tests** before final canonical-path additions; final path-focused **2 suites / 48 tests passed**, repeated independently.
- Independent backend review found and verified repairs to double URI decoding and double index/slash folding. Final bounded backend review has no unresolved finding; read-only cross-review of the widget found no blocker. Reviewer-owned document remained untouched.
- The first combined full-suite/build attempt encountered timeouts in five unchanged suites and was stopped for the N2 repair. All five then passed sequentially: **128/128 tests**. No timeout, guard, skip or assertion was changed to accommodate host contention. Final gates run sequentially below.

The next full run exposed two additional pre-existing `/api/sites` mocks that returned an awaited `eq()` result and lacked the ordered/ranged chain. Only those test doubles were adapted to a thenable empty paged query; every credential/snippet assertion stayed unchanged. Both suites then passed all **9 tests**. The production build subsequently passed before the final full precommit replay.

## Final fix mode 2 gates — 2026-09-24

All commands used the main CI placeholder environment from `.github/workflows/ci.yml` via `/tmp/s27-ci-run.py`; no production env file was copied. Full tests ran serially after a contended run. For the final replay, only this process's macOS background policy was cleared with `taskpolicy -B`; no test timeout, assertion or skip was changed.

- `npm run precommit -- -- --runInBand`: exit 0; lint **0 errors / 39 inherited warnings**; full TypeScript clean; Jest **223 passed / 2 skipped suites**, **2,958 passed / 38 skipped tests**, **2,996 total**, zero failures. Existing and opt-in DB skips remain; SQL ran separately below.
- `npm run build`: exit 0, optimized production build.
- `npm run type-check:build`: exit 0.
- `npm run format:check`: exit 0.
- `npm run audit:prod`: exit 0, **0 vulnerabilities**.
- `~/.asdf/installs/nodejs/20.15.1/bin/node scripts/build-embed.mjs --check` and `~/.asdf/installs/nodejs/24.14.0/bin/node scripts/build-embed.mjs --check`: both exit 0, fresh artifact. Both runtimes: **bundle 46,601 / 46,681 B**, **widget 33,837 / 33,865 B**, **transport 13,141 B** (Node zlib level 9). Headroom: **80 B bundle / 28 B widget**; ceilings unchanged.
- `RCF_TEST_DB_URL=postgresql://marcusbey@127.0.0.1:55437/postgres python3 /tmp/s27-ci-run.py npm test -- --runInBand --testPathPatterns=content-attributes-lifecycle`: **18/18 passed** on owned PostgreSQL 16, independently repeated; scratch server stopped afterward.
- Neutralization: pagination removal gives **4 red tests**; save `FOR UPDATE`, save equality filter, publish equality comparison, staging GET comparison, and preview comparison each give **1 red**. Reintroducing scoped SQL publish gives **1 red**. All mutants restored.
- Full widget suite: **12 suites / 151 tests passed**. Final canonical-path suites: **2 suites / 48 tests passed**, independently repeated. Bounded backend and widget cross-reviews have no unresolved findings.
- `git diff --check`: clean, excluding the untouched reviewer-owned working diff. No new failing/skip markers were added or flipped in fix mode 2; prior story flips remain.

Merge prerequisite: `origin/main` at `300548a` (PRs #23 and #25) merged as `6ffc3d9`, keeping all story entries. Delivery uses the directly verified gates above without rerunning duplicate Git hook jobs on the overloaded host. Review SHA-256 remains `de2958b56f7859e3f109a908335f51b35ee7cbd32f9a65017ed51292c12b2499`; the file is excluded from staging. No PR merge, ready transition, remote migration or deployment is authorized in this delivery.
