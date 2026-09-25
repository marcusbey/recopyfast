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
- [x] T5 Record ADR 033 column privileges require table-level revoke; add AGENTS.md incident note; keep research inventory/exposure/rotation limits and story status accurate.
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

Historical internal verdict before the operator review: Max severity: none / Ship allowed: yes.
The current immutable operator review supersedes it: Max severity: major / Ship allowed: yes,
with M1/M2 and m1–m6 required before merge. That exact verdict is retained in docs/reviews/s38-hide-site-api-key.md, deliberately
uncommitted and unmodified per the lane instruction.

Final code proof: 11/11 real PostgreSQL tests and 78/78 focused source tests, with independent
negative/neutralization controls. Required local gates are green as recorded above.

Authorized handoff: one fix(security) commit with the required Claude coauthor, push
feature/s38-hide-site-api-key, and draft PR titled “fix(security): stop exposing site HMAC
secrets to collaborators”. Mandatory hooks gate the final commit/push. Git and the draft PR
record delivery status; neither merge nor production release is authorized. Remove owned
.next/coverage output after hook completion; the disposable DB runner already removed its
cluster. Operator rollout and rotation remain explicit follow-up outside this lane.


## Authorized review fix cycle — 2026-09-25

The operator explicitly authorized this scope in the current task. The uncommitted review
remains immutable. Previous verification counts above are historical, not this cycle's gate.
Local integration of origin/main is authorized; production merge/deploy remains forbidden.

- [x] M1 Integrate origin/main including PRs 31, 33 and 34, preserving all stories; re-audit user-scoped sites reads.
- [x] M2 Run portable column invariants on plain PostgreSQL and a real supabase start stack; document platform roles; superuser-only negative controls skip clearly on non-superusers.
- [x] m1 Replace anonymous health sites reads with a cheap permitted probe and test GET/HEAD/readiness behavior.
- [x] m2 Prove embedded sites api_key projections fail the source guard.
- [x] m3 Correct exposure since table creation (20250817) and prioritize collaborator-bearing sites for rotation.
- [x] m4 Remove needless sibling mutation privileges and prohibit user updates to device hashes in the unapplied migration.
- [x] m5 Hide staging access fingerprint hashes, extend inventory and DB tests.
- [x] m6 Prove dashboard embedded select through real PostgREST with a user JWT.
- [x] Run the review-fix gates using CI placeholders, obtain independent approval, and prepare commit/push with draft PR 35 retained. The mandatory hooks recheck the final integrated tree; Git/GitHub record delivery.


Source review-fix proof: health tests failed twice on the old tenant probes, then the three
health suites passed 31 tests. A temporary embedded `sites!inner(id, api_key)` source fixture
made the confinement guard fail; it was removed. The staging projection regression failed
before explicit user projections; the combined source run passed 6 suites / 49 tests.
The merged-tree audit also covered staging callers because the new fingerprint ACL would
otherwise break their default/wildcard selects. Service-side fingerprint validation remains
unchanged. Production typecheck and production dependency audit (0 vulnerabilities) passed.


DB review-fix proof: the full pre-fix PostgreSQL 14 migration replay failed 4 assertions
(8 passed / 1 HTTP test skipped), reproducing the old grants. Final plain PostgreSQL 14
passes 13 tests / 1 PostgREST test skipped; its owned cluster is stopped and removed.
A full `supabase start` stack with PostgreSQL 15 passes 14/14, including the real authenticated
PostgREST dashboard embed and anonymous plans probe. The two superuser-only negative-control
assertion groups explicitly warn and return on Supabase's non-superuser postgres; they run on
plain PostgreSQL. The migration reapplies cleanly. CI now runs the required suite on both the
plain PostgreSQL job and the real Supabase/PostgREST E2E stack; CI contract tests pass 6/6.

Independent review repeated the 49 source tests and caught a nested embedded-projection
parser gap (`sites(id, site_permissions(id), api_key)`). The source executor is adding its
regression and fix before the final gate; final review confirmation is pending.


### Full-stack gate corrections

The first integrated Jest run connected to the real stack and found two inherited failures
that an absent database had gated away. The immutable security-definer invariant correctly
rejects `update_translation_coverage(uuid) -> authenticated`: migration 20260818001000
restored that grant after 20260809120000 had removed it. The function has no caller
permission check and no application caller. Restore the original service-only ACL in the
unapplied s38 migration; do not exempt it from the invariant. Separately, the current full
migration chain already has no site-scoped DELETE policy on site_permissions, so remove the
stale `test.failing` marker and retain its exact positive assertion.

The initial full command also incorrectly set RCF_TEST_DB_URL globally to port 54322, which
an unrelated scratch-only lifecycle suite deliberately refuses. Ordinary full runs must
leave that override unset and let db-harness select the running local stack from config;
set the required override only for the dedicated DB suite. The embedded-parser failure in
that run was sampled during its test-first correction and is now fixed (11/11 focused).

- [x] Restore the inherited translation-coverage RPC lockdown and retain the strict invariant.
- [x] Convert the already-fixed database DELETE policy marker to a normal positive regression.
- [x] Verify a real protected-table owner invariant and its superuser negative control, as
  requested by the fresh review; non-superusers report the control skipped explicitly.


Post-correction full Jest with running local Supabase: 246 suites passed / 2 skipped,
3,247 tests passed / 38 skipped / zero failures. Lint (38 inherited warnings, no errors),
both type checks, format check, production build, required stock Node20 embed check and
production audit (0 vulnerabilities) passed. Source guard now covers both nesting before
api_key and nested sites cycles; 12/12 focused tests pass. The real Supabase column/function
suites pass 17/17 and plain PostgreSQL passes 13 with its HTTP test skipped.

Main advanced from fe98f69 to 0b8014f (PR #32) during verification. Preserve the completed
merge and security changes, then integrate that newest main as a separate local merge;
renumber branch-only s38 ADRs to avoid the newly merged billing ADR 031 collision. Re-run
final gates on the integrated tree. No production merge/deploy is authorized.

Fresh independent fix review against fe98f69: Max severity: none / Ship allowed: yes.
Reviewer independently passed 51 focused source tests, 17 Supabase column/function tests,
plain PostgreSQL 13/1 HTTP skip, remote-HTTP refusal control and typecheck. Both review
findings (nested projection parser and owner invariant) were fixed and rechecked. This
result is recorded here; the operator's original uncommitted verdict remains unchanged.


Latest-main integration: 0b8014f applied cleanly with all story entries retained. S38 ADRs
are now 033 and 034 (number-only correction, recorded in errata). A fresh local Supabase
reset applies checkout migrations 100000 and 110000 before s38 120000; column/function/
founding-cap suites pass 40/40. The latest-chain plain PostgreSQL runner passes 13 tests
and skips only its HTTP test; owned cluster removed. Production typecheck, zero-vulnerability
audit and stock Node20 embed freshness/budget checks pass on the final merged tree.


Fresh bounded review of the latest-main integration: Max severity: none / Ship allowed: yes.
All stories remain; PR #32 introduces no sites/api_key read surface; migration ordering and
content-preserving ADR renumbers were checked. Final conventional merge commit and push run
the mandatory full-suite and build/coverage hooks with the owned local Supabase stack active.
Original review remains unmodified and uncommitted. No production action is authorized.
