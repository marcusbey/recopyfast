---
validated: yes
story: s119-source-drift-conflicts
---
# Source drift conflicts — flag a deploy that an override masks

Goal and semantics: [ADR 075](../decisions/075-source-drift-is-flagged-not-enforced.md). Research:
[`docs/research/s119-source-drift-conflicts.md`](../research/s119-source-drift-conflicts.md).

- [x] Human validation: owner's standing directive for this work, relayed by the parent session on
      October 22, 2026 ("Claude acts as architect, implementation goes to subagents"; done = PR open
      with tests). Independent review remains the gate.
- [x] **Migration** `supabase/migrations/20261029120000_content_source_drift.sql`: add
      `source_baseline TEXT`, `source_drift_content TEXT`, `source_drift_detected_at TIMESTAMPTZ`
      to `content_elements` (nullable, no default). Functions, `SECURITY DEFINER`,
      `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`,
      `GRANT EXECUTE ... TO service_role`:
      - `record_content_source_drift(p_site_id UUID, p_reports JSONB)` — `p_reports` is
        `[{element_id, content}]`; one UPDATE over `en`/`default` rows of that site where
        `published_content IS DISTINCT FROM original_content`: equal to
        `COALESCE(source_baseline, original_content)` → clear both drift columns (only if set);
        else set `source_drift_content`, `source_drift_detected_at = now()` only when
        `source_drift_content IS DISTINCT FROM` it. Must not fire the monotonic `updated_at`
        bump in a way that breaks staging CAS — check
        `set_content_element_updated_at_monotonic` and decide (document in a comment).
      - `resolve_content_source_drift(p_site_id UUID, p_content_element_id UUID, p_resolution
        TEXT, p_expected_observed TEXT, p_user_email TEXT, p_user_id UUID)` returning a status
        (`resolved | conflict | missing | pending`): row lock; `missing` if no row / no drift;
        `conflict` if drift ≠ expected; `pending` for `drop` while a staged draft differs from
        published; keep/drop exactly as ADR 075 §6 (drop writes `staging_history` action
        `revert`, previous = old published, new = observed, sets `published_at`/`published_by`).
- [x] **DB tests** (`src/__tests__/db/content-source-drift.test.ts`, real PostgreSQL via the
      harness): the three-value scenario (original "5 to 10", published "5 to 11", report
      "5 to 9" → drift recorded, published still "5 to 11"); repeat report no-op (timestamp
      unchanged); report equal to baseline clears; unedited row and unknown id ignored; other
      site's row untouched; keep and drop semantics incl. 409-equivalents; grants (service role
      only) added to `function-grants.test.ts` / privilege inventories as those tests require.
- [x] **Content GET** (`src/app/api/content/[siteId]/route.ts`): select the three columns; emit
      `source_seen` only on edited rows; strip the raw drift/baseline columns from the response
      unless needed. Unit tests.
- [x] **Discovery POST** same route: after a successful upsert, call
      `record_content_source_drift` with the validated rows' `{element_id, content}`. Best effort:
      a failure is logged and never fails the discovery response (widget degrades). Unit tests,
      incl. the three-value scenario at route level.
- [x] **Widget** (`public/embed/recopyfast.src.js`, then `npm run build:embed`): in
      `postContentMap`, an id also qualifies when its row in `this.index` has `source_seen != null`
      and the element's live `content` differs; set `row.source_seen` to the live text as the
      claim. Tombstone comment in house style. Jest test (jsdom) of the three-value scenario:
      override still on the page, one POST containing "5 to 9", no second POST on rescan, no POST
      when live = baseline or when the row is unedited. Fit within the committed ceilings: find
      equivalent savings in the same file if needed; never raise `MAX_*`. If it genuinely cannot
      fit, stop and report.
- [x] **Resolution route** `src/app/api/content/source-drift/route.ts` (`POST`, `OPTIONS` not
      needed — same origin): ADR 037/042 chain, `admin` permission, validation via
      `src/lib/api/validation.ts` (uuid ids, resolution enum, `expectedObserved` string capped at
      the discovered-text max). Map statuses: resolved 200, conflict/pending 409, missing 404.
      Unit tests for every refusal and both resolutions.
- [x] **Changes read** (`src/app/api/content/changes/route.ts`): per returned row, a
      `sourceDrift: { observed, baseline, detectedAt } | null` from an RLS read of the base table
      (edited rows only); a `conflicts` state filter if it can be done without widening the view.
      Tests.
