# Review — s70a-embed-ui-not-content

Reviewer: fresh-context `reviewer` subagent, 2026-10-08. Diff: `git diff 7276bb3..48bb6e2` (f44b676 embed fix,
cd6b1d5 migration, 48bb6e2 production count recorded) on `feature/s70a-embed-ui-not-content`.

## Verdict summary

Tasks 1 and 2 done exactly as planned; interdicts hold (nothing under `src/app`, `src/components`, `src/lib`,
`server`; one migration; ceilings down; Playwright `--list` 78). `shouldSkipElement` is one `closest()` with the
corrected `#rcf-edit-board-panel` id; the AI suggestions overlay and the form-field popover carry
`data-rcf-ignore`; the artifact rebuilds byte-identical (`build:embed -- --check`). Every root appended to `body`
is covered (editor bar, 5 `createOverlay` callers, staging bar, hover hint/toolbar/counter/field panel, animation
badge, popover, AI overlay, Edit Board panel) — except the container hint, safe only because a bare `div` is not
in the scan selector. Host behaviour unchanged; one ancestor walk instead of up to five.

Bytes: main 45841 / 33073 → branch 45840 / 33073; `MAX_*` and `SEEDED_MAX_*` equal the measurement.

Migration: forward-only, one statement, byte-identical to the plan's predicate, sorts after `20261008110000`.
The `untouched` guard holds against every writer (`bulk/update`, `bulk/import`, v1 PUT write `published_content`
with `current_content`). All four FKs into `content_elements` cascade; the public revision rotates for affected
sites only; `restore_content_version` cannot resurrect deleted rows. DB suite 1/1 on a throwaway PG14 (bootstrap
+ 72 migrations, `RCF_REQUIRE_TEST_DB=1`).

Gates: embed 22 suites / 286; full jest 374 suites / 4,846; type-check (both) 0; lint 0 errors; `format:check`
clean. 18 mutations: embed markers/id/selector parts → red; `[contenteditable]` (M8) and four predicate guards
(D1 `published_at`, D2 `staging_attributes`, D7 footer `'Close'`, D9 popover texts) stayed green.

## Findings

**F1 (major, pre-existing on main, not in this diff) — stored XSS via `version.created_by`.** The Edit Board
History tab builds "by …" with `innerHTML` (`recopyfast.src.js:6516`). `created_by` is a session or staging-access
email; `POST /api/staging/access` checks only presence (`route.ts:102`), and site admins can read an invite's
`verification_code`/`token` and set `email_verified` directly — so a site admin can store a payload that runs on
the customer's origin when the owner or an editor opens History (bearer tokens in `sessionStorage` reachable).
jsdom probe confirmed the element is created. Owner decision 2026-10-09: own security story **s72**, started now.

**F2 (minor) — migration header claims wrong:** the trigger's 'delete' row is erased by the cascade; snapshot
reachability is bounded by the ≤60 s CDN lifetime (ADR 046), not the revision rotation. Must be fixed before
apply. **F3** itemized byte figures don't reproduce. **F4** the "THE RULE" comment (`:2705`) is false for the
container hint; the test header overclaims coverage. **F5** four predicate guards untested. **F6** the
`[contenteditable="true"]` skip has no test (pre-existing). **F7** the count ran through the Supabase connector,
not the plan's named channel.

## Fix pass `9d57624` — F2…F7

F2 header rewritten (no audit row survives; CDN lifetime bounds the public copy), SQL byte-identical (same
sha256). F3 ledger re-measured: +6 / +7 then −7 / −7, with the banner-hash noise (comment edits move gzip ±2 B)
explained. F4(b) test header lists driven and undriven surfaces. F5 four kept seed rows — D1, D2, D7, D9 each now
red (throwaway PG14, then deleted). F6 contenteditable test, red under mutation. F7 both plans name the channel
(connector, `SELECT` only).

**F4(a) not done, deliberately:** a comment-only edit of the source changes the artifact banner's sha256 and
measured 45840 / 33074 — over the widget ceiling by 1 B; the container-hint marker measured 45847 / 33081.
Ceilings only go down, so the comment fix moves to **s72**, which edits the same file and re-ratchets.

Gates after the pass: embed 22 suites / 287; full jest 374 suites / 4,847; type-check (both) 0; lint 0 errors;
`format:check` clean; `build:embed -- --check` 45840 / 33073; `--list` 78. Reviewed by the orchestrator (not the
author): migration statement unchanged, header accurate against ADR 046 and the FK catalog.

## Not verified

Real browser (jsdom only). CI's Supabase replay for the DB suite (CI runs it). Production: after merge, apply the
migration, re-count (`will_delete = 0`), and after ≥60 s check `GET /api/published/<site>` for both sites.

## Devin Review on PR #75 — fix `5c90de6`

🔴 **Customer copy deleted by cleanup** (valid): `ce.selector LIKE '#rcf-%'` matched any customer element whose
own id starts with `rcf-` (generateSelector stops at any id), e.g. an untouched `<h1 id="rcf-hero">`. The clause
is now an allowlist of the 26 ids the embed has ever assigned (full history of both embed files), matched as the
whole leading id followed by whitespace or end. Red first on a throwaway PG14: `#rcf-hero`, `#rcf-editor-banner-x
> p`, `#rcf-savings > span` were deleted; green after, with every earlier embed row still deleted; restoring
`LIKE '#rcf-%'` → red. SQL check 52/52 allowlisted forms match, 8 lookalikes don't. Migration and both plans stay
byte-identical for the predicate. Production read-only re-count with the new predicate (orchestrator,
2026-10-09): unchanged — 25 to delete (13 www.aicompoz.com, 12 QA site), 0 edited kept, 0 review tier; the only
`#rcf-` root in production is `#rcf-editor-banner` (4 rows, in the allowlist).

Flag "Embed-root rule excludes a live exception" (`recopyfast.src.js:2704-2711`) is F4(a) above — moved to s72
for the byte ceiling.

Max severity: minor
Ship allowed: yes
