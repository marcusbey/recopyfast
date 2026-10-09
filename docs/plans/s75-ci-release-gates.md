---
validated: yes
---
# Plan — Story s75-ci-release-gates

> CTO decision under the owner's 2026-10-09 directive.

Branch: `feature/s75-ci-release-gates` (from `origin/main` `72f4cff`).
Research: `docs/research/s75-ci-release-gates.md` — read it first; this plan does not repeat it.
No Design step: no UI. No migration. No embed byte moves (allocation 0).

## Decisions

1. **PostgreSQL 17 everywhere CI touches a database.** The replay service becomes `postgres:17`
   (the official image, floating within the major like today's `postgres:14`), the runner accepts
   only `17xxxx`, and `supabase/config.toml` says `major_version = 17`. Production is 17.4.
2. **All seven suites go to the replay step** (`scripts/run-db-invariants.mjs`), because none
   needs PostgREST or GoTrue and `content-attributes-lifecycle` refuses the Supabase port. The
   runner also sets `RCF_S29_DB_URL` for `editor-activation-concurrency`.
3. **CTO decision: the replay step verifies what ran, not only what failed.** The runner reads
   Jest's `--json` report and fails, naming the suite, when a named suite produced no result,
   has no passing real test, or registered a `[gated]` placeholder other than "no PostgREST
   target configured" (the replay has no PostgREST by design and those halves run in the e2e
   job; found at execution: `edit-sessions-privileges` registers one in the replay). It does not
   forbid skips: the PostgREST-only test in `column-privileges` skips there by design. The check
   is a pure function, `findSuitesThatDidNotRun`, in `scripts/db/replay-checks.mjs` (the module
   task 1 creates for the version check), tested with `node --test` and named in CI like the
   other script tests. Reason: two of the seven gate on their own variables and one skips
   silently; a renamed variable or a misspelled path must be loud.
4. **Coverage rides the existing Jest step** (`--coverage --coverageReporters=text-summary`)
   rather than a second full run: one run, and Jest names the threshold it missed. Thresholds
   ratchet to the final tree's measurement, rounded down. A contract test holds the floors, the
   same two-place pattern as the embed ceilings, so lowering one shows in review.
5. **CTO decision: Node 24 LTS, not 22.** The triage said 22. Verified instead: Node 20 is already
   past end of life (2026-04-30, not "approaching"); 22 leaves ~6 months (2027-04-30) before the
   same migration again; 24 is the active LTS to 2028-04-30; Vercel supports `24.x` and
   discontinued `20.x` on 2026-10-01; the server audit (`server-security.yml`) and every local
   gate already run 24.14.0. CI moves to `"24"` (floating within the major, as today), the
   realtime image to `node:24-alpine`, and `package.json` gains `engines.node: "24.x"` so Vercel
   runs what CI tested. Reverting to 22 is a five-line change if the owner prefers it.
6. **CTO decision: `node:24-alpine` stays a major tag, not a digest.** A digest with no update bot
   freezes Node's security patches; the tag picks them up on each `fly deploy`. s69 L16 is
   ticked with this recorded: its "unpinned" half is declined, not deferred.
7. **CTO decision: actions are pinned to the first Node-24-native release of each action**
   (checkout v5.1.0, setup-node v5.0.0, upload-artifact v6.0.0; setup-cli v3.0.1, which `@v3`
   already resolves to). Removes the "Node.js 20 is deprecated" annotation with no behaviour
   change we use; later majors are a separate, deliberate bump. No Dependabot config is added
   (out of scope; follow-up).
8. **Permissions: `contents: read` at workflow level** in `ci.yml` (as `server-security.yml`
   already does). No job needs more: caches and artifacts use the runtime token, not
   `GITHUB_TOKEN`.
9. **CTO decision: delete `e2e-billing-tests.spec.ts`.** Superseded and partly invalid (research
   fact 10). The strict e2e count stays 80. The 401s it alone claimed (`payment-methods`,
   `subscription` POST/PUT/DELETE, `reactivate`) go to the follow-ups.
10. **AGENTS.md: three factual edits only** (embed figure, coverage floor, the CI sentence of the
    Definition of Done), as the triage asked. No rule changes. `docs/architecture.md:431` is not
    touched (follow-up).

## Tasks (ordered, test-first)

The contract test is `src/__tests__/ci/release-gates.test.ts`, built task by task: each task adds
its assertions, watches them fail for the right reason, then makes them pass.

- [x] **1. PostgreSQL 17.** Assert: the `ci.yml` replay service image is `postgres:17`; the
  runner's version check accepts exactly major 17; `supabase/config.toml` `major_version = 17`;
  all three equal the production major. Red, then change `ci.yml` (image, comments, step name),
  `run-db-invariants.mjs` (check, error text naming `RCF_POSTGRES_BIN` and 17, temp-dir prefix)
  and `config.toml`. Prove: runner green on local 17.11 with `RCF_POSTGRES_BIN`; runner red on
  14.17 with the new message.
