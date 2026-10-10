# Review — s75-ci-release-gates

Reviewer: fresh-context `reviewer` subagent, 2026-10-09. Diff: `git diff origin/main...feature/s75-ci-release-gates`
(72f4cff → c02f3e2; be070c8 docs).

## Verdict summary

All 9 plan tasks present; nothing beyond the plan. Gates: CI-identical jest with coverage 382 suites / 4,958 (coverage
68.62 / 61.56 / 65.72 / 69.23, identical across three runs incl. TZ=UTC — deterministic); type-check (both), lint,
format:check, build:embed (45,828) exit 0; node script tests 39/39; action-validator passes both workflows; Playwright
`--list` 80 everywhere; real replay on local PostgreSQL 17.11: 13 suites, 90 passed, 1 skipped by design.

Action pins resolved through the GitHub API, all lightweight tags pointing at the commented commit: checkout v5.1.0
`fbc6f399…`, setup-node v5.0.0 `a0853c24…`, upload-artifact v6.0.0 `b7c566a7…`, supabase/setup-cli v3.0.1 `45a513f8…`
(same commit as `@v3`). Supabase CLI 2.117.0 accepts `major_version = 17` (config.go:1035). Vercel lists 24.x and
discontinued 20.x on 2026-10-01. Node 24 production risk low: no native module compiled at install (sharp/@next/swc
prebuilt), Next 16.3.8 requires >=20.9, the realtime server has no native addons and already audits on Node 24.14, no
removed Node 22–24 API in use. `contents: read` suffices (no job uses GITHUB_TOKEN). 57P01 teardown exception narrow.
Deleted root billing spec never ran (testDir ./e2e) — no running check lost.

23 mutations (guard logic M1–M7, ci.yml/config/engines/Dockerfile/supabase major/permissions M10–M23) red; R1 real
replay without RCF_S29_DB_URL exits 1 naming the suite.

## Findings

**major** — `scripts/run-db-invariants.mjs:259-265`: nothing pins that the runner acts on the guard. Ignoring
`problems` (M8) or widening the tolerated `[gated]` pattern (M9) left every test green; R2 (R1 + M8) exited 0
printing "all 13 named suites ran" with 2 tests skipped — contradicts AC "goes red when any one is undone".
**minor** — `docs/stories.md` conflicts with main (s73 append) — rebase. **minor** — plan/research name a
"subscription POST" 401 follow-up; the route exports GET/PUT/DELETE only.

## Not verified

The e2e job on Supabase 17.6 (`supabase start`, 8 named DB suites, 80 Playwright tests); runner psql vs postgres:17
service; `npm ci` on npm 11 / Node 24 on GitHub and Vercel (check the first preview log says Node 24.x); coverage as
measured on GitHub (compare with 69.25 lines); `node:24-alpine` on Fly at the next deploy (`/health`, 512 MB VM);
the teardown fix across CI runs.

## Fix pass `f336445` (rebased onto fc5968b)

Major fixed: the post-Jest check is one exported function, `verifyReplayReport(reportFile, suites, repoRoot)` in
`scripts/db/replay-checks.mjs` (tolerated placeholder fixed inside the module, not a parameter); the runner only prints
its result. Node tests (red against an always-success stub first): skipped suite, untolerated placeholder, tolerated
PostgREST placeholder, every failing suite named, missing report, unreadable report. `release-gates.test.ts` pins the
runner passing `--json` + the report file and calling the check exactly once with `REPLAY_SUITES`, with no success line,
no `findSuitesThatDidNotRun`, no `[gated]` and no `catch` of its own. Mutations M8a/M8b/M8c/M9/M9b/M10/M11/M12 red.
Real replay on PostgreSQL 17.11: 13 suites, 90 passed, exit 0; without `RCF_S29_DB_URL` exit 1 naming
`editor-activation-concurrency` ("no passing test (2 registered)").

Billing 401 gap closed: `src/__tests__/api/billing/unauthenticated.test.ts` — anonymous callers get 401 and no billing call
on payment-methods GET/POST/DELETE, subscription PUT/DELETE, reactivate POST, each with a signed-in twin proving the
route does billing work (each guard disabled → its case red). Docs corrected (subscription has no POST).

Coverage on the rebased tree: 68.92 / 61.87 / 65.88 / 69.54 → floors unchanged at 68/61/65/69. Jest 383 suites / 4,985;
type-check (both) 0; lint 0 errors; format:check clean; build:embed 45828 / 33062; Playwright `--list` 80; node tests
20/20, 12/12, 14/14. Reviewed by the orchestrator (not the author).

Max severity: minor
Ship allowed: yes
