---
validated: yes
---

# Plan — Story s99-outdated-website-checker

The prior plan was marked `validated: yes (architect, 2026-10-11)`. Research on current
`origin/main` found that its `isLikelyEnglish(pages)` premise was false and that its info-only
summary states overlapped the pass rule. This revision preserves the architect's product decisions,
repairs those implementation premises and requires a fresh human validation checkpoint.

Branch: `feature/s99-outdated-website-checker`, from `origin/main` after s96/s96c.

Inputs:

- story: `docs/stories.md` § `s99-outdated-website-checker`;
- research: `docs/research/s99-outdated-website-checker.md`;
- design: `docs/designs/s99-outdated-website-checker.md` and its HTML reference;
- platform: s96's catalogue, lens, scan and generic report contracts.

The only story dependency is the already-merged s96/s96c platform. No migration, package, model or
provider call is added. The tool is deterministic, reads the injected scan date and uses the
existing lazy English dictionary. It does not execute the scanned page's JavaScript.

## Scope and files

Add:

- `src/lib/tools/lenses/outdated/dates.ts`
- `src/lib/tools/lenses/outdated/rules.ts`
- `src/lib/tools/lenses/outdated/seasons.ts`
- `src/lib/tools/lenses/outdated/language-evidence.ts`
- `src/lib/tools/lenses/outdated/outdated-lens.ts`
- colocated tests under `src/lib/tools/lenses/outdated/__tests__/`
- `src/app/tools/outdated-website-checker/{page,opengraph-image,twitter-image}.tsx`
- `src/__tests__/app/outdated-checker-page.test.tsx`
- `e2e/tools-outdated.spec.ts`

Edit only the two s96 discovery seams in shared free-tool source:

- one entry in `src/lib/tools/catalogue.ts`;
- one import and registry entry in `src/lib/tools/lenses/registry.ts`.

Update the existing strict Playwright-count contracts required by the new E2E test. Do not add a
story-specific report renderer or change the report schema.

## Frozen behavior

### Pages and time

- Lens id: `outdated`; catalogue slug: `outdated-website-checker`.
- `pages = { sample: "sitemap", max: 10 }`.
- Every calendar decision derives from `LensContext.now` with UTC accessors. Rule code never calls
  `new Date()` or `Date.now()`.
- “Today” is the UTC calendar day. A day-precision date equal to today is not past.
- A month/year date is past only after the final UTC day of that month.
- A date range uses its end date. A year range such as `2026/27` uses 2027 as its final year.
- For `last updated`, shift the reference UTC date back two calendar years and fire only when the
  recognized date's end is strictly earlier. Exactly two calendar years old is not enough.

The month-end and exclusive-verdict rules were implicit in the old plan. This repaired plan makes
them explicit because both prevent false “fresh” or false “past” outcomes; their boundary fixtures
and rationale are part of the fresh human validation checkpoint.

### Recognized dates

`dates.ts` recognizes, linearly and in English:

- `Month D[st|nd|rd|th][,] YYYY`;
- `D Month YYYY`;
- `Mon[.] D, YYYY`;
- `Month YYYY`;
- ISO `YYYY-MM-DD`;
- `Oct 3–5, 2025` and `3–5 October 2025`.

Numeric slash dates stay ignored. Calendar-invalid dates are rejected by component round-trip.
Accepted years are 1990 through `ctx.now`'s UTC year + 5.

### Language gate — corrected boundary

`language-evidence.ts` builds evidence per page from existing exported APIs:

1. `tokenizeBlock` each `ExtractedPage.blocks` value;
2. use blocks with at least four tokens;
3. exclude digit-touching tokens, call `reduceContraction`, and keep resulting words of at least
   three characters, including Unicode words;
4. call `isLikelyEnglish({ lang: page.lang, words, isKnown: dictionary.isKnown })`;
5. load the production dictionary through `getDictionary()` lazily.

