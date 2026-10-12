# Research — Story s65b-site-delete-revision-lock-order

Verified against `feature/s65b-site-delete-revision-lock-order` at `bc6e503` on 2026-10-12.
No production, provider, remote database or environment read was used.

## Verdict

The premise is confirmed. The applied s62 migration adds a content-row-to-site-row lock edge that
the product does not consume, while the site delete already takes the opposite site-row-to-content-
row order. Retiring the four statement triggers and their five helper functions is the smallest
global repair. The `sites.public_content_revision` column should remain non-null, server-only and
reserved so the schema stays compatible with any unknown external reader.

The current `docs/reviews/stories.md` footer predates this appended remediation story and says
`Stories ready: no`. The owner nevertheless explicitly human-validated this story's complete plan
on 2026-10-12 ("Validate all four recommended plans"), so the research warning is acknowledged and
the approved story proceeds.

## Lock-order premise

- `20261005000000_versioned_public_content_cache.sql:41-64` locks every affected `sites` row and
  updates `public_content_revision`. Four `AFTER ... FOR EACH STATEMENT` triggers invoke that path
  for insert, update, delete and truncate (`:146-175`). The update trigger is intentionally
  conservative and rotates even for draft-only and no-op updates (`:91-107`).
- The real draft-write RPC first selects the matching `content_elements` row `FOR UPDATE`, then
  updates it (`20260924030000_content_page_path.sql:36-84`). With the s62 trigger present, the same
  transaction next waits for the parent `sites` row.
- The product delete is one `DELETE FROM sites` shaped statement through PostgREST
  (`src/app/api/sites/[siteId]/route.ts:50-79`). The FK from `content_elements.site_id` uses
  `ON DELETE CASCADE` (`20250817000000_complete_database_setup.sql:26-28`), so PostgreSQL locks the
  site row before reaching the content row.
- Those paths therefore form the reproduced cycle: edit owns content and waits for site; delete
  owns site and waits for content. Ordering site rows inside the revision helper only orders
  revision writers with each other; its own migration correctly says it does not provide global
  deadlock freedom (`20261005000000_versioned_public_content_cache.sql:37-40`).

