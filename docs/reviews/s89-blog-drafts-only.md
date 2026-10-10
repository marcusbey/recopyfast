# Review — s89-blog-drafts-only

Reviewer: fresh independent review, 2026-10-10. Frozen source:
`96e2d0786ed79cc2432b5c57feb55d62aebbe169`; accepted base:
`0dea1c05babed48834ecc72700cfebef01ae6733`. The review covered the complete story diff against
`origin/main`: 39 files, +5,115 / -435.

## Verdict summary

No critical, major or minor defect was found. The repaired implementation closes the previous
ship-blocking concurrency failure: one durable database claimant owns the UTC day before the
provider call, followers never generate, and the owner completes the draft and claim in one
transaction. Failed and old pending claims are never taken over automatically. The service-role
boundary is explicit in the migration, application and repository contract.

The story's original draft/publication boundary remains intact. AI output is still assembled
field-by-field into a draft; the cron is fail-closed behind `CRON_SECRET`; on-demand generation,
listing and publish/unpublish create a service client only after the platform-admin checks; POSTs
require the same Origin before authentication; `user_metadata` grants nothing; and public reads
retain their published-status filters.

## Prior blocked gate and closure

The previous independent review froze `b778756` and blocked ship with critical `c1`: two overlapping
cron deliveries both passed the pre-read and called the provider before the unique daily-post key
chose one database winner. Its barrier proof recorded two generation calls, one row and one
`created: true` / one `created: false` response. That report also recorded minor `m1`: AGENTS.md did
not name the two accepted non-tenant blog service-role principals.

This source closes both findings:

- ADR 060 supersedes only ADR 057's insufficient concurrency mechanism. The original applied
  migration and ADR 057 are unchanged; the repair is the new forward migration
  `20261010120000_blog_generation_claims.sql`.
- `claim_daily_blog_generation` serializes the day and creates the pending owner before OpenAI
  (`supabase/migrations/20261010120000_blog_generation_claims.sql:55-126`). A legacy daily row is
  materialized as an already-succeeded claim.
- `complete_daily_blog_generation` locks and verifies that exact owner, inserts or reuses the daily
  draft, and marks success in the same transaction (`:128-251`). `fail_daily_blog_generation`
  changes only the matching pending owner (`:253-280`).
- `createDailyDraft` sends only the acquired token to generation; existing pending/succeeded/failed
  claims go through the follower path (`src/lib/blog/drafts.ts:425-475`). An ambiguous response after
  committed completion cannot demote success: the failure RPC returns false, and the next delivery
  reads the committed post.
- AGENTS.md now names the daily cron and guarded platform admin as the two non-tenant blog
  service-role principals and points to ADRs 057/060 (`AGENTS.md:175-180`).

## Plan, contract and anti-hallucination review

Plan tasks 10-13 and ADR 060 are present in code, tests and operations documentation. The story
acceptance criteria now explicitly require one provider call for concurrent duplicate delivery,
bounded follower behavior, atomic finalization and manual-only recovery. No dependency, embed,
`server/`, sitemap or UI change entered the repair.

Every new runtime target was opened at the reviewed SHA. Node 24 supplies `randomUUID` and
`AbortSignal.timeout`; the installed Supabase client exposes `rpc`, and its PostgREST implementation
JSON-parses table-function results as arrays and scalar-function results as scalars. The TypeScript
argument names exactly match the three migration-defined function signatures. The completion
result is accepted only when it is a draft for the requested day.

The claim table has RLS enabled, no web-principal table access, and service-role SELECT only. All
three `SECURITY DEFINER` functions revoke `PUBLIC`, `anon` and `authenticated` execution before
granting `service_role` (`supabase/migrations/20261010120000_blog_generation_claims.sql:282-298`).
The PostgreSQL replay test also injects a PUBLIC owner-token column grant and proves migration replay
removes it without changing a completed claim.

The follower deadline covers database-read latency as well as poll sleeps
(`src/lib/blog/drafts.ts:320-367`). A read already issued when the deadline wins is not
transport-cancelled and may finish later; an independent proof confirmed it cannot restart polling,
write, or call the provider. That bounded-count read-only remainder does not violate the s89
acceptance contract.

## Findings

No findings.

## Verification

- Fresh focused rerun on `96e2d07`: 4 suites, 47 tests passed, 0 failed/skipped.
- Normal pre-commit hook on the same source: lint, type check, format check and full Jest passed;
  421 suites / 5,665 tests passed, with 38 skips.
- Normal pre-push: production build compiled successfully; coverage passed the ratchet at 72.10%
  statements, 65.21% branches, 69.26% functions and 72.70% lines; the same 421 suites / 5,665 tests
  passed. The branch was pushed at the reviewed SHA.
- PostgreSQL 17 replay after the deadline and lost-response repairs: 15 named suites, 102 tests
  passed, with one expected existing PostgREST-only skip. The claim suite drove the actual
  TypeScript function through two real service-role database sessions and actual migration RPCs:
  one generator call, one shared draft, transactional rollback on an injected completion failure,
  wrong-owner refusal, no stale/failed takeover, private grants/RLS, replay convergence and legacy
  daily-row reuse.
- Preserved red evidence: the old implementation made two provider calls under overlap; the first
  stalled-read regression remained pending and failed 1 of 18 tests before the wall-clock repair.
  The review assignment prohibited source mutation on the frozen shared checkout, so no additional
  in-place neutralization was performed.
- Full commands and evidence: `.omx/ultragoal/evidence/s89/claim-review/review-evidence.md`.

## Not verified and remaining gates

No real OpenAI call, production credential or production database was used. No hosted PostgREST
gateway or signed-in browser exercised list → review → publish → public article → unpublish. The
database suite uses real PostgreSQL/functions/sessions through a thin adapter matching the installed
client's JSON shapes; live gateway behavior remains a deployment check.

Before production release, the owner still must inventory existing blog rows, review/unpublish any
legacy AI publication, apply both migrations in order, set `ADMIN_EMAILS`, deploy, and verify the
live cron plus public visibility. The hard-coded `/blog` index remains the declared follow-up.

Review passed. Next step: `/ks-ship s89-blog-drafts-only`.

Max severity: none
Ship allowed: yes
