---
validated: yes
---

# Plan — Story s108-native-operation-ids

Branch: `feature/s108-native-operation-ids`, refreshed to `origin/main` `20f95f5` before
implementation and integrated without source changes onto current main `29fbc9d` before shipping.

Research: `docs/research/s108-native-operation-ids.md`. No Design step: there is no UI change.
No ADR is proposed: the story removes an external implementation detail while preserving the
existing RFC v4 operation-id contract and the required Node 24 runtime.

The canonical story section lands through the framing/docs branch before execution. The temporary
local `docs/stories.md` append exists so this plan resolves today; it is not feature-branch
ownership and will disappear when this branch rebases onto the framing result.

## Decision awaiting validation

Use `node:crypto.randomUUID()` for the two bulk-operation ids, remove direct `uuid` and
`@types/uuid`, and supersede PR #91 with this story's reviewed PR. Do not change Jest's module
system. Do not touch Lighthouse's nested dependencies; s109 owns those.

The fallback choice is to retain patched UUID 11.1.1 and close PR #91 with a documented
incompatible-major disposition. Choosing that fallback rejects this implementation plan and
requires the plan to be rewritten before execution.

## Acceptance criteria

- [ ] Bulk import and bulk update each create a fresh RFC 4122 v4 `bulk_operations.id`; all route
      guards, database clients, inserted fields, response bodies and error behavior remain unchanged.
- [ ] No application source imports `uuid`; the root manifest and generated lock contain no direct
      production `uuid` or direct `@types/uuid` entry.
- [ ] The seven suites that failed on PR #91 pass unchanged, coverage remains above every ratchet,
      and the real PostgREST content-write preflight passes.
- [ ] Production audit, statics, build, database replay, all 97 Playwright tests and every hosted
      required check pass on the reviewed replacement head.
- [ ] The replacement PR records that Lighthouse's nested UUID/tooling advisories remain owned by
      s109. PR #91 is closed as superseded only after the replacement PR's reviewed current head is
      green in hosted CI.

## Task 1 — preserve the exact red and resolved-tree baseline

Before editing, record PR #91 head `900ad10815f144471fde77baeb3db69c58363e77`, current main, the
seven failing suites, the E2E preflight failure and the passing build/typecheck/audit checks from
the hosted logs. On the clean s108 branch, record:

```bash
npm ls --package-lock-only --all uuid @types/uuid @lhci/cli
rg -n "from ['\"]uuid['\"]|uuidv4" src server scripts e2e
```

The expected baseline is two application imports/calls, direct `uuid@11.1.1`, direct
`@types/uuid`, and a separate dev-only `@lhci/cli/node_modules/uuid@8.3.2`. Do not install or
modify dependencies merely to capture the baseline.

Execution baseline, 2026-10-12: PR #91 remains open at
`900ad10815f144471fde77baeb3db69c58363e77`; its Lint/Test/Build and E2E checks remain failed
while TypeScript, built-embed, realtime audit, Lighthouse and Vercel remain green. On refreshed
main `20f95f5`, the lock-only tree and source census exactly matched the expected baseline above.

- [x] Task 1

## Task 2 — pin the preserved operation-id contract in existing route tests

In the existing successful bulk import and bulk update route suites, capture the inserted
`bulk_operations` row and assert that its `id` is an RFC v4 UUID. Keep the assertion at the row
contract; do not mock `node:crypto`, assert one fixed id or add a test that only reads the
manifest. Run the two focused suites before the dependency change to prove the behavior is already
the contract.

Characterization evidence, 2026-10-12: both existing success-path suites passed 20/20 with the
new inserted-row assertions before the dependency change, proving RFC v4 was already the external
contract rather than a behavior introduced by this refactor.

Review repair, 2026-10-12: each success contract now runs its route twice, keeps the v4 and
row/response-equality assertions for both calls, and requires the ids to differ. Replacing both
real generators with the fixed valid v4 value `00000000-0000-4000-8000-000000000000` made both
tests fail at the freshness assertion (18 passed / 2 failed); restoring `randomUUID()` byte for
byte returned the pair to 20/20 and the seven-suite regression set to 135/135. No crypto mock was
introduced.

