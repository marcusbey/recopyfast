# Research — Story s123-owner-seo-guides

Date: 2026-10-25. Inputs: `.omc/gtm/research/site-owner-angle-2026-10-22.md` (main checkout,
read-only; "the brief" below), the current code on `origin/main` (`6eeedceb`), Google's public
suggest endpoint, and vendor help pages fetched or searched on 2026-10-25.

## Search intent: why these five pages

The brief's verdict on SEO was blunt (§6 "SEO intent", experiment 6): owner demand for "an editing
layer" is low, owners search **platform-specific** questions, and SEO is a slow channel. The owner
asked for the pages anyway, so they are built to be useful to the searcher whatever they buy:
answer first, platform by platform, and say "you don't need us" where a built-in editor is enough.
That is also the only version of these pages that can rank for platform-shaped queries.

| Page | Searcher | Brief evidence |
|---|---|---|
| Update website hours | Owner whose hours just changed; holiday season | §2 GBP row: hours live in Google Business Profile; Yext 2022 (wrong hours cost visits) |
| Edit WordPress text without Elementor | WordPress owner with admin, afraid of the builder | §4 "best self-serve segment"; experiment 3 asks for exactly this page |
| Change prices yourself | Restaurants (menus, PDFs), services | §1 r/restaurantowners threads are about menus/PDFs; autocomplete "how to change price on website" |
| Edit a website someone else built | Owner whose site was built by someone else | §1 rows 9–13 (ownership, ghosted); §5 "my developer disappeared" answer; §4 handoff |
| Small website change cost | Owner deciding whether to keep paying | §2 cost table ($50–150/hr, $100–250/mo with edits) |

## Keyword evidence (hypotheses, free endpoint only)

`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=…`, 2026-10-25.
Autocomplete shows that a phrase is searched, not how often; treat each line as a hypothesis.

- "update website hours" → only Google/Apple Maps/Facebook/Yelp variants ("update business hours
  on google"). Supports leading the hours guide with Google Business Profile and listing other
  places in the checklist.
- "how to update holiday hours on" → google, google business profile, apple maps, yelp, square.
- "edit wordpress without elementor" → itself, "wordpress edit page without elementor".
- "how to edit text on wordpress" → website, front page, homepage, "…in wordpress elementor".
- "how to change prices on my website" → "how to change price on your godaddy website", "how to
  change price on website".
- "how to edit a website someone else built" → "…created by someone else", "…that isn't yours",
  "…an existing website".
- "how much does it cost to update a website" → itself, uk, change, upgrade, "…should i charge".
- "edit wordpress text without", "website someone else built" → no suggestions.

No paid tool was used; no volume numbers are claimed anywhere.

## Vendor facts used, and where they come from

Checked 2026-10-25; each is cited on the guide that uses it.

- Google Business Profile special hours: Edit profile → Hours → Special hours; "Open with main
  hours" requirement; confirm holidays; temporarily closed for 7+ days
  (support.google.com/business/answer/6303076).
- GBP menu editor (food and drink; 24–48 h to show) and services editor
  (answer/9455840, answer/9455399).
- Squarespace text blocks edited on the page, Save (support.squarespace.com …/205813798).
- Wix: double-click a text box to edit; more than one editor exists (support.wix.com, Harmony
  Editor text article). Kept generic for that reason.
- Shopify: Products → product → price → Save; variants; Compare-at price; theme sections via
  Online Store → Edit theme, depending on theme (help.shopify.com).
- WordPress revisions: saved on each update; slider; Restore (wordpress.org/documentation/article/revisions).
- Webflow: legacy Editor retired; clients edit as a Content editor with a Workspace seat; pencil
  icon; `?update` opens a page for editing (help.webflow.com, two articles).
- Elementor recommends not switching back and forth between its editor and the WordPress editor
  (elementor.com/help/changes-dont-appear-online). Paraphrased, not quoted.
- Not verified, therefore generic: WordPress footer location (theme-dependent), staging (described
  as "ask your host"), Elementor's own history panel (not mentioned).

## Codebase findings

- `/guides` is free: no route, redirect or rewrite uses it. `/blog` is DB-backed AI drafts
  (ADR 057) and `/docs` is product documentation, so neither fits typed owner content.
- The compare cluster is the template (ADR 012): typed registry + runtime validator,
  `[competitor]` route with `dynamicParams = false`, sitemap/llms.txt read the registry, shared
  JSON-LD builders. It uses the root `/opengraph-image`; no per-page OG images exist, so guides
  reuse it too.
- No `Article` builder exists in `src/lib/seo/json-ld.ts`; ADR 012 §3 says shared builders go there.
- ADR 013's gate is the comparison Lighthouse workflow; its URLs come from a registry helper
  (`buildComparisonLighthouseUrls`). ADR 013 says later clusters extend the same list. The job
  is not a required status check, so renaming it is safe.
- GA's page allowlist (`isAnalyticsRoute`) says a new public page joins on purpose; the privacy
  page lists the measured page groups in words.
- `app-document-boundary-links.test.ts` lists marketing files that may link to app routes;
  `/signup` must be a native anchor (ADR 059).
- Copy rules come from `OwnersPage.tsx` (s120): no "take control", no SEO promise, redesign
  caveat ("we don't warn you about that yet", until PR #119), Pro for draft approval, "Start your
  free trial", no price typed (OwnerStarterPrice reads `/api/pricing`). The founding offer is
  live catalogue data, so the guides do not restate it.
