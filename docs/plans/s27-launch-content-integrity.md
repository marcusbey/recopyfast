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
- [x] 6. Audit discovery/dashboard/bulk/A-B/impressions opaque-ID compatibility; existing page field display only if available, otherwise document absence.
- [x] 7. Rebuild embed after source changes and verify freshness/ceilings, precommit, production build/typecheck, audit:prod, formatting. Record exact counts and limitations.
- [x] 8. Prepare the verified story diff and draft PR body with Why/What changed/Decisions/Verification/Risk & rollback. Review file is only pending independent review. Delivery after verification: commit, push feature branch, open DRAFT PR; final handoff records the commit and PR URL.

## Files / verification

Embed source and identity/hydration tests; staging and public content routes; API validation helper and tests; timestamped SQL migration and local DB lifecycle tests; story/research/plan/ADR docs. Backend and embed implementation ownership is separate. No new dependencies. All guard tests remain. No production credentials, remote database changes, merge, ready flag, or deployment.

## Gate repair discovered during installed hook replay

The unchanged bulk-import large-file test started its 1-second alert query before real FileReader completion. Under host load above 400 it repeatedly timed out; it passed alone. A test-only synchronization repair awaits the real read inside React act while retaining the same real file, every assertion, size threshold and default timeouts. No product code or test condition is weakened.

Node 25 uses a different gzip implementation than CI Node 20. Its initial byte pass was insufficient; the final widget must pass with the installed Node 20 runtime, matching CI, without increasing ceilings. Final gate evidence below is updated after those repairs.

The final main-CI gate leaves RCF_TEST_DB_URL unset. Since another lane started a separate RecopyFast stack on 54322 during hook replay, local auto-discovery is temporarily pointed to unused loopback port 55428 in an unstaged config copy; the exact config is restored before handoff. This reproduces the main CI job's absent-database condition without adopting another lane's stack. No test assertion, timeout, skip marker, or production code is changed for this isolation. The s27 SQL lifecycle runs separately on owned Postgres 55427 with its explicit URL; all 10 cases passed. No remote migration is performed.

## Verification evidence

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