The regression must use two real PostgreSQL clients and an observed lock-wait barrier. A sleep-only
race is insufficient. The edit client will hold the content row, the delete will be observed in
`pg_stat_activity.wait_event_type = 'Lock'`, and then the edit will perform its update. Before the
repair PostgreSQL must break that cycle with `40P01` (or the bounded test's lock timeout); after the
repair the edit commits and the delete finishes the cascade.

## Revision consumer census

A tracked-file census (`git grep`) covered application code, `server/`, operational scripts,
generated artifacts, migrations, tests and docs.

- No runtime file under `src/`, `server/`, `scripts/` or `public/` reads or writes
  `public_content_revision`.
- The only executable references are its applied migration and database tests. The privilege
  invariant independently keeps it out of web-role projections
  (`src/__tests__/db/column-privileges.test.ts:124-126,316-329`).
- ADR 046 already supersedes the s62 Redis read path. The public snapshot uses a fixed CDN lifetime
  and body `ETag`, and explicitly says nothing in that read path consumes the revision
  (`docs/decisions/046-unauthenticated-published-copy-snapshot.md:168-188`).
- No checked-in deployment or operational configuration names the revision. External deployed
  configuration was not queried because this story has no production/provider-read authority, so
  an out-of-repository reader remains unknowable. Keeping the column and its UUID default avoids a
  schema break for such a reader; its value will simply stop rotating on content writes.

The existing `20261008120000_delete_embed_ui_discovery_rows.sql` comment describes the then-current
rotation trigger. That applied migration must remain byte-identical; current architecture and the
new forward migration should record the retirement instead.

## `sites.updated_at` semantics

Every current consumer treats this timestamp as site-row metadata, not content invalidation:

- `GET /api/sites` explicitly selects and returns it (`src/app/api/sites/route.ts:45-50,181-189`).
- The sites list labels it **Last edited** (`src/components/dashboard/SiteRow.tsx:102-126`) and the
  overview labels it **Updated** (`src/app/dashboard/sites/[siteId]/page.tsx:102-113`). Content
  rotation makes both labels describe an internal coordination write rather than site metadata.
- `SiteProvider` uses a strictly newer value to detect another admin's API-key rotation and replace
  stale install credentials (`src/components/dashboard/site/SiteProvider.tsx:294-389`). The intended
  event is a `sites.api_key` update; content-trigger churn can cause an unnecessary credential
  refresh but is not required for correctness.

Ordinary site updates still pass through `update_sites_updated_at`. Removing the revision triggers
therefore restores the timestamp's existing product meaning while preserving credential rotation,
rename, liveness and other direct site-row updates.

## Implementation surface and traps

- Add only the forward migration
  `20261012120000_retire_public_content_revision_rotation.sql`. Never edit
  `20261005000000_versioned_public_content_cache.sql` or another applied migration.
- Drop the four triggers before dropping their functions. Revoke function grants defensively before
  each `DROP FUNCTION`; keep the exact signatures.
- Keep `sites.public_content_revision`, its UUID default, `NOT NULL` constraint and all existing
  web-role column revokes. Replace its column comment with a tombstone that requires any future
  cache story to introduce a reviewed lock order.
- Rewrite the s62 revision suite around the end state: column compatibility/privacy, absent
  triggers/functions, content writes leave both the revision and `sites.updated_at` unchanged, and
  a direct site metadata update still advances `sites.updated_at`.
- Extend `site-delete-cascade.test.ts` for the deterministic two-client overlap. It already owns the
  exact product-shaped delete and cleanup behavior, so a second concurrency-only file is not needed.
- Update the current published-snapshot architecture record. ADR 046 left trigger retirement as an
  explicit follow-up decision, so ADR 064 should record the now-approved structural choice and the
  rejected delete-only retry.

## Verification

Run the focused revision and cascade suites first against a disposable PostgreSQL 17 cluster, then
the delete-atomicity and content-write database suites, the complete PostgreSQL 17 migration replay
and privilege invariants, followed by the normal lint, type-check, format, build and Jest gates.
The shared dependency install is read-only; use the worktree-specific Jest cache and do not run an
install.

## Complexity

**3 / 5.** The SQL change is small, but the concurrency proof must establish an observed lock wait
and safe transaction cleanup on both pre- and post-repair schemas. The story entry did not include a
prior numeric score. No split is warranted because the migration and the regression prove one
inseparable lock-order outcome.

## Open questions

- An external reader outside the repository cannot be ruled out without a production/provider
  inventory, which is outside this task's authority. Retaining the private column is the accepted
  compatibility boundary and leaves no implementation blocker.
- A future revision cache may reuse the column or introduce a separate table only through a new
  reviewed design. This story deliberately establishes neither mechanism.

## Implementation evidence

- **Red:** the first PostgreSQL 17 replay ended with two failed suites and four failed tests. The
  forced overlap logged `deadlock detected` (`40P01`) between `DELETE FROM public.sites` and
  `save_staging_content_atomic`; the revision suite separately proved the old comment, four live
  triggers and revision mutation were still present.
- **Green:** the final disposable PostgreSQL 17 replay ran all 16 named database suites: 114 passed,
  one intentionally skipped. Both the revised contract and the independent column-privilege suite
  confirmed `public_content_revision` stayed `NOT NULL`, UUID-backed, service-readable and denied
  to `PUBLIC`, `anon` and `authenticated`.
- **Broad regression:** 484 Jest suites passed (6,948 tests; 38 skipped). Lint (zero errors, 34
  inherited warnings), full and production type-checks, source/changed-file format checks and
  `npm audit --omit=dev --audit-level=high` passed.
- **Build gap:** the default Turbopack build could not follow this worktree's disk-saving
  `node_modules` symlink outside its project root. The webpack build compiled successfully, then
  Next's generated route types rejected three pre-existing named page exports
  (`buildComparisonStaticParams`, `CompareIndexContent`, `ToolsHubContent`) outside this story. No
  dependency, project config or unrelated page was changed to conceal that baseline failure.

The regression proves removal of this revision-trigger/site-delete cycle. It does not claim global
freedom from every possible database deadlock.

Research ready in `docs/research/s65b-site-delete-revision-lock-order.md`. Next step:
`/ks-plan s65b-site-delete-revision-lock-order` (already human-validated).
