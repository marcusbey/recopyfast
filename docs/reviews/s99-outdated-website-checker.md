# Review — s99-outdated-website-checker

Fresh-context independent review of the uncommitted story work on
`feature/s99-outdated-website-checker`, against `origin/main` `20f95f5`, the human-validated plan,
research, design, AGENTS.md and accepted ADR 062. The review covered all 24 changed tracked and
untracked story files. No source file was changed by the reviewer except for temporary mutations
described below, each restored byte-for-byte before this report was written.

## Verdict

The implementation follows the s96 free-tools architecture and Tasks 1–5 are substantially
present: a deterministic UTC lens, real tokenizer/dictionary boundary, catalogue and registry
entries, the designed static page and SEO data, generic report coverage, and a strict 99-test
Playwright inventory. Both seasonal year-presence defects found by independent review are now
fixed with one plausible year/range shape kept separate from the accepted-year analysis window.
No technical finding remains in the bounded review. The ship gate stays closed only because Task 6
is incomplete until the repository-wide gates and the seeded browser journey run in their
coordinated heavy slot.

## Findings

### Resolved — Critical 1: an explicit out-of-range year was reported as “undated”

The repair separates accepted `YearReference` values from visible year presence. The new fixtures
for `Summer 2035 sale` and `Summer 1989 sale` were independently red before the source change and
are now green; the existing `Summer sale` positive still warns. The implementation-only 24-file
manifest is stable at `a17848f2120c992c75bb3c5c7d5cdd70ae5bf6eaf6d8d8f10e2c411b4f4fe499`.

### Resolved — Critical 2: any nearby four-digit number suppressed the undated seasonal warning

The repaired `YEAR_REFERENCE` now defines plausible visible year/range syntax as `1xxx` or `2xxx`
with the supported two- or four-digit range suffix. `yearSpans` separately applies
`parseYearReference`'s 1990 through `now + 5` window when deciding stale/current behavior. An
extension or street number `5555` no longer counts as a year.

The following cases are now pinned and green at `2026-10-11T12:00:00Z`:

| Input | Actual | Required by the validated plan |
|---|---|---|
| `Summer sale` | `seasonal-promo-out-of-season` | warning |
| `Summer sale, call extension 5555` | `seasonal-promo-out-of-season` | warning |
| `Summer sale at 5555 King Street` | `seasonal-promo-out-of-season` | warning |
| plausible year at 60 characters | no undated warning | no undated warning |
| plausible year at 61 characters | `seasonal-promo-out-of-season` | warning |
| `Summer 2035 sale` / `Summer 1989 sale` | no undated warning | no undated warning |
| `Summer 2100 sale` with a 2098 clock | no stale or undated warning | no finding |

The implementation manifest after this repair independently recomputes to
`91b795bd1158f773c8fb61e07034f8cc0cb2a81b320017c91bfb0fff41542156`.

## Plan and contract check

| Area | Evidence | Result |
|---|---|---|
| UTC dates and ranges | Day precision stays current through its UTC day; month precision uses the real final UTC day, including leap February; day ranges use the end; compact year ranges use the final year | passes focused review |
| Strict two-calendar-year rule | Exact shifted day and month-end values remain clean; one day/month beyond the boundary produces `stale-updated` information | passes focused review |
| Block context | The rule API receives one extracted block and the 60/61-character boundary is pinned; no keyword search crosses a block | passes focused review |
| Language gate | Imports and exact signatures for `tokenizeBlock`, `reduceContraction`, `isLikelyEnglish`, `Dictionary` and lazy `getDictionary` all exist; skips are per page and English siblings still run | passes focused review |
| Dedupe, facts and cap | Dedupe key is `kind|lower-case match|before|after`; counts come from distinct findings before the 40-item display cap; the summary has exactly eight facts and exclusive verdicts | passes focused review |
| Generic report and safety | Findings use `createFinding`; stored URLs are revalidated as HTTP(S); scraped text reaches React text and `<mark>`, not raw HTML; the existing report CTA and skipped-page section are reused | passes focused review |
| SEO and claims | Catalogue drives the hub, sitemap and `/llms.txt`; canonical, Open Graph, WebApplication, BreadcrumbList and FAQPage data are present; visible FAQ copy shares the source list; forbidden launch claims are absent | passes focused review |
| Story scope | No migration, dependency, API route, alternate report schema or story-specific report renderer was added | passes focused review |
| Seasonal year presence | Raw plausible year/range presence is separate from accepted stale-year analysis; out-of-window years suppress “undated,” unrelated 5555 values do not, and the 60/61 boundary is pinned | passes focused review |

## Tests rerun independently

- First-pass focused story and integration set: **11 suites, 156 tests passed**.
- Author's repaired focused set: **11 suites, 158 tests passed**. Independently rerun after the
  repair: the rule suite passed **52/52**.
- The implementation manifest was recomputed from `/tmp/recopyfast-s99-files.XdVtBL` and matches
  `a17848f2120c992c75bb3c5c7d5cdd70ae5bf6eaf6d8d8f10e2c411b4f4fe499`.
- After the second repair, the author reports **11 suites, 162 tests passed**. The reviewer reran
  the rule and lens suites: **2 suites, 68 tests passed**. The implementation manifest independently
  matches `91b795bd1158f773c8fb61e07034f8cc0cb2a81b320017c91bfb0fff41542156`.
- Playwright collection with the ordinary list reporter: **99 tests in 20 files**, including the
  two s99 tests. The workflow, config and contract test all declare 99.
