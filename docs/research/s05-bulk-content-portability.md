# Research — Story s05-bulk-content-portability

> **Gate warning (recorded per instruction):** `docs/reviews/stories.md:263` ends `Stories ready: no`
> (max severity: **major**). The six open majors concern renumbering, `s13`/`s08` scoring and
> dependency edges — none of them touch `s05` (`s05` is listed as ✅ resolved-critical in the
> perimeter table and is not named in any of the six majors in Part A/B of that review). Operator
> confirmed proceeding with `s05` research despite the file-level "no". This is a warning, not a
> block, per the instruction.

## The five structuring facts

1. **The dark-feature premise is true.** `grep -rn "BulkOperations" src/app src/components` returns exactly one file — its own definition (`src/components/dashboard/BulkOperations.tsx:28,33`). Nothing imports it. There is no route, no tab, no button anywhere a signed-in user can reach it.
2. **Import writes published state directly, never staging.** `src/app/api/bulk/import/route.ts:306-343` and `src/app/api/bulk/update/route.ts:310-317` set `published_content` and `current_content` in the same statement — the real human-edit path (`src/app/api/staging/content/[siteId]/route.ts:222-233`) only ever touches `staging_content`; publishing is a separate, explicit step through the `publish_staging_content_atomic` RPC (`src/app/api/staging/publish/route.ts:111-119`). Bulk import skips staging entirely and goes straight to "live."
3. **The "version history" the user actually sees is not the DB trigger.** `VersionHistoryPanel.tsx` reads `content_versions` via `GET /api/edit-board/history` (`src/app/api/edit-board/history/route.ts:87-94`), populated by an explicit `create_content_version` RPC call (`:212-217`) — not by the `content_history` trigger. Bulk import/update never call that RPC, so imported changes will **not** appear in the panel the acceptance criterion names, even though a separate legacy `content_history` row gets written automatically by a DB trigger (`log_content_change()`, `20250817000000_complete_database_setup.sql:524-541`, timing-split by `20260809130000_content_history_definer_and_delete_split.sql`).
4. **CSV import cannot round-trip what CSV export produces.** `generateCSV` (`export/route.ts:171-205`) quotes fields and escapes embedded `"` — proper CSV. `parseCSVImport` (`import/route.ts:194-231`) does `line.split(",")` with **zero quote-awareness** and splits on `"\n"` with no embedded-newline handling. Any `current_content` containing a comma, a quote, or a line break will parse into the wrong columns or the wrong number of lines. This directly threatens AC3 ("re-imported unchanged produces zero content differences").
5. **A malformed row aborts the whole import today, not just that row.** `parseJSONImport` (`:169-192`) and `parseCSVImport` (`:194-231`) each `throw` on the first invalid item — before `validateContentElements`/`importContentElements` (the only functions with per-item try/catch) ever run. The outer `catch` in `POST` marks the whole `bulk_operations` row `"failed"` and returns 500. This contradicts AC4 ("a malformed row fails that row alone without aborting the import") as the code stands.

## Target story

**As a** site owner **I want** to export all my content and re-import it **so that** my copy is mine and switching away from RecopyFast is never a hostage situation.

Complexity in `docs/stories.md:283-284`: **2** — "form, persistence and list over API routes that already exist and are tested."

### Acceptance criteria (`docs/stories.md:287-293`)
- [ ] A control in the dashboard exports one site's content elements as CSV and as JSON.
- [ ] The export includes element id, selector, current content, language and variant.
- [ ] An exported file re-imported unchanged produces zero content differences, asserted by a round-trip test.
- [ ] Import reports per-row outcomes — created, updated, skipped, failed with a reason — and a malformed row fails that row alone without aborting the import.
- [ ] Import refuses a file targeting a site the caller has no permission on.
- [ ] Import of a file larger than a stated size limit is refused before parsing.
- [ ] Imported changes appear in version history as normal, revertible edits.

Dependencies: none (`docs/stories.md:296`).

## Current state of the code

