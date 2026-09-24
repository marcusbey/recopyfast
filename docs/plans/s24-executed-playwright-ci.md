---
validated: yes
---

# s24 — Execute Playwright in CI

Validated by the user's explicit "yes" on 20 September 2026 after the three plan links and
summaries were presented. This is test infrastructure, not a product UI.

## Tasks

- [x] Add test-first URL safety helpers/global setup that reject every service-role/mutating run
  unless Supabase, app and WebSocket targets are loopback and are not the production project.
- [ ] Reproduce the ephemeral stack locally: clean root/server install, `supabase start`, local
  Redis, local Socket.IO and production Next on deterministic ports. Capture local anon/service
  values in process environment only; never commit or print keys.
- [ ] Repair shared fixtures/cleanup so core share→edit→publish and two-client parity self-seed
  run-scoped records, restore content and delete only captured IDs. Remove all four skip gates only
  after each test fails before its fixture and passes after it.
- [x] Replace GitHub's missing-secrets success guard with a Docker-backed local Supabase/Redis
  workflow. Install server deps, build/start both services, wait on readiness, run Playwright with
  `RUN_RECOPYFAST_CORE_E2E=1` and `RUN_RECOPYFAST_PARITY=1`, always upload redacted reports and stop
  services. The job must fail if setup or tests fail.
- [x] Update stale E2E/Supabase documentation and exact expected executed test count. Preserve all
  root unit/type/audit/build gates; never convert a failure into a skip or continue-on-error.
- [ ] Run clean local E2E twice to prove isolation, plus precommit/prepush. Obtain fresh review,
  open a draft PR, require GitHub logs to show actual Playwright steps/tests, then use the user's
  completion authorization to squash-merge and verify main CI repeats the executed run.

## Boundaries

No hosted staging project, production credential, provider mutation, saved browser auth, payment,
test narrowing or relaxed gate. If local Supabase cannot apply the existing migration catalogue
without data/schema changes, stop for plan revalidation rather than pointing CI at production.

## Execution evidence and open proof

- Guard/reporter/workflow contracts: 4 Jest suites, 27 tests passed. The first run was red because
  the guard and reporter modules did not exist; the workflow contract was red against the old
  missing-secret skip job.
- Static browser inventory: 39 tests in 9 files; zero `test.skip`/`describe.skip` declarations.
- Root gates: placeholder-env `npm run precommit`, `npm run format:check`, placeholder-env
  `npm run prepush`, `npm run audit:prod`, `npm run type-check:build`, embed freshness and
  `git diff --check` passed. The first environment-free precommit run exposed four existing tests
  that depend on the same placeholder Supabase/App variables CI already supplies; no test or app
  behavior was changed to hide that dependency.
- Full-stack proof remains open. Docker Desktop started once, then `supabase start` hit anonymous
  ECR rate limits followed by an overlay-layer `input/output error`; the Docker daemon exited and
  returned `EOF`. One explicit daemon restart did not recover it. No migration, Playwright or
  twice-clean-run result is claimed from that failed infrastructure attempt.
