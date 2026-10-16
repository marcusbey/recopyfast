---
validated: yes
---

# Plan — Story s116-ci-test-inventory

Branch: `feature/s116-ci-test-inventory`, based on released main `1cbf586`.
Research: `docs/research/s116-ci-test-inventory.md`.
Owner request: fix the tests missing from CI and preserve every unfinished worktree.
No product, UI, embed, dependency, migration, package-manifest or branch-protection change.

## Reviewed approach

Use one small standard-library Node test runner with an explicit list of reviewed fixture-only
files. Discover all `scripts/**/*.test.mjs` and compare that set with the list before executing
anything. A missing or unexpected file fails by name. This prevents silent omission and avoids
automatically executing an unreviewed provider test. It is an inventory guard, not a network
sandbox: transitive imports and changes inside known files still require normal code review.

Run the six reviewed files sequentially: the existing five (79 baseline assertions) plus a new
`scripts/__tests__/node-test-runner.test.mjs`. Require a valid nonempty TAP summary with zero
failures, cancellations, skips and todo, and consistent totals. Report actual per-file counts;
do not pin counts or file hashes that would require unrelated bookkeeping for every new test.

Move valid conditional database assertions into existing required PG17 suites. Replace the stale
web-role INSERT expectation with the actual service-role write boundary. Remove two vacuous
connectivity guards. Remove the obsolete 30-test hero suite only after checking the current
coverage map. Preserve browser inventories 106/7 and all performance/coverage/size thresholds.

## Tasks (test-first, six bounded steps)

- [x] **1. Establish the inventory contract in failing tests.** Extend
      `src/__tests__/ci/release-gates.test.ts` to require the shared Node runner in the required CI
      job and retain existing browser/gate contracts. Add fixture-only
      `scripts/__tests__/node-test-runner.test.mjs` for missing/unexpected files, valid results,
      zero tests, missing/malformed summaries, failed/cancelled/skipped/todo cases and inconsistent
      totals. An unknown test with a marker side effect must be rejected before any child executes.
- [x] **2. Wire every reviewed Node test.** Add `scripts/run-node-tests.mjs` with the six reviewed
      file paths and brief fixture/network notes. Validate complete discovery before spawning;
      execute using `process.execPath --test --test-reporter=tap`, retain output and fail on an
      invalid/incomplete result. Replace the four manually named CI commands with this runner.
      Keep `package.json` and its lockfile untouched, avoiding overlap with draft PR #90.
- [x] **3. Exercise valid content-write invariants.** Move the two meaningful DB cases from
      `src/__tests__/api/bulk/update-history-policy.test.ts` into required
      `src/__tests__/db/content-write-privileges.test.ts`, using the existing guarded disposable
      PG17/Supabase harness. Verify actual role privileges, denied authenticated UPDATE, unchanged
      stored content and the relevant history behavior, retaining a meaningful seed/trigger control.
      Remove only the superseded conditional block and duplicate DB helpers; retain source tests.
- [x] **4. Correct and exercise sharing-policy invariants.** Extend the required
      `src/__tests__/db/replay-privilege-convergence.test.ts` with the current service-role-only
      INSERT/UPDATE boundary and per-row DELETE authorization (`user_id`/`granted_by`). Use effective
      privileges and meaningful actor/write checks where the existing replay harness supports them;
      do not rely on policy names or array-existence checks. Remove the three old files' remaining
      conditional DB blocks after mapping their substantive cases: three original assertions are
      retained, one stale INSERT assertion is replaced, two connectivity-only cases are removed.
      Keep route/source tests in `share-rls.test.ts` and `share-owner-lockout.test.ts`.
- [x] **5. Retire obsolete skipped hero tests without losing current coverage.** Run the mapped
      current demo/page, reduced-motion, attract-loop, editable text/image and toolbar suites in the
      research. Keep the two real-input mobile browser cases. Delete only the obsolete
      `src/components/landing/__tests__/InteractiveHero.test.tsx`. If a current behavior lacks
      coverage, add a focused current-contract regression before removal; do not resurrect obsolete
      controls/copy. Explain the removed obsolete expectations in the PR. Expected remaining base
      Jest skips are the two activation-concurrency cases subsequently run by PG17 replay.