| File | Lines | Role today |
|---|---|---|
| `src/app/api/bulk/export/route.ts` | 302 | `POST`: auth via anon-key cookie client → `site_permissions` check (`view`/`edit`/`admin`) → query `content_elements` with optional filters → serialize to `json`/`csv`/`xml` → logs a `bulk_operations` row → streams file as a download response. `GET`: lists past export operations for a site. |
| `src/app/api/bulk/import/route.ts` | 411 | `POST`: same auth pattern, requires `edit`/`admin` → creates a `"running"` `bulk_operations` row → parses `json`/`csv` (xml throws `"not yet implemented"`, `:235`) → `validateContentElements` (skips elements missing required fields, or missing from DB when `create_missing_elements` is false) → `importContentElements` writes straight to `content_elements.published_content`/`current_content` via `.upsert()` (if `overwrite_existing`) or `.insert()` → updates the `bulk_operations` row to `"completed"`/`"failed"`. `GET`: fetch operation status by `operationId`. |
| `src/app/api/bulk/update/route.ts` | 411 | `POST`: same auth, `edit`/`admin` required → per-element `find_replace`/`append`/`prepend`/`set` against `current_content`, with a real ReDoS guard (`MAX_REGEX_LENGTH`, `isDangerousRegex`, `:141-165`) → writes straight to `content_elements.published_content`/`current_content` via `.update()`. `GET`: operation status / list. |
| `src/components/dashboard/BulkOperations.tsx` | 744 | Full three-tab UI (Import / Export / Batch Update / History) already built against these three routes, plus polling (`pollOperationStatus`) and a file download flow. **Imported by nothing.** |
| `src/__tests__/api/bulk/import.test.ts` | 262 | Mocked-Supabase unit tests for `import/route.ts` only. |
| `src/__tests__/api/bulk/update-history-policy.test.ts` | 315 | Not a functional test of the update route — it is a targeted regression test for a specific production-risk finding (A-13/B-3, see Traps). |
| — | — | **No test file exists for `export/route.ts`.** The story's "are tested" claim (agentic notes, `docs/stories.md:299-300`) is true for import, not for export. |
| `supabase/migrations/20260731004000_missing_tables_integrations.sql:107-127` | — | `bulk_operations` table: `id, user_id, site_id, operation_type CHECK IN ('import','export','batch_update','sync'), status, total_items, processed_items, failed_items, configuration jsonb, result_data jsonb, error_log text[], scheduled_at, started_at, completed_at, created_at`. RLS enabled (`:136`) with view/create/update policies scoped through `site_permissions` and a service-role bypass — correctly wired. |

## Anchor points

- **UI mount point:** `src/components/dashboard/SiteDetailView.tsx` — already imports and renders `VersionHistoryPanel` (`:32, 374-379`) and `DomainVerification` (`:18, 367-371`) as bottom-of-page cards, each keyed off `site.id`. The file's own comment on `DomainVerification` (`:360-366`) describes the **exact same defect class** as `s05`: *"has existed since the security schema landed and the component was never mounted anywhere... It lives here, under the integration it is adjacent to."* This is the established, in-repo precedent for how an orphaned dashboard feature gets wired up — follow that pattern rather than inventing a new one.
- **Prop mismatch to resolve while wiring:** `SiteDetailView` receives a single `site: SiteWithDetails` (`:87`), but `BulkOperations` declares `sites: Site[]` (`:28,30`) — a prop that is dead code today (see Verified APIs below). Since the story's own agentic notes already require deleting the unused `sites` prop as a lint fix, resolving the mismatch and the lint warning are the same edit.
- **Round-trip fix point:** `parseCSVImport` (`import/route.ts:194-231`) needs a real CSV parser (quote-aware) to match `generateCSV`'s quoting, or both sides need to agree on a simpler encoding. This is the load-bearing change for AC3.
- **Version-history fix point:** `importContentElements` (`import/route.ts:283-355`) needs to either (a) route writes through the staging path (`staging_content` + `publish_staging_content_atomic`) so `content_versions` gets populated the same way a human edit does, or (b) call `create_content_version` (the RPC backing `POST /api/edit-board/history`) directly after a successful import batch. Option (a) is what the story's own trap note recommends ("Route it through the same path as a human edit").
- **Per-row-failure fix point:** move the `throw` in `parseJSONImport`/`parseCSVImport` out of the parse step and into the per-item loop already present in `importContentElements`, so a single bad row degrades to a `"failed"` result entry instead of aborting the batch.
- **Size-limit fix point:** no existing check anywhere in `import/route.ts`. AC6 needs a new guard before `await req.json()`/before parsing — e.g. a `Content-Length` check or a byte-length check on the raw body, added at the very top of `POST`.

## Verified APIs / functions