- `git diff --check origin/main`: clean.
- Extra read-only probes confirmed leap-month ends, same-day non-past behavior, range-end behavior,
  strict two-calendar-year boundaries and wrap-around winter dates.

## Mutation proof

| Neutralization | Result |
|---|---|
| Treat a day as past before its UTC day finishes | **2 red, 60 passed** across the date and rule suites; both the direct same-day assertion and the upcoming-date negative fixture failed |
| Bypass the per-page English gate | **3 red, 9 passed** in the lens suite; declared-French, dictionary-detected and all-pages-skipped behavior failed |

After restoration, the three affected suites passed **74/74**. Restored SHA-256 values were
`5868401a…` for `dates.ts`, `b0e6c3e…` for `outdated-lens.ts`, and `d4e3523b…` for `rules.ts`.

## Not verified in this pass

- Full Jest, coverage, lint, format, both TypeScript checks, production build, embed freshness and
  production audit gates are still awaiting the coordinated heavy-resource slot. Run them against
  the stable `91b795bd…` implementation manifest.
- The two Playwright tests were collected but not executed. Run the seeded local-Supabase report
  journey and confirm zero CSP violations, zero skipped/flaky tests and a clean 99-test summary.
- The 390 px and 1440 px layouts were not visually rendered. A human should load the tool page and
  one fail/warn/pass report at both widths, confirm there is no horizontal scroll, and inspect the
  fixed social card.
- No third-party site was scanned, no LLM/provider was called, and no production or remote data was
  touched. After deployment, perform one bounded real-site scan and confirm the language skip,
  seasonal warning and generic report copy with ordinary browser gestures.

No technical finding remains. Complete Task 6 against the stable manifest, execute the seeded s99
browser tests, then finalize this review gate.

## Final independent gate audit — 2026-10-12

This addendum supersedes the earlier pending-gate statements. A separate final reviewer inspected
Task 6 and the recorded human validation, checked the gate logs and machine-readable summaries in
`/tmp/s99-gates`, and independently recomputed all 24 file hashes. The final manifest digest is
`88bec8bd02f23d8d92176dce95dcc751fa5c5b03b64d06f537331fb89b87b102`. Comparison with the earlier
`91b795bd1158f773c8fb61e07034f8cc0cb2a81b320017c91bfb0fff41542156` manifest shows that only
`docs/plans/s99-outdated-website-checker.md` changed for the completed task/evidence record; all
reviewed production code, tests, configuration, research and design hashes remain identical.
The review file itself is deliberately outside this implementation manifest.

The binding base is `20f95f5f3f1e9a1432613cff7e2b2aff5c0b0474`, still this branch's HEAD.
During verification `origin/main` advanced to `2b3f864abcff2f24398a42cabf33cc9aa5dd057a` with the
separate s65b work. Those ten upstream paths are not s99 edits. Inspection against the binding
base found no unexpected changed or untracked story paths beyond the 24 manifest entries and
this review. This gate does not attest to a future rebase or integration onto the newer base;
normal hosted CI and any integration verification remain required.

| Final gate | Independently inspected evidence |
| --- | --- |
| Static checks | Node 24.14.0; format and both TypeScript gates complete; lint has zero errors and 34 existing warnings |
| Full Jest and coverage | 500 passed suites, 7,464 passed tests; 2 standard skipped suites/38 skipped tests explicitly retained; statements 76.55%, branches 70.40%, functions 74.48%, lines 77.26% |
| Production and artifact gates | Successful production build and all 123 static-page generations; current embed artifact at the existing 45,818-byte gzip ceiling; production audit reports zero vulnerabilities |
| Additional contracts | 68 Node contract tests pass; PostgreSQL 17 replay passes 16 named suites/121 tests with one PostgREST-only skip; the real local Supabase/PostgREST run passes 15 suites/186 tests without skips |
| Browser journey | Strict JSON summary and log agree: 99 passed, zero failed/skipped/flaky, including both s99 tests; built-embed fixture log separately records 6/6 with no failures/skips/flakiness |
| Mutation coverage | All eleven required perturbations have exit 1 and failed assertions in the saved summary; restored focused run passes 84/84, and current source hashes match the reviewed originals |
| Visual evidence | Eight landing/fail/warn/pass renders at 390 and 1440 px return 200, no horizontal overflow and no CSP violations; the verifier inspected all screenshots; this reviewer independently inspected the mobile landing/fail/pass, desktop warn and social card with no blocking layout or clipped-copy defect |

The original independent source review and mutation review remain applicable because their source
binding is unchanged. The final auditor did not rerun the expensive suites or repeat already
proven mutations; the separate verifier's concrete logs, summaries, restored hashes and rendered
artifacts close Task 6 without duplicating that work. This auditor changed only this review.

### Remaining verification limits

- These are local production-build and disposable local-stack results, not hosted CI, deployment,
  or production acceptance. The known embed budget overrun above the long-term 30,000-byte target
  is inherited and unchanged; the current ratchet passes.
- Seeded s99 reports prove the generic renderer and nonce journey; they do not prove a real
  third-party outdated scan in production. No customer domain, paid provider or production data
  was touched. After an authorized deployment, perform the already-recorded bounded real-site
  scan and check its language skip, seasonal finding and report copy with ordinary browser gestures.
- Manual merge and production changes remain separate owner decisions. This passing review permits
  the story's draft-PR/CI handoff under the validated plan, and does not claim that the feature is
  deployed or that newer-main integration has passed.

All validated plan tasks now have corresponding evidence. No open technical finding remains.

Max severity: none
Ship allowed: yes
