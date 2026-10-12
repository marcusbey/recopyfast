---
validated: yes (architect, 2026-10-11)
---
# Plan — Story s99-outdated-website-checker (short: lens spec + tests)

Branch `feature/s99-outdated-website-checker` from `origin/main` after s96. Uses s96's pipeline
unchanged. Adds: one catalogue entry, one registry line, `src/lib/tools/lenses/outdated/`,
`src/app/tools/outdated-website-checker/` and `e2e/tools-outdated.spec.ts`. No migration, no
dependency, no LLM. Design: the s96 tool-page and report states apply; only copy differs
(`docs/designs/s99-outdated-website-checker.md`, copy-only).

## Lens spec — `outdated`

- **Pages:** `sample: "sitemap"`, max 10 (homepage + 9).
- **Reference date:** `ctx.now` (scan time, UTC), injected; never `new Date()` inside a rule.
- **Text:** `ExtractedPage.blocks`, one block at a time. A context window never crosses a block.
- **Date recogniser** (`dates.ts`, linear, English):
  - `Month D[st|nd|rd|th][,] YYYY`, `D Month YYYY`, `Mon[.] D, YYYY`, `Month YYYY`, ISO
    `YYYY-MM-DD`;
  - ranges `Oct 3–5, 2025` / `3–5 October 2025`, where the end date counts.
  - **Numeric slash dates are ignored in v1** (US/EU ambiguity).
  - Years accepted: 1990 … current + 5.
- **Rules.** Each emits a `Finding` (`kind`, `match`, `before`/`after` ≤ 120, `note`), with
  severity in its kind:

| Kind | Fires when | Never fires on |
|---|---|---|
| `copyright-year` (stale) | `©`/`(c)`/`Copyright` + year or range within 20 chars, latest year < current year; **1–31 January → `copyright-year-grace` (info)** | a © year ≥ current; years in prose without the marker |
| `past-date-upcoming` (stale) | a recognised date < today **and** within ±60 chars in the same block: `upcoming`, `join us`, `register`, `book (now\|your)`, `save the date`, `tickets`, `rsvp`, `reserve`, `apply by`, `deadline`, `ends`, `ending`, `until`, `valid (until\|through)`, `offer`, `sale`, `starts`, `opens`, `opening`, `launch(ing)?`, `coming`, `next` | blog bylines/dates without that wording; `since 2015`; `founded in`; `established`; `last updated` (own rule) |
| `dated-prices` (stale) | `<year> (prices\|pricing\|rates\|menu\|price list\|fees\|catalog(ue)?\|collection\|schedule\|timetable)` or `(prices\|rates\|menu…) for <year>` or a season `20YY/YY` ending < current | the current or a future year |
| `past-future-tense` (stale) | `(coming( soon)?\|launching\|opening\|arriving\|new) (in\|for) <year>` with year < current | — |
| `seasonal-promo-past-year` (stale) | `black friday\|cyber monday\|christmas\|holiday sale\|summer sale\|winter sale\|back to school\|valentine'?s\|easter\|halloween\|new year'?s?` + year < current within 20 chars | the current year |
| `seasonal-promo-out-of-season` (warn) | the same terms **with** sale/offer wording (±60) and **no** year, while today is outside that term's window (table in `seasons.ts`, e.g. Black Friday 15 Nov–5 Dec, Christmas 15 Nov–6 Jan, Valentine's 20 Jan–15 Feb, Easter 1 Mar–30 Apr, Summer 1 Jun–31 Aug, Halloween 1–31 Oct, New Year 15 Dec–15 Jan) | a mention without sale/offer wording ("our Christmas opening hours" stays a mention) |
| `stale-updated` (info) | `(last )?updated:? <date>` more than 2 years before today | — |

- **Dedupe:** `boundFindings` with key `kind|match|before|after`. A footer © on 10 pages is one
  finding, "Also on 9 other pages".
- **Summary:**
  - verdict `pass` (no stale/warn), `warn` (warn/info only), `fail` (≥ 1 stale);
  - headline, e.g. "3 lines look out of date";
  - facts: pages checked, copyright year found, stale / may-be-stale / info counts.
- **CTA:** s96's `ToolCta` ("Fix it on your live page", `/try`, pinned honest copy).

## Tasks (test-first)

1. [ ] **Dates.**
   - RED `src/lib/tools/lenses/outdated/__tests__/dates.test.ts`:
     - every format;
     - ordinals; ranges (end counts); abbreviations with and without a period;
     - invalid days (Feb 30) are refused;
     - slash dates ignored;
     - years out of range ignored;
     - a 200 KB block completes in < 200 ms (linear).
   - GREEN `dates.ts`.
