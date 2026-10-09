---
validated: no
proposed_split_from: s03-activation-funnel
---
# Plan — Proposed story s03b-activation-funnel-surface

Branch after story validation: `feature/s03b-activation-funnel-surface`
Research: `docs/research/s03-activation-funnel.md`
Design: `docs/designs/s03-activation-funnel.md`
Dependency: proposed `s03a-activation-evidence`

## Goal

Give an authorized RecopyFast operator an honest, source-backed activation funnel for any UTC date
range without exposing global account data to ordinary customers.

## Tasks

1. [ ] **Lock the calculation and authorization contracts in failing tests.** Fixtures cover an
   ordinary user, `ADMIN_EMAILS` operator, `app_metadata.role=admin` operator, invalid/reversed
   ranges, zero accounts, partial funnels, an unconfirmed legacy account with null
   `account_confirmed_at`, unmeasurable legacy accounts with timestamps, durations
   `[1,2,9,10]`, a negative-duration corruption row, all five actor kinds and a service read error.
   Use one exact percentile
   rule: sort minutes and apply continuous linear interpolation at `(n-1)*p` for p50/p90.

2. [ ] **Create one server-only operator predicate.** New
   `src/lib/auth/operator-access.ts` exports `isOperatorUser(user): boolean`, trusting only the
   normalized server `ADMIN_EMAILS` allowlist or server-managed `app_metadata.role === 'admin'`.
   It never reads `user_metadata`. Both the API and page server component call this exact helper;
   the browser receives only `canViewActivation: boolean`, never the allowlist.

3. [ ] **Build the pure read-model calculator.** New
   `src/lib/analytics/activation-funnel.ts` accepts milestone and activity rows and returns four
   reached counts, previous-step drop-offs, p50/p90 minutes, non-account/account edit counts and
   share, and unmeasurable count. The selected cohort is based on immutable
   `account_created_at`, never a nullable confirmation timestamp; the first step is the subset with
   `account_confirmed_at`. Unmeasurable rows remain in cohort/reached/drop-off counts and are
   excluded only from durations. Percentiles use
   `account_confirmed_at -> first_persisted_content_update_at` only when both endpoints exist, the
   account is measurable and the duration is nonnegative. Attribution includes only explicit
   boolean rows; `actor_kind=unknown`/`is_non_account=NULL` is in neither numerator nor denominator,
   and zero known edits returns a NULL share. Zero duration/step denominators likewise return
   `null`, not NaN/Infinity or a fabricated zero percentile.

4. [ ] **Add the operator route.** `GET /api/analytics/activation-funnel?from=YYYY-MM-DD&to=...`
   first applies `enforceRateLimit` with `IP_GENERAL`, `getClientIp(request)` and
   `onStoreFailure: "deny"`; this global service-role-backed read must not become unmetered when
   Redis is unavailable. Only after the pre-auth limiter does it authenticate with the signed-in
   server client, call `isOperatorUser`, then use
   a service-role client for the global read. This is a read-only operator exception, matching the
   existing audit-log boundary; no service write is permitted. Extend hand-rolled validation for
   ISO dates, require `from <= to`, interpret both as UTC days (`from` inclusive, `to + 1 day`
   exclusive), and return generic errors. Query milestones by `account_created_at` and activity
   by `edited_at` in the same range, then call Task 3. Tests assert the service client is never
   constructed for 401/403/400.

5. [ ] **Provide the capability from the server page.** Convert
   `src/app/dashboard/analytics/page.tsx` to a server wrapper that authenticates, calls the same
   operator predicate and passes the boolean to a small client child preserving the existing
   `/api/sites` fetch. Add `canViewActivation` to `AnalyticsDashboard`; only true renders the tab
   and mounts its fetch. No client code parses `ADMIN_EMAILS` or guesses from email/domain.

6. [ ] **Implement `ActivationFunnelPanel` exactly from the existing design.** A fourth Activation
   tab uses `SectionHeader`, four outlined step cards, `Metric` tiles, attribution bar, UTC date
   inputs and Apply. Loading, empty, error and success remain distinct. Date changes do not fetch
   until Apply; stale data carries a visible refresh error. A non-operator renders no tab and sends
   no activation request.

7. [ ] **Prove the API/component boundary.** Route tests assert exact counts/drop-off/percentiles,
   unconfirmed/cohort handling, measurable nonnegative endpoint filtering, unknown-attribution
   exclusion and zero-known NULL share, immutable activity attribution, 429-before-auth, 401/403,
   validation and generic 500. RTL tests assert the four
   view states, retry, range submission, and no tab or
   fetch for non-operators. Existing Trends/Top Sites/Performance output stays unchanged.

8. [ ] **Perform the planned local cleanup only.** Remove the unused `siteAnalytics` binding and
   `updateSiteAnalytics` date parameter in `tracker.ts`; keep its tests/return shape unchanged.

## Interdicts and verification

- No new migration or write path in this surface story.
- No `analytics/track` change, activity-log fallback, client-side admin allowlist, per-site
  permission substitute, React Query/Zustand, new primitive, results mutation or production read.
- Run focused calculation/route/component/tracker suites, full lint/type-check/format/build/Jest;
  verify the non-operator path makes zero global data calls. Review must pass before Ship.

## Definition of Done

Both server and UI use one operator capability; the selected UTC range produces reproducible
cohort counts and percentiles; unconfirmed/unmeasurable accounts remain countable while
unmeasurable accounts never affect durations; edit share comes
only from immutable activity evidence; ordinary customers cannot mount or call the global view.
