# Review — s84-observability

Reviewer: fresh-context native `reviewer` subagent, 2026-10-10. Reviewed commit
`f569eb535864ebf28da6a7c7ac5d4b1d1801ec80`, tree
`4031f11169ed5588e2cf0cec68b62e06e062efb0`, against `origin/main`
`0dea1c05babed48834ecc72700cfebef01ae6733` with `git diff origin/main...HEAD`.
The source tree was frozen for this review; only this report and the reviewer's ignored evidence
directory were written.

## Verdict summary

No critical, major or minor finding remains in the reviewed s84 diff. The prior blocked review's
four findings are repaired in the committed source: GitHub issue write authority is confined to
the one named uptime job, every health URL spelling runs the real dependency probes, readiness
publishes only checks it performs, and the realtime Sentry scrubber filters encoded, malformed and
oversized query names before an event leaves the process.

The implementation otherwise remains aligned with the validated plan: database and cache outages
are critical; anonymous health bodies omit internal detail; health probes share a fail-open IP
limit; every accepted Sentry tunnel path spelling is guarded; Next runtimes use one release;
realtime fatal reporting preserves exit 1; uptime decisions are tested; and the restore runbook
rebuilds schema and privileges from migrations before loading rows.

## Findings

None.

## Prior blocked review disposition

The earlier review examined staged tree `d4019cb305cacd3b5fef83c4c68639649148d548`
at source HEAD `5c19370220b95b6d4e8171b219410a8a6b34ce2c`. It correctly blocked ship on C1
and recorded M1–M3. This review does not erase that history; it verifies the later repairs in
`f569eb535864ebf28da6a7c7ac5d4b1d1801ec80`.

- **C1 resolved — workflow authority.** `.github/workflows/uptime.yml` defaults to exactly
  `contents: read`; only `uptime.yml#probe` receives exactly `contents: read` and `issues: write`.
  The list-wide release gate permits that one scope and fails closed on other mappings, inline
  forms, widened grants and moved grants. The captured red control kept the approved job present
  while another job used `{ contents: write }`; the old guard missed it and one of 20 tests failed.
  The committed guard passes all 20, and the real workflow is covered again by the full suite.
- **M1 resolved — truthful quick spelling.** `GET /api/health` no longer branches on `quick`.
  `?quick=true` reaches database, storage, cache and realtime exactly like the canonical URL; the
  focused test makes the database fail and receives `503 unhealthy` with the component states.
  Repository search finds `quick` only in the regression test and the repair documentation.
- **M2 resolved — truthful readiness set.** The unconditional `critical_paths: pass` function is
  gone. The route runs and returns exactly `environment_variables`, `database_connection` and
  `storage_access`; the route-level no-leak suite pins both that set and each public shape.
- **M3 resolved — encoded query names.** `isSensitiveQueryName` applies one bounded URL-decoding
  pass before the sensitivity decision, preserves the raw key spelling in the filtered event, and
  filters malformed or names longer than 512 characters closed. Unit coverage includes partial,
  full and mixed-case encodings, arrays and ordinary data preservation. A real CLI crash sends a
  percent-encoded logged URL to a local fake Sentry ingest and proves the planted credentials are
  absent from the envelope.

## Plan and source review

- Tasks 1–3 are present: the cache probe calls the product's real limiter operation; database and
  cache independently force `unhealthy`/503; GET, HEAD and readiness share the 60/minute per-IP
  fail-open bucket before dependency work.
- Task 4 and its earlier critical repair are present: the middleware guard validates exact org,
  project and region query cardinality plus the envelope DSN, and the normalized tunnel predicate
  is shared with sessionless routing. Compiler-driven coverage exercises all rewrite spellings.
- Task 5 is present: `VERCEL_GIT_COMMIT_SHA` supplies both the inlined runtime release and source-map
  upload release; no runtime init writes an explicit undefined release.
- Task 6 is present: the realtime process loads `@sentry/node` only when server-only `SENTRY_DSN`
  exists, removes duplicate SDK fatal handlers, scrubs nested event data, bounds flush to two
  seconds and exits 1. Root and server locks both resolve `@sentry/node` 10.58.0.
- Task 7 is present: two fixed production targets, manual redirects, per-attempt timeout, two
  retries, exact-title issue reconciliation, sanitized issue text, serialized workflow runs and
  SHA-pinned actions. The workflow-level token remains read-only.
- Task 8 and the restore correction are present: migrations rebuild schema/ACLs, the dump supplies
  rows only, public seed data is cleared in the same transaction, triggers are disabled for the
  load, and verification checks effective secret-column access, definer-function grants and RLS.
- No s84 migration, UI/design surface or embed source/artifact changed. The story diff contains the
  39 expected implementation, test, workflow, dependency and operations-document files.

## Verification evidence

- Normal commit hook: lint completed with 0 errors and existing warnings; type-check and
  format-check passed; 418 Jest suites / 5,666 tests passed, with 38 database-gated skips.
- Normal pre-push hook: the production build compiled, the coverage ratchet passed, and the same
  418 suites / 5,666 tests passed again. The branch push completed and
  `origin/feature/s84-observability` matches the reviewed commit.
- Independent repair-focused Jest run under Node 24: 4 suites / 84 tests passed.
- Independent uptime Node suite: 22/22 passed.
- Independent in-memory neutralization: replacing the decoded query-name decision with the old raw
  decision made all three controls red (`to%6ben`, `rcf_%74oken`, malformed `to%6`); the committed
  implementation passed all three. The frozen source tree was never edited.
- PostgreSQL 17 replay evidence: 13 named suites / 94 tests passed, with one expected
  PostgREST-only skip.
- Fresh synthetic restore evidence: PostgreSQL 17.11 replayed all 73 migrations into source and
  target databases; five named row counts matched, published copy survived, the runbook's
  privilege/function/RLS queries returned zero findings, and effective web-role column grants
  matched. This proves the documented local commands against synthetic public data and
  `auth.users`; it is not production recovery proof.
- `git diff --check origin/main...HEAD` passed. After review checks, every source and test file
  still matched `HEAD`.

Full review evidence is recorded under the ignored operator path
`.omx/ultragoal/evidence/s84/repair-review/`.

## Not verified

- Hosted GitHub CI has not been observed for this reviewed commit. Local commit and pre-push gates
  are green, but they are not a hosted-CI result.
- No Vercel tunnel/body-forwarding check, production browser event, Sentry release/source-map
  attribution, Fly realtime fatal delivery/flush, `workflow_dispatch`, scheduled issue
  open/recovery, provider setting, secret or deployment was exercised.
- Backup metadata shows scheduled run `38043247098` succeeded and retains one unexpired
  859,958-byte artifact. No artifact was downloaded or decrypted, and no hosted Supabase/provider
  restore, auth identities or storage-object parity was tested. The private backup repository's
  README synchronization remains an after-merge operator task.
- No UI changed, so there was no screen/render or browser interaction to review. Merge remains the
  repository's manual decision after the PR and hosted gates.

Max severity: none
Ship allowed: yes