`analyzeOutdated(pages, context, dictionary = getDictionary())` accepts an injected `Dictionary`
for deterministic tests. A non-English page is added to `skippedPages`; it does not suppress an
English sibling page. Fewer than ten evidence words retain the shared helper's benefit-of-doubt
behavior, so a short English footer can still produce a copyright finding.

No edit to `language.ts`, the Typo Finder or its dictionary/tokenizer is planned.

### Rules

Each rule reads one block and emits a sanitized generic `Finding`. A date-keyword distance never
crosses the block boundary.

| Kind                           | Level | Fires when                                                                                                                                                                                                                                                                                                                                     | Must not fire on                                                                                     |
| ------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `copyright-year`               | stale | `©`, `(c)` or `Copyright` is within 20 characters of a year/range whose final year is behind the current UTC year                                                                                                                                                                                                                             | current/future final year; a year without the marker                                                 |
| `copyright-year-grace`         | info  | the same stale copyright condition from January 1 through January 31 UTC                                                                                                                                                                                                                                                                       | February 1 onward, which is stale                                                                    |
| `past-date-upcoming`           | stale | a recognized date is past and, within ±60 characters in the same block, copy says `upcoming`, `join us`, `register`, `book now/your`, `save the date`, `tickets`, `rsvp`, `reserve`, `apply by`, `deadline`, `ends/ending`, `until`, `valid until/through`, `offer`, `sale`, `starts`, `opens/opening`, `launch/launching`, `coming` or `next` | blog/byline dates; `since`, `founded`, `established`, `last updated`; no nearby future/deadline word |
| `dated-prices`                 | stale | a past final year is paired with prices, pricing, rates, menu, price list, fees, catalogue/catalog, collection, schedule or timetable, including `20YY/YY`                                                                                                                                                                                     | current/future final year                                                                            |
| `past-future-tense`            | stale | `coming`, `coming soon`, `launching`, `opening`, `arriving` or `new`, followed by `in/for <past year>`                                                                                                                                                                                                                                         | current/future year                                                                                  |
| `seasonal-promo-past-year`     | stale | a named seasonal promotion is paired within 20 characters with a past year                                                                                                                                                                                                                                                                     | current/future year                                                                                  |
| `seasonal-promo-out-of-season` | warn  | a named seasonal promotion has sale/offer wording within ±60 characters, has no year and today is outside its pinned UTC window                                                                                                                                                                                                                | seasonal mention without sale/offer wording; in-window promotion                                     |
| `stale-updated`                | info  | `(last )?updated:` followed by a recognized date whose end is strictly more than two calendar years before today                                                                                                                                                                                                                               | exactly two years old; ordinary blog/byline dates; no `updated` label                                |

Pinned broad windows: Black Friday/Cyber Monday 15 Nov–5 Dec; Christmas/holiday 15 Nov–6 Jan;
Valentine's 20 Jan–15 Feb; Easter 1 Mar–30 Apr; summer 1 Jun–31 Aug; back to school 1 Aug–30 Sep;
Halloween 1–31 Oct; New Year 15 Dec–15 Jan; winter 1 Dec–28/29 Feb. Wrap-around
windows must work across New Year.

### Dedupe, counts and verdict

- Create findings with `createFinding`; `before` and `after` are the same block around the match and
  are capped by the shared constructor.
- Collapse repeated lines across pages through `boundFindings`, keyed by
  `kind|lower-case match|before|after`.
- Summary counts use distinct keys before the 40-finding display limit. Set `findingsTruncated`
  when distinct findings exceed the returned list.
- Exactly eight facts: Pages checked; Copyright years with stale and January-grace counts in the
  same value; then one count for each of the six remaining kinds. The generic report already lists
  skipped pages separately. Combining the two copyright severities keeps both counts visible while
  preserving the shared `MAX_FACTS = 8` contract.

Verdicts are exclusive:

- `skipped` when zero pages pass the language gate;
- `fail` when at least one stale kind exists;
- `warn` when no stale kind exists and at least one warning/info kind exists;
- `pass` when at least one page was checked and all eight counts are zero.

