# Review — Story s05-bulk-content-portability

> Fresh-context review by the `reviewer` subagent.
> Diff reviewed: `git diff main...feature/s05-bulk-content-portability` (`d900d25`).

## Tests
- [x] Run by the reviewer. 145 suites passed / 1 skipped, 2012 of 2048 tests, exit 0.
      type-check clean, lint 0 errors, `npx eslint BulkOperations.tsx` 0 warnings (was 3),
      format:check clean, build exit 0. All run interdicts show an empty diff. No zod.
- [x] **Bite proven by neutralization**, all restored, `git diff --exit-code` clean, verified
      twice: CSV quote-awareness → 10 red · per-row JSON isolation → 2 · 413 size guard → 1 ·
      `create_content_version` → 1 · `change_type` → 1 · export GET permission check → 2 ·
      history fetch URL → 3. Every load-bearing behaviour is pinned by a test that bites.
- ⚠️ The green run depended on `.env.test.local`, which is gitignored and not in the diff.
      Without it, 4 suites / 5 tests fail — all untouched by this diff, none of the 8 bulk
      suites among them. Environment artifact, not an s05 regression.

## Findings

### CRITICAL 1 — AC 3 is unmet; the round trip silently rewrites and deletes customer copy
The implementer suspected the sanitizer was lossy on `&lt;`. It is not — it is idempotent on
all 17 probed values, so already-sanitized content round-trips fine. **The real failure is
worse, and it is on content that never saw the sanitizer — which is nearly every row in the
product.**

Content discovery writes the widget's raw `textContent` into `original_content`,
`current_content` and `published_content` **unsanitized**
(`src/app/api/content/[siteId]/route.ts:131-133`), deliberately:
`src/lib/security/discovered-text.ts:1-31` records that an HTML sanitizer here was removed as
production bug **A-1**, and `AGENTS.md` makes it a standing rule — *"Text scraped off a
customer's DOM … is not markup and is not sanitized as markup."*
**Import sanitizes it as markup anyway** (`import/route.ts:436-443`).

Demonstrated with ordinary marketing copy in the round-trip fixture:

```
- Expected: "Setup in <2 minutes — Paste the <script> tag"
+ Received: "Setup in &lt;2 minutes — Paste the "
```

Both CSV and JSON fail. The copy is rewritten **and ` tag` is destroyed**. The widget writes
back via `target.textContent`, so `&lt;` renders literally on the customer's page.

Compounding it: `roundtrip.test.ts:20-24` states in its own header that the fixture carries no
HTML-special characters "because the write path sanitizes content deliberately … that
transformation is not what this test is about". **The AC 3 test was scoped around the AC 3
failure.**

This is the feature the PRD calls the one that *"kills the lock-in objection in the sales
call"*. An export that silently rewrites a customer's copy is worse than no export.

### MAJOR 1 — every bulk import is labelled "Manual edit — Saved by hand from the edit board"
`versionChangeTypes` (`src/components/ui/status-badge.tsx:134-163`) has the key `bulk`, not
`bulk_edit`; `VersionTimelineItem.tsx:69-73` falls back to `manual`. Two comments in the diff
(`import/route.ts:499-502`, `import-outcomes.test.ts:256-257`) assert the panel renders it as
"Bulk edit" — verifiably false. One registry key fixes it.

### Minors
1. Task 7 and task 5 deviations shipped unrecorded in the plan (task 10's `Select` deviation
   *was* recorded, correctly).
2. Missing CSV header → 500 `"Failed to process bulk import"`; the plan specified 400, and the
   actionable reason is discarded.
3. A payload with no `options` key → 500 (probed); the route does not use
   `src/lib/api/validation.ts`.
4. No rate limiter on a newly-reachable 5 MB endpoint.

## Two of the implementer's three flagged items were not defects
- **`bulk_edit` change_type — the implementer is right, the plan and ADR 008 are wrong.**
  `20251230100000_edit_board.sql:69` constrains `change_type` to a list containing `bulk_edit`
  and **not** `bulk_import`; no later migration relaxes it. `bulk_import` would violate the
  CHECK and history would silently stay empty.
- **Task 5's "impossible fixture" — the plan is wrong, the split is correct.**
  `create_missing_elements` / `overwrite_existing` are per-request, so "created" and
  "missing-not-created skipped" cannot co-occur. The two-test split covers all four outcomes
  and still bites under neutralization.

## Verified sound
The CSV codec is genuinely correct — a pathological fixture (embedded commas, quotes and
`\r\n` inside quotes, a bare `"` field, `,,,` as data, preserved leading/trailing spaces,
unicode) round-trips exactly. Every import and call signature checks against the real file.
**No hallucinated primitive — `Select` correctly not invented.** `create_content_version`
params and grants verified against the migration; ADR 008 accurately implemented. The export
GET permission hole is closed, the history fetch repointed, the false empty state fixed.

## Not verified
No screen was ever rendered. No real file was ever exported or imported — `FileReader`, blob
and `createObjectURL` are all mocked. Supabase is mocked throughout, so no CHECK constraint was
exercised against Postgres. The MAJOR 1 label defect was proven by reading the registry, not by
rendering. 413 was never hit with a genuinely oversized body (a platform body cap may fire
first). No E2E. Permission-refused was only ever a stubbed 403.

**Fastest confirmation of CRITICAL 1: export a real site to CSV, re-import it, diff the
content.**

## Verdict
Max severity: critical
Ship allowed: no
