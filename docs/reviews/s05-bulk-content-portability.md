# Review — `s05-bulk-content-portability` (third pass)

Branch `feature/s05-bulk-content-portability`, commit `caaa5e0`. Fresh context, read-only.
Pass 1: critical / ship no. Pass 2: major / ship no, four majors. **This pass: all four closed.**

## Suite, run by the reviewer

`npx jest --ci`: 146 suites passed / 1 skipped, **2035 of 2071**, exit 0. Coverage exit 0 —
statements 42.64 · branches 35.72 · functions 40.11 · lines 42.92, all far above the ratchet floors
(22/16/19/22), and **`jest.config.js` is byte-identical to `main`**, so nothing was lowered.
`npm run build` exit 0. `type-check`, `format:check` clean; `lint` 0 errors. All four run interdicts
show empty diffs. No `zod`. No SIGSEGV.

## The four prior majors — closed, each verified independently

**MAJOR 1 — removing the length bound did *not* trade one defect for another.** All three
sub-checks were run separately rather than inferred from one another:

- *Discovery unchanged.* `validateDiscoveredText` is now
  `validateVerbatimText(content, MAX_DISCOVERED_TEXT_LENGTH)` (`discovered-text.ts:162-164`) — same
  check order, and the parameterised error template renders the identical string at 20000.
  Neutralizing the wrapper to pass `null` turned **5 tests red repo-wide**.
- *Both guarantees survive on the import path specifically, not by inheritance.* Skipping the
  control-character check when `maxLength === null` → **2 red**. Re-applying the A-1 `<`→`&lt;`
  rewrite on the null-ceiling branch only → **4 red**.
- *`MAX_IMPORT_BYTES` is real and enforced.* `src/lib/bulk/constants.ts:13`, applied at
  `import/route.ts:49` after `req.text()` and before `JSON.parse`. `import.test.ts:178-198` hits it
  with a genuinely oversized body, asserting 413 plus zero inserts and zero upserts. Raising the
  threshold ×1000 → **1 red**. **Unbounded text does not reach the database by this route** — the
  body ceiling caps any single field. Pass 2's "413 never hit" gap is closed.

**MAJOR 2 — presence semantics are uniform, and there is no third column.** Both columns treat
`undefined` and JSON `null` as absent (`route.ts:419-422`) and are omitted from the payload entirely
(`:704-713`), so `ON CONFLICT DO UPDATE` never names them. Both are nullable in the schema
(`20250817000000:31,35`), so no `NOT NULL` trap was hiding behind the mock. Neutralizing the
omission → **5 red**. The whole payload was checked for a third: the only other content column is
`published_content: content.current`, deliberately in lockstep — every writer in the repo sets
published and current together (`v1/content:236,258`; `bulk/update:313-314`; `content/[siteId]:133`;
`server/index.js:457-458,712-713`; `publish_staging_content_atomic 20260803020000:81-82`).

**MAJOR 3 — closed.** `git diff main --exit-code` on `docs/decisions/008-…` and on the whole
`docs/decisions/` directory both exit 0. The false *"before this ADR ever reached `main`"* claim is
gone; the plan and the route comment cite ADR 024.

**MAJOR 4 — closed and correct.** `edit-board/styles/apply/route.ts:176` writes exactly
`p_change_type: "style_apply"`. The fixture `not-a-change-type` is genuinely outside the CHECK list
at `20251230100000_edit_board.sql:69`. Neutralizing the label → 1 red; reverting the key to `bulk` →
1 red.

## New — MAJOR 5: the 5 MB import limit is not the limit that applies

`constants.ts:4-8` claims the constant exists so the owner's number *"can never drift from the
number the server actually applies."* It drifts twice:

1. **It is above the platform ceiling this repo documents.** `upload/image/route.ts:38-45` states it
   in the repo's own words: Vercel caps a serverless function body at **4.5 MB**, the rejection
   happens in the platform *before the handler runs*, and it surfaces as an opaque 413 with no JSON
   body — which is why that route deliberately picks 4 MB. `architecture.md:49` confirms Vercel
   hosts the app. `s05` picked 5 MB, so for a 4.5–5 MB body the route's own 413 branch never runs,
   and `BulkOperations.tsx:155-158` calls `response.json()` on the platform's non-JSON 413. **The
   owner sees a JSON-parse error string.**
2. **Client and server measure different quantities against the same constant.**
   `BulkOperations.tsx:104` checks `file.size`; the server measures the `JSON.stringify(payload)`
   envelope (`:145` → `route.ts:46-47`), where every quote and newline in a CSV becomes two bytes.
   The body is strictly larger than the file.

