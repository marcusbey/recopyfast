# Research — s119-source-drift-conflicts

Base: `main` at `5d42b8e`. Problem and decision: [ADR 075](../decisions/075-source-drift-is-flagged-not-enforced.md).

## What exists

- `content_elements.original_content` — authored text at first discovery. `POST
  /api/content/[siteId]` (`buildDiscoveryRows`) writes original = current = published from the
  widget's report and upserts with `ignoreDuplicates`, so a visitor never overwrites it. Bulk
  import (an admin path) can set it.
- Discovered text is stored verbatim (`validateVerbatimText` in
  `src/lib/security/discovered-text.ts`), so the stored `original_content` equals the widget's
  `data.originalContent` byte for byte — a live/baseline comparison needs no normalisation.
- `GET /api/content/[siteId]` returns `original_content` and `current_content`
  (= published ?? original) to the widget.
- Widget (`public/embed/recopyfast.src.js`):
  - `applyRow` (~:3870) writes text only when `current_content !== original_content` (s67 AC 11).
  - `data.originalContent` is the first-seen authored text, kept across re-renders (s65a).
  - `sendContentMap` (~:3155) builds `{ id: { selector, content: originalContent, type,
    page_path } }` for every element; `postContentMap` (~:3227) sends only ids missing from
    `serverKnownElementIds`, coalesced (first at once, then ≤ 1 per 10 s, ≤ 10 per page view),
    claiming ids before the POST.
  - `this.index` holds the current path's rows by element id.
- Publish: `publish_staging_content_with_attributes_atomic` (migration
  `20260924060000_restore_site_wide_publish.sql`) — never sees the live page.
- Changes page: `GET /api/content/changes` reads the security-invoker view `content_changes`
  (ADR 054: do not widen it) plus an RLS read of the base table for staged attributes — the
  pattern to copy for drift fields. UI in `src/components/dashboard/changes/`.
- `staging_history.action` CHECK allows `create | update | publish | revert`.
- Content writes from the dashboard: ADR 042 / ADR 037 chain (see
  `src/app/api/staging/content/[siteId]/route.ts`, `checkOwnerCanEdit`).
- DB tests: `src/__tests__/db/` with `db-harness.ts`; `function-grants.test.ts` and
  `content-write-privileges.test.ts` enumerate privileges and must learn the new functions.

## Embed budget (measured 2026-10-22)

`node scripts/build-embed.mjs --check`: bundle 45,769 B gz (max 45,801), widget 32,992 B gz
(max 33,044). Headroom 32 B / 52 B. The widget change must be a few dozen gzipped bytes and any
excess paid for by savings in the same diff. Raising a ceiling is not allowed.

## Traps

- `postContentMap`'s filter is the one place to add the report; a separate request path costs
  more bytes than exist.
- A row without `source_seen` (unedited) must never report, or every element of every page
  reports on every view.
- Discovery's per-site limiter is fail-closed (100/min); drift must stay one report per drift,
  not one per visitor.
- `NextResponse.json({}, {status: 204})` throws; OPTIONS uses `new NextResponse(null, ...)`.
