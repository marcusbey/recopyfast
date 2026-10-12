# Review — s69a-atomic-conversion-dedupe

Independent review of `origin/main` `bc6e503` through `1f17aa5`, followed by verification of
the comment-only finding repair in the working tree. The review compared the implementation with
the human-validated plan, research, A/B ADRs 016/017, ADR 002, ADR 042 and the repository rules.
No source was changed by the reviewer.

## Findings

No open findings.

### Closed — SECURITY INVOKER and service-role rationale corrected

`supabase/migrations/20261012121000_atomic_ab_conversion_dedupe.sql` and
`docs/research/s69a-atomic-conversion-dedupe.md` now state the actual boundary:
`service_role` intentionally bypasses RLS; `SECURITY INVOKER` prevents an accidentally exposed
`anon` or `authenticated` caller from acquiring the function owner's authority; and the HTTP
route remains the tenant-authorization boundary. The follow-up migration diff changes comments
only; executable SQL is unchanged. The prior minor is closed.

## Plan and architecture conformance

- The new timestamped migration is forward-only. No applied migration or dependency was changed.
- Historical duplicates are removed under a write-blocking
  `SHARE ROW EXCLUSIVE` lock using the approved survivor order:
  `recorded_at ASC NULLS LAST, id ASC`. The partial unique index then enforces one conversion per
  `(test_id, visitor_id)` while leaving clicks and views repeatable.
- `insert_ab_test_events(jsonb)` is bounded to 1..50 events, `SECURITY INVOKER`, pinned to
  `public, pg_temp`, denied to `PUBLIC`/`anon`/`authenticated`, and executable only by
  `service_role`.
- The route preserves the existing IP/site rate limits, site-token authorization, ownership and
  variant checks, and exposure proof before the RPC. It derives `recorded`, `deduplicated` and
  completion cadence from rows the database actually returned.
- The real-database suite covers concurrent conversion calls, mixed-batch conflict behavior,
  repeatable click/view semantics, function bounds, effective grants, the migration lock and
  historical cleanup. The replay runner names that suite explicitly.
- The API tests retain the cross-tenant refusal and add truthful accounting/completion assertions
  around raced RPC results.

## Verification

- Fresh PostgreSQL 17 replay:
  `RCF_POSTGRES_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/run-db-invariants.mjs`
  passed all 17 named database suites: 129 passed, one intentionally skipped.
- Focused route tests run with the repository's CI placeholder environment passed:
  `track-bounds.test.ts` and `track-cross-tenant.test.ts`, 56 tests in two suites.
- Database mutation proof in an owned temporary clone: removing
  `ON CONFLICT DO NOTHING` made two database tests fail with the partial index's `23505`:
  the concurrent-call test and the mixed-batch preservation test. The mutation was reversed.
- Route mutation proof in the same owned clone: deriving `recorded` from admitted rows instead of
  returned rows made two focused API tests fail. The mutation was reversed and
  `git diff --exit-code` proved the temporary clone clean.
- `git diff --check origin/main...HEAD` passed.
- Follow-up inspection confirmed that the migration repair changes only comments and the research
  repair changes only explanatory prose. No executable SQL or route behavior changed, so the
  passing replay, focused tests and mutation evidence above remain applicable without a redundant
  rerun.

## Not verified in this review

- No production/provider/database state was read. Before deployment, an operator must run the
  research's read-only duplicate probe on every target database so the approved cleanup's deletion
  scope is visible before the migration runs.
- The database suite calls the RPC as PostgreSQL `service_role` and the route suites mock the
  Supabase RPC transport. A local Supabase/PostgREST request was not run; the live transport and
  schema-cache exposure remain deployment-smoke evidence.
- The broad 485-suite Jest run and a full build were not repeated. The reviewer ran the concurrency,
  grant, migration and route surfaces that can prove this story's changed behavior.

Max severity: none
Ship allowed: yes
