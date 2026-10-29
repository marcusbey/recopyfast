# Review — s123-owner-seo-guides

Date: 2026-10-25 (Toronto). Independent review of `feature/s123-owner-seo-guides` at
`a75ad209` against main.

## Verdict

PASS-WITH-FIXES: one major, seven minor, plus a set of vendor claims the reviewer could not
confirm (403 over curl). All are resolved on this branch (see Resolution).

## Findings

### MAJOR

1. **Cost sentence misread its source.** `OwnersPage.tsx:103` and `:335` said small website edits
   "typically cost $50–150 each when you pay your developer per change". The cited source
   (WebsiteMaintenance.com) says "Freelancers charge $50 to $150 an hour" — an hourly rate, not a
   per-change price. The code comments (`guides.ts:21`, `OwnersPage.tsx:31`) repeated "hourly / per
   change".

### MINOR

2. **Yext stat paraphrased past its source.** The release says 44% of 1,000+ US respondents had
   visited closed locations in the past year because of inaccurate hours.
3. **Care-plan range attached to "one or two hours of edits".** The sources tie $100–250 a month
   to plans with regular content edits, not to an hour count.
4. **"ReCopyFast is a monthly subscription".** The catalogue sells monthly and yearly
   subscriptions and a one-time lifetime product.
5. **Unsourced claim** that the Squarespace app can edit existing text blocks.
6. **Internal CTA UTMs used `utm_medium=organic`,** which GA4's default channel grouping files as
   Organic Search.
7. **Calculator description** did not match the calculator's inputs or tell an owner how to read
   the result as their own cost.
8. **BreadcrumbList without Home.** `/guides` emitted a one-item list and each guide started at
   Guides.

### Unverified vendor claims

Shopify theme editor steps and Compare-at price; Webflow legacy Editor retirement, `?update` and
Content editor seats; Fiverr "$10–30" small-edit gigs; Bekee and Google JavaScript SEO sources.

## Resolution

| # | Finding | Fix |
|---|---|---|
| 1 | Per-change cost misread | `OwnersPage.tsx:103` now "Freelance web developers typically charge $50–150 an hour, so even a small change can cost more than the edit itself"; `:335` "freelance web developers typically charge $50–150 an hour". Owner-approved headline "Stop paying $75 to fix a typo." kept (half an hour to an hour at that rate). Comments `OwnersPage.tsx:31` and `guides.ts:21` say hourly, quoting the source. The cost guide's description and hub line (`guides.ts:766`, `:768`) say "hourly" instead of "per-change". Test `src/app/for/owners/__tests__/page.test.tsx` asserts the new sentence. |
| 2 | Yext stat | `guides.ts:154`: "44% of 1,000+ US respondents had visited a closed location in the past year because the business hours online were inaccurate", still labelled a 2022 survey commissioned by Yext. |
| 3 | Care-plan range | `guides.ts:786` and the short answer `:770`: "care plans that include regular content edits run about $100–250 a month". |
| 4 | Subscription wording | `guides.ts:879`: "a subscription (monthly or yearly), with a lifetime option" — checked against `src/components/sections/Pricing.tsx` (Monthly/Yearly toggle, Lifetime Pro card) and `/api/pricing` (`oneTimeProducts` with `lifetime_pro`). No price typed. |
| 5 | Squarespace app | Cut. The Squarespace text-blocks help page does not mention the app. `guides.ts:317` keeps the Google Business Profile part only. |
| 6 | UTM medium | `guide-registry.ts:351` emits `utm_medium=guide` (comment at `:347` says why); `guides.test.ts`, `guide-pages.test.tsx` and `docs/stories.md` updated. |
| 7 | Calculator description | `guides.ts:836` lists the real inputs (sites, copy changes per site a month, minutes per change, hourly rate, share of changes billed) and tells owners to set the billed share to 0% — every change unbilled — so the yearly figure is their own cost. The calculator's field is "Share of changes you bill (%)", so "unbilled 100%" is expressed as "billed 0%". |
| 8 | Breadcrumbs | `src/app/guides/page.tsx:50` and `GuidePage.tsx:113` start at Home (`resolveSiteUrl()`): Home → Guides, and Home → Guides → Guide. `guide-pages.test.tsx` asserts both (new test "states a Home → Guides BreadcrumbList"). |

Vendor claims, checked in a real browser on 2026-10-25:

| Claim | Page | Outcome |
|---|---|---|
| Shopify: Online Store → Edit theme → section → Save | Shopify Help, sections and blocks | Verified ("From your Shopify admin, go to Online Store. Find the theme…, and then click Edit theme… click a section name… Click Save"). Kept. |
| Shopify: Products → price → Save; Compare-at price for a sale | Shopify Help, adding and updating products; sale pricing | Verified. Kept. |
| Webflow: legacy Editor retired; clients edit as Content editor with a Workspace seat | Webflow Help, Legacy Editor deprecation FAQ | Verified (fully deprecated 5 Oct 2026; sign-in with a seat on the site's Workspace required). Kept. |
| Webflow: `?update` shortcut, pencil icon, CMS items | Webflow Help, edit site content as a content editor | Verified. Kept. |
| Fiverr: small edits "$10–30" | Fiverr website-editing gigs | Contradicted: small website-edit gigs start around CA$23–59 (shown in CAD), none at $10. Rephrased at `guides.ts:793` to "commonly listed from under $50 (starting prices, checked October 2026)". |
| Bekee: guide for owners whose web person disappeared | bekee.com, "My web guy ghosted me" | Verified (domain, hosting and admin login in the owner's name). Kept. |
| Google: Google runs JavaScript when indexing | Google Search Central, JavaScript SEO basics | Verified. The honesty note (`GuidePage.tsx:245`) now matches the page's own wording, "not all bots can run JavaScript", instead of naming AI tools. |

Also rechecked: Google special hours (steps, 7-day temporary closure), WebsiteMaintenance.com
($35–100 basic, $100–250 with regular content edits, $50–150 an hour) and FatLab.

## Verification

- `npm run lint` — 0 errors (34 pre-existing warnings; `eslint` on the changed files is clean).
- `npm run type-check` — passed.
- `npm run format:check` — passed.
- `npx jest` — 571 suites passed, 1 skipped; 8,520 tests passed, 2 skipped. No failures (the
  known content/[siteId] session flake did not occur).
- `npm run build` — succeeded; `○ /guides`, `○ /for/owners`, and `● /guides/[slug]`
  prerendered with generateStaticParams.
