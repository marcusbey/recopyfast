---
validated: yes (architect, 2026-10-11)
---
# Plan — Story s101-alt-text-checker (short: lens spec + tests)

Branch `feature/s101-alt-text-checker` from `origin/main` after s96. Adds: one catalogue entry, one
registry line, `src/lib/tools/lenses/alt-text/`, `src/app/tools/alt-text-checker/` and
`e2e/tools-alt-text.spec.ts`. No migration, no dependency, **no LLM and no vision suggestions in
v1**.

## Verified on `origin/main` (changes the CTA)

- **The embed edits alt text.**
  - `applyContentToElement` writes `alt` for `IMG` (`public/embed/recopyfast.src.js:3692`).
  - The editor has an alt input (`:5176`) and sets `element.alt = newAlt` (`:5365`).
  - The server bounds it (`MAX_CONTENT_ALT_LENGTH = 2000`, `src/lib/api/validation.ts:223`).
- **The `/try` preview does not edit alt text.** Every `alt` match in `public/try/rcf-try.js` is
  `altKey` (`:105-117`, `:425-427`, `:537-538`).

So the s96 "Fix it on your live page → /try" CTA would be untrue here. s101 uses its own pinned CTA:
- **Label:** "Fix alt text on your live page".
- **Sub-line:**
  > "With ReCopyFast installed, click an image to edit its alt text. The change is published to the
  > live page, and visitors and screen readers get it on their next page load."
- **Links:** `/signup` (native `<a>`) and `/docs/install`. **No `/try` link.**
- **Precondition:** a claims-ledger row ("the editor edits an image's alt text", with the lines
  above as evidence) is added to `docs/gtm/launch-2026-09-28.md` §12 before the PR is ready. The
  ledger is the owner's document, so the row is proposed in the PR description and committed by
  the owner or orchestrator.

## Lens spec — `alt-text`

- **Pages:** `sample: "sitemap"`, max 10.
- **Input:** `ExtractedPage.images` (s96: absolute `src` with the `data-src`/`srcset` fallback,
  `alt: string | null`, `role`, `ariaHidden`, `width`/`height`, `inLink`, `linkHasText`).
- **Classification**, first match wins (`classify.ts`):
  1. `skip-pixel`: `width` and `height` both ≤ 2. Excluded from everything.
  2. `decorative`:
     - `role` ∈ {presentation, none} or `ariaHidden`;
     - or `alt === ""` and not (`inLink && !linkHasText`).

     Valid; excluded from the coverage denominator; listed only as a count.
  3. `linked-empty` (fail): `alt === ""` or `null` on an image that is the only content of a link.
     The link has no accessible name.
  4. `missing` (fail): `alt === null`.
  5. `filename` (fail), any of:
     - ends `.(jpe?g|png|gif|webp|avif|svg)`;
     - `^(img|dsc|dscn|pxl|photo|image|screenshot|untitled)[-_ ]?\d+`;
     - ≥ 8 hex characters with no space;
     - snake/kebab case with digits and no space.
  6. `generic` (warn): the trimmed, lower-cased alt is exactly one of `image`, `picture`, `photo`,
     `graphic`, `banner`, `icon`, `logo`, `img`, `thumbnail`, `placeholder`.
  7. `long` (info): > 150 characters.
  8. `ok`.
- **Coverage:** `(ok + long) / (all unique images − skip-pixel − decorative)`, over **unique
  `src`s** (a logo on 10 pages counts once), rounded to a whole %. If there are no non-decorative
  images, the verdict is `info`: "No content images found".
- **Findings:**
  - `kind` = class;
  - `match` = the alt or "(no alt)";
  - `before`/`after` = "" (an image has no sentence);
  - `note` = the plain-English reason;
  - `imageSrc` = `src` only when `https:`.

  `boundFindings` dedupes by `src`, "Also on N other pages".
