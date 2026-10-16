# ADR 064 — Public content revision rotation is retired

Status: accepted

Date: 2026-10-12

Story: `s65b-site-delete-revision-lock-order`

## Context

Migration `20261005000000_versioned_public_content_cache.sql` introduced
`sites.public_content_revision` and four statement triggers that rotated it after every
`content_elements` insert, update, delete and truncate. The proposed Redis cache needed a
transactional generation token so a stale fill could not make an older payload reachable again.

ADR 046 superseded that read path with the public published-copy snapshot. The snapshot uses one
stable URL, a strong body `ETag` and a bounded CDN lifetime; no runtime reads the database revision.
The old write mechanism nevertheless remained on every content mutation.

That mechanism creates an opposite lock order with site deletion. A draft save locks a
`content_elements` row before its statement trigger locks and updates `sites`. The product deletes
the parent `sites` row first, then its foreign-key cascade reaches `content_elements`. A
deterministic two-client PostgreSQL 17 reproduction observed the delete waiting on the content row;
allowing the draft write to continue completed the cycle and PostgreSQL raised `40P01`.

The revision write also fires `update_sites_updated_at`. Product consumers display that timestamp
as site metadata and use a newer site row to notice install-credential rotation. A content edit is
neither event, so revision rotation made “Last edited” noisy and could refresh credentials without
an API-key change.

The original migration is applied and immutable. The column might also be known to an external
schema consumer that is not represented in this repository.

## Decision

1. Forward migration `20261012120000_retire_public_content_revision_rotation.sql` drops the four
   `rotate_public_content_revision_*` triggers and their five helper functions. It revokes function
   grants before dropping and is safe to retry after an uncertain result.
2. `sites.public_content_revision` remains in the schema with its UUID default and `NOT NULL`
   constraint. It remains inaccessible to `PUBLIC`, `anon` and `authenticated`, and its column
   comment marks it reserved and unrotated.
3. Content writes no longer update the parent site row. Direct site metadata changes continue to
   advance `sites.updated_at` through the existing trigger.
4. Any future content cache that wants a database revision must introduce a new reviewed lock-order
   design. This ADR does not reserve these retired trigger names or endorse restoring them.
5. The PostgreSQL replay harness reapplies the retirement after its deliberate retry of the older
   s62 migration, then reapplies the retirement once more to prove the final migration converges.

## Considered options

- **Retry the site delete at most twice on `40P01`.** Rejected. PostgreSQL has already aborted a
  customer transaction, other delete callers retain the same graph, and future writers can still
  participate. A caller-local retry mitigates one symptom rather than removing the unused edge.
- **Require every content writer to lock `sites` first.** Rejected. It spreads a non-product cache
  invariant across existing and future writers, including RPCs and cascades, while the revision has
  no reader.
- **Move revision state into a separate table now.** Rejected. There is no current cache consumer to
  design for, and choosing its row shape and lock order belongs to that future story.
- **Drop `public_content_revision`.** Rejected. Retaining the private column avoids a schema break for
  an unknown external reader while still removing the internal lock edge.

## Consequences

- Site deletion and an in-flight draft write serialize on the content row and both complete; there
  is no content-trigger request for the already-held parent row.
- This removes the reproduced revision-trigger cycle. It does not claim that every current or
  future database transaction is globally deadlock-free.
- Content insert, update and delete leave both `public_content_revision` and `sites.updated_at`
  unchanged. Direct site updates still move `sites.updated_at`.
- The reserved revision value is no longer a change signal. Code that starts reading it without a
  new ADR and migration is incorrect even though the column still exists.
- No API route, public snapshot payload, RLS policy or content-write RPC contract changes.