- [x] **2. Seven suites wired.** Assert: every `src/__tests__/db/*.test.ts` is named by the runner
  or by a `ci.yml` step. Red (seven missing), then add them to the runner's list and set
  `RCF_S29_DB_URL`. Prove: runner on 17 runs 13 suites.
- [x] **3. Runner guard.** `scripts/__tests__/replay-checks.test.mjs` (`node --test`): a missing
  suite, a suite with zero passing tests, a `[gated]` title and a fully skipped suite each fail
  with the suite's name; a run with one by-design skip passes. Red (export missing), then
  `findSuitesThatDidNotRun` in `scripts/db/replay-checks.mjs`, wired into the runner after Jest.
  Contract: the `ci` job names the node test. Mutation: drop `RCF_S29_DB_URL` from the runner →
  the replay fails naming `editor-activation-concurrency`.
- [x] **4. Coverage ratchet in CI.** Assert: the `ci` job's Jest step passes `--coverage`; each
  `jest.config.js` threshold is ≥ the s75 floor. Red, then the step and the ratchet (final
  measurement).
- [x] **5. `format:check` in CI.** Assert the `ci` job runs `npm run format:check`. Red, then the step.
- [x] **6. Permissions and SHA pins.** Assert: every workflow has a top-level `permissions:` of
  exactly `contents: read` and no `write`; every `uses:` is `owner/repo@<40 hex> # vX.Y.Z`. Red,
  then both workflows. Existing test changed: `playwright-ci-contract.test.ts:21` asserted the
  tag `supabase/setup-cli@v3`; it now asserts the v3 SHA pin.
- [x] **7. Node 24.** Assert: every `node-version` in both workflows is major 24, the Dockerfile is
  `FROM node:24-alpine`, `package.json` `engines.node` is `24.x`. Red, then `ci.yml`,
  `server/Dockerfile`, `package.json` (+ the lockfile's root `engines`).
- [x] **8. Playwright specs live in `e2e/`.** Assert no `*.spec.*` file at the repo root. Red, then
  delete `e2e-billing-tests.spec.ts`. `playwright test --list` still reports 80.
- [x] **9. Facts.** `AGENTS.md:108`, `:228`, `:239-240`; s69 L16/L19 annotations in
  `docs/stories.md`; the "PostgreSQL 14 runner" comment in `edit-sessions-privileges.test.ts:40`;
  the two `Dockerfile:16` references in `server-manifest.test.ts` comments (now `:21`, after the
  Dockerfile's new comment); an "In CI" section in `src/__tests__/db/README.md`. YAML of both
  workflows parses.

## Found during execution

- **`content-attributes-lifecycle` teardown race (harness, not product).** In the runner's fresh
  PostgreSQL 17 cluster the suite failed 2 of 5 runs with "Unhandled error … terminating
  connection due to administrator command" (57P01) after all of its tests had passed. Cause:
  pg-pool 3.10's `end()` resolves once idle clients are *asked* to close (`_pulseQueue`), its idle
  clients keep an error listener that re-emits on the pool, and the pool had no listener; the
  teardown's `DROP DATABASE … WITH (FORCE)` then terminated a still-closing backend. Fix in the
  suite's `afterAll`: a pool `error` listener that tolerates only 57P01 and rethrows anything
  else. After: 6 of 6 fresh-cluster runs green. No assertion changed.

## Execution evidence (local, 2026-10-09)

- Runner on a fresh PostgreSQL 17.11 cluster (`RCF_POSTGRES_BIN=/opt/homebrew/opt/postgresql@17/bin`):
  72 migrations + 4 re-applied, 13 suites, 90 passed / 1 skipped (the PostgREST-only test),
  "all 13 named suites ran against PostgreSQL 17". On 14.17 it refuses: `requires PostgreSQL 17;
  server reported "140017"`.
- Final tree, the exact CI Jest command: statements 68.62, branches 61.56, functions 65.72, lines
  69.23 — identical to the baseline; floors 68/61/65/69 hold.
- Both workflows parse (`js-yaml`) and pass `@action-validator/cli`.
- `playwright test --list` (CI mode): 80, unchanged.

## Gates

Full Jest (with the CI env), `type-check`, `type-check:build`, `lint`, `format:check`,
`build:embed -- --check`, `playwright test --list`, `node --test` on every script test, the
runner on local PostgreSQL 17, a YAML parse of both workflows. One story commit after the docs
commit.

## Follow-ups (not this story)

- 401 pins for `payment-methods`, `subscription` POST/PUT/DELETE and `subscription/reactivate`.
- The B-3 oracles in `share-rls.test.ts` / `share-owner-lockout.test.ts`: fold into `db-harness`
  or delete; the A-9 one is stale against the current schema.
- Dependabot (or Renovate) for `github-actions`, so SHA pins do not rot; then a deliberate bump to
  the current action majors.
- `docs/architecture.md:431` coverage figure.
- `e2e-run-tests.mjs` (repo root): a manual Playwright script with the deleted spec's stale
  checks, wired nowhere — delete or fold.
- `supabase/README.md` "Playwright's disposable local database" still says 44 tests; CI expects 80.