2. [ ] **Rules.**
   - RED `rules.test.ts`, with the reference date fixed at 2026-10-11T12:00Z and per-rule positive,
     negative and boundary rows:
     - `© 2025` → stale; `© 2024–2026` → none; `© 2025` on 2026-01-15 → grace;
     - "Join us on October 10, 2026" → stale, "on October 11, 2026" → none (same day);
     - "Posted October 10, 2026" → none;
     - "2025 prices" → stale; "2026/27 season" → none;
     - "Coming in 2025" → stale;
     - "Black Friday sale" on 2026-10-11 → out-of-season warn; on 2026-11-20 → none;
     - "Black Friday 2025 deals" → stale;
     - "Christmas opening hours" → none;
     - "Last updated March 2, 2024" → info; "since 2015" → none.
   - GREEN `rules.ts`, `seasons.ts`.
3. [ ] **Lens.**
   - RED `outdated-lens.test.ts`:
     - multi-page dedupe with "Also on N other pages";
     - summary verdicts and facts;
     - findings bounded;
     - match/before/after caps;
     - the lens never reads the clock (`jest.useFakeTimers` set to a different date does not change
       results when `ctx.now` is given).
   - GREEN `outdated-lens.ts`, plus a registry line and a catalogue entry (slug
     `outdated-website-checker`, name "Is your website out of date?", lens `outdated`,
     `sample: "sitemap"`).
4. [ ] **Page.**
   - RED `src/__tests__/app/outdated-checker-page.test.tsx`: canonical, JSON-LD
     (`WebApplication`/`BreadcrumbList`/`FAQPage`), the forbidden-claims list, a visible note that
     the check reads the HTML as delivered (copy added by JavaScript is not seen).
   - GREEN `src/app/tools/outdated-website-checker/{page,opengraph-image,twitter-image}.tsx`.
5. [ ] **Playwright, +1** `e2e/tools-outdated.spec.ts`: the tool page renders CSP-clean; a seeded
   report shows a `copyright-year` finding in its sentence and the CTA. Count +1 over main at rebase.
6. [ ] **Gates and mutations:**
   - same-day counted as past;
   - context window crosses blocks;
   - grace removed;
   - the slash-date recogniser enabled;
   - `Date.now()` used in a rule.

## Notes

- Precision first: a date with no upcoming or deadline wording is never flagged. The sentence
  shows the visitor why the line was flagged.
- English month names only. On a non-English page the language gate shared with s96's typo lens
  applies: the lens reuses `isLikelyEnglish(pages)` exported from s96 (a change to s96's typo
  module only if it was not exported there; s96 exports it from `src/lib/tools/lenses/language.ts`
  up front).
- Budget: lens CPU < 50 ms for 10 pages; scan p95 ≤ 20 s (fetch-bound, as s96).

## Architect decisions (2026-10-11)

> Binding answers to the open questions of s96–s101, recorded by the architect when the plans
> were validated. Where they differ from the plan above, they win.


1. Report TTL: 30 days.
2. Global daily cap: 500 scans/day, env override `TOOLS_SCAN_GLOBAL_DAILY_CAP` for launch day.
3. Site-owner opt-out: the scanner fetches and honours `robots.txt` for its user agent (Disallow for `RecopyFastToolsBot` or `*` on the path → refuse with reason `robots_disallowed`, 422, fixed message). "About our scanner" page explains the robots.txt opt-out. The env denylist stays as the operator override. No email address is published until support@ works.
4. Turnstile: deferred to a later story (s96b), built only when the global cap is actually hit.
5. CTA measurement: CTA links carry `utm_source=tools&utm_medium=free_tool&utm_campaign=<slug>`. Capturing UTMs at sign-up is a separate later story.
6. s97 style-src: say plainly the editor's styles need the site's `style-src` to allow our origin; never recommend `'unsafe-inline'`; link /docs/install.
7. s97 per-platform steps: yes, name where custom code goes for Wix, Squarespace, Shopify, Framer and Webflow, each with a link to the vendor's own doc (verified at implementation time).
8. s101 claims-ledger row: the s101 PR adds "Alt Text Checker finds missing, empty or filename-like alt text. It never claims accessibility compliance." to docs/gtm/launch-2026-09-28.md §12.
9. /privacy and /terms: add only factual wording — what a scan processes (the submitted URL without query, public page text, the caller's IP used only for rate limiting and never stored), that reports are public to anyone with the link and deleted after 30 days, and how to opt out (robots.txt).
10. A scan refused by the per-site limit still counts against the caller's daily allowance.
