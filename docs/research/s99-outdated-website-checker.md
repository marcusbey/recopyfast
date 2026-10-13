# Research — Story s99-outdated-website-checker

Verified against `origin/main` at `bc6e503` on 2026-10-12. This was a repository-only review: no
production access, third-party website scan, provider call or package installation was used.

## Pipeline warning

`docs/reviews/stories.md` still ends with `Stories ready: no` and predates the October free-tools
portfolio. The parent lane is reconciling the PRD and running a fresh stories review. This research
continues under that explicit framing work; it does not claim the backlog review has passed.

## Premise verdict

The s96 scan and report platform is present and is the correct base for s99, but the existing s99
plan contains a false premise:

> `isLikelyEnglish(pages)` does not exist.

`src/lib/tools/lenses/language.ts` exports
`isLikelyEnglish({ lang, words, isKnown })`. The caller must provide tokenized lower-case words and
a dictionary predicate. The working precedent is the Typo Finder:

- `tokenizeBlock(text)` and `reduceContraction(word)` are exported from
  `src/lib/tools/lenses/typos/tokenize.ts`;
- `getDictionary()` and the `Dictionary` interface are exported from
  `src/lib/tools/lenses/typos/dictionary.ts`;
- `analyzeTypos` builds language evidence per page, injects the dictionary in tests and reports a
  skipped page rather than treating non-English text as clean.

s99 can use that public boundary without changing the shared helper or the Typo Finder. Its lens
should build its own page evidence, then call `isLikelyEnglish` with the actual signature.

## Story contract

The story is deliberately narrower than a general freshness audit. It checks only:

1. a copyright year behind the current year, with January 1–31 treated as information;
2. a past date near language that still presents it as upcoming, bookable or a deadline;
3. a year-stamped price/menu/rate/schedule whose final year has passed;
4. “coming/opening/launching/new in <past year>” wording;
5. a seasonal promotion tied to a past year, or an undated seasonal sale outside its broad season;
6. a `last updated` date more than two calendar years behind the reference day, reported as
   information rather than a stale verdict.

Numeric slash dates stay ignored. Blog dates and historical phrases such as “since 2015” and
“founded in 2015” stay unflagged. `stale-updated` is preserved from the architect-reviewed plan;
the parent framing lane will align the story acceptance criteria before final pipeline approval.

## Current implementation

### Scan pipeline

`src/lib/tools/scan/run-scan.ts:146-279` already supplies the required execution model:

- `Lens.pages = { sample: "sitemap", max: 10 }` fetches the homepage and at most nine sampled
  pages;
- the scan creates one `LensContext` with the injected `now`, final URL and hostname;
- lens-level skipped pages are carried into the stored report;
- the report schema, 12 KB compact limit and 40-finding limit are shared.

The lens must not fetch, read the clock or store a second report shape.

### Extracted text

`ExtractedPage.blocks` is the correct input. `extract-page.ts` caps each block at 2,000 characters,
all page text at 200 KiB and the page at 2,000 blocks. Script, style, template, code-like and hidden
content is excluded, except for the resolved React/Next streamed segment added in s96c. The page's
JavaScript is never executed.

A rule can inspect at most one block at a time. Passing a whole page or adjacent block into a
60-character context search would violate the acceptance criterion and manufacture relationships
between unrelated pieces of copy.

### Language boundary

The compatible boundary is:

1. tokenize each block with `tokenizeBlock` so URLs, paths, handles and file-like chunks are blanked
   exactly as the existing free-tool language check expects;
2. use only blocks with at least four tokens as language evidence, avoiding menus and short labels;
3. ignore tokens touching a digit, reduce contractions with `reduceContraction`, keep lower-case
   words of at least three characters, including Unicode words;
4. call `isLikelyEnglish({ lang: page.lang, words, isKnown: dictionary.isKnown })` per page;
5. obtain the production dictionary through lazy `getDictionary()` once per isolate, while exposing
   a `Dictionary` parameter on `analyzeOutdated` so unit tests use a small deterministic fake.

The shared helper deliberately gives fewer than ten evidence words the benefit of the doubt. That
is useful here: a short page containing “© 2025” should still be checked unless its `lang` declares
another language. A skipped French page must not cause English sibling pages to be skipped.

### Lens and report contracts

`src/lib/tools/lens.ts` supplies all required output fields:

- `createFinding` cleans attacker-chosen text and caps `match` at 80 characters and each side of
  the context at 120;
- `boundFindings` collapses a repeated footer finding across pages and appends “Also on N other
  pages.”;
- `LensSummary` supports `pass`, `warn`, `fail`, `info` and `skipped`, with at most eight facts;
- `findingsTruncated` is distinct from report-size trimming and must be set when more than 40
  distinct findings exist.

