# Review — Story s60-public-content-timing

> Fresh-context review of `git diff origin/main...feature/s60-public-content-timing`.
> Pinned commit: `b2c3a9e8e4012b8cb986c1bb3e1396fa9e4109b5`.
> Pinned tree: `d1c64704b6010aa7d65cf1ac371dd4155cada410`.
> Base: `origin/main` at `4aed967e93cb8f3c09f12ccfaa0545926e3bb30a`.
> Judged against the validated plan, research, `AGENTS.md`, ADRs 002, 006 and 030,
> and the exact production-security baseline already merged into main.

## Verdict

The final diff correctly removes two avoidable waits from the public content path. A successful
widget read schedules advisory liveness through Next `after()` instead of awaiting it; dashboard,
authorization-refusal and content-read-failure paths schedule nothing. Page-scoped public reads use
fresh exact counts to avoid known-empty terminal requests while preserving server caps, legacy
unknown-count behavior, returned rows, deterministic ordering and error propagation.

The s60 source files are byte-identical to the previously reviewed timing candidate after merging
the s64 security baseline. Both production audits now pass at the exact final source. I found
no critical, major or minor issue.

## Plan and scope compliance

- [x] **Deferred liveness.** `GET /api/content/[siteId]` schedules one `recordSiteReport` only
  after successful widget authorization, content retrieval and response transformation. The
  response settles while a deliberately held write is pending, and deferred failure cannot alter
  its body, status or CORS header.
- [x] **Principal boundary preserved.** A first-party dashboard session never records visitor
  liveness. Authorization failures and untyped authorization exceptions return before scheduling;
  content-read failures also schedule nothing. Site-token authorization and per-request CORS have
  no source diff beyond the moved bookkeeping boundary.
- [x] **Exact-count pagination is narrowly enabled.** Only a normalized page-scoped public GET
  requests `{ count: "exact" }`; an omitted `page_path` retains the legacy projection and
  empty-page termination. The page and shared scopes each own their count/fallback state.
- [x] **Changing-count correctness.** Every reliable later count replaces the prior target, so an
  insertion before the current offset cannot hide the original tail. Once a count is missing or
  invalid, that scope permanently returns to empty-page termination. Returned pages are never
  sliced to a count, and first/later query errors return no partial response.
- [x] **Server caps and ordering preserved.** The next range advances by rows actually returned,
  not the requested 1,000-row size. Page/shared reads remain concurrent and the combined result is
  still sorted by `element_id`, then `id`.
- [x] **No scope expansion.** There is no widget, staging, cache, schema, dependency, manifest,
  authentication helper, billing, CSP, endpoint or response-field change. The global Jest mock only
  adds the real `next/server.after` surface needed by routes that already use it.
- [ ] **Release-stage proof remains.** The reviewed helper benchmark is local/operator evidence.
  Exact deployed revision, full API/browser timing, visible published copy and failure fallback are
  still post-merge checks under task 4b.

The branch carries its approved `docs/stories.md` entry although framing docs normally land on
main before story execution. This remains the previously recorded nonblocking lifecycle deviation;
it does not change runtime behavior or the reviewed source boundary.

## API and anti-hallucination checks

- Installed Next 16.3.8 exports `after<T>(Promise<T> | (() => T | Promise<T>)): void`, matching
  the callback used by the route.
- The installed Supabase/PostgREST client accepts `select(columns, { count: "exact" })` and returns
  `count: number | null`; the route requests that option only for scoped public hydration.
- `recordSiteReport(supabase, siteId)` exists with the used signature, updates only
  `last_reported_at`, and throws write errors for the existing best-effort wrapper to log.
- All five other production callers of `fetchPageScopedRows` were inspected. None opts into exact
  counts, so each retains the prior unknown-count path.
- The final rebase changed none of the timing source, route tests, helper tests, research or plan
  bytes from commit `23ada77`; it only incorporated the already-reviewed security baseline.

## Independent verification

All reviewer commands used Node 24.14.0 unless noted:

- Focused route/helper run: **66/66 tests passed**.
- Full Jest: **310 suites and 4,037 tests passed**; 2 suites / 38 tests skipped; zero failures.
- Lint passed with 0 errors / 35 inherited warnings. `type-check`, `type-check:build` and the
  configured `format:check` passed.
- Root and server `npm audit --omit=dev --json` both exited 0 with zero vulnerabilities.
  `npm ls --all --omit=dev` exited 0 in both dependency trees.
- The Next 16.3.8 production build compiled, type-checked and generated all routes successfully.
  Expected inert-environment Redis, Supabase and pricing diagnostics remained non-fatal.
- Embed freshness and fixed Node 24 gzip ceilings passed unchanged: 45,880-byte bundle,
  33,120-byte widget and 13,141-byte transport.
- `git diff --check` is clean. The pre-existing untracked `.lavish/` directory was preserved and
  excluded from the review.

### Mutation proof

Mutations ran only in disposable archives of the pinned commit and were removed from the active
workspace afterward. The source worktree remained byte-clean.

| Neutralized behavior | Result |
| --- | --- |
| Freeze the first valid exact count with `exactCountTarget ??= result.count` | **1 red / 23 green**: the inserted-boundary case omitted the original final row |
| Replace deferred `after()` liveness with the old awaited write | **3 red / 39 green**: scheduling, pending-response and deferred-failure assertions |

## Findings

None.

## Not verified here

- Hosted CI for the final pinned SHA remains a mandatory merge gate. This source report does not
  turn a pending or failed check green.
- No merge, deployment, production request or customer content mutation ran in this review.
- Deployed `after()` execution still needs a controlled timestamp observation: the content response
  must finish first, then `last_reported_at` must advance without changing that response.
- The real aicompoz homepage still needs the plan's comparable visitor measurements after deploy:
  full API response range/median, paint-to-response timing, correct hero copy and failure fallback.
- The helper covers capped and changing multi-page results. Repeated exact `COUNT(*)` cost on a
  genuinely large hosted page remains production performance evidence, not a source correctness gap.
- Registry advisories can change without a source commit. Final CI and the merge operation must use
  the current audit result rather than treating this report as a permanent waiver.

Max severity: none
Ship allowed: yes