Nothing is corrupted and the refusal direction is safe, so this is major, not critical.
**Fix: `MAX_IMPORT_BYTES` → 4 MB, and bound the envelope client-side rather than the raw file.**

## Minors

1. **One guard has zero bite.** Neutralizing `carriesOriginal` (`route.ts:420`) to drop the null
   check produced **0 red**, while the identical neutralization on `carriesMetadata` produced 1.
   The guard is load-bearing for exactly the rows this story now creates: a 3-column import leaves
   `original_content` NULL, the JSON export writes that NULL, and without the guard every such row
   fails re-import.
2. The status-badge comment says nothing writes `language_switch` / `theme_apply`. **Something
   does** — `server/index.js:810` and `:983`. The conclusion still holds, because `AGENTS.md:77` and
   `architecture.md:35,276` record `server/` as not deployed, so there is no live mislabelling. But
   the wording is false as written, and **[ADR 023](../decisions/023-websocket-only-transport-no-sticky-routing.md)
   means `s07b` standing that service up turns both into silent "Manual edit".**
3. CSV export flattens NULL `original_content` to `""` (`export/route.ts:199`), so JSON preserves
   NULL and CSV cannot. Pre-existing on `main`, newly consequential because the import now creates
   NULL-original rows.
4. The native `<select>` deviation is honest against the code, but `design-system.md:337-346`
   records gap 6 as **closed by `s16`** and names `s05` as the consumer that inherits
   `select.tsx`'s `bg-transparent` drift. The plan's citation is stale — **merge-order dependency**.
5. `jest.setup.js` and `import-outcomes.test.ts` are missing from the plan's "Files touched".
   `validate_content` is still parsed into options and read by nothing.

## Bite — 12 neutralizations, 11 bit

discovery ceiling → 5 · control-char skip → 2 · A-1 rewrite → 4 · size threshold ×1000 → 1 ·
`original_content` null → **0** · payload always names both → 5 · metadata null → 1 · `style_apply`
label → 1 · key back to `bulk` → 1 · fetch URL back to import → 3 · export GET permission gate → 1 ·
CSV quoting removed → 8. All restored; final `git diff --exit-code` 0, `git status --short` empty.

## Not verified

No screen rendered in a browser. No real file exported or re-imported — `FileReader`, `Blob` and
`NextResponse` all mocked. Supabase mocked throughout, so the CHECK constraint is read, never
exercised. **The 413 is never hit through the platform — which is precisely why the Vercel ceiling
went unnoticed.** Permission-refused is only a stubbed 403. No E2E.

Human gestures, in priority order: (1) upload a ~4.7 MB file against a deployed preview and read the
error the owner actually sees — that is MAJOR 5; (2) export a real site as CSV and JSON, re-import
both with `overwrite_existing`, and diff `current` / `original` / `published_content` and `metadata`
in Postgres, especially rows where `original_content IS NULL`; (3) confirm a `content_versions` row
lands and renders "Bulk edit"; (4) open the Import tab as a view-only collaborator.

## Follow-up — MAJOR 5 and minor 1 fixed and verified (`d172a0c`)

Fixed before merge despite the ship-yes, because the constant was provable against the repo's own
documented platform ceiling and a load-bearing guard with zero bite should not ship. **Verified
independently against the branch, not accepted from the report:**

- `MAX_IMPORT_BYTES = 4 * 1024 * 1024` (`constants.ts:24`), and `MAX_IMPORT_LABEL` is **derived**
  from it (`:27`) — so the owner-facing string can no longer drift from the enforced number, which
  is the failure this finding was about.
- The card measures **the request envelope**, not the file: `new Blob([JSON.stringify(payload)]).size`
  (`BulkOperations.tsx:126`), evaluated at file-choose time (`:157`) *and* again immediately before
  the request (`:184`) — correct, because the format picker and the option checkboxes both change
  the envelope and both can be touched after the file is picked. The cheap `file.size` pre-check
  stays in front of the read (`:152`): escaping only grows a body, so a file already over the limit
  cannot produce an envelope under it.
- Its test uses a real ~2.1 MB CSV of quote characters — under the limit as a file, over it once
  each `"` escapes. Nothing about it is faked.
- Minor 1's null case is in, and bite was checked both directions: removing `carriesOriginal`'s null
  check turns exactly the new test red; restored, green.
- No stale "5 MB" survives in code or plan. The design doc did, and has been corrected on `main` —
  `.md` and `.html`, both figures.

Knock-on worth recording: choosing a file is now asynchronous, so four submit-path tests wait for
the button to arm. That is real UI behaviour, not a test accommodation — an owner waits for the same
thing.

## Verdict
Max severity: major
Ship allowed: yes
