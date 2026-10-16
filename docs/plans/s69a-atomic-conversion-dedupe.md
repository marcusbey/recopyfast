---
validated: yes
---

# Plan — s69a-atomic-conversion-dedupe

Human validated on 2026-10-12: **"Validate all four recommended plans"**.
Mechanically materialized from the approved deferred-findings proposal. Approval covers fresh
research, implementation and independent review within this plan. No production migration or merge
is authorized. Reopen a checkpoint only for a material premise or semantic change.

Branch: `feature/s69a-atomic-conversion-dedupe` from `origin/main` `bc6e503`.
Research must be verified and saved before source edits.

## Shared constraints

- One story, branch and PR per scope. None of the four fixes is bundled with another.
- Every story starts with fresh `/ks-research`; the paths below are the current surface, not a
  substitute for re-verifying it when the story begins.
- New migrations are forward-only and timestamp-prefixed. Applied migrations are never edited.
- No new dependency.
- The embed ceilings only go down. `s67b` may not raise a ceiling, remove discovery coalescing,
  remove the per-page discovery cap, or stop observing shadow roots to buy bytes.
- Existing authorization, rate limits, RLS and service-role boundaries remain unchanged unless the
  story explicitly tests an equivalent or stricter boundary.
- Each implementation is test-first, passes the repository Definition of Done, receives an
  independent review, and ends with the exact review footer required by `AGENTS.md`.

### User-visible outcome

Two concurrent conversion beacons for the same `(test_id, visitor_id)` can create at most one
conversion result, so a race cannot double-count a conversion or move an A/B test toward a winner
twice.

### Current premise

`countableConversions()` checks for an existing conversion and the route later performs a separate
insert. Two requests can both observe zero and both insert. This is the deferred D2 from Devin's
PR #65 review. Exposure proof, tenant ownership validation, request bounds and rate limits are
already separate guards and remain required.

### Recommended safe approach

Make the database the final arbiter. Add a partial unique index on
`ab_test_results(test_id, visitor_id) WHERE event_type = 'conversion'`, then insert the already
validated event batch through one service-role-only SQL function using `ON CONFLICT DO NOTHING`
and returning which rows landed. The route may keep its read as an optimization and for its current
`deduplicated` response, but correctness cannot depend on that read.

### Tasks

1. [x] **Research current data before choosing a cleanup.**
   - Add a read-only duplicate query to the operator section of the research.
   - Verify the table shape across a clean replay and the current migration-repair path.
   - If duplicates exist in any target database, stop before migration until the survivor rule
     below is approved; do not let `CREATE UNIQUE INDEX` fail halfway through rollout.
2. [x] **Write the database race test first.**
   - Add a real-Postgres test that starts two transactions or concurrent function calls for one
     conversion and proves exactly one row is returned/stored.
   - Keep tests proving clicks remain repeatable and views keep their current semantics.
3. [x] **Add one forward migration.**
   - Resolve approved historical duplicates deterministically, if any.
   - Create the partial unique index.
   - Create a narrowly scoped event-insert function that uses `ON CONFLICT DO NOTHING`, is
     `SECURITY INVOKER`, pins `search_path`, is revoked from `PUBLIC`, `anon` and `authenticated`,
     and is executable only by `service_role`.
4. [x] **Use the atomic insert result.**
   - Update `src/app/api/ab-tests/track/route.ts` only after authorization, ownership checks,
     exposure checks and validation have succeeded.
   - Build `recorded`/`deduplicated` from returned inserted rows so concurrent losers report a
     dedupe instead of 500.
   - Trigger significance checks only from views that actually landed; conversion conflicts must
     not create extra completion work.
5. [x] **Pin boundaries and replay.**
   - Extend `track-bounds.test.ts` and the cross-tenant tests.
   - Add function-grant and migration-replay assertions, then run the A/B lifecycle suites,
     PostgreSQL 17 replay and normal gates.

### Expected files

- New `supabase/migrations/<timestamp>_atomic_ab_conversion_dedupe.sql`
- `src/app/api/ab-tests/track/route.ts`
- `src/__tests__/api/ab-tests/track-bounds.test.ts`
- `src/__tests__/api/ab-tests/track-cross-tenant.test.ts`
- New or existing `src/__tests__/db/` coverage for the unique index, concurrency and grants
- Canonical s69a story/research/plan/review docs after the checkpoint

### Human checkpoint

Approve the duplicate survivor rule: **keep the earliest conversion by `recorded_at`, then `id` as
the deterministic tie-breaker; delete later duplicates in the forward migration**. If historical
conversions must instead be preserved for analysis, the story needs a data-archive step before the
index and cannot be validated from this proposal.