- [x] **6. Verify, review and open the PR.** Demonstrate failures for omitted/unknown inventory,
      skipped/todo/zero results, omitted CI runner, absent required DB flag, restored web INSERT and
      weakened DELETE authorization; restore each mutation. Run targeted suites, all reviewed Node
      tests, disposable PG17 replay and applicable PostgREST preflights, lint, both type checks,
      format, build/coverage and the unchanged 106/7 browser gates. Respect low disk space: do not
      delete any other worktree/cache to make room; use hosted gates for expensive checks when needed
      and report any local limitation. Independent review must pass before shipping. Normal hooks
      remain enabled; record actual final counts and changed semantics. Open one PR and verify its
      CI. Merge remains a separate human decision under AGENTS.md.

## Execution evidence before independent review

- Shared Node runner: 90/90 passed across all six reviewed files on exact Node 24.14.0; zero
  failed/cancelled/skipped/todo. Its focused contract killed missing, unexpected provider-like,
  zero, malformed, failure, cancellation, skip, todo and inconsistent-summary cases before a child
  could be treated as clean.
- Main Jest coverage command: 540 passed suites, one skipped suite; 8,068 passed and two skipped
  tests out of 8,070. The only skips are `editor-activation-concurrency`, subsequently executed by
  the PG17 replay. Coverage stayed statements 77.38%, branches 71.55%, functions 75.55%, lines
  78.16%; no threshold changed.
- Disposable PostgreSQL 17 replay: all 21 named suites ran, 190 passed and one by-design
  PostgREST-only case skipped. The moved content/history proof separately passed 9/9 on a full
  82-migration disposable PostgreSQL 17 replay.
- Mutations: restored authenticated site-permission INSERT/UPDATE produced two red assertions;
  unconditional DELETE policy produced one red predicate assertion; restored authenticated content
  UPDATE produced three red assertions. Each disposable database was restored to 8/8, 8/8 and 9/9
  respectively, then stopped and removed. Omitting the CI runner and requiring the DB lane without
  its target also failed closed.
- Current hero coverage: eight mapped Jest suites 32/32; the two production-build mobile real-input
  cases 2/2. The obsolete 30-case skipped file is deleted. App/fixture inventories remain 106 and 7;
  the built-embed fixture executed 7/7 with zero failed/skipped/flaky.
- Static/build gates: lint zero errors (31 inherited warnings), format check, full and production
  type-checks, embed freshness/size ratchet, production build, root production audit and realtime
  production audit all passed.
- `uptime-check.test.mjs` changed only because its previous final assertion required its removed raw
  CI command. It now requires the shared CI runner and verifies that runner explicitly reviews the
  uptime test; all 22 uptime behavior assertions are unchanged and pass.
- `playwright-ci-contract.test.ts` independently pinned the removed raw Stripe/snapshot commands.
  It now preserves the same gate by requiring the shared runner and both exact reviewed manifest
  entries; browser config/count assertions are unchanged.
- Local Docker is unavailable, so the full disposable Supabase/PostgREST preflight and all 106 app
  Playwright cases remain hosted-CI evidence. No production or hosted provider was used locally.
- Independent review on the final 15-path manifest
  `13f6022b8dc7a8a818e1246679a5afa49a1d2bbd8c533f3124d5edfdf347e9fb` ended
  `Max severity: none` and `Ship allowed: yes`. Push, PR creation and hosted CI follow this single
  normal-hooked story commit; merge remains a separate human decision.

## Acceptance and preservation

Every discovered script test has an explicit reviewed execution path and an enforced nonempty,
fully executed result. Valid formerly skipped DB semantics run on disposable PG17. No obsolete
hero skip remains. Existing browser counts and thresholds are unchanged, and every required
hosted gate passes. No provider credentials or production data are used by these tests.

Only this new s116 worktree may change. Never reset, stash, clean, archive, delete or overwrite
another worktree, branch, recovery ref or unfinished file. Test changes and their semantic reason
must be documented explicitly; fewer skips alone are not proof of stronger coverage.

Human validation is required before code under AGENTS.md and ks-plan. This checkpoint covers
implementation, independent review, normal commit/push, a PR and CI; it does not authorize merging.

Human validation: owner selected “Validate the CI repair plan” in this chat on 2026-10-16.
