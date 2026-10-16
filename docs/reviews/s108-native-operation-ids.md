# Review — Story s108-native-operation-ids

Date: 2026-10-12
Branch: `feature/s108-native-operation-ids`
Reviewed base: `20f95f5f3f1e9a1432613cff7e2b2aff5c0b0474` (`origin/main`)
Review state: passed after independent freshness-test repair verification

## Scope and evidence

The story delta was reviewed against `docs/plans/s108-native-operation-ids.md`,
`docs/research/s108-native-operation-ids.md`, `AGENTS.md`, the bulk-route ADR boundaries, and the
working-tree diff from the reviewed base. The local `main` ref is stale; `HEAD` and `origin/main`
both resolve to the base above, so the uncommitted delta against `HEAD` is the complete story
implementation under review.

The implementation changes only the two operation-id imports/calls, the two existing route suites,
and the direct manifest/lock entries described by the plan. The route diff does not alter request
parsing, rate limiting, authentication, permission checks, owner-plan checks, client selection,
write order, row fields, error handling, or response shape.

Import/API verification:

- `randomUUID` is imported from the real `node:crypto` module and is already used through the same
  named-import boundary elsewhere in this repository. Both affected real route modules loaded and
  ran through Jest; there is no crypto mock in the changed suites.
- Both calls remain synchronous and occur at the same point immediately before the existing
  `bulk_operations` insert. The inserted id is reused for the completion/failure update and the
  response's `operation_id` exactly as before.
- `package.json` deletes only direct `uuid` and direct `@types/uuid`. The semantic lock diff deletes
  only the matching root declarations and two direct package nodes. `npm ls --package-lock-only
  --all uuid @types/uuid @lhci/cli` resolves only `@lhci/cli@0.15.1 -> uuid@8.3.2`; the s109-owned
  nested tooling dependency remains.
- Source census found no remaining application import or call of `uuid` / `uuidv4`.

## Verification run

The original independent review ran the seven former PR #91 failures: **7 suites / 135 tests
passed** on ambient Node 25.6.1. Its fixed-valid-v4 neutralization exposed the missing freshness
assertion and blocked this review. The author repaired both contracts without changing production
code or dependencies.

A fresh independent repair review then ran both affected suites under **Node 24.14.0**, using
`/tmp/recopyfast-with-test-env.py`: **2 suites / 20 tests passed**. The reviewer temporarily
replaced each route's `randomUUID()` call with the fixed valid v4 value
`00000000-0000-4000-8000-000000000000`. Exactly **2 tests failed / 18 passed**, at the import
and update distinct-id assertions respectively. After byte-for-byte restoration, the same two
suites again passed **20/20**. The real generator is not mocked.

Evidence is in `/tmp/s108-gates/independent-repair-green.log`,
`independent-repair-mutant.log`, and `independent-repair-restored.log`.

The complete binary diff of both routes compared identical before and after neutralization.
Restored SHA-256 values:

- import: `64456f78ae4cbab8488dff957cdd1403369f52b35591742ea3ba9dabd4336a24`;
- update: `91978c7d28063e6b49bef70285a75479fc34c1bfaf7a39c5069642d97bbdce54`.

`git diff --check HEAD` passed. All nine files match
`/tmp/s108-gates/source-manifest-review-fix.sha1`, whose aggregate SHA-1 is
`18eb6fb26412fc80eb8f73ab3825e39a2ba36ef1`. Comparing that manifest with the earlier
`source-manifest.sha1` confirms that both production routes, `package.json`, `package-lock.json`,
the story and research are unchanged. Only the two regression tests and plan evidence changed
since the earlier full gates.

Inspected author artifacts record Node 24.14.0 full gates on that unchanged production
implementation: production audit 0 vulnerabilities; statics and Next build green; coverage
495 suites / 7,528 tests; PostgreSQL 17 replay 121 passed plus one intentional PostgREST-only
skip; real PostgREST preflight 10 suites / 84 tests; built-embed 6/6; and strict Playwright
97/97 with no failed, skipped, or flaky tests. The repaired tests have a subsequent author
seven-suite result of **135/135** in `review-fix-seven-suites.log`, supplemented by the
independent focused and mutation runs above. The earlier full-suite run is not represented as a
rerun of the strengthened tests.

## Findings

No open findings. The prior major finding is resolved: each route now runs twice, both inserted
ids must match RFC v4, each response must echo its inserted id, and the two ids must differ.
Neutralization independently proves both freshness assertions reject reuse of a valid UUID.
The repair preserves the existing success-path and literal-only assertions.

## Plan and rule checklist

- [x] Tasks 1 and 3: the dependency/source census matches the researched baseline and the native
      replacement is limited to the intended lines.
- [x] Task 2: both routes pin v4 shape, row/response identity, and freshness; independent
      neutralization proves the repaired assertions reject reused ids.
- [x] Task 4: the seven former Jest failures and the real PostgREST preflight are green in bound
      evidence; the dependency tree retains only the nested Lighthouse copy.
- [x] Task 5 independent review: passed after the bounded test repair; normal commit-hook
      completion remains the leader's separate step before closing the plan task.
