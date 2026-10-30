# ADR 075 — A developer's changed source is flagged against the override, never silently won or lost

- Status: accepted (architect decision, 2026-10-22)
- Date: 2026-10-22
- Scope: story `s119-source-drift-conflicts`, branch `feature/s119-source-drift-conflicts`
- Related: [ADR 042](./042-content-writes-are-service-role-only.md) (content writes),
  [ADR 037](./037-dashboard-admin-service-role-writes.md) (dashboard admin writes),
  [ADR 054](./054-content-change-state-is-a-security-invoker-view.md) (the Changes view stays narrow),
  s67 / AC 11 (only an edited row writes page text)
- Narrows: ADR 046 parity — the content GET carries `source_seen`, the snapshot does not.
  `source_seen` is a comparison hint for the widget, not copy, and putting it (or the drift
  columns behind it) in the unauthenticated, CDN-cached snapshot would widen ADR 046's public
  projection for no reader that needs it: the widget never reads the snapshot. Every other byte
  of the two reads stays identical, and the parity test pins both halves.

## Context

A client publishes an override for an element: the page said "5 to 10", the client published
"5 to 11". Later the developer deploys new HTML in which that element says "5 to 9". The embed
keeps writing "5 to 11" over it, forever, and nobody is told. Reported publicly on
r/SideProject on 2026-10-21 by a developer evaluating ReCopyFast for client sites; the founder
confirmed the gap in the thread. It is the strongest concrete product objection received so far:
a developer cannot trust a tool that silently masks their deploys.

What already exists and is reused:

- `content_elements.original_content` is the authored text at first discovery. Discovery upserts
  with `ignoreDuplicates`, so it is never overwritten by a visitor.
- `GET /api/content/:siteId` already sends `original_content` to the widget, and the widget only
  writes page text for a row where `current_content !== original_content` (s67 AC 11).
- The widget already holds each element's live authored text (`data.originalContent`, read before
  any write) and already reports elements to `POST /api/content/:siteId`.

## Decision

1. **Visitors keep seeing the override.** Detection never changes what a visitor sees. The client
   published those words; un-publishing them because a deploy happened would be the same silent
   surprise in the other direction, on a page the client is responsible for. The conflict is
   surfaced to the developer, who decides.
2. **Baseline = what the override was written against.** New nullable column
   `content_elements.source_baseline`. NULL means `original_content` (every existing row). It is
   moved only by a developer's "Keep override" resolution. Publish does not move it: the publish
   path is server-side and never sees the live page the editor saw, and the only value it could
   snapshot is `original_content`, which is already stored. Storing a hash instead of text was
   rejected — the dashboard must show the developer what changed, and the text is already public
   page copy.
3. **Drift = live authored text ≠ baseline, on an edited row.** New nullable columns
   `source_drift_content` (the live text last observed) and `source_drift_detected_at`. A row that
   is not edited (`published_content IS NOT DISTINCT FROM original_content`) never drifts: the
   widget does not write its text, so the developer's deploy already shows.
4. **The widget reports through the discovery POST it already makes.** The content GET adds one
   field, `source_seen`, on edited rows only: `COALESCE(source_drift_content, source_baseline,
   original_content)`. When an element's live authored text differs from its row's `source_seen`,
   the widget includes that element in its normal discovery report and sets `source_seen` to the
   live text, so a page view reports a given drift once. No new endpoint, no new request shape,
   the same per-page-view coalescing and caps. The embed budget has ~30–50 gzipped bytes of
   headroom; a second reporting path does not fit and is not needed.
5. **The server decides, in one statement.** After the discovery upsert, the route calls
   `record_content_source_drift(site, reports)` (service role only). For each reported element on
   an edited `en`/`default` row: equal to the baseline → clear any drift (the developer reverted);
   different and not already recorded → record it with `now()`. Unedited and unknown rows are
   ignored. Repeat visitors after the first therefore send nothing: their GET's `source_seen` is
   already the recorded drift.
6. **The developer resolves; only a site admin can.** `POST /api/content/source-drift`
   `{ siteId, contentElementId, resolution: "keep" | "drop", expectedObserved }`, chained per
   ADR 037/042: IP limiter → `getUser()` → fail-closed per-user limiter → `admin` row read through
   the RLS client → `checkOwnerCanEdit` → service-role RPC `resolve_content_source_drift`, which
   locks the row and compares `expectedObserved` against the stored drift (a newer observation
   since the admin looked returns 409).
   - **keep**: `source_baseline := source_drift_content`, drift cleared. Visitor copy unchanged.
     No `staging_history` row: no content changed.
   - **drop**: the row is re-discovered at the developer's text —
     `original_content = published_content = current_content := source_drift_content`,
     `source_baseline := NULL`, drift cleared, a `staging_history` row with action `revert`
     (the existing CHECK allows it). The row is no longer edited, so the widget stops writing it
     and the page shows the deployed source. Refused (409) while the row has a pending staged
     draft: publish or discard that first.
7. **Dashboard.** The Changes page marks a row with an open conflict ("Source changed since this
   edit") and its detail shows three values — written against, page now says, visitors see —
   with Keep override / Use new source. The conflict fields come from an RLS read of the base
   table for the returned ids, the pattern already used for staged attributes; the
   `content_changes` view is not widened (ADR 054).

## Trust

The site token is public, so anyone can forge a discovery report. Forged drift can only set
`source_drift_content` on an edited row — the same trust level as forging a discovery row today
— and changes nothing a visitor sees until an admin acts on it. "Keep" on a forged value is
self-healing: the next real visitor's text differs from the forged baseline and re-flags it.
"Drop" makes the row unedited at the observed text. On a site where the widget is the only
renderer, the page then shows its own authored text whatever the stored value is; but every
consumer that renders the stored copy — an ADR 046 snapshot integration, the v1 API — serves
the observed text as published copy. So "drop" publishes what the admin was shown, and the
dialog shows the observed text before they choose; that review is the control, not the widget.

## Known limits

- Per-visitor authored text on an edited element (personalisation, host A/B, i18n) flips the
  recorded drift on each differing visitor and spends the per-site discovery limit. Such an element
  should not carry an override in the first place; documented, not mitigated.
- Drift on rows edited only in staging mode (editor session) is not reported: the staged read
  does not carry `source_seen`. Visitors' page views report it.
- A drift that predates the first edit (developer deployed between discovery and the client's
  first publish) is flagged too. It is still true that the override masks the developer's current
  source; "Keep override" clears it once.

- **SSR snapshot integrations.** A site that server-renders `GET /api/published/[siteId]`
  (`docs/architecture/published-snapshot.md`) puts the served copy into its HTML, so the text
  the widget reads first is the override, never the developer's source: drift there is
  undetectable. A live text equal to the row's served copy is therefore no evidence either way —
  the widget does not report it, and `record_content_source_drift` neither records nor clears on
  it (review M1). Inside the snapshot's cache window after a publish, such a page can still show
  the previous override and report it once as drift; the admin sees that text before choosing.

## Rejected

- **Stop applying the override on drift.** Silent in the other direction; see 1.
- **A dedicated drift endpoint in the widget.** Does not fit the embed ceilings, duplicates the
  coalescing and claim logic, and adds a public write surface.
- **Rebasing `original_content` on "keep".** Rewrites the first-seen authored copy the Changes
  view and history read as "before"; a separate baseline column is additive.
- **Snapshotting at publish.** See 2: nothing new to snapshot server-side; threading the editor's
  live text through both staging save RPCs would change two signatures for no stronger guarantee.