- [x] Task 2

## Task 3 — replace the generator and remove the unused dependency pair

In `src/app/api/bulk/import/route.ts` and `src/app/api/bulk/update/route.ts`, import
`randomUUID` from `node:crypto` and call it where `uuidv4()` currently creates the operation id.
Change no other route line except formatting made necessary by that import/call replacement.

Remove `uuid` from `dependencies` and `@types/uuid` from `devDependencies`. Regenerate
`package-lock.json` with the repository's Node 24.14.0/npm toolchain. Inspect the semantic lock
diff: it may remove the direct nodes but must retain the independent s109-owned LHCI UUID node.
No force update, hand-edited lock entry, new package, Jest configuration or unrelated resolution.

TDD evidence, 2026-10-12: after the manifest/lock removal and `npm prune`, with the route source
still unchanged, the two contract suites failed to load with `Cannot find module 'uuid'` from the
two real route modules. Replacing only the imports and calls with `node:crypto.randomUUID()` made
the same real inserted-row contract pass 20/20. No crypto mock or manifest-only test was used.

- [x] Task 3

## Task 4 — run the exact failed regressions first

Run the seven suites from PR #91 in one process:

```bash
npm test -- --runInBand --runTestsByPath \
  src/__tests__/api/owner-plan-gate.test.ts \
  src/__tests__/api/bulk/import-outcomes.test.ts \
  src/__tests__/api/bulk/import.test.ts \
  src/__tests__/api/bulk/roundtrip.test.ts \
  src/__tests__/api/bulk/update-literal-only.test.ts \
  src/__tests__/api/bulk/update-operations-cap.test.ts \
  src/__tests__/api/bulk/update-limiter.test.ts
```

Then run the E2E workflow's exact disposable Supabase/PostgREST preflight containing
`src/__tests__/db/content-write-privileges.test.ts`. A skip or missing PostgREST target is not a
pass. Confirm with `npm ls --package-lock-only --all uuid @types/uuid @lhci/cli` that no direct
production UUID remains and that the nested dev-only node is still explicitly visible for s109.

Execution evidence, 2026-10-12: the seven former PR #91 failures passed 135/135 under Node
24.14.0. The CI-pinned Supabase CLI 2.117.0 replayed PostgreSQL 17, and the exact ten-suite
PostgREST preflight passed 84/84 with `RCF_REQUIRE_TEST_DB=1`. The full local stack first failed
closed on the unused Studio container's invalid package config; the documented essential-services
start retained real PostgreSQL, GoTrue, PostgREST and Kong and excluded only Studio, storage,
realtime, edge runtime, imgproxy, postgres-meta and mailpit. The final lock-only tree contains only
`@lhci/cli@0.15.1 -> uuid@8.3.2`; the direct production tree is empty.

- [x] Task 4

## Task 5 — local full gates, then independent review

With Node 24.14.0 and the reviewed dummy CI environment, run the repository Definition of Done:

- `npm run audit:prod`;
- `npm run lint`, `npm run type-check`, `npm run type-check:build`, `npm run format:check`;
- `node scripts/build-embed.mjs --check`, then `npm run build`;
- the exact CI coverage command;
- `node scripts/run-db-invariants.mjs` against disposable PostgreSQL 17;
- the full disposable Supabase/PostgREST preflight and `npm run test:e2e` with all 97 tests;
- the local built-embed fixture and the realtime server's existing test/audit equivalents.

Run normal hooks. Obtain a fresh `/ks-review`; do not create a ship-allowed review by editing the
footer yourself. If review changes application, dependency or test behavior, return through
`/ks-execute`, rerun the affected local gates and obtain a fresh review before shipping.

Local gate evidence, 2026-10-12, all under Node 24.14.0:

- production audit found 0 vulnerabilities; lint had 0 errors and 34 inherited warnings; both
  type checks and the repository format check passed;
- the embed artifact was current at 45,818 / 33,059 / 13,141 gzipped bytes, and the production
  Next build passed;
- exact CI coverage passed 495 suites and 7,528 tests (2 suites / 39 tests skipped by their
  existing gates), with 76.42% statements, 70.25% branches, 74.3% functions and 77.11% lines;
