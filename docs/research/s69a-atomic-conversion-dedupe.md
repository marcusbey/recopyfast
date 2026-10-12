# Research — Story s69a-atomic-conversion-dedupe

Verified against `origin/main` at `bc6e503` on 2026-10-12. No production database, provider,
Stripe, credential or environment file was used. Database evidence came from the disposable
PostgreSQL 17.11 cluster created and deleted by `scripts/run-db-invariants.mjs`.

`docs/reviews/stories.md` still ends with `Stories ready: no` from its historical 2026 backlog
review. The owner has nevertheless explicitly validated this remediation story and its plan on
2026-10-12, including the duplicate survivor rule, so implementation may continue within that
approved scope.

## Premise verdict

The premise is true. `countableConversions()` first asks whether a conversion already exists for
the `(visitor_id, test_id)` pair (`src/app/api/ab-tests/track/route.ts:303-329`). Later, after all
authorization, rate limits, ownership and exposure checks, the route performs a separate ordinary
insert (`:577-600`). Two requests can both finish the read while no row exists and both insert.
`checkTestCompletion()` counts conversion rows directly (`src/lib/ab-testing/lifecycle.ts:56-73`),
so the race can change conversion rates and the winner decision.

The database has no conversion uniqueness rule today. The clean-chain definition creates only the
four non-unique result indexes (`supabase/migrations/20260127_ab_testing_v2.sql:22-25`). The
production-repair definition is the same ten-column table and the same four indexes
(`20260818000000_repair_aborted_migrations.sql:384-404`).

## Current path and compatibility boundaries

- The request is bounded and validated before authorization, then authorized by site token, rate
  limited per authorized site, and checked as a whole batch against that site's tests and variants
  (`track/route.ts:420-519`). The atomic insert must stay after every one of those checks.
- Conversion exposure proof is a bucket row, a prior view, or a view in the same batch
  (`track/route.ts:275-332`). The database function receives only events the route has already
  admitted; it must not become a second public authorization path.
- Clicks are intentionally repeatable. Views keep the current read-before-insert semantics,
  including more than one matching view in a single previously unseen batch. Only conversions gain
  a uniqueness constraint.
- The accepted request maximum is 50 events and 64 KiB. The RPC input is therefore a bounded JSON
  array, not an unbounded table-wide operation.
- `ab_test_results` has no `site_id`; the route's ownership query is the tenant boundary because
  `service_role` intentionally bypasses RLS. The RPC must be `SECURITY INVOKER` and callable only
  as `service_role`; if `anon` or `authenticated` accidentally regained `EXECUTE`, invoker security
  would still leave that caller subject to its own table ACLs and RLS rather than elevating it.
- Results and lifecycle consumers count rows in `ab_test_results`; no consumer needs duplicate
  conversions preserved. The approved cleanup keeps the earliest `recorded_at`, then the smallest
  `id` as the deterministic tie-breaker.
- Significance checks are driven by views. After the RPC, only returned view rows may contribute to
  the crossing calculation; a conversion conflict must never schedule completion work.

## Migration paths

On a clean replay, `20260127_ab_testing_v2.sql` creates `ab_test_results` because the bootstrap has
already created its referenced A/B tables. On the historical production path that migration
aborted before the A/B tables existed; `20260818000000_repair_aborted_migrations.sql:369-478`
creates the same result shape and the tightened RLS policies. The new forward migration can target
the common shape and must not modify either source migration.

Fresh baseline replay command:

```sh
RCF_POSTGRES_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/run-db-invariants.mjs
```

Result before s69a source changes: all migrations applied on PostgreSQL 17.11; all 16 named replay
suites ran; 121 tests passed and one PostgREST-only test skipped by design; the temporary cluster
was stopped and deleted.

## Operator duplicate probe

Run this read-only query on every target database before applying the migration. It reports only
conversion keys whose later rows the approved cleanup will remove:

```sql
SELECT
  test_id,
  visitor_id,
  count(*) AS conversion_rows,
  min(recorded_at) AS earliest_recorded_at
FROM public.ab_test_results
WHERE event_type = 'conversion'
GROUP BY test_id, visitor_id
HAVING count(*) > 1
ORDER BY conversion_rows DESC, test_id, visitor_id;
```

The disposable clean replay had no application rows and therefore no duplicates. Production was
deliberately not queried in this implementation lane. If the operator probe reports rows, the
approved survivor rule is already explicit: keep the earliest `recorded_at`, then `id`; delete the
later rows in the forward migration before creating the partial unique index.

## Test anchors and traps

- `src/__tests__/api/ab-tests/track-bounds.test.ts` pins accepted embed payloads, conversion
  exposure, repeated clicks, repeated conversions and truthful `recorded` / `deduplicated` counts.
  Its service-client double must gain an `rpc()` surface without weakening its table-read checks.
- `src/__tests__/api/ab-tests/track-cross-tenant.test.ts` proves the ownership query runs before
  any result write and that a foreign test cannot reach lifecycle promotion. The RPC must remain
  absent on every refusal.
- A mock cannot prove the race. A new `src/__tests__/db/` suite must execute concurrent calls on a
  real PostgreSQL pool and must be named by `scripts/run-db-invariants.mjs`, or the normal Jest run
  can pass with only the harness's gated placeholder.
- `ON CONFLICT DO NOTHING` must cover a mixed batch. A duplicate conversion cannot abort a valid
  click, view or another visitor's conversion in the same call, and returned rows must describe
  exactly what landed.
- Historical cleanup and unique-index creation need one write-blocking transaction. A DELETE's
  `ROW EXCLUSIVE` lock does not conflict with another INSERT, so an explicit table lock must prevent
  a new duplicate entering between cleanup and index creation. The repository's bare-psql replay
  autocommits file statements, so the critical sequence also has to remain one SQL statement there.
- PostgreSQL grants function execution to `PUBLIC` by default. The migration must explicitly
  revoke `PUBLIC`, `anon` and `authenticated`, then grant only `service_role`; tests must inspect
  the effective ACL, not assume a `REVOKE` was enough.

## Open questions

No implementation-blocking question remains. The story cannot report whether production currently
contains duplicates because production access is outside this lane; the operator query above is the
deployment preflight. No ADR is needed: the validated plan already fixes the uniqueness key,
survivor rule, invoker security, grant boundary and route behavior without changing an architectural
boundary.

## Complexity

Re-scored **3 / 5**. The source diff is narrow, but correctness spans concurrent PostgreSQL
behavior, historical data cleanup, PostgREST RPC return shape, route accounting, lifecycle
scheduling and effective grants. The story remains coherent as one database-plus-caller slice and
does not need splitting.

Research ready in docs/research/s69a-atomic-conversion-dedupe.md. Next step: /ks-plan
s69a-atomic-conversion-dedupe