- **No thumbnails in v1** (s96's `FindingList` rule): each image shows its filename and a "View
  image" link (`https` only, `rel="noopener noreferrer nofollow ugc"`), **never an `<img>`**. A
  hotlinked thumbnail would hand every report viewer's IP to the scanned site (s96 analyst finding).
  `http:` and `data:` sources show the filename only. A thumbnail proxy through s96's guarded
  fetcher (re-encoded, size-capped) is a follow-up if the list proves hard to read.
- **Summary:**
  - verdict: `pass` (coverage 100% and no fail), `warn` (coverage ≥ 80% or warn-only), `fail`;
  - facts: pages checked, images checked (unique), coverage %, missing, filename, linked-empty,
    generic, decorative.
- **Disclaimer**, pinned in `copy.ts` and rendered on the tool page **and** every alt-text report:
  > "This checks alt text only. It is not an accessibility audit and does not show WCAG, ADA or EAA
  > compliance."

## Tasks (test-first)

1. [ ] **Classify.**
   - RED `src/lib/tools/lenses/alt-text/__tests__/classify.test.ts`: one row per class and its
     boundaries:
     - 2 × 2 → pixel, 3 × 2 → not;
     - `alt=""` in a link with text → decorative, in a link without text → linked-empty;
     - `IMG_2041.JPG`, `dsc-0042`, `a3f9c2e1b7`, `hero_banner_2` → filename;
     - `Logo` → generic; `Acme logo` → ok;
     - 151 chars → long;
     - `role="none"` with no alt → decorative.
   - GREEN `classify.ts`.
2. [ ] **Lens.**
   - RED `alt-text-lens.test.ts`:
     - unique-src coverage (a 10-page logo counts once);
     - the denominator excludes decorative and pixel images;
     - zero content images → info;
     - verdict thresholds;
     - `imageSrc` only for `https`;
     - findings bounded and deduped;
     - **no summary or note string matches `/complian|wcag|ada|eaa/i`** (the disclaimer lives in page
       copy, not in lens output).
   - GREEN `alt-text-lens.ts`, plus a registry line and a catalogue entry (slug `alt-text-checker`,
     name "Alt Text Checker", lens `alt-text`, `sample: "sitemap"`, `cta: "alt-text"`).
   - s96's catalogue type carries `cta: "fix-on-page" | "alt-text"` from the start; `ToolCta`
     renders the variant. This is the one s96 contract s101 relies on.
3. [ ] **Page and CTA.**
   - RED `src/__tests__/app/alt-text-checker-page.test.tsx` and a report-page case:
     - the disclaimer is present on both;
     - **after removing the disclaimer sentence, no rendered text matches `/complian/i`**;
     - the CTA has no `/try` link, and its `/signup` link is a native `<a>`;
     - canonical, JSON-LD and FAQ ("Does this make my site accessible? No…").
   - GREEN `src/app/tools/alt-text-checker/{page,opengraph-image,twitter-image}.tsx`, `copy.ts`.
4. [ ] **Playwright, +1** `e2e/tools-alt-text.spec.ts`:
   - the CSP-clean tool page;
   - a seeded report (a nonce document) shows a coverage fact, a `missing` finding with its
     filename and a "View image" link, and the disclaimer;
   - **no request leaves for the scanned image host** (`page.on("request")` sees none).

   Count +1 over main at rebase.
5. [ ] **Gates and mutations:**
   - decorative counted in the denominator;
   - an `http:` `imageSrc` allowed;
   - `imageSrc` rendered as `<img>`;
   - the disclaimer removed;
   - a `/try` link added to the alt-text CTA.

## Notes

- **Privacy:** no thumbnails, so viewing a report sends nothing to the scanned site. A visitor who
  clicks "View image" opens it themselves, without a referrer.
- **Optional vision suggestions** (GTM doc: ≤ 5 images, hashed cache) are out of v1: they need an
  LLM budget, credits policy and a claims review.
- Budget: lens CPU < 20 ms for 10 pages × 200 images; scan p95 ≤ 20 s (as s96).

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