Headline patterns are the design's pinned copy: `N lines look out of date` counts stale findings
only; `N lines may need review` counts warning and information findings when there are no stale
ones; the other states use `No clearly out-of-date lines on the N pages we checked` or
`No English pages were checked`. Warning/information findings remain listed in a fail report but
are never included in its “look out of date” number.

## Tasks — test first

1. [x] **Recognize dates and precision.**
   - RED `dates.test.ts`: every supported form; ordinal and abbreviated months; day/month ranges;
     year ranges; same-day boundary; month-year stays current through its final day; leap-year and
     invalid-date round-trips; slash dates and out-of-range years ignored; a large synthetic input
     completes under the existing unit-test performance convention.
   - GREEN `dates.ts` with no ambient clock read and no regex built from page text.

2. [x] **Classify only the story's stale-copy rules.**
   - RED `rules.test.ts`, fixed at `2026-10-11T12:00:00Z`, with positive, negative and boundary
     fixtures for every table row; context at exactly 60 and 61 characters; block isolation;
     January 31/February 1; cross-year seasonal windows; `last updated` at exactly two years and one
     day beyond it; blog dates, `since/founded/established`, numerical slash dates and plain seasonal
     mentions remain clean.
   - GREEN `rules.ts` and `seasons.ts`. Keep all notes plain and specific about why the line was
     selected.

3. [x] **Gate each page through the real tokenizer/dictionary API and build the lens.**
   - RED `language-evidence.test.ts`: URL/file chunks do not count as words; digit-touching tokens
     are removed; contractions reduce; short-label blocks are excluded; Unicode words remain
     evidence.
   - RED `outdated-lens.test.ts`: declared French and dictionary-detected non-English pages skip;
     English siblings still run; short English copyright copy still runs; fake dictionary injection
     avoids package loading; multi-page dedupe/occurrence note; exact eight facts; all four verdict
     states; distinct counts and truncation; a fake system clock cannot change `ctx.now` results.
   - GREEN `language-evidence.ts` and `outdated-lens.ts`, then add the one registry line and one
     catalogue entry (`cta: "fix-on-page"`).

4. [x] **Build the designed tool page and SEO surface.**
   - RED `src/__tests__/app/outdated-checker-page.test.tsx`: exact title, intro, submit label,
     checks/leaves-alone copy and FAQ; canonical and OG URL; visible FAQ equals `FAQPage` JSON-LD;
     `WebApplication` and `BreadcrumbList`; no forbidden launch claims; explicit “HTML as sent,
     JavaScript is not run” note.
   - Update the catalogue/discovery, sitemap and `/llms.txt` expectations that are driven by the
     catalogue; do not add a parallel list.
   - GREEN the three page/social-card files by composing `ToolPageLayout`, `ToolScanForm` and the
     existing OG helper exactly as the design specifies.

5. [x] **Prove the generic report and browser journey.**
   - Add an s99 case to the existing report-page coverage: a seeded outdated report renders the
     fail headline, eight facts, the highlighted line, its reason and the `fix-on-page` CTA; a
     skipped page remains in “Pages not checked.” No per-tool renderer.
   - RED/GREEN `e2e/tools-outdated.spec.ts`: the static tool page renders without a CSP violation;
     a seeded nonce report renders a `copyright-year` finding and CTA. It makes no third-party
     scan request.
   - Increase every strict Playwright inventory/count contract by exactly the number of tests added,
     rebased against main.

6. [x] **Run gates and mutation checks.**
   - Mutations must fail: same-day treated as past; month-year treated as the first day; context
     crosses a block; January grace removed; numeric slash dates enabled; ambient clock read;
     non-English page reported as pass; raw occurrence count used instead of distinct findings;
     info-only report marked pass; `stale-updated` rule removed or made stale.
   - Run targeted outdated-lens/page/report tests first, then format check, lint, type-check,
     `type-check:build`, full Jest, production build, embed freshness, strict Playwright inventory
     and the repository's production audit gates. The E2E story test runs when its seeded test
     environment is available.

