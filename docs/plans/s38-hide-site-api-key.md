---
validated: yes
validated_by: user exact implementation specification and explicit execute-through-draft-PR authorization, 2026-09-25
---

# Plan — s38-hide-site-api-key

This implements the user's numbered security specification. No production actions, key rotation, new dependencies, applied migration edits, merges or deployment. Existing uncommitted reviewer verdicts must remain untouched and uncommitted. No UI behavior/design change.

- [x] T1 Write executable real-Postgres regression tests and reproduce the old column-revoke/table-grant failure using actual migration/schema and view-only JWT claims. Verify metadata/dashboard joins, no cross-tenant rows, rejected api_key/wildcard reads, service-role reads and writes, and unneeded site mutations denied.
- [x] T2 Add forward migration 20260925120000_sites_api_key_column_grants.sql. Explicitly revoke sites table SELECT and other table privileges from PUBLIC/anon/authenticated, clear residual column ACLs, grant authenticated exactly all 10 current nonsecret columns. No anon path needs a grant. Preserve service_role full access. Apply equivalent explicit SELECT allowlists hiding webhooks.secret, api_keys.key_hash and editor_device_grants grant_hash/user_agent_hash/origin_hash. Preserve unrelated mutation policies/contracts. Do not dynamically grant unknown future columns.
- [x] T3 Add DB catalogue invariants comparing effective authenticated column grants to schema minus hidden fields (new columns must fail), checking every non-infrastructure role and application inheritance paths, and negative controls for restored table/PUBLIC/inherited/column grants plus added columns. State PostgreSQL unavoidable trusted-role exceptions explicitly. Run against disposable PostgreSQL with all real migrations; wire blocking execution into existing disposable CI database lane. Stop and remove owned cluster at completion.
- [x] T4 TDD caller regression guards: audit every src/server sites read including nested joins/realtime; keep current explicit safe user reads and service signing reads. Remove unnecessary api_keys.key_hash SELECT, replace default/wildcard API-key mutation returning selections with explicit nonsecret fields, preserve response contract. Verify sibling hash changes do not break any user-scoped reads.
- [x] T5 Record ADR 031 column privileges require table-level revoke; add AGENTS.md incident note; keep research inventory/exposure/rotation limits and story status accurate.
- [x] T6 Run targeted tests then required local gates with /tmp/recopyfast-s38-ci-env.sh placeholders: lint, both type-checks, format check, full Jest, build, Node 20.15.1 embed check, npm audit --omit=dev. Fresh independent review and fix findings; prepare the conventional single fix(security) commit and requested draft PR. Delivery handoff below is tracked by Git/GitHub.

Ownership: DB executor owns migration, DB test/runner/bootstrap files and CI wiring; source executor owns api-keys route and user-read regression tests. Lead owns research/plan/story/ADR/AGENTS docs, integration, local gates and delivery. Executors do not commit/push until lead integrates verification. Shared code must not be reverted.

## Verification record

- Source TDD: original GET/POST/PUT projections failed all 3 new cases; corrected code passed 3 focused suites / 16 tests.
- DB red: `node scripts/run-db-invariants.mjs --pre-fix-proof` replayed pre-s38 migrations and reproduced all six readable credential/hash fields plus view-only site-key read.
- DB green: Node 20 `node scripts/run-db-invariants.mjs` replayed the full real migration chain on owned PostgreSQL 14, reapplied s38, and passed 1 suite / 8 tests. Hidden/wildcard/write rejections returned SQLSTATE 42501; table/PUBLIC/inherited/column and new-column negative controls passed. Cluster and temporary directory were removed.
- Targeted lint, full TypeScript check and owned-file formatting passed.
- Initial Node20 embed check: bundle 46,601 / 46,681 bytes; widget 33,837 / 33,865; artifact fresh. Production dependency audit: zero vulnerabilities.
- Final integrated local gates passed with CI placeholders: lint (0 errors, 38 inherited warnings), both type-checks, format:check, build, Node20 embed freshness/budget, and npm audit --omit=dev (0 vulnerabilities).
- Full Jest: 236 passed suites / 2 skipped; 3,098 passed tests / 38 skipped / 0 failed. Real DB proof is the separate 8/8 run, not the ordinary Jest gated placeholders.
- Independent reviewer reran the complete DB runner: 8/8 passed with cleanup. Source neutralization made all 3 projection regressions fail; exact source restored and focused tests green. Final verdict and delivery pending.

## Independent review correction

The reviewer found that the initial test exempted a role owning any protected table from
checks on all protected tables. This could conceal an unexpected cross-table grant. Fix
by creating the disposable cluster as postgres, explicitly asserting approved ownership,
removing the broad owner exception, and proving an unexpected owner granted access to
another protected table is caught. This tightens the test boundary; the migration itself
did not grant that access. Review remains pending until the corrected DB proof passes.

The same review found a critical sibling-secret bypass: authenticated webhook PUT returned
the full service-role UPDATE row, including secret, to edit/admin collaborators. Extend T4
within the user's requested sibling-secret repair: explicit nonsecret update returning
projection plus response defense, preserve server-generated show-once creation, and add
query/JSON regression tests. Signing/dispatch service reads retain secret. Rerun affected
tests and final gates after this repair, then obtain a fresh review verdict.

Review fixes verified: DB owner guard reproduced 2/11 failures before repair; final clean
PostgreSQL runner passed 11/11, independently repeated by reviewer. Webhook creation/update
projection and update-response tests reproduced the three unsafe behaviors; corrected webhook
suites passed 62 tests and combined source-security suites passed 78. TypeScript, targeted
lint, formatting and diff checks passed. Both findings require final reviewer confirmation
and integrated gate rerun before delivery.

The final response-contract check retains pending_event_type and pending_payload in webhook
mutation responses through a separate nonsecret mutation projection; GET's existing shape
stays unchanged. Exact projection regressions failed before this adjustment and passed after.
Latest focused source proof: 5 suites / 78 tests; TypeScript, lint, formatting and diff clean.
Integrated post-security-fix gate: 236 passing suites / 2 skipped, 3,099 passing tests / 38
skipped, build/embed/audit and both type checks green. Mandatory commit/push hooks verify
the final projection adjustment against the full suite/build again.

## Final review and delivery handoff

Independent verdict: Max severity: none / Ship allowed: yes. All three review findings are
resolved. The exact verdict is retained in docs/reviews/s38-hide-site-api-key.md, deliberately
uncommitted and unmodified per the lane instruction.

Final code proof: 11/11 real PostgreSQL tests and 78/78 focused source tests, with independent
negative/neutralization controls. Required local gates are green as recorded above.

Authorized handoff: one fix(security) commit with the required Claude coauthor, push
feature/s38-hide-site-api-key, and draft PR titled “fix(security): stop exposing site HMAC
secrets to collaborators”. Mandatory hooks gate the final commit/push. Git and the draft PR
record delivery status; neither merge nor production release is authorized. Remove owned
.next/coverage output after hook completion; the disposable DB runner already removed its
cluster. Operator rollout and rotation remain explicit follow-up outside this lane.
