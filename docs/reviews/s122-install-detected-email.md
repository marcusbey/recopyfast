# Review — s122-install-detected-email

Date: 2026-10-24 (Toronto). Independent review of `feature/s122-install-detected-email` at
`47056eb0` (migration `22e726f1` + feature `47056eb0`) against main `230a0ea6`.

## Verdict

PASS-WITH-FIXES: one major, five minor. All six are resolved on this branch (see Resolution).

## Findings

### MAJOR

1. **Owner lookup hand-copied, and a lookup error became a permanent `no_owner`.**
   `install-detected-email.ts` re-implemented the earliest-`admin` query without billing's
   `.order("id")` tie-breaker, so on a same-instant tie the email could go to a different account
   than the one `resolveSiteOwnerId` (`src/lib/feature-gating/permissions.ts:221`) charges. It also
   read a query error as "no owner" and, because the ledger was claimed first, wrote a `failed /
   no_owner` row — permanent, since nothing re-fires the trigger.

### MINOR

2. **Scheduling after a throwable write.** `route.ts` scheduled the email and DataFast
   `script_installed` after `recordSiteReport`; a throw there (inside `bestEffortSiteWrite`) lost
   both once-only events though the flip had committed.
3. **Raw provider error logged.** `send()` in `resend.ts` passed Resend's error object (and any
   thrown error) to `console.error` and returned its `message`, which callers log; either can echo
   the recipient address.
4. **Copy overpromise.** "they won't need to touch it again" contradicts the s120 redeploy-risk
   honesty rule.
5. **Unbounded waits in `after()`.** The identity lookup and the Resend call had no timeout.
6. **No runbook for stuck `pending` / `failed` rows.**

## Resolution

1. `src/lib/sites/install-detected-email.ts` now calls `resolveSiteOwnerId` (line 198) and
   orders the work **resolve → claim → send**: `prepare` / `resolveRecipient` (lines 190–240) read
   the site, owner and address first; any error, null or timeout there claims nothing, reports
   `stage=resolve` with a code, and returns `skipped`. Exactly-once is unchanged: the claim is
   still written before the provider call and still not reclaimable. Tests: tie-breaker over real
   ordering (and agreement with `resolveSiteOwnerId` itself), lookup error leaves no row and a
   later call sends, no-owner claims nothing.
2. `src/app/api/content/[siteId]/route.ts:617–635` schedules both `after()` tasks immediately
   after `markSiteLive` and before `recordSiteReport`. Route test: a failing liveness bump still
   schedules the email and the goal, and the failure is still logged.
3. `src/lib/email/resend.ts:74–103`: `send()` logs and returns only `providerErrorCode` — Resend's
   `name` (`validation_error`, ...) or a thrown error's class name, else `unknown`. Applies to every
   caller of `send()` (invites, staging and editor codes, install email). Test: neither log path
   contains the address or the provider message.
4. `resend.ts:307`: "If your developer installed it, thank them — the line is in place."
5. `install-detected-email.ts:62–63`: 5 s bounds (`Promise.race`, timer cleared) on the whole
   resolve step and on the Resend call. A resolve timeout claims nothing (`lookup_timeout`) — by
   design, per finding 1, rather than finishing a row as failed. A send timeout finishes the row
   `failed / provider_timeout`; the SDK takes no abort signal, so the mail may still arrive and the
   claim still blocks a second one. Both report to Sentry with stage and code only. Tests with fake
   timers for both.
6. `docs/operations/monitoring.md` § "Install detected" email ledger: SQL for `pending` rows older
   than 15 minutes and `failed` rows grouped by `error_code`. **Not** added to `/api/health`: that
   endpoint is anonymous and reports component state only (s84); a service-role backlog count does
   not fit its pattern without widening it.

## Verification (Node 24.14.0)

- `npm run lint` — 0 errors (32 pre-existing warnings, none in changed files).
- `npm run type-check` — clean. `npm run format:check` — clean.
- `npx jest` — 561 suites passed, 1 skipped; 8,307 tests passed, 2 skipped.
- PG17 replay (`scripts/run-db-invariants.mjs`) — all 23 named suites ran against PostgreSQL 17,
  202 passed, 1 skipped.
- `npm run build` — succeeded.