## Risks and limits

- This is a precision-first English heuristic, not a complete freshness audit. Unsupported date
  forms stay silent.
- Seasonal windows are broad review hints. They warn; they do not declare an undated offer false.
- The scanner reads server-delivered HTML only. Browser-added copy is explicitly outside the claim.
- The existing safe fetcher, limits, report storage, public-link policy and nonce report boundary are
  unchanged.
- No ADR is needed: the story uses existing s96 contracts and introduces no new structural boundary.

## Validation checkpoint

The repaired plan received independent review and the owner checkpoint recorded below before
execution. That checkpoint supersedes the previous architect-only marker.

## Human validation — 2026-10-12

The owner answered **“Validate all three recommended plans”** to the native question linking
s108, s109 and s99. This validates this reviewed plan, including implementation, independent
review, draft PRs and CI. s108 may supersede #91 after its replacement passes. s109 leaves the
two extract-zip alerts open with the stated temporary acceptance. These bounded stories may
proceed while the separate AI-translation backlog gap remains open. Their merges and production
changes remain separate from this plan validation.

## Verification evidence — 2026-10-12

The recovery verification ran on Node **24.14.0**, against base `20f95f5`, after both independently
reviewed seasonal-year repairs. The 24-file implementation manifest was
`91b795bd1158f773c8fb61e07034f8cc0cb2a81b320017c91bfb0fff41542156` before this evidence-only plan
update. Every temporarily mutated source file was restored byte-for-byte to that manifest. No
production source or test assertion changed during this verification pass.

| Gate | Result |
| --- | --- |
| `npm run lint`, `format:check`, `type-check`, `type-check:build` | All passed |
| `node scripts/build-embed.mjs --check` | Passed; generated embed is current |
| Full Jest with CI coverage settings | 500 suites and 7,464 tests passed; 2 suites/38 tests retain their standard gates/skips |
| Coverage | Statements 76.55%, branches 70.40%, functions 74.48%, lines 77.26%; all ratchets passed |
| `npm run audit:prod` | Zero vulnerabilities |
| Node replay, Stripe-catalogue, snapshot-measurement and uptime contracts | 68 passed; local fixtures only |
| Full migration replay on PostgreSQL 17 | 16 named suites, 121 passed; the one PostgREST-specific check deferred to the real stack below |
| Real local Supabase 2.117.0/PostgREST preflight | 15 suites, 186 tests passed, no skips; includes secret-column grants, content writes, snapshots, edit sessions, report privileges, credit and founding-capacity checks |
| `npm run build` with disposable local-stack environment | Passed production compilation, TypeScript, generation and route inventory |
| Strict main Playwright run | **99 passed, 0 failed, 0 skipped, 0 flaky**, including both s99 tests |
| Built embed fixture Playwright run | **6 passed, 0 failed, 0 skipped, 0 flaky** |
| Rendered landing and seeded fail/warn/pass reports | All eight renders returned 200 at 390 px and 1440 px; no horizontal overflow or CSP violations; screenshots visually inspected |
| Open Graph image | 200 `image/png`; complete title and description visually inspected |

All planned mutation checks produced failed assertions: same-day-past (2), month-start (3),
cross-block context (2), January grace removed (1), slash dates enabled (2), ambient clock (1),
non-English reported as pass (2), raw counts (1), information-only pass (1), `stale-updated` removed
(3), and `stale-updated` made stale (3). The restored focused suites passed **84/84**.

Local evidence is under `/tmp/s99-gates/`, including per-gate logs, the strict credential-free
`playwright-summary.json`, `mutation-summary.json`, `visual-summary.json`, eight viewport
screenshots and `social-card.png`. Browser reports were directly seeded into disposable local
Supabase and deleted by captured ids. The verifier stopped its owned Next, WebSocket, Redis and
Supabase services afterward. No customer site was scanned, no paid/provider call was made and no
production deployment or merge was performed. Independent final review and the normal story
commit/PR workflow remain separate release steps.