- [x] **Changes UI** (`src/components/dashboard/changes/`): badge "Source changed since this
      edit" on the row; detail shows written-against / page now says / visitors see, with
      "Keep override" and "Use new source" (admins only; confirm step consistent with
      `RevertDialog`), re-reading after the write as the page already does. Compose from
      `src/components/ui/`. Testing Library tests.
- [x] Coverage ratchet held or raised; lint, type-check, type-check:build, format:check, full
      `npm test`, `npm run build` green; `node scripts/build-embed.mjs --check` passes.

Files: the migration, `src/app/api/content/[siteId]/route.ts`, new
`src/app/api/content/source-drift/route.ts`, `src/app/api/content/changes/route.ts`,
`src/components/dashboard/changes/*`, `public/embed/recopyfast.src.js` + rebuilt artifact, tests.
Rollback: revert the PR; the migration is additive (three nullable columns, two functions) and
harmless if left applied.

## Implementation notes

Recorded by the implementer, October 22, 2026. Each item is a choice the plan or ADR 075 left
open, or a place where the code differs from the plan's wording; nothing here changes the
ADR's decision.

- **ADR renumbered.** 074 was taken on `main`; on the architect's instruction the ADR is
  `075-source-drift-is-flagged-not-enforced.md` and every reference says ADR 075.
- **"Edited" mirrors the widget.** The plan writes `published_content IS DISTINCT FROM
  original_content`. Both RPCs, the content GET and the Changes read use
  `COALESCE(published_content, original_content) IS DISTINCT FROM original_content` instead —
  the widget's own `current_content !== original_content` — so a legacy row with a NULL
  published copy (which the widget does not write) never drifts or gets `source_seen`.
- **CAS token (s81).** `set_content_element_updated_at_monotonic` is replaced (CREATE OR
  REPLACE, in the new migration): an UPDATE whose only effect is on the three source columns
  keeps `updated_at`. Otherwise every visitor's drift report would hand an owner reviewing that
  row a spurious Discard conflict. Any other change, and a full no-op UPDATE, still bumps it
  (DB test `guard: an ordinary content write still moves the CAS token`; staging-content-cas
  passes unchanged). "Keep override" therefore keeps the token too; "Use new source" bumps it.
- **`source_seen` only on `en`/`default`.** The recorder ignores every other row, so a widget
  comparing against one would re-report the same drift on every page view.
- **Widget claim.** The plan says "set `row.source_seen` to the live text as the claim"; the
  claim deletes `source_seen` instead (11 gz bytes cheaper). Same effect for the page view:
  the reported text is the first-seen authored copy, fixed for the view. A failed drift POST
  forgets the id like any claim, so the next rescan re-reports it through the unknown-id path.
- **Embed bytes.** The drift report costs +31 / +33; it is paid by equivalent forms elsewhere in
  the widget (object spread for every `Object.assign`, `3` for `Node.TEXT_NODE`, length
  truthiness, `slice`, `url.href`). Final 45742 / 32964 against main's 45769 / 32992; both
  ceilings ratcheted down by what the story earned (45774 / 33016, headroom unchanged),
  itemised in `scripts/build-embed.mjs` and pinned in `build-size-gate.test.ts`.
- **Drop and drafts.** "Pending" is the Changes view's definition (text draft differing from
  published, or a staged attribute differing from live). A non-pending `staging_content` (equal
  to the old published copy) is moved to the deployed text with the row; left alone it would
  read as a pending draft that re-publishes the override.
- **`missing`** also covers an unedited row carrying a leftover drift (e.g. reverted to the
  original after the drift was recorded): there is nothing to resolve.
- **Resolution route.** Per-user limiter is `USER_GENERAL` (100/min), fail-closed, like the IP
  limiter. No same-origin check was added: the plan's chain is ADR 037/042, and the existing
  dashboard content writes (`staging/publish`) carry none — a reviewer question, not decided here.
  The Changes page treats 404 as stale as well as 409 and re-reads the row.
- **No `conflicts` filter.** A correct filter needs either a widened view (ADR 054) or a bounded
  id list: PostgREST cannot express "edited" (a column-to-column comparison), and an unbounded
  `id IN (…)` would page and count wrongly once it is capped. Conflicts are shown by the row badge
  in every list instead.
