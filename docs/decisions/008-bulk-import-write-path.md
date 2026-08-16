# ADR 008 — Bulk import writes land directly, then take one version-history snapshot

- Status: accepted
- Date: 2026-08-16
- Scope: story `s05-bulk-content-portability`

## Context

`s05` requires imported changes to "appear in version history as normal, revertible edits"
(`docs/stories.md:400`). Today they do not: `importContentElements`
(`src/app/api/bulk/import/route.ts:283-355`) writes `content_elements.published_content` and
`current_content` directly and never touches `content_versions`, the table
`VersionHistoryPanel` actually reads (via `GET /api/edit-board/history`,
`src/app/api/edit-board/history/route.ts:87-94`).

Two real write paths exist in the codebase already, and research (`docs/research/s05-bulk-content-portability.md`,
"Version-history fix point") left the choice between them open:

1. **Staging, then publish.** `PUT /api/staging/content/[siteId]` writes `staging_content`
   (`src/app/api/staging/content/[siteId]/route.ts:222-233`); `POST /api/staging/publish` then
   calls the RPC `publish_staging_content_atomic` to move `staging_content` into
   `published_content`. Read directly from the migration that defines it
   (`supabase/migrations/20260803020000_restore_atomic_publish.sql:32-104`): this function
   inserts into `staging_history` and updates `content_elements` — it **never** touches
   `content_versions`. Routing bulk import through this path would not, by itself, satisfy the
   criterion; a `create_content_version` call would still be needed afterward.
2. **A version snapshot.** `create_content_version` (RPC, defined at
   `supabase/migrations/20260805120000_reconcile_create_content_version.sql:43-91`) snapshots
   **every** `content_elements` row for the site into one `content_versions` row, keyed by
   `element_id`, with a `version_number`, `description` and `change_type`. It is `SECURITY
   DEFINER`, revoked from `PUBLIC`/`anon`/`authenticated` and granted only to `service_role`
   (`:99-101`) — callable only through `createServiceRoleClient()`. This is the exact RPC the
   Edit Board's "Save Current Version" button calls
   (`public/embed/recopyfast.src.js:5972-5982`) and the one `POST /api/edit-board/history`
   wraps (`src/app/api/edit-board/history/route.ts:212-217`) — i.e. it is what makes a *human*
   edit "revertible" today, on the rare occasion a human clicks it.

Restoring a version (`POST /api/edit-board/history/[versionId]`, `restore_content_version` RPC)
writes the snapshot back into **staging**, not live — the route's own header comment says so
("Restore this version to staging",
`src/app/api/edit-board/history/[versionId]/route.ts:4`). Reverting a version is therefore
already a two-step flow (restore → explicit publish) for every version in the product, not
something this story changes.

## Decision

**Keep the direct write.** Bulk import continues to write `content_elements.published_content`
and `current_content` directly (with this plan's round-trip and per-row fixes) — it does not
route through staging. After a batch completes with at least one applied (`created` or
`updated`) row, the route calls `create_content_version` **once**, via the service-role client,
with `change_type: "bulk_import"` and a description summarizing the outcome counts. Zero calls
when nothing was actually applied (a fully-refused or fully-failed import changes nothing, so
there is nothing to snapshot).

This makes the imported state reachable through the exact same restore mechanism a human's
manual snapshot uses — "as normal" — without adding a second HTTP-shaped write path for what is,
today, a single-step operation.

## Considered options

- **Route every row through `PUT /api/staging/content/[siteId]`, then one
  `POST /api/staging/publish`** — rejected. Turns "N inserts" into "N HTTP-shaped writes + 1 RPC
  call" for a 400-row file, forces every import through an explicit publish step the design
  mockup does not show and no acceptance criterion names, and — per the Context section above —
  still would not populate `content_versions` on its own; `create_content_version` would still
  need to be called afterward, making the staging detour additive complexity with no version-history
  benefit of its own.
- **Snapshot before writing (a "pre-import checkpoint"), not after** — considered, not chosen.
  It would give the owner a literal one-click undo of exactly this import (restore the
  checkpoint taken a moment before it ran). Rejected for this story because it is strictly more
  than the acceptance criterion asks for, it requires a second decision (what happens to the
  checkpoint when the import itself then fails or is refused after it was taken), and it
  snapshots even imports that end up refused before anything changes. If product feedback wants
  a guaranteed one-click undo specifically, this is the alternative to revisit — it supersedes
  this ADR rather than extending it.
- **Treat AC7 as already satisfied by the `content_history` trigger** — rejected. Research fact
  #3 confirms `VersionHistoryPanel` reads `content_versions`, populated only by the
  `create_content_version` RPC, not by the `log_content_change()` trigger that writes
  `content_history`. These are two different tables serving two different UI surfaces; the
  trigger already fires on every write today and does nothing to change what a user sees in the
  History panel.

## Consequences

**Easier.** One new call, no new write path, no change to how staging or publish behave for a
human editor. Reuses machinery already reviewed and shipped — `create_content_version`'s
`SECURITY DEFINER` grant and its whole-site JSON snapshot shape — rather than inventing a
bulk-specific versioning scheme.

**Harder.** The snapshot is whole-site, not scoped to the imported rows: a version taken
immediately after a 400-row import also captures whatever any other editor changed moments
earlier, exactly as a manual "Save Current Version" click already would. This is pre-existing
snapshot semantics, not a regression this story introduces. "Revertible" here means "reachable
through the same restore-to-staging-then-publish flow every other version uses," not an instant
one-click undo — the version created by this story sits in the list like any other; reverting
the import means restoring whichever version preceded it.

**Watch.** If a future story is asked for one-click "undo my last import" specifically, the
pre-import-checkpoint alternative above is the one to build — it supersedes this ADR rather than
extending it.