- `POST /api/bulk/export` — `src/app/api/bulk/export/route.ts:19`. Body: `BulkExportPayload` (`src/types/index.ts:582-591`: `{ site_id, format: "json"|"csv"|"xml", filters?: { language?, variant?, element_ids?, updated_since? } }`). Returns a raw file body with `Content-Disposition: attachment`, not JSON — the UI already handles this via `response.blob()` (`BulkOperations.tsx:168-176`).
- `POST /api/bulk/import` — `route.ts:12`. Body: `BulkImportPayload` (`src/types/index.ts:571-580`: `{ site_id, format: "json"|"csv"|"xml", data: unknown, options: { overwrite_existing?, create_missing_elements?, validate_content? } }`). `validate_content` is accepted but **is a no-op** — `validateContentElements` has an empty `if (options.validate_content) { /* Add content validation logic here */ }` block (`import/route.ts:252-256`).
- `POST /api/bulk/update` — `route.ts:7`. Body: `BulkUpdatePayload` (`src/types/index.ts:593-608`).
- `function BulkOperations({ siteId, sites }: BulkOperationsProps)` — `src/components/dashboard/BulkOperations.tsx:33`. `sites` prop declared (`:30`) and destructured (`:33`) but never referenced again in the 744-line file — genuinely dead.
- `sanitizeHTML(content, "RICH_TEXT")` — `src/lib/security/content-sanitizer.ts`, already called by both `import` (`:297-304`) and `update` (`:306`) before any write. XSS handling for bulk writes is already in place; do not re-add it.
- Real-world "does this feature already exist elsewhere done right" reference confirmed against the PRD's own framing (`docs/stories.md:313-314`): TinaCMS (git-backed, content is already the customer's) and CloudCannon (source-file export) — both make portability trivial by construction; RecopyFast has to build it explicitly, consistent with the complexity-2 scoring.

## Traps & constraints

