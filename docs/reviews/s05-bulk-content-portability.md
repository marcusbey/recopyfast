# Review — `s05-bulk-content-portability` (re-review of the fix run)

Branch `feature/s05-bulk-content-portability`, commit `27d9bd1`. Fresh context, read-only.
Supersedes the first-pass review (critical / ship no); that verdict's findings are assessed below.

## Tests, run by the reviewer

`npx jest --ci`: **146 suites passed / 1 skipped, 2019 of 2055**, exit 0. Coverage run exit 0, the
ratchet holds. `type-check`, `lint` (0 errors), `format:check`, `build` — all green. All four run
interdicts show empty diffs. No `zod`.

**13 neutralizations, all bit, all restored** (`git diff --exit-code` clean afterwards). Highlights:
re-applying the A-1 `<`→`&lt;` rewrite turned 3 red; `bulk_edit`→`bulk_import` 1; the registry key
back to `bulk` 1; removing CSV quote-awareness 7; `encodeCSVRow` no longer quoting 8.

## The prior critical is genuinely closed

`sanitizeHTML` is gone from the import path — only the tombstone comment remains.
`validateDiscoveredText` was read line by line: it never escapes, strips or truncates. The
round-trip fixture now carries `<`, `>`, `&` and quotes in real marketing copy, and goes red under
neutralization. **A-1 is not back in any form.**

The `bulk_edit` correction is substantively right: `20251230100000_edit_board.sql:69` constrains
`change_type` to six values, `bulk_import` is not among them, and no later migration relaxes it.

## Findings

### MAJOR 1 — a value that round-trips today can now be refused on import
Probed, not inferred: a 20,001-character `current_content` returns `failed / "content exceeds 20000
characters"` with zero writes. The deviation's premise — *"both bounds already govern every row"* —
is **true of discovery and false of the column**. No other writer caps length:
`bulk/update` set/append, `staging/content` PUT (`sanitizeHTML` has no cap) and `v1/content` POST
all write unbounded. So a row written by any of those three exports fine and will not import.

Not the old bug — it is loud, per-row, and corrupts nothing — hence major, not critical. But **AC 3
fails for that class of row**, and the run interdict against adding a content-length rule was
explicit.

### MAJOR 2 — a minimal import file blanks `original_content` permanently
Probed: a 3-column CSV — *the exact minimum the UI advertises* — writes `original_content: ""`.
That column is the served fallback when `published_content` is null, and the last `COALESCE` arm in
`create_content_version`. **Pre-existing on `main`** (identical shape in
`git show main:…/import/route.ts`), but this story makes it reachable, and the card's own "What's in
the file" panel lists 5 fields while omitting this one — so a user following the UI builds the
destructive file. Scoping is a judgement call; the data loss is not.

### MAJOR 3 — ADR 008 was edited in place, and the correction misstated its own history
`AGENTS.md`: ADRs are immutable; a change means a superseding ADR. ADR 008 is on `main`
(`45844fd`), where line 51 still reads `bulk_import`. The branch rewrote the Decision paragraph and
appended a note claiming the value was fixed *"before this ADR ever reached `main`"* — verifiably
untrue. Substance right, mechanism wrong, and the artifact now carries a false claim about itself.

**Already remedied on `main`:** [ADR 024](../decisions/024-bulk-import-snapshot-change-type.md)
supersedes ADR 008 on this one value. **The branch must restore ADR 008 byte-for-byte** to `main`'s
content and cite ADR 024 instead.

### MAJOR 4 — a new test certifies a live mislabelling
`VersionTimelineItem.test.tsx:47` asserts `style_apply` → "Manual edit" *as correct*, describing it
as "a change type this build does not know". But `edit-board/styles/apply/route.ts:176` writes
exactly that value on every AI style application. It is the **identical** silent-fallback defect
just fixed for `bulk_edit`, now blessed by a test — and the author enumerated the full CHECK list in
their own comment, so the contradiction was on screen. Minimum fix: use a genuinely impossible value
in the fixture.

### Minors
No test covers the 20,000-character bound — the deviation's central claim is the one thing unpinned.
"What's in the file" lists 5 of 11 exported columns. `POST /api/bulk/export` remains unmetered
(the scope argument does not hold, but it is kept minor for consistency with the prior review).

## The three declared deviations, judged

1. **`validateDiscoveredText` reuse — does not fully hold.** See MAJOR 1.
2. **400 widening — holds.** All four reachable `FileParseError` conditions are caller errors.
3. **`export` unmetered — does not hold as argued**, but stays minor.

## Verified sound

Every import, signature and primitive checks against the real file: `enforceRateLimit`/`API_UPLOAD`,
`create_content_version`'s four parameters, and every `src/components/ui/` component with matching
props. **No primitive was invented** — `select.tsx` is genuinely absent, and design-system gaps 6
and 8 are cited exactly. Design conformity is complete: every named state is rendered and tested.
Plan tasks 1–10 are all done, with nothing unasked-for in the diff.

## Not verified — needs a human's hands

No screen rendered in a browser. No real file exported or re-imported — `FileReader`, `Blob` and
`NextResponse` are all mocked. Supabase is mocked throughout, so the CHECK constraint is **read,
never exercised**. 413 never hit with a genuinely oversized body. Permission-refused is only ever a
stubbed 403. No E2E.

**One query decides how much MAJOR 1 matters:**
`select count(*) from content_elements where length(current_content) > 20000`.
Then: export a real site in both formats, re-import, diff `current_content` / `original_content` /
`metadata` in Postgres, and confirm a `content_versions` row lands with `change_type = 'bulk_edit'`.

## Verdict
Max severity: major
Ship allowed: no
