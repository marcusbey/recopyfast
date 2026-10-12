---
validated: yes
---

# Plan — s65b-site-delete-revision-lock-order

Human validated on 2026-10-12: **"Validate all four recommended plans"**.
Mechanically materialized from the approved deferred-findings proposal. Approval covers fresh
research, implementation and independent review within this plan. No production migration or merge
is authorized. Reopen a checkpoint only for a material premise or semantic change.

Branch: `feature/s65b-site-delete-revision-lock-order` from `origin/main` `bc6e503`.
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

Deleting a site cannot deadlock with a content write. Editing content also stops presenting as a
site-metadata change through `sites.updated_at` unless research finds a current product consumer
that intentionally depends on that coupling.

### Current premise

`20261005000000_versioned_public_content_cache.sql` updates `sites.public_content_revision` from an
`AFTER` statement trigger on every `content_elements` insert, update and delete. A content write can
therefore hold a content row and then wait for the site row. The product deletes a site with one
`DELETE FROM sites`, which holds the site row and cascades into `content_elements`. Those opposite
lock orders can form a cycle.

The cycle is reproduced, not hypothetical. On 2026-10-12 a separate verifier applied the
`origin/main` migration verbatim to a disposable PostgreSQL 17 minimal schema, held the child
content lock in the edit transaction, let the product-shaped site delete take the parent lock, and
released the barrier. The delete ended with SQLSTATE `40P01` while the edit succeeded. The cluster
was cleaned and no production call was made. No test artifact from that isolated probe is committed
yet. The source chain is the site route's one-statement delete, the migration's site-row rotation,
and `save_staging_content_atomic`'s content-row lock/write path.

At `bc6e503`, repository search finds no runtime reader of `public_content_revision`: the column is
named only by its migration and database tests. The revision update also fires the inherited
`update_sites_updated_at` trigger; the current test explicitly expects a no-op draft update to move
`sites.updated_at`. The public snapshot does not use the revision and deliberately refuses a body
over 1 MiB; all shared rows count on every page. Those snapshot bounds are intentional and outside
this repair.

### Recommended safe approach

Retire the unused rotation mechanism with a new forward migration: drop the four
`content_elements` revision triggers and their five helper functions. Leave
`sites.public_content_revision` in place for schema compatibility, mark it unused/reserved in its
column comment, and keep its web-role privileges revoked. A later cache story may reuse the column
only through a new reviewed lock-order design.

This removes the content-row → site-row edge instead of trying to make every current and future
content writer acquire the site row first. It also stops incidental `sites.updated_at` churn
without changing the site-delete route, the public snapshot response, or any content-write RPC.

A bounded route retry for SQLSTATE `40P01` (at most two attempts) is a smaller alternative, but it
only mitigates one caller after PostgreSQL aborts a transaction; it leaves the opposite lock order
for other site-delete callers and future write paths. Keep it rejected unless the human checkpoint
chooses mitigation over retirement after the consumer census.

### Tasks

1. [x] **Research and prove the premise.**
   - Re-run the runtime-consumer census for `public_content_revision`, including server code,
     generated artifacts, SQL functions and operational scripts.
   - Trace every current consumer of `sites.updated_at`; classify metadata semantics separately
     from cache invalidation.
   - Record whether any deployed configuration outside this repository is known to read the
     revision. Unknown external use blocks dropping the column, but does not block removing the
     internal triggers after the owner accepts that boundary.
2. [x] **Add a deterministic database regression.**
   - Convert the isolated PostgreSQL 17 reproduction into a deterministic committed regression:
     extend `src/__tests__/db/site-delete-cascade.test.ts` or add a colocated DB test that uses two
     clients and an explicit barrier to reproduce the actual site-row/content-row lock cycle.
   - The pre-fix case must terminate as a detected deadlock or lock-timeout failure; it may not be
     a timing-only test.
3. [x] **Add the forward migration.**
   - Drop `rotate_public_content_revision_{insert,update,delete,truncate}` triggers.
   - Drop `rotate_public_content_revision_after_*()` and
     `rotate_public_content_revisions(uuid[])` after revoking grants defensively.
   - Keep the server-only column and explicit column revokes. Update the comment to state that no
     current runtime consumes it and that a future cache must introduce a reviewed lock order.
4. [x] **Rewrite the revision contract tests.**
   - Replace rotation assertions in `src/__tests__/db/public-content-revision.test.ts` with the
     intended end state: no rotation triggers/functions, the reserved column remains non-null and
     inaccessible to web roles, content writes do not move `sites.updated_at`, and ordinary site
     metadata updates still do.
   - Keep `src/__tests__/db/column-privileges.test.ts` strict for the reserved column.
5. [x] **Prove deletion and writes together.**
   - Run the new concurrency test, `site-delete-cascade`, `delete-atomicity`, the content-write DB
     suites, a full PostgreSQL 17 migration replay, and the normal repository gates.

### Expected files

- New `supabase/migrations/<timestamp>_retire_public_content_revision_rotation.sql`
- `src/__tests__/db/public-content-revision.test.ts`
- `src/__tests__/db/site-delete-cascade.test.ts`
- Possibly a new colocated DB concurrency test if keeping the deterministic barrier isolated is
  clearer
- `docs/architecture/published-snapshot.md` and the story research/plan/review created after the
  checkpoint

### Human checkpoint

Approve or reject retirement of the **unused trigger/functions while retaining the private
column**. The alternatives are a bounded delete-only `40P01` retry, which mitigates but preserves
the lock graph, or preserving future cache capability in a separate revision table, which is a
different design. Either alternative must replace this approach before validation; neither is an
implementation-time improvisation.
