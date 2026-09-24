# ADR 027 — page-scoped computed identity and staged content attributes

Date: 2026-09-24. Status: accepted by operator for s27.

## Context

A-14 aliases structural twins across pages. A-26 discards accepted href/alt changes. Production has zero real customers (operator statement); existing content is QA fixtures.

## Decision

D2: ACCEPT RE-KEYING, NO BACKFILL. Hash normalized case-sensitive pathname with structural identity. Ignore query/hash; remove trailing slashes except root. Keep author `data-rcf-id` page-independent to support deliberate shared components.

Use existing element metadata JSONB: published href/alt at the top level, draft patch in staging_attributes. Public reads exclude the draft patch. Publish atomically promotes attributes along with text, including attribute-only edits. History and version snapshots retain attributes; restore targets staging. Capture authored attributes during discovery.

## Rejected alternatives

Legacy ID fallback can reintroduce cross-page collisions. Backfill has no trustworthy page mapping and no real-customer benefit. Publishing metadata during save violates staging privacy. New per-attribute columns duplicate the existing JSONB boundary.

## Consequences / rollback

Old computed rows become orphaned; no data migration attempts to guess their page. Reverting to the old embed revives page-blind IDs and can redisplay legacy QA rows. Prefer forward fixes. SQL ships before the app/widget; no migration is applied remotely in this lane. Reverting app/embed does not require dropping additive history columns.
