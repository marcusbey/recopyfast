# Review — Story s60-public-content-timing

> Fresh-context review. Each issue is classified critical / major / minor.
> Diff reviewed: `git diff main...feature/s60-public-content-timing`, commit
> `e21563787793cf00982c6899bb218258e8032c2c` on `9aa492d5afee05268e24440dc679d20214840bc9`.
> The reviewed commit tree is `0158c51309a9b26f8dcfe6a51bd784690764cf11`.
> Judged against the validated plan, research, `AGENTS.md`, and ADRs 002, 006 and 030.

## Summary

No critical, major or minor issue remains in the final diff.

The public content response no longer waits for advisory liveness bookkeeping. A successful
widget read schedules the existing best-effort write with Next `after()`; dashboard reads,
authorization failures and content-read failures schedule nothing. A deferred write failure is
logged without changing the already-built response or its CORS header.

Page-scoped public hydration now asks PostgREST for exact counts and avoids the terminal empty
wave when the latest reliable per-scope count is exhausted. Legacy all-site reads and every other
helper caller remain on empty-page termination. Counts are refreshed on each counted page so an
insert before an offset cannot hide an originally existing tail row; one missing or invalid later
count permanently restores the empty-page fallback for that scope.

The review found three issues before the final commit, all resolved and regression-tested:

- exact count was initially enabled for legacy all-site hydration as well as the measured
  page-scoped path;
- the first implementation froze the first count and could omit an old tail row after a
  concurrent insert shifted a capped page;
- the pending-write test initially asserted settlement only after releasing the held write.

## Plan and scope compliance

- [x] **Task 1 — deferred liveness.** `GET /api/content/[siteId]` calls `after()` only after a
  successful widget authorization, content read and response transformation. Tests cover one
  scheduled write, no dashboard/auth/read-failure write, a deliberately pending write, and an
  unchanged 200 body/CORS header when the deferred write throws.
- [x] **Task 2 — exact-count pagination.** Tests cover one-wave completion, server caps, zero,
  missing/null/negative/fractional/NaN/infinite/unsafe/string counts, a later missing or invalid
  count, a growing count caused by an inserted boundary row, stale high/low counts, first and
  later errors, per-scope parallelism and deterministic ordering.
- [x] **Task 3 — local proof and independent review.** Lint, full and production type-checks,
  format, build and Jest are green. Package manifests and lockfiles are unchanged. The widget,
  authentication helpers, font gating, caching, SSR, staging runtime and embed artifacts have no
  diff.
- [ ] **Task 4 — release-stage proof remains.** Two five-pair read-only helper benchmarks are
  recorded. The final imported helpers returned the same 258 rows in every pair, reduced
  PostgREST reads from four to two, and improved median time from 346 ms to 268 ms (23%). One
  candidate pair was slower, so the evidence does not claim a uniform speedup. A deployed
  full-API/browser measurement, exact paint-to-response timing, failure fallback on a real
  visitor page, PR/CI evidence and post-deploy revision check cannot exist before the manual
  release and remain explicit verification work below.

The branch also carries the new `docs/stories.md` entry although the repository lifecycle normally
lands framing docs on `main` before story work. The user approved this concrete branch plan while
`main` remains protected by manual merge, so this is recorded as a nonblocking lifecycle deviation,
not a source or runtime finding.

## Anti-hallucination and rules check

- `next/server` in the installed Next 16.3.5 package exports
  `after<T>(Promise<T> | (() => T | Promise<T>)): void`; the same primitive is already used by
  editor-code and publish routes.
- Supabase PostgREST `select` accepts `count: "exact"` and returns `count: number | null`.
  Exact count is a real `COUNT(*)`, which is why the final benchmark and page-scoped opt-in matter.
- `recordSiteReport(supabase, siteId)` exists with the used signature and throws database write
  errors for the existing best-effort wrapper to log.
- All five other `fetchPageScopedRows` callers were opened. None requests a count, so each keeps
  its prior empty-page behavior.
- Service-role authorization order, CORS selection, published/original fallback, staged metadata
  secrecy and deterministic row order are unchanged. ADR 002's principal boundary, ADR 006's
  widget-only liveness signal, and ADR 030's public staging boundary remain intact.
- No dependency, schema, endpoint, response field, widget byte, source-copy hardcode, font wait,
  cache, SSR bridge or whole-page mask was added.

## Verification

- **Reviewer full suite:** `npm test -- --runInBand` with the CI inert environment — **310 suites
  passed, 2 skipped; 4,037 tests passed, 38 skipped, 0 failed**. The run used the frozen working
  tree; its recorded hashes and Git tree match final commit `e215637` exactly.
- **Reviewer focused suite in an isolated archive:** route plus helper — **66/66 passed** before
  mutation and **66/66 passed** after restoration.
- **Final repository gates:** lint **0 errors** (35 existing warnings), `type-check`,
  `type-check:build`, `format:check` and `build` passed. The production build compiled on Next
  16.3.5 and rebuilt the unchanged embed at 45,759 bytes gzip, within its current 45,880-byte
  ratchet.
- **Production dependency audit remains red by design:** `npm run audit:prod` reports six known
  advisories — 1 critical, 2 high, 2 moderate and 1 low. No dependency changed. This review does
  not waive that separate release gate.

### Mutation proof

Mutations ran only in archive `/tmp/s60-final-review.t9XuLm`; source files in the story worktree
were never changed. Both archive files were restored byte-for-byte before the final green run.

| Mutation | Result |
| --- | --- |
| Freeze the first valid exact count with `exactCountTarget ??= result.count` | **1 red / 24**: the inserted-boundary regression omitted original row 199 |
| Replace deferred `after()` liveness with the old awaited write | **3 red / 42**: scheduling, pending-response timing and deferred-error tests |

## Regressions checked

- Page and shared scopes still start concurrently and retain independent count/fallback state.
- Missing counts never become trusted later; a count that disappears mid-read disables count
  termination for the rest of that scope.
- Every returned page is preserved even when cumulative rows exceed the latest count.
- First- and later-page errors still return no partial data.
- A missing `page_path` retains the legacy all-site query and terminal empty request.
- Dashboard reads do not update visitor liveness. Failed authorization and failed content reads
  still exit before scheduling background work.

## Findings

None.

## Not verified

- **Deployed visitor timing.** The final code was not merged or deployed during review. After the
  dependency gate is cleared and the exact reviewed revision is deployed, load the real
  aicompoz.com landing page at least five comparable times, record API response end and
  paint-to-response range/median, and confirm the saved hero text replaces the authored text.
- **Real `after()` execution.** Unit tests capture and run the callback, and the production build
  compiles it, but no deployed function invocation proved that `last_reported_at` advances after
  the response. On a controlled site, compare the timestamp before and after one widget read and
  inspect logs for a forced or naturally occurring write failure without altering the response.
- **Large scoped-page performance.** Correctness under server caps and changing counts is covered,
  but the benchmark's two scopes each completed in one counted wave. Repeated exact `COUNT(*)`
  cost on a genuinely multi-wave scoped page was not measured.
- **Browser and CI.** The reviewer did not run Playwright or a hosted PR CI run. No widget code
  changed, but the release should retain the existing real-page rendering checks.
- **Production release.** No PR, merge, deployment or production revision identity was created or
  inferred by this review. The six-advisory audit failure must be cleared before release.

Max severity: none
Ship allowed: yes