- **The ADR 046 snapshot stays as it is.** ADR 046 says `GET /api/published/[siteId]` serves exactly
  what the content GET serves; ADR 075 adds `source_seen` to the content GET and says nothing
  of the snapshot. Publishing `source_seen` (or the drift columns behind it) through the
  unauthenticated, CDN-cached snapshot would widen a public projection — an ADR 046 decision —
  so the closest safe variant was taken: the snapshot is unchanged, `PUBLIC_CONTENT_COLUMNS` is
  unchanged, and the content GET selects that list byte for byte followed by the three drift
  columns. Parity now means "identical rows except the widget-only `source_seen` hint", and the
  snapshot is asserted never to carry it. If the snapshot should carry it, that is a new ADR.
- **Existing tests changed.** `public-rows.test.ts` (the content GET's select is the public list
  plus the drift columns) and `published/route.test.ts` (parity minus `source_seen`, which the
  snapshot must not carry), for the item above. `content-attributes-lifecycle.test.ts`: its
  scratch-schema migration list gains this story's migration, because it runs the real content
  GET, which now reads the new columns. `changes-route.test.ts`: the `metadataQueries` helper now excludes
  the new drift read (selected by its projection) so "the metadata read" keeps meaning the
  metadata read, and the row-contract assertion gains `sourceDrift: null`.
  `build-size-gate.test.ts`: the seeded ceilings follow the ratchet.
- **Not CI-run here.** `founding-offer-cap.test.ts` fails against the bare-Postgres replay
  (`auth.users.created_at` NOT NULL in the fixture); it is unrelated, unchanged, and runs in CI
  against the Supabase stack only.
- **Migration first, then deploy** — runbook:
  [`docs/operations/s119-source-drift-deploy-order.md`](../operations/s119-source-drift-deploy-order.md)
  (review M2). The visitor content GET now selects the three new columns:
  an app deployed before `20261029120000_content_source_drift.sql` is applied answers that read
  with a 500, and every widget falls back to the authored page (published copy disappears until
  the migration lands). The migration is additive and safe to apply ahead of the code.

### Review fixes (docs/reviews/s119-source-drift-conflicts.md)

- **M1 — snapshot SSR sites.** A page that server-renders the ADR 046 snapshot shows the
  override itself, so the widget read it as the "authored" source and every publish raised a
  false conflict. Fixed twice: the widget does not report a live text equal to the row's
  `current_content`, and `record_content_source_drift` treats a report equal to
  `COALESCE(published_content, original_content)` as a no-op (it neither records nor clears).
  The migration was edited in place: it has not been applied anywhere (the branch is unmerged).
  Tested at the widget level (page "5 to 11", `source_seen` "5 to 10" → no POST) and the DB level
  (no drift recorded, and none cleared). ADR 075 gains the "SSR snapshot integrations" known
  limit, and its Trust paragraph no longer says "drop" always shows the real authored text.
  Embed: +8 / +8 → 45750 / 32972 B gz, still under the unchanged 45774 / 33016 ceilings and
  −19 / −20 against main.
- **M2 — deploy order.** Runbook `docs/operations/s119-source-drift-deploy-order.md`, linked from
  this plan, the story and `docs/README.md`.
- **m1 — ADR 046 parity.** ADR 075's header carries a "Narrows:" line with the reason.
- **m3 — webhook.** "Use new source" records `content.updated` through
  `webhookManager.recordQualifyingEvent` in `after()`, with the publish route's payload shape.
  "Keep override" changes no copy and records nothing.

### Deferred

- **m2 — same-origin guard.** Add `isSameOriginRequest` to `POST /api/content/source-drift`
  together with `staging/publish` and `staging/content`, which share the gap. One follow-up
  story, so the content writes stay consistent.
- **m4 — lazy images and other per-load authored values.** A host lazy-loader that swaps an
  edited image's `src` after the first scan can make drift flap between visitors (one report
  per view while it flaps). This is covered in spirit by ADR 075's "per-visitor authored text"
  limit, but images are not named there. Mitigation, if it shows up: skip IMG rows whose `src`
  is a known placeholder, or compare `currentSrc`.
- **Snapshot cache window.** After a publish on an SSR snapshot site, a page served from a
  ≤ 60 s stale snapshot still shows the previous override, which can be reported once as drift
  (named in ADR 075's known limit). `docs/architecture/published-snapshot.md` could say so for
  integrators. It is not edited here.