- the PostgreSQL 17.11 replay ran all 16 named suites: 121 passed and the one PostgREST-only case
  skipped by design; the separate real PostgREST preflight is recorded under Task 4;
- the built-embed Playwright harness passed 6/6 and the strict product suite passed 97/97 with
  zero failed, skipped or flaky tests;
- a clean realtime production install and moderate audit found 0 vulnerabilities.

The checkbox remains open until the required independent review and normal commit hook complete.

Current-main integration evidence, 2026-10-13, all under Node 24.14.0:

- the seven PR #91 regression suites passed 135/135, and the independent integration review
  re-ran the two changed suites 20/20 plus both fixed-valid-v4 freshness mutations;
- production audit, lint (33 inherited warnings, zero errors), both type checks, format, embed
  freshness and the production build passed;
- the exact CI coverage command passed 535 suites and 8,000 tests (2 suites / 38 tests skipped by
  their existing gates), with 77.22% statements, 71.39% branches, 75.3% functions and 77.98%
  lines;
- the PostgreSQL 17.11 replay ran all 19 named suites: 168 passed and the one PostgREST-only case
  skipped by design; the already recorded real PostgREST preflight covers the unchanged bulk
  route boundary;
- the built-embed Playwright fixture passed 6/6, the realtime production audit found zero
  vulnerabilities, and the independent integration review passed with no findings.

- [x] Task 5

## Task 6 — ship the reviewed replacement, run hosted checks, then supersede PR #91

After Task 5 ends with `Ship allowed: yes`, run `/ks-ship` to push the reviewed branch and create
the draft replacement PR. Hosted workflows are pull-request-triggered, so none of their results is
claimed before this step. The PR description names the before/after generator, the removed
dependencies, the seven-suite and PostgREST evidence, and the still-open s109 tooling scope.

Wait for and verify the replacement PR's current head: Lint/Test/Build, TypeScript, E2E including
the PostgREST preflight and all Playwright tests, built-embed fixture, realtime production audit,
comparison Lighthouse and Vercel preview. Diagnose a failure; do not manufacture green by retrying
unchanged deterministic failures or weakening a gate. A source/test/dependency repair returns
through `/ks-execute` and fresh `/ks-review` before another ship attempt.

When the reviewed replacement head is green, close PR #91 as superseded and link the replacement.
The existing remaining-work goal plus validation of this plan authorizes the normal push, draft PR,
hosted-check coordination and that superseding closure; no extra permission handoff is inserted.
Do not merge the replacement PR or mutate production under this plan. Repository ship mode remains
manual.

- [ ] Task 6

## Expected files

- `src/app/api/bulk/import/route.ts`
- `src/app/api/bulk/update/route.ts`
- Existing bulk route tests that capture the two operation rows
- `package.json`
- `package-lock.json`
- `docs/research/s108-native-operation-ids.md`
- `docs/plans/s108-native-operation-ids.md`
- `docs/reviews/s108-native-operation-ids.md` created by the independent review

Embed allocation: 0 bytes. No migration, provider call, production mutation or new dependency.

## Validation checkpoint

**Validate this plan?**

- **Validate native replacement:** authorize tasks 1–6: implementation, local verification,
  independent review, normal push and draft-PR creation, hosted-check diagnosis, and closing PR
  #91 as superseded only after the replacement's reviewed current head is green. Merge and
  production remain manually gated.
- **Keep UUID 11.1.1:** reject this implementation plan; document the compatible patched pin and
  prepare a close-only disposition for PR #91 instead.
- **Rework for UUID 14/Jest ESM:** reject and rescope as a broader test-platform decision.

Plan validated by the recorded human checkpoint below.

## Human validation — 2026-10-12

The owner answered **“Validate all three recommended plans”** to the native question linking
s108, s109 and s99. This validates this reviewed plan, including implementation, independent
review, draft PRs and CI. s108 may supersede #91 after its replacement passes. s109 leaves the
two extract-zip alerts open with the stated temporary acceptance. These bounded stories may
proceed while the separate AI-translation backlog gap remains open. Their merges and production
changes remain separate from this plan validation.