- **npx eslint confirms the exact three warnings the story claims, at the exact lines:**
  ```
  33:42  warning  'sites' is defined but never used                    @typescript-eslint/no-unused-vars
  139:48 warning  '_' is defined but never used                        @typescript-eslint/no-unused-vars
  323:6  warning  React Hook useEffect has a missing dependency: 'fetchOperations'   react-hooks/exhaustive-deps
  ```
  (Verified by running `npx eslint src/components/dashboard/BulkOperations.tsx` directly — 0 errors, 3 warnings, nothing else. The story's premise on this point is exact, not approximate.)
- **The staging-bypass trap is real and precisely as described in the story's own note**, but it is worse than "skips version history" — it also skips the entire staging workflow (an import lands live immediately, with no staging preview and no explicit publish step), and the version-history system it skips is `content_versions`/`create_content_version`, not the legacy `content_history` trigger table (structuring fact #3). Fixing this by literally reusing `PUT /api/staging/content/[siteId]` per-row for N imported rows, then one `POST /api/staging/publish` call, is the most direct way to get staging + `content_versions` + (if ever wired) webhooks for free — but it changes import from "N inserts" to "N HTTP-shaped writes + 1 RPC," which is the real complexity driver under a "2."
- **Webhook dispatch is not wired to any content path today.** `webhookManager.triggerEvent` (`src/lib/webhooks/manager.ts:133`) has exactly one caller in the whole codebase: its own test file (`src/__tests__/webhooks/manager.test.ts`). No route — not `staging/publish`, not `content/[siteId]`, not `bulk/*` — ever calls it. So "webhooks behave normally" for a human edit today means "webhooks don't fire for a human edit either." This lowers the story's real risk on that specific sub-clause (there is no regression to cause), but the story's Agentic Notes assert webhooks as one of the three things a direct write bypasses — that's not currently a differentiator between the bulk path and the human path, since neither fires them. Flag this in planning so the AC isn't written to require behavior that doesn't exist yet for humans either.
- **`authenticated`-role table-DML gap (A-13/B-3), read directly from `update-history-policy.test.ts:1-36,197-229`:** on a fresh local Supabase Postgres image, the `authenticated` role has no table-level INSERT/UPDATE grant on `content_elements` at all (`Dxt` privileges only — no `arwd`), which would make every bulk-update/import write raise `permission denied for table content_elements`. The same test file's comment states this is schema-wide (hits `service_role` too on that image) and explicitly **does not reproduce on production**, which was provisioned on an older Postgres image with broader default grants. The test recording this is `test.failing` by design, and the underlying question (B-3: does production actually have this gap) is explicitly marked "not answerable from this repository." Do not treat this as an s05 defect to fix — it predates and is orthogonal to this story — but be aware `import`/`update` share the exact same anon-key `createServerClient` write path this finding is about, so if B-3 is ever answered "yes" for production, bulk import inherits the same failure.
- **CSV round-trip mismatch (structuring fact #4)** is the single largest concrete risk to AC3. It is not a hypothetical — `generateCSV` and `parseCSVImport` are asymmetric by construction (quote-and-escape vs. naive split), verified by reading both functions directly.
- **Per-row failure handling (structuring fact #5)** is a real gap against AC4, verified by reading the call order in `POST` (`import/route.ts:77-97` parse, then `:100-105` validate, then `:108-114` import) — the parse step throws before any per-item error accumulation exists.
- **No size limit exists** (verified: no `Content-Length`, no byte-length check, no `MAX_*` constant anywhere in `import/route.ts`) — AC6 is new work, not a wiring task.
- **`validate_content` option is a documented no-op** (`import/route.ts:252-256`) — if the UI's "Validate content" checkbox (`BulkOperations.tsx:412-425`) is kept, either implement the validation or remove the checkbox; leaving it as decorative UI that silently does nothing is inconsistent with `AGENTS.md`'s "no dead surface" pattern this story exists to fix in the first place.
- **XML is a partial feature**: export generates it (`export/route.ts:207-231`), import explicitly throws `"XML import not yet implemented"` (`import/route.ts:235`), and the UI's format dropdown offers XML for both without restriction (`BulkOperations.tsx:357-359, 465-467`). The story's ACs only require CSV+JSON, so XML is out of scope for AC-completeness — but the existing UI would let a user pick XML import and hit a 500. Worth a one-line UI guard even though it's not named in the ACs.
- **Existing coverage floor**: `jest.config.js` thresholds are a ratchet at 22% lines (`AGENTS.md:198-199`) — planning does not need to hit 80%, just not regress the floor.

## Open questions

- **Whether the `authenticated`-role DML gap (A-13/B-3) is real in production** is explicitly unanswerable from this repository (confirmed by the test file's own comment, not by my inference). If it is real, bulk import/update are silently broken today regardless of UI wiring, and s05 would need to route through the service-role client (like `staging/content` and `content/[siteId]` already do) rather than the anon-key `createServerClient` the three bulk routes currently use. This changes the shape of the fix materially and should be resolved before or during planning, not assumed either way.
- **Whether s05 is expected to reuse the staging→publish path exactly, or to call `create_content_version` directly after a batch write.** The story's trap note says "route it through the same path as a human edit," which argues for staging→publish; but that turns a single import into N staging writes + 1 publish RPC call, which is a meaningfully bigger change than "wire up an existing UI." Planning needs to pick one and own the complexity delta explicitly.
- **Whether `docs/stories.md`'s complexity-2 estimate was made with knowledge of the CSV round-trip mismatch and the staging-bypass depth.** Nothing in the story text suggests it was verified against the code (no file:line citations for the parse functions or the staging path) — the note only cites the UI file and the lint warnings, which are the shallow part of the fix.

## Real complexity

**Story is scored 2. Verified complexity is closer to 3-4, not a straight re-score to 5** (no split proposal is offered — see below for why this stays a single story).

Why higher than 2:
- Wiring the existing UI into `SiteDetailView` and fixing the three lint warnings is genuinely a "2" on its own — this part of the premise holds exactly as claimed.
- But three of the seven ACs require real logic changes the story frames as pre-existing: the round-trip guarantee (AC3, needs a proper CSV parser), the per-row failure isolation (AC4, needs restructuring where parse-time errors are caught), and the version-history requirement (AC7, needs either a staging-path rewrite of the import write or a new `create_content_version` call plus a decision on which). None of these are "wiring" — they are logic changes to routes the story describes as "already exist and are tested."
- The size-limit AC (AC6) is net-new, not a gap-fix, but it's small (a byte-length guard) and doesn't move the number on its own.

Why not a 5 (no split needed):
- All the higher-complexity items are still contained inside the same three files (`import/route.ts`, `export/route.ts`, `BulkOperations.tsx`) and one component mount point — there's no second surface, no new page, no cross-cutting schema change. The `authenticated`-DML open question is the only thing that could blow this up, and it's explicitly a pre-existing, orthogonal risk to *confirm*, not new work to do; if confirmed true, the fix (switch to service-role client with the same explicit-authorization pattern `content/[siteId]/route.ts` already uses) is mechanical and roughly a half-day, not a second story.
- A round 3 is a fair verdict: "2" undercounts the parser/staging work; "5" overcounts a story that never leaves three existing files.

## Split proposal

Not applicable — verdict is not a 5.
