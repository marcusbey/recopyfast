---
validated: yes
---
# Plan — Story s05-bulk-content-portability

Branch: `feature/s05-bulk-content-portability`
Research: `docs/research/s05-bulk-content-portability.md` — read it first; this plan does not repeat it.
Design: `docs/designs/s05-bulk-content-portability.md` — the "Content portability" card, its
three redesigned tabs (Export/Import/History), every state (including partial-success) and the
component table in it are followed verbatim. `Batch Update` is out of scope and untouched.
Decision: `docs/decisions/008-bulk-import-write-path.md` — the import-write-path choice this plan
turns on; read before task 7, together with
[ADR 024](../decisions/024-bulk-import-snapshot-change-type.md), which supersedes it on the
snapshot's `change_type` value.

## Target story

`s05-bulk-content-portability` (`docs/stories.md:385-421`). Complexity 2 as scored, **3 as
verified by research** — the UI-wiring part is genuinely a 2; three of the seven criteria
(round-trip, per-row isolation, version history) require real logic changes to routes the story
describes as "already exist and are tested." No split: everything stays inside three existing
files plus one new small module, per research's own verdict.

Acceptance criteria, carried forward verbatim from `docs/stories.md:394-400`:
1. A control in the dashboard exports one site's content elements as CSV and as JSON.
2. The export includes element id, selector, current content, language and variant.
3. An exported file re-imported unchanged produces zero content differences, asserted by a round-trip test.
4. Import reports per-row outcomes — created, updated, skipped, failed with a reason — and a malformed row fails that row alone without aborting the import.
5. Import refuses a file targeting a site the caller has no permission on.
6. Import of a file larger than a stated size limit is refused before parsing.
7. Imported changes appear in version history as normal, revertible edits.

**Two bugs found while planning, in scope because wiring this feature up is what makes them
reachable for the first time:**
- `BulkOperations.tsx`'s `fetchOperations()` (`:266-276`) calls
  `/api/bulk/import?siteId=${siteId}`, a shape `import/route.ts`'s `GET`
  (`:357-411`, `operationId`-only) has never supported — today this silently 400s and the
  `if (response.ok)` guard swallows it into a false empty list, which is exactly the "empty is
  never how an error renders" failure `docs/design-system.md` names.
- `export/route.ts`'s `GET` (`:244-302`, the endpoint that actually does support a `siteId`
  listing) checks only that the caller is authenticated — no `site_permissions` check at all
  (`:269-273`). Reachable by nobody today because nothing calls it; reachable by any signed-in
  user for any site's history the moment this story mounts a UI in front of it.

## Tasks (ordered)

1. [x] **Shared, quote-aware CSV codec (`src/lib/bulk/csv.ts`).**
   New module: `encodeCSVRow(fields: string[]): string` and `parseCSV(text: string): string[][]`
   (RFC4180-shaped: fields containing `,`, `"` or a newline are quoted, `"` doubles to `""`
   inside a quoted field, embedded `\r\n`/`\n` inside quotes does not end the row). This directly
   replaces the asymmetry research fact #4 identifies: `generateCSV`
   (`export/route.ts:171-205`) quotes and escapes; `parseCSVImport`
   (`import/route.ts:194-231`) does `line.split(",")` with zero quote awareness and
   `data.trim().split("\n")` with no embedded-newline handling.
   Test: round-trip unit tests — a value containing a comma, a bare `"`, an embedded newline, and
   plain unicode each survive `encodeCSVRow` → `parseCSV` unchanged; a header-only input parses
   to zero data rows, not one empty row.