s99 has eight finding kinds. The unchanged eight-fact ceiling still fits without a schema change:
Pages checked, one combined Copyright years fact that states stale and January-grace counts
separately, then one fact for each of the other six kinds.

The verdict states can be made mutually exclusive:

- `skipped`: no page passed the language gate;
- `fail`: at least one clearly stale finding;
- `warn`: no stale finding, but at least one seasonal warning, January-grace information finding or
  old `last updated` information finding;
- `pass`: at least one page checked and no finding of any kind.

A fail headline counts stale findings only; warning and information findings remain visible in the
same report and in their facts without being described as out of date. A warn headline counts its
warning and information findings.

This removes the old ambiguity where “pass (no stale/warn)” also described an info-only report.
The repaired choice preserves the existing plan's `warn (warn/info only)` intent: any surfaced line
gets a review state, while `pass` means the lens found nothing. That choice and the month-end
precision rule below are explicit changes for the fresh human validation checkpoint.

### Discovery, SEO and UI

`src/lib/tools/catalogue.ts` is the single discovery list for `/tools`, sitemap, `/llms.txt` and
report slug validation. A scanning tool adds one catalogue entry with a lens id and one matching
line in `src/lib/tools/lenses/registry.ts`; `tools-discovery.test.ts` pins the relationship and the
existence of the tool page.

The UI should compose the existing pinned-light marketing surface:

- `ToolPageLayout` owns the header, breadcrumb, title, visible FAQ and matching JSON-LD;
- `ToolScanForm` owns idle, scanning, error and successful navigation behavior;
- the generic report page already renders verdict facts, findings in context, partial/truncated
  alerts, skipped pages and the `fix-on-page` CTA;
- `og-image.tsx` supplies the established solid, no-gradient social-card treatment.

No story-specific report component is needed. The tool page needs story-specific copy and structured
data, while the report remains the generic s96 renderer.

## Date and rule traps

1. **UTC is part of the contract.** Derive the reference calendar day and current year only from
   `LensContext.now` using UTC accessors. Do not call `new Date()` or `Date.now()` inside a rule.
2. **Precision matters.** A day-precision date is past only before the reference UTC day. A
   month/year date is past only after the final UTC day of that month; treating it as the first day
   would flag “October 2026” during October.
3. **Ranges use the end.** `Oct 3–5, 2025` becomes past only after October 5. A year range such as
   `2026/27 prices` uses 2027 as its final year.
4. **Calendar validity must round-trip.** JavaScript normalizes February 30 into March; the parser
   must reject it instead.
5. **Old update labels use a calendar threshold.** Shift the reference UTC date back two calendar
   years and fire only when the recognized date's end is strictly earlier. Exactly two years old is
   not “more than two years,” and a month/year value uses that month's final day.
6. **Season windows can cross New Year.** Christmas and New Year ranges need explicit wrap-around
   logic under UTC.
7. **Regexes see public attacker-controlled text.** Patterns must be bounded and linear. The
   production block cap is 2,000 characters, while a larger synthetic performance fixture can pin
   the helper against catastrophic backtracking.
8. **Counts use distinct findings.** A repeated footer across ten pages is one reported line with an
   occurrence note, not ten stale lines in the headline.

## Existing verification anchors

- `src/lib/tools/lenses/typos/__tests__/typo-lens.test.ts` demonstrates injected dictionaries,
  per-page skipped reasons, ordered findings, distinct-count summaries and truncation.
- `src/lib/tools/__tests__/lens.test.ts` pins sanitization, caps and multi-page deduplication.
- `src/__tests__/app/tools-discovery.test.ts` pins catalogue/registry/page parity.
- `src/__tests__/app/tools-pages.test.tsx` pins canonical metadata, visible FAQ parity, JSON-LD and
  forbidden claims.
- `src/__tests__/app/tool-report-page.test.tsx` pins the generic report, public-link retention copy,
  service-role read boundary and CTA.
- s96's browser test pattern seeds the report directly; s99 needs no third-party network in E2E.

## Complexity

The story was scored 2 before its code was read. The verified score is **3**: the UI is routine, but
the date parser has multiple precisions and range forms, the seasonal calendar wraps across years,
and language classification must use the real tokenizer/dictionary boundary without coupling the
result to the system clock. The work still fits one story and a six-task plan.

## Open questions

- The portfolio's fresh stories review is still pending in the parent framing lane. That is a
  release-pipeline gate, not an implementation decision for this branch.
- The repaired plan asks one human checkpoint to validate two previously implicit precision choices:
  month/year dates use their final day, and any warning/information finding produces `warn` rather
  than `pass`. Both favor the precision-first product promise and have explicit boundary tests.

Research ready in docs/research/s99-outdated-website-checker.md. Next step: /ks-design s99-outdated-website-checker
