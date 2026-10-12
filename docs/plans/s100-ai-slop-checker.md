---
validated: yes (architect, 2026-10-11)
---
# Plan — Story s100-ai-slop-checker (short: lens spec + tests)

Branch `feature/s100-ai-slop-checker` from `origin/main` after s96. Adds: one catalogue entry, one
registry line, `src/lib/tools/lenses/ai-slop/`, `src/app/tools/ai-slop-checker/` and
`e2e/tools-ai-slop.spec.ts`. No migration, no dependency, **no LLM, no "written by AI" verdict**:
detectors that say "83% AI" are the competitors' weakness (`docs/gtm/search-and-tools.md` Tool 4).

## Lens spec — `ai-slop`

- **Pages:** `sample: "none"`, max 1 (the homepage: "Does your *homepage* sound like AI?").
- **Phrase list** `phrases.ts`: data, reviewed like copy. Each entry is `{ id, pattern, category,
  weight, why, tryInstead? }`.
  - `pattern` is lowercase words joined by single spaces. The matcher compiles each to a
    word-boundary, whitespace-tolerant, case-insensitive matcher with inflection suffixes from a
    closed list (`-s`, `-ed`, `-ing`, `-ly`, `-less`), declared per entry, never a free regex.
  - **Categories and weights:**
    - `opener` (weight 2): "in today's fast-paced world", "in an ever-evolving landscape", "look no
      further", "whether you're a … or a …" (one fixed gap token), "it's not just … it's …".
    - `buzzword` (1): seamless, elevate, unlock, unleash, empower, leverage, streamline, harness,
      revolutionize, cutting-edge, game-changer, next-level, robust, holistic, synergy, delve,
      tapestry, embark, realm, testament to, navigate the complexities.
    - `filler` (1): "take your … to the next level", "at the end of the day", "we're passionate
      about", "world-class", "best-in-class", "one-stop shop".
  - **Target:** ≥ 80 entries at merge, each with a `why` (≤ 140 chars, plain English: "Says
    nothing a reader can check; name the specific thing that's easy").
- **Skips:**
  - a match inside a capitalised multi-word name mid-sentence ("Elevate Fitness Studio");
  - a match inside the page `title` or `siteName`;
  - a match inside quotation marks longer than 3 words (quoted testimonials are someone else's words).
- **Score:** weighted matches per 100 words of checked text (blocks of tag `h1–h6, p, li, td, dd,
  blockquote, figcaption, button`, the same tags s96 extracts). Pages with < 50 words → `skipped`
  ("not enough copy to score").
- **Bands** (pinned):

  | Score | Band |
  |---|---|
  | < 0.5 | "Reads like a person wrote it" |
  | 0.5–1.5 | "A few stock phrases" |
  | 1.5–3 | "Leans on stock phrases" |
  | > 3 | "Sounds like a template" |

  The headline never contains "AI wrote", "AI-generated" or a percentage.
- **Findings:** `kind` = category; `match` = the phrase as it appears; `before`/`after` = the
  sentence; `note` = `why`; `suggestion` = `tryInstead` when present. `boundFindings` dedupes by
  `id + before + after`.
- **Summary facts:** words checked, stock phrases found, score (1 decimal), band. Share = the
  report URL, plus the tool's static OG. No page text in images.
- **CTA:** s96's `ToolCta`. AI rewrite exists for plan holders. The tool **does not** claim it
  here; the copy stays "Fix it on your live page" with s96's honest sub-line.

## Tasks (test-first)

1. [ ] **Phrase data.**
   - RED `src/lib/tools/lenses/ai-slop/__tests__/phrases.test.ts`:
     - ≥ 80 entries; ids unique; patterns lowercase, trimmed, unique;
     - category ∈ the enum; weight ∈ {1, 2};
     - every `why` ≤ 140 chars and not empty;
     - no pattern is a substring-duplicate of another in the same category;
     - **a "plain copy" fixture** (a synthetic, specific, human homepage) **produces zero matches**.
   - GREEN `phrases.ts`.
2. [ ] **Matcher.**
   - RED `matcher.test.ts`:
     - case-insensitive;
     - word boundaries (`leverages` matches when `-s` is declared; `cleverage` never);
     - curly apostrophes; line breaks inside phrases;
     - the brand skip (mid-sentence Capitalised run);
     - the quote skip;
     - title/siteName skip;
     - a 200 KB page completes in < 200 ms;
     - no regex built from page text.
   - GREEN `matcher.ts`.
3. [ ] **Score and lens.**
   - RED `ai-slop-lens.test.ts`:
     - band boundaries exactly (0.49 / 0.5 / 1.5 / 3.0 / 3.01);
     - < 50 words → skipped;
     - the weight-2 opener counted twice;
     - findings bounded and deduped;
     - **no output string matches `/written by ai|ai-generated|\d+\s?% ai/i`** (headline, facts,
       notes).
   - GREEN `score.ts`, `ai-slop-lens.ts`, plus a registry line and a catalogue entry (slug
     `ai-slop-checker`, name "Does your homepage sound like AI?", lens `ai-slop`, `sample: "none"`).
4. [ ] **Page.**
   - RED `src/__tests__/app/ai-slop-checker-page.test.tsx`: canonical, JSON-LD, FAQ including "Does
     this tell me whether AI wrote my page? No…", forbidden claims, the band table visible.
   - GREEN `src/app/tools/ai-slop-checker/{page,opengraph-image,twitter-image}.tsx`.
5. [ ] **Playwright, +1** `e2e/tools-ai-slop.spec.ts`: CSP-clean tool page; a seeded report shows
   the score fact and a highlighted phrase with its `why`. Count +1 over main at rebase.
6. [ ] **Gates and mutations:**
   - weight ignored;
   - the brand skip removed (the fixture "Elevate Fitness" goes red);
   - the band boundary off by one;
   - a "% AI" string added to the headline.

## Notes

- Risk: the list reads as opinion. Mitigation: every entry carries a concrete `why`; the FAQ says
  these are phrases, not authorship; the list is reviewed like copy (the owner signs off in the PR).
- Budget: lens CPU < 30 ms per page; one-page scan p95 ≤ 8 s.

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