2. [x] **`export/route.ts`'s `generateCSV` uses the new codec; add the missing export test file.**
   Replace the hand-rolled quoting at `:190-204` with `encodeCSVRow`, applied to every column, not
   only the three currently wrapped in `"..."` — so a comma or quote in `element_id` or
   `selector` (unlikely, but no longer assumed impossible) round-trips too. Add
   `src/__tests__/api/bulk/export.test.ts` — none exists today (research, "no test file exists
   for `export/route.ts`").
   Test: JSON and CSV export for a fixture site (AC1, AC2 — asserts `element_id`, `selector`,
   `current_content`, `language`, `variant` are present in both formats); permission levels
   `view`/`edit`/`admin` succeed, no permission row 403s; an encode→`parseCSV` round trip on the
   generated CSV reproduces the same field values as the source rows.

3. [x] **Fix bulk-operation history listing — the two bugs named above.**
   Point `BulkOperations.tsx`'s `fetchOperations` (`:268`) at `/api/bulk/export?siteId=...`
   instead of `/api/bulk/import?siteId=...` — the endpoint that already supports this shape.
   In `export/route.ts`'s `GET`, add the same `site_permissions` check the `POST` handler already
   does (`:51-67`) before querying `bulk_operations`, and drop the
   `.eq("operation_type", "export")` filter (`:280`) so the listing returns import, export and
   batch-update history together — what the design's History tab is meant to show.
   Test: a component test confirms `fetchOperations` requests `/api/bulk/export?siteId=`; a route
   test confirms a caller with no `site_permissions` row on the target site gets 403, and a
   `view`/`edit`/`admin` caller gets a list mixing `operation_type` values.

4. [x] **Import route: a malformed row fails alone (AC4, first half).**
   Restructure `parseJSONImport` (`:169-192`) and `parseCSVImport` (`:194-231`, now built on
   task 1's codec) so a single bad **row** — one JSON array item or one CSV data row missing
   `element_id`/`selector`/`current_content` — produces a row-level failure entry instead of
   throwing. Both functions keep throwing for **whole-file** problems that have no per-row
   meaning: `data` not an array (JSON), `data` not a string or missing required CSV headers
   (CSV) — there is no row to attribute those to. Each function now returns both the
   successfully-parsed candidates (tagged with their original 1-based row position) and any
   row-level parse failures, in file order.
   Test: a CSV/JSON file with one malformed row among several valid ones imports all the valid
   rows and reports exactly one `failed` entry for the bad one — the batch does not abort and no
   other row's outcome is affected. A CSV missing a required header still refuses the whole file
   (`400`, no `bulk_operations` row created as `"running"`… see task 8 for exact semantics if this
   changes them).

5. [x] **Import route: canonical per-row outcomes (AC4, second half).**
   *(Deviation: the fixture this task specifies — "created, updated,
   existing-not-overwritten skipped, missing-not-created skipped, malformed row failed" in a
   single import call — cannot exist. `create_missing_elements` and `overwrite_existing` are
   per-request flags, so "created" and "missing-not-created skipped" are mutually exclusive
   within one call, as are "updated" and "existing-not-overwritten skipped". Shipped as two
   tests in `import-outcomes.test.ts`, one per option setting, covering all four outcomes
   between them. Confirmed correct at review.)*
   *(No content-length rule, as this task and the run interdict both require. The write path
   had to stop running an HTML sanitizer over the content (see "Review fixes"), and what
   replaces it is `validateVerbatimText(..., null)` — the refuse-never-repair half of
   `src/lib/security/discovered-text.ts`, with no ceiling. The round-1 fix reused
   `validateDiscoveredText` and imported its 20,000-character bound with it; that was wrong and
   round 2 removed it. The bound is a rule about discovery, and nothing else that writes
   `content_elements.current_content` caps it, so a row written by `bulk/update`,
   `staging/content` PUT or `v1/content` POST exported fine and would not have re-imported.
   Control characters are still refused, per row, with the reason.)*
   Replace `validateContentElements` (`:238-281`) and `importContentElements`
   (`:283-355`)'s separate existence-check / try-catch-23505 logic with one per-row pipeline that
   looks the element up once (`site_id`, `element_id`, `language`, `variant`) and emits exactly
   one of four outcomes:
   - **created** — no existing row, `create_missing_elements` true, insert succeeds.
   - **updated** — existing row, `overwrite_existing` true, write succeeds.
   - **skipped** — no existing row and `create_missing_elements` is false (detail: `"Element id
     not found and 'create missing elements' is off"` — the exact wording the design mockup
     uses); or an existing row and `overwrite_existing` is false (detail: `"Element already
     exists and 'overwrite existing' is off"`). Today the second case is miscounted as
     `failed` via the caught `23505` unique-violation (`:334-340`) — this is a deliberate
     reclassification, not a bug fix to preserve; note it in the PR description.
   - **failed** — sanitize/DB error on write, or a row-level parse failure from task 4 (detail:
     the parse reason, e.g. `"missing required fields"`).
   Do **not** invent a content-length cap or any other validation rule the codebase does not
   already enforce — the design mockup's "Content exceeds the 10,000-character limit" example is
   illustrative, not a verified requirement, and no such limit exists anywhere in the schema or
   `content-sanitizer.ts` today.
   Add `BulkImportRowResult` to `src/types/index.ts`:
   `{ row: number; elementId: string; outcome: "created"|"updated"|"skipped"|"failed"; detail?: string }`.
   Change the `POST` success response from `{ total, successful, failed, errors }` to
   `{ total, created, updated, skipped, failed, rows: BulkImportRowResult[] }` (`rows` in
   original file order, parse failures from task 4 merged in at their original position). Update
   `src/__tests__/api/bulk/import.test.ts`'s two assertions on the old shape
   (`:113-118`, `:184-186`) to the new one — a deliberate behaviour change, stated here per
   `AGENTS.md`'s "change the test *and say so*" rule, not a silent edit.
   Test: one fixture exercising all four outcomes in a single import call (new element created,
   existing element updated, existing-not-overwritten skipped, missing-not-created skipped,
   malformed row failed) asserts the exact `rows` array and summary counts.

6. [x] **Pre-parse size guard (AC6).**
   New `src/lib/bulk/constants.ts` exporting `MAX_IMPORT_BYTES` — imported by both the route and
   the client component so the number the UI quotes can never drift from what the server
   enforces. *(The plan said `5 * 1024 * 1024`, the figure the design mockup states. Shipped as
   **4 MB**: 5 MB is above Vercel's 4.5 MB platform body cap, so the refusal would not have been
   ours to phrase. See round-3 MAJOR 5.)* At the very top of
   `import/route.ts`'s `POST`, before any `JSON.parse`: read the request body as raw text
   (`await req.text()`), measure `Buffer.byteLength(text, "utf8")`; if it exceeds
   `MAX_IMPORT_BYTES`, return `413` with a clear message and stop — no `bulk_operations` row is
   created, `JSON.parse` is never called. Only measure the actual bytes read; do not trust a
   client-supplied `Content-Length` header on its own. Parse the already-read text with
   `JSON.parse` afterward instead of calling `req.json()` a second time.
   Test: a body over `MAX_IMPORT_BYTES` is refused with `413` and creates no `bulk_operations`
   row (assert zero `insert` calls against that table); a body under the limit proceeds exactly
   as before.

7. [x] **Post-batch version snapshot (AC7) — per `docs/decisions/008-bulk-import-write-path.md`,
   as superseded on the `change_type` value by
   [ADR 024](../decisions/024-bulk-import-snapshot-change-type.md).**
   *(Correction, made at review: this task and ADR 008 both said `p_change_type: "bulk_import"`.
   That value does not exist — `content_versions.change_type` is constrained to
   ('manual','style_apply','language_switch','theme_apply','restore','bulk_edit') by
   `20251230100000_edit_board.sql:69`, so `bulk_import` would have failed the insert invisibly
   and left version history empty, the exact bug this call exists to fix. **The code was right
   and the documents were wrong**; the implementation has always written `bulk_edit`. Round 1 of
   this fix run edited ADR 008 in place, which `AGENTS.md` forbids — ADRs are immutable and a
   change means a superseding ADR. ADR 008 is restored byte-for-byte to what is on `main`, and
   ADR 024 carries the correction. A second correction followed in the dashboard:
   `versionChangeTypes` was keyed `bulk`, also impossible, so every bulk snapshot rendered as
   "Manual edit".)*
   After `importContentElements`'s replacement (task 5) returns, if `created + updated > 0`, call
   `createServiceRoleClient().rpc("create_content_version", { p_site_id: site_id, p_created_by:
   user.email ?? user.id, p_description: <summary of the counts>, p_change_type: "bulk_edit"
   })` — the same RPC `POST /api/edit-board/history` already wraps
   (`src/app/api/edit-board/history/route.ts:212-217`). Skip the call when `created + updated ===
   0` (nothing changed; no snapshot to take). The route already holds an authorized `user` from
   its existing `site_permissions` check — no new authorization path, just a second Supabase
   client for this one `SECURITY DEFINER`-gated call, matching how `staging/content` and
   `edit-board/history` already mix an anon-key check with a service-role RPC call in the same
   request.
   Test: an import that creates or updates at least one row triggers exactly one
   `create_content_version` RPC call with the site's id and `change_type: "bulk_edit"`; an
   import where every row is `skipped`/`failed` (nothing applied) triggers zero calls.

8. [x] **Round-trip integration test (AC3) — the criterion the story names explicitly.**
   New `src/__tests__/api/bulk/roundtrip.test.ts`: seed a fixture set of `content_elements` whose
   `current_content` values include a comma, an embedded quote, an embedded newline and non-ASCII
   text; call the (now-fixed) export route for both `json` and `csv`; feed each exported file
   straight back into the (now-fixed) import route with `overwrite_existing: true`; assert every
   element's `current_content` (and `language`/`variant`) is byte-for-byte identical to the
   source, for both formats, and that the CSV round trip specifically exercises the pathological
   values above — the case that was silently broken before task 1.

9. [x] **Wire `BulkOperations` into `SiteDetailView.tsx` (the dark-feature fix).**
   Mount `<BulkOperations siteId={site.id} />` directly above `<VersionHistoryPanel ...>`
   (`SiteDetailView.tsx:373-379`) — self-contained, the same way `VersionHistoryPanel` is mounted
   (no external `Card` wrapper from `SiteDetailView`, unlike `DomainVerification`'s wrapping at
   `:367-371`), because the component now owns its own `Card`/`CardHeader`/`CardTitle` (task 10).
   Remove the dead `sites: Site[]` prop end-to-end: drop it from `BulkOperationsProps` (`:28-33`),
   the destructure, and the mount call — `SiteDetailView` has no site list to pass and never did
   (research: the prop is referenced nowhere past the destructure). Fix the other two lint
   warnings in the same pass: rename the unused destructured `_` at `:139`
   (`Object.entries(exportFilters).filter(([_, value]) => value !== "")`) to a name the linter
   accepts, and give the `useEffect` at `:321-323` its missing `fetchOperations` dependency
   (wrap `fetchOperations` in `useCallback` keyed on `siteId`, matching the `useSites.ts`
   reference hook shape).
   Test: `npx eslint src/components/dashboard/BulkOperations.tsx` reports 0 warnings (today: 3,
   exactly as research measured); a `SiteDetailView` render test asserts the "Content
   portability" card appears above the version-history control.

10. [x] **Rebuild the tab bodies from `src/components/ui/`, per the design doc.**
    *(Deviation: composed with the native `<select>` — `src/components/ui/select.tsx`
    does not exist; recorded as design-system gap 6, `AnalyticsDashboard.tsx` is the
    in-repo precedent. Inventing the primitive inside this story is exactly what the
    gap list forbids.)*
    Card shell: `Card` → `CardHeader` (`IconTile tone="neutral"` + `CardTitle` "Content
    portability" + `CardDescription`) → `CardContent` holding the existing `Tabs`. Replace both
    raw `<select>` elements (`:349-360`, `:457-468`) with `Select`. Import tab: a size-limit
    `Alert variant="destructive"` fired client-side the instant a file is chosen, using
    `MAX_IMPORT_BYTES` from task 6 — the file input clears itself, the submit `Button` never
    enables for that file (no request is sent — this is the client half of AC6; task 6 is the
    server half). Permission-refused state: when a permission check fails (403 from any bulk
    route, or a `canImport`/`canExport` derived from the site's own `permissions`/role already
    available to `SiteDetailView` — pick whichever the component already has without adding a
    new prop; do not invent a new authorization signal for this), replace the whole Import tab's
    form with `Alert variant="destructive"`, no form underneath. Outcome report: four `Metric`
    tiles (created/updated/skipped/failed) + a `<table>` (no new table primitive, per the design
    doc's own "design system gaps" note) with `Row`/`Element`/`Outcome` (`StatusBadge`, tone
    mapping `created→success`, `updated→info`, `skipped→neutral`, `failed→danger`)/`Detail`
    (`ContentValue`) columns, default-filtered to non-`created` rows with a `Button
    variant="ghost"` "N created rows hidden — show all" disclosure. `Skeleton` rows in the
    report's shape while an import is in flight. History tab: replace the hand-rolled empty
    block (`:698-702`) with `EmptyState`. Guard the import format picker so `"xml"` cannot be
    selected for import (`parseXMLImport` still throws — export may keep offering it).
    Test: a component test suite covering each named state — default, size-refused,
    permission-refused, loading (skeleton), error, all-success, partial-success (with the "show
    all" disclosure toggling row visibility), and the History tab's empty state — renders the
    expected `src/components/ui/` primitives and no ad-hoc markup for any of them.

## Review fixes (round 1 — `docs/reviews/s05-bulk-content-portability.md`, ship refused)

1. [x] **CRITICAL 1 — the round trip rewrote and deleted customer copy.**
   `applyImportRows` ran `sanitizeHTML(..., "RICH_TEXT")` over `current_content` and
   `original_content` before writing them. Those columns hold the customer's `textContent`,
   which discovery stores verbatim on purpose (bug **A-1**,
   `src/lib/security/discovered-text.ts`, standing rule in `AGENTS.md`) and which every
   consumer reads back as text — `target.textContent` in the widget, JSX in the dashboard. So
   an export of ordinary copy, re-imported, came back rewritten *and* truncated:
   `"Setup in <2 minutes — Paste the <script> tag"` → `"Setup in &lt;2 minutes — Paste the "`.
   Replaced with the repo's verbatim gate: the row is stored byte-for-byte or refused with a
   reason at its own row — never repaired. Long tombstone left at the call site. (Round 1 used
   `validateDiscoveredText` and inherited its length ceiling; round 2 corrected that — see
   MAJOR 1 below.)
   Test: `roundtrip.test.ts`'s fixture carried no HTML-special characters and said so in its
   own header — the AC3 test was scoped around the AC3 failure. It now carries `<`, `>`, `&`
   and quotes in real marketing copy, and went red on both formats before the fix.
   `import-outcomes.test.ts` pins the write itself, both halves: byte-for-byte storage, and a
   single unstorable row failing alone while its neighbours are written.
2. [x] **MAJOR 1 — every bulk import was labelled "Manual edit".**
   `versionChangeTypes` was keyed `bulk`; `content_versions.change_type` can only hold
   `bulk_edit`, so `resolveStatus` fell back to `manual` — silently, a fallback looking exactly
   like a match. One registry key, plus the `VersionChangeType` union. Test:
   `VersionTimelineItem.test.tsx` renders the row, because reading the registry is what missed
   it the first time.
3. [x] **Minor 1 — unrecorded deviations.** Tasks 5 and 7 above now carry theirs.
4. [x] **Minor 2 — a missing CSV header answered 500 and discarded the reason.**
   Whole-file parse problems now throw `FileParseError` and answer **400** with the message
   (`Missing required CSV headers: current_content`). *Deliberate behaviour change beyond the
   plan's letter*: the plan asked for 400 on the missing-header case specifically, and the same
   treatment now covers every whole-file refusal — a non-array JSON body and an unimplemented
   format included — because they are the same class of caller error. Two assertions in
   `import.test.ts` changed from 500 to 400, stated here per `AGENTS.md`'s "change the test
   *and say so*" rule. The `bulk_operations` row is still closed out as `failed` first.
5. [x] **Minor 3 — a payload with no `options` key answered 500.**
   The handler read `options.create_missing_elements` off the raw body. Body validation now
   goes through `src/lib/api/validation.ts` per ADR 003 (`requireString`, `requireEnum`, and a
   new `optionalBoolean` added to that module — no zod). Absent options default to all-off,
   which is the fail-closed reading; a non-object `options` is a 400.
6. [x] **Minor 4 — no rate limiter on a newly-reachable multi-megabyte endpoint.**
   `enforceRateLimit` (`API_UPLOAD`, `onStoreFailure: "deny"`) is now the first statement in
   `POST`, above the body read and above authorization, per `AGENTS.md`. Fail-closed is
   justified in the comment: the batch it admits writes `content_elements` in a loop and ends
   in a `SECURITY DEFINER` service-role RPC. `POST /api/bulk/export` was left alone — the
   finding names the import endpoint, and adding a second limiter is not this fix's to make.

## Review fixes (round 2 — re-review of `27d9bd1`, max severity major, ship refused)

The critical from round 1 was confirmed closed: `validateDiscoveredText` was read line by line
and never escapes, strips or truncates, and 13 neutralizations of the round-1 diff all went red.
Four majors remained.

1. [x] **MAJOR 1 — a value that round-trips today was refused on import.**
   Round 1 reused `validateDiscoveredText`, and with it discovery's 20,000-character ceiling, on
   a column that has never had one. `content_elements.current_content` is an unbounded `TEXT`
   and no other writer caps it — not `bulk/update`'s set/append, not `staging/content` PUT, not
   `v1/content` POST — so a 20,001-character row written by any of those exported cleanly and
   came back `failed / "content exceeds 20000 characters"`. That breaks AC3 for that class of
   row and departs from this plan's own "do not add a content-length rule" interdict.
   The bound protects against nothing the column cannot already hold, so it is **removed** from
   this path. `validateDiscoveredText` is now a one-line wrapper over a new exported
   `validateVerbatimText(content, maxLength: number | null)` in the same module — parameterised,
   not copied, so there is still one definition of "control character" and one refuse-never-repair
   guarantee in the repo. Import passes `null`; discovery passes
   `MAX_DISCOVERED_TEXT_LENGTH` and is unchanged. The ceiling that does apply to an import is
   `MAX_IMPORT_BYTES`, measured before parsing.
   Test: `import-outcomes.test.ts` imports a 20,001-character `current_content` and asserts it is
   stored byte-for-byte; `discovered-text.test.ts` pins the parameterised function directly —
   no ceiling accepts past the cap, still refuses control characters and non-strings, an
   explicit ceiling is enforced, and `validateDiscoveredText` equals
   `validateVerbatimText(x, MAX_DISCOVERED_TEXT_LENGTH)`.
2. [x] **MAJOR 2 — a three-column import file blanked `original_content` permanently.**
   The minimum file the Import tab advertises — element id, selector, current content — wrote
   `original_content: ""` over whatever was stored. That column is the served fallback when
   `published_content` is null (`api/content/[siteId]/route.ts:308`) and the last `COALESCE` arm
   in `create_content_version`. Pre-existing on `main`, made reachable by this story, and the
   Export tab's own "What's in the file" panel omitted the column, so an owner following the UI
   built the destructive file.
   **An absent column now leaves the stored value untouched**: it is omitted from the write
   payload entirely, so the upsert's `ON CONFLICT DO UPDATE` never names it. Presence is decided
   by the file — a declared CSV header with an empty cell, or a JSON key holding `""`, is a
   deliberate empty and is written. JSON `null` counts as absent, because the JSON export is the
   raw row and that column is nullable.
   Test: four cases in `import-outcomes.test.ts` — a three-column CSV updating an existing row
   writes no `original_content` key at all; nor does a created row the file says nothing about;
   an empty cell under a declared header writes `""`; a value present is written verbatim.
   **`metadata` carries the same rule**, applied on the lead's call after it was flagged rather
   than fixed silently. The loss there is milder — display hints, not the value the site serves —
   but "absent means leave it alone" is a rule about files, not a per-column severity judgement,
   and one protected column beside an unprotected one reads as an oversight whether or not it
   was. `readCSVMetadata` decides presence from the header set exactly as the content columns do;
   JSON `null` counts as absent, matching how the raw-row export writes a null column. Five more
   cases in the same file.
3. [x] **MAJOR 3 — ADR 008 was edited in place.**
   `AGENTS.md`: ADRs are immutable, a change means a superseding ADR. `docs/decisions/008-bulk-import-write-path.md`
   is restored byte-for-byte to `main`'s content, and this plan and the route's comment now cite
   [ADR 024](../decisions/024-bulk-import-snapshot-change-type.md), which was written on `main`
   and supersedes ADR 008 on the `change_type` value alone. The substance is unchanged: the route
   has always written `bulk_edit`.
4. [x] **MAJOR 4 — a new test certified a live mislabelling.**
   `VersionTimelineItem.test.tsx` asserted `style_apply` → "Manual edit" *as correct*, calling it
   "a change type this build does not know". `edit-board/styles/apply/route.ts:176` writes exactly
   that value on every AI style application — the identical silent-fallback defect just fixed for
   `bulk`, blessed by a test. Both halves fixed: `style_apply` is now an entry in
   `versionChangeTypes` ("Style applied"), and the fallback fixture uses `not-a-change-type`,
   a value no writer produces and the CHECK cannot hold. `language_switch` and `theme_apply` are
   also CHECK-legal and also absent from the registry; nothing writes either, so there is no live
   mislabelling and no label invented for them — noted in the registry comment.
   Test: two renders in `VersionTimelineItem.test.tsx` — `style_apply` shows "Style applied" and
   not "Manual edit"; the unknown value still falls back.
5. [x] **Minor — "What's in the file" listed 5 of the 11 exported columns.**
   All eleven now, in the order `generateCSV` writes them, plus a line saying a JSON export
   carries the whole row. The test asserts each column and the list's length, so a column added
   to the export without a line here fails.
6. **Not done — `POST /api/bulk/export` stays unmetered.** Kept minor by both reviews and
   explicitly left out of scope by this fix run.

## Review fixes (round 3 — pass 3 on `caaa5e0`, major, ship allowed)

All four round-2 majors verified closed, each independently. Two things remained.

1. [x] **MAJOR 5 — `MAX_IMPORT_BYTES` was above the platform ceiling, and the two sides measured
   different quantities.**
   *Half one.* 5 MB is above Vercel's 4.5 MB serverless request-body cap. That rejection happens
   in the platform **before** the handler runs and arrives as an opaque 413 with no JSON body, so
   for a 4.5–5 MB import the route's own 413 never executed and `BulkOperations.tsx` called
   `response.json()` on a non-JSON response — the owner saw a JSON-parse error instead of "split
   the file". `src/app/api/upload/image/route.ts:38-45` states the constraint in this repo's own
   words and picked 4 MB for it; `docs/architecture.md` records Vercel as the host. **Now 4 MB**,
   citing the same reasoning, so the refusal stays ours to phrase.
   *Half two, and the one that made the constant a fiction.* The client checked `file.size` while
   the server measures the JSON envelope (`req.text()` → `Buffer.byteLength`). The envelope is
   strictly larger — a CSV travels as a JSON string, so every `"` and newline becomes two bytes —
   so a file could pass the UI and be refused by the API, which is the exact drift a shared
   constant exists to prevent. The card now measures the **body it would send**
   (`measureImportBody`), at file-choose time and again immediately before the request, because
   the format picker and the option checkboxes both change the body and both can be touched after
   the file is picked. A cheap `file.size` pre-check stays in front of the read: escaping only
   ever grows a body, so a file already over the limit cannot produce an envelope under it.
   Test: a real ~2.1 MB CSV of quote characters — under the limit as a file, over it as a request
   body — is refused client-side with the owner's message, the input clears, the button stays
   disabled, and no request is sent. Nothing about the file is faked. Neutralizing the envelope
   check turns it red; `file.size` alone admits the file.
   *Knock-on, declared:* choosing a file is now asynchronous, so the four tests that submit wait
   for the button to arm (`chooseAcceptedFile`). That is what an owner does too.
2. [x] **Minor 1 — the `original_content` null guard had zero bite.**
   Neutralizing `carriesOriginal`'s null check produced 0 red; the identical neutralization on
   `carriesMetadata` produced 1. The guard is load-bearing for precisely the rows this story
   creates: a three-column import leaves `original_content` NULL, the JSON export is
   `select("*")` so it writes that NULL out, and re-importing that file hands back
   `original_content: null` — which without the guard fails every such row with "content must be
   a string". Case added; confirmed red with the guard removed, green with it.
3. [x] **Two corrections while in there.** The status-badge comment claimed nothing writes
   `language_switch`/`theme_apply`; `server/index.js:810` and `:983` do. The conclusion stands
   only because that Socket.io service is undeployed — the comment now says that, and names
   [ADR 023](../decisions/023-websocket-only-transport-no-sticky-routing.md)/`s07b` as what turns
   both into live "Manual edit" mislabels. "Files touched" below gains `jest.setup.js` and
   `import-outcomes.test.ts`.

## Run interdicts

- `src/app/api/bulk/update/route.ts` and its ReDoS guard (`MAX_REGEX_LENGTH`,
  `isDangerousRegex`) — diff must be empty; Batch Update is out of scope per the design doc.
- `src/__tests__/api/bulk/update-history-policy.test.ts` — diff must be empty; unrelated A-13/B-3
  regression coverage, not this story's to touch.
- No new schema-validation dependency (no zod) — extend `src/lib/api/validation.ts` per
  [ADR 003](../decisions/003-no-schema-validation-library.md) if a new validator is genuinely
  needed; this plan's tasks do not require one.
- No `supabase/migrations/*` changes — `bulk_operations`, `create_content_version` and
  `publish_staging_content_atomic` all already exist with the shapes this plan uses.
- Do not attempt to fix the `authenticated`-role DML gap (A-13/B-3) — research marks it explicitly
  out of scope and unanswerable from this repository; if it turns out to be real in production,
  every bulk write already fails today regardless of this story, and the fix (switch to the
  service-role client with explicit authorization) is a separate story.
- Do not implement XML import (`parseXMLImport` keeps throwing) — task 10 only guards the UI from
  offering it; export may keep generating XML unchanged.
- Do not add a content-length validation rule (see task 5) — no such limit exists in the schema
  today and no acceptance criterion asks for one. *(Departed from in round 1 by reusing
  `validateDiscoveredText`, which carries a 20,000-character bound; held again from round 2 —
  the import path passes no ceiling. See round-2 MAJOR 1.)*
- `jest.config.js` coverage thresholds — only raise, never lower, per `AGENTS.md`.

## The point everything turns on

**The import-write-path decision in [ADR 007](../decisions/008-bulk-import-write-path.md):**
keep the direct write to `content_elements`, and satisfy "revertible" with one
`create_content_version` call after the batch, instead of rewriting the write path through
`staging` + `publish`. This is the single decision every other task in this plan assumes;
task 7 is where it is implemented, and it is the task most likely to be second-guessed at review.

Where it could be wrong:
- **If the review (or a live test with the actual owner) expects a literal one-click "undo my
  400-row import" button,** this design does not give them one directly — it gives them a
  version they can restore-to-staging-then-publish, same as any other version, which only undoes
  the import if no other edit happened to land on top of it first and if a version existed
  *before* the import to restore back to. Compare against: does the design mockup's reassurance
  line ("review or revert any of them from the History tab below") read as promising instant undo,
  or as promising *reachability* through the existing history mechanism? This plan reads it as
  the latter — the ADR names the pre-import-checkpoint alternative to build if that reading is
  wrong.
- **If `create_content_version`'s whole-site snapshot semantics surprise someone in review** —
  the version taken after an import captures every element on the site, not just the imported
  ones, identical to what a manual "Save Current Version" click already does today. This is not
  new behavior this story introduces, but it is more visible once bulk import is the thing that
  triggers it routinely.
- **If the `authenticated`-role DML gap (A-13/B-3) turns out to be real in production** — every
  write this plan touches (`content_elements` insert/update/upsert via the anon-key client) would
  already be silently broken today, independent of anything in this plan. This is explicitly out
  of scope to fix here (see Run interdicts) but is the one external fact that would invalidate
  "the import writes succeeded" as an assumption underneath every task above.

## Files touched

- `src/lib/bulk/csv.ts` — new (task 1).
- `src/lib/bulk/constants.ts` — new (task 6).
- `src/app/api/bulk/export/route.ts` — CSV codec, permission check + type filter on `GET` (tasks 2, 3).
- `src/app/api/bulk/import/route.ts` — per-row parsing/outcomes, size guard, version snapshot (tasks 4, 5, 6, 7).
- `src/types/index.ts` — add `BulkImportRowResult`, update `BulkImportPayload`/response-adjacent types (task 5).
- `src/components/dashboard/BulkOperations.tsx` — fetch fix, dead prop removal, lint fixes, full UI rebuild (tasks 3, 9, 10).
- `src/components/dashboard/SiteDetailView.tsx` — mount point (task 9).
- `src/__tests__/api/bulk/import.test.ts` — updated for the new response shape and per-row behaviour (task 5).
- `src/__tests__/api/bulk/import-outcomes.test.ts` — new; the four-outcome pipeline, byte-for-byte
  storage, the absent-column rule and the version snapshot (tasks 5, 7).
- `jest.setup.js` — the `NextRequest` mock gained `text()`; without it a route that measures its
  body before parsing cannot be tested at all (task 6).
- `src/__tests__/api/bulk/export.test.ts` — new (task 2).
- `src/__tests__/api/bulk/roundtrip.test.ts` — new (task 8).
- `src/__tests__/lib/bulk/csv.test.ts` — new (task 1).
- `src/__tests__/components/dashboard/BulkOperations.test.tsx` — new (tasks 3, 9, 10).
- `docs/decisions/008-bulk-import-write-path.md` — **not touched.** Written before this branch
  and already on `main`; ADRs are immutable.
  [ADR 024](../decisions/024-bulk-import-snapshot-change-type.md) supersedes it on the
  `change_type` value and is also already on `main`.

Added by the round-1 review fixes:

- `src/components/ui/status-badge.tsx` — `versionChangeTypes` key `bulk` → `bulk_edit` (MAJOR 1).
- `src/components/dashboard/VersionTimelineItem.tsx` — `changeType` now reuses the registry's
  `VersionChangeType` union instead of restating it (the two had drifted).
- `src/lib/api/validation.ts` — new `optionalBoolean` (Minor 3).
- `src/__tests__/components/dashboard/VersionTimelineItem.test.tsx` — new (MAJOR 1).

Added by the round-3 review fixes:

- `src/lib/bulk/constants.ts` — `MAX_IMPORT_BYTES` 5 MB → 4 MB, under Vercel's platform cap
  (round-3 MAJOR 5).
- `src/components/dashboard/BulkOperations.tsx` — `measureImportBody`; the client bounds the
  request body rather than the file (round-3 MAJOR 5).

Added by the round-2 review fixes:

- `src/lib/security/discovered-text.ts` — new exported `validateVerbatimText(content, maxLength)`;
  `validateDiscoveredText` becomes a one-line wrapper over it (round-2 MAJOR 1).
- `src/__tests__/lib/security/discovered-text.test.ts` — a `validateVerbatimText` block
  (round-2 MAJOR 1).
- `src/components/ui/status-badge.tsx` — `style_apply` entry (round-2 MAJOR 4).

## Test strategy

- Route-level tests follow the existing mocked-Supabase pattern in
  `src/__tests__/api/bulk/import.test.ts` and `update-history-policy.test.ts` (a per-table query
  builder stub keyed by `resultsByTable`) — extend it rather than inventing a second mocking
  style in the new `export.test.ts`/`roundtrip.test.ts` files.
- `src/lib/bulk/csv.ts` is pure and gets plain Jest unit tests with no Supabase mocking at all —
  it is the one piece of this story with zero I/O.
- Component tests (`BulkOperations.test.tsx`) follow the RTL conventions already in
  `src/__tests__/components/dashboard/DashboardNavigation.test.tsx`: query by role/text, assert
  on rendered output, not internal state.
- The round-trip test (task 8) is the one place this plan asks for an integration-shaped test
  (export route → import route, in-process, against the shared mocked Supabase) rather than a
  unit test — it is also the criterion the story names explicitly (AC3), so it earns the extra
  weight.
- No test is modified to accommodate a behaviour change without saying so in this plan — see
  task 5's explicit note on `import.test.ts`.

## Definition of Done

- Single PR on `feature/s05-bulk-content-portability`, structured description, readable diff.
- `npm run lint`, `npm run type-check`, `npm run format` (check mode), `npm run build`, `npm test`
  all green.
- All seven acceptance criteria demonstrated: AC1/AC2 via task 2's export tests, AC3 via task 8,
  AC4 via tasks 4–5, AC5 via task 2/3's permission tests (already-passing behaviour, re-confirmed
  after the refactor), AC6 via task 6, AC7 via task 7.
- `npx eslint src/components/dashboard/BulkOperations.tsx` reports 0 warnings.
- Every path listed under "Run interdicts" shows an empty diff against `main`.
- A stranger, unaided, can reach the feature: `BulkOperations` is rendered from
  `SiteDetailView.tsx`, reachable from the dashboard with no direct URL or hidden route — the
  PRD's own bar for this story, restated because the story's premise is that an endpoint with no
  UI does not satisfy it.
- Review passed (`/ks-review`), no open critical issue.
