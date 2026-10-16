# ADR 067 — Discard uses a row-version compare-and-set

Status: accepted

Date: 2026-10-12

Story: `s81-version-restore-integrity`

Related: [ADR 042](./042-content-writes-are-service-role-only.md) (content writes are
service-role-only), [ADR 054](./054-content-change-state-is-a-security-invoker-view.md) (the
Changes projection runs with the caller's RLS)

## Context

The Changes page's Discard action reads an element immediately before it writes. It checks that
the draft text and staged attribute names are still the ones the owner reviewed, then builds a
draft from the fresh live text and live attribute values. The staging PUT subsequently performs
authorization, rate limiting and the owner's plan check before calling
`save_staging_content_atomic`.

A second tab, the live-page editor or a write that outlived an earlier Changes page can commit in
that interval. The old RPC locks the row and keeps its history truthful, but deliberately accepts
the latest request: a stale Discard can overwrite the intervening edit.

`staging_updated_at` cannot version the content Discard reviews. A publish, live-content write or
attribute write can move the live text or metadata without moving that draft timestamp. The
complete reviewed row is versioned by `content_elements.updated_at`.

The Changes route reads its text from `public.content_changes`, then reads draft attributes from
`content_elements` separately. Taking the expected version from the later metadata query would
pair a newer token with older view text when a write lands between those reads, allowing stale
copy to pass a compare-and-set.

## Decision

1. `public.content_changes` appends the explicitly named `updated_at` column. It remains a
   `security_invoker` view with the same RLS and grants. Discard's text and row version therefore
   come from the same database snapshot.
2. The client preserves the PostgREST timestamp string exactly, including PostgreSQL
   microseconds and timezone. It validates the string but never rebuilds it through
   `Date.toISOString()`, which truncates sub-millisecond precision.
3. `PUT /api/staging/content/[siteId]` accepts an optional `expectedUpdatedAt`. Omission alone
   retains the existing last-write-wins `save_staging_content_atomic` path for permanent editor
   callers. Explicit null or a malformed timestamp is a 400; it never falls through to an
   unconditional save. The new trigger can store a later token than that RPC's local `v_now`, so
   the migration redefines the same legacy signature and two-column result to return the UPDATE's
   actual post-trigger `updated_at`; its write behavior and response shape are otherwise unchanged.
4. Conditional calls use the separately named, required-argument
   `save_staging_content_compare_and_set` RPC. It locks the row, compares the row-wide
   `updated_at`, merges attribute drafts, updates the draft and appends `staging_history` in one
   statement. It returns exactly one typed outcome: `saved`, `missing` or `conflict`.
5. The function is `SECURITY DEFINER` with `search_path = public, pg_temp`; only `service_role`
   may execute it. The inherited `content_elements` BEFORE UPDATE trigger used transaction-start
   `NOW()` and overwrote the function's candidate token, so two writes in one transaction could
   return the same version. This migration replaces only that table's trigger with a monotonic
   trigger: wall-clock time, the requested value or one PostgreSQL microsecond after the previous
   token, whichever is greatest. Other tables retain the shared timestamp function unchanged.
6. The route maps `conflict` to HTTP 409 with the fixed message “This change was updated elsewhere
   — review it again.” Discard marks that outcome stale, refreshes the row and counts through the
   existing read path, closes the confirmation dialog onto the refreshed expanded row, and never
   retries or offers a force action.
7. A missing or malformed version in an older/corrupt Changes response refuses Discard before the
   PUT. It cannot accidentally become an unconditional save.

## Considered options

- **Read `updated_at` in the route before the old RPC.** Rejected. That is another preflight read;
  a write can still land between it and the update.
- **Use `staging_updated_at`.** Rejected. It misses the live text and metadata changes Discard
  copies back into the draft.
- **Take `updated_at` from the later metadata query.** Rejected. It can version a different
  snapshot from the text and make stale copy look current.
- **Overload `save_staging_content_atomic`.** Rejected. PostgREST chooses RPCs by name and
  arguments; defaults and omission would make the old and conditional contracts ambiguous.
- **Make every staging save conditional.** Rejected. Existing widget/editor callers have no
  version token and their permanent contract remains last-write-wins.
- **Retry the 409 automatically or offer “force discard”.** Rejected. Either can destroy the
  intervening edit without a new deliberate review.

## Consequences

- Discard applies only to the exact complete row version read immediately before its PUT. A
  competing writer wins or loses normally; it is never silently overwritten by the stale action.
- A conflict changes neither `content_elements` nor `staging_history` and returns a deterministic
  response the existing Changes UI can explain.
- Other staging saves are unchanged because they omit the optional precondition and call the old
  RPC.
- `updated_at` is now part of the reviewed member-visible Changes projection. It is operational
  row metadata, contains no content or credential, and remains tenant-scoped by the view's RLS.
- The new forward migration must follow s65b's revision-trigger retirement in deployment order;
  it does not copy or modify that migration.