- [ ] Task 6: correctly pending; no replacement PR, hosted checks, superseding closure, merge, or
      production mutation was claimed or performed in this review.
- [x] No unplanned source, configuration, dependency, migration, UI, embed, auth, or rate-limit
      change was found.
- [x] Relevant ADR 042 service-role/content-write sequencing remains unchanged.

## Not verified in this review

- Hosted CI, replacement-PR state, and PR #91 superseding closure do not exist yet; verify them on
  the replacement head during the authorized ship step.
- No production request, Supabase production connection, Stripe call, deployment, merge, or other
  provider mutation was made. The production/hosted lanes remain separate from local evidence.
- Full-gate artifacts were inspected rather than rerun during repair review. This fresh reviewer
  independently executed the two changed suites and both generator mutations; the earlier reviewer
  executed the seven-suite regression set. Database clients are mocked in the focused route tests;
  real-database assurance comes from the separately recorded PostgREST and PostgreSQL gates.
- Normal commit hooks and hosted checks remain pending. This passing code-review gate authorizes
  the plan's next ship steps, not a merge or production deployment.

## Integration review addendum — 2026-10-13

Fresh integration review used current `origin/main`
`29fbc9dfc66fe8fe91954fe07a5ed708db71ecaf` as the base and included the complete staged,
uncommitted story delta. The branch `HEAD`, merge base and `origin/main` all resolve to that
revision. No intervening main commit changes any of the six implementation, regression-test or
manifest files: their SHA-1 values still exactly match
`/tmp/s108-gates/source-manifest-review-fix.sha1`. The only integration addition is the canonical
s108 section appended to the current analytics-era `docs/stories.md`; it preserves the validated
scope, dependency boundary and zero-byte embed allocation.

The current diff was re-read against the validated plan, research, repository rules and ADR 042.
The two route changes remain limited to the exact `uuidv4` → `node:crypto.randomUUID`
replacement at the pre-existing operation-row boundary. Every rate-limit, authentication,
permission, owner-plan, client-selection, write-order, row-field, response and error path around
that boundary is unchanged. The manifest and generated lock remove only the direct `uuid` and
`@types/uuid` roots; a fresh lock-only tree resolves the independently owned
`@lhci/cli@0.15.1 -> uuid@8.3.2` node and no application `uuid` import remains.

Fresh Node 24.14.0 verification passed the two changed route suites: **2 suites / 20 tests**.
For anti-hallucination neutralization, both `randomUUID()` calls were temporarily replaced with
the same valid RFC v4 value, `00000000-0000-4000-8000-000000000000`. Exactly **2 tests failed /
18 passed**, one freshness assertion per route. Both files were restored through the inverse
patch; their prior hashes returned, `git diff --check origin/main` passed, and the restored suites
again passed **20/20**.

No new finding was introduced by the rebase. This is a passing technical integration review, not
evidence that the remaining release gates ran on a committed replacement head. The normal commit
hook, complete required local gates, replacement PR, hosted checks and authorized PR #91
superseding closure remain pending with the leader. No merge or production action is authorized by
this addendum.

Max severity: none
Ship allowed: yes

## Integration review addendum — 2026-10-16 (`a58b6fc`)

The in-progress merge of current `main`
`a58b6fc2e63975bef1c0bbe7506360828c49c2b9` into story head
`86fc2d1d82b3c5f157af1a4e69f172ea291f2604` is technically clean. The resolved index contains
only the already-merged s113 social-card files and the combined `docs/stories.md`; the canonical
s108 and s113 sections are both present. `git diff --check` and `git diff --cached --check` pass,
and no unmerged index entry remains.

The six implementation/test/manifest files owned by s108 are byte-for-byte identical to story
head `86fc2d1d`: `package.json`, `package-lock.json`, both bulk routes and both strengthened route
tests have matching SHA-256 hashes in the worktree and `HEAD`. The resulting feature delta against
`a58b6fc` therefore remains the reviewed change: replace only the two `uuidv4()` calls with
`node:crypto.randomUUID()`, remove only the direct `uuid` and `@types/uuid` roots, and preserve the
nested dev-only `@lhci/cli@0.15.1 -> uuid@8.3.2` dependency. No application `uuid` import remains.
No fallback, alternate generator or weakened error path was introduced.

Fresh verification under Node 24.14.0 passed the two changed route suites: **2 suites / 20 tests**.
The existing fixed-valid-v4 neutralization remains applicable because all six reviewed file hashes
are unchanged; it previously made exactly the two distinct-id assertions fail and was not repeated
during this no-source-mutation integration review. No LSP diagnostic was required for the merge
delta because it contains no changed TypeScript or JavaScript owned by s108; the prior full Node 24
type checks remain bound to these exact source hashes.

No new finding was introduced. This addendum establishes only source-preserving integration onto
`a58b6fc`. The merge commit and normal hooks, hosted checks on the resulting PR head, private Devin
review availability, and any release action remain separate evidence lanes. Devin review could not
be refreshed because the private review service currently reports unavailable credits; no approval
is inferred from that absence.

Max severity: none
Ship allowed: yes
