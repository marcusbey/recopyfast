---
validated: yes (architect, 2026-10-11)
---
# Plan — Story s98-maintenance-cost-calculator

> CTO decision, 2026-10-11. Tool 7, the launch wedge ("Stop doing free copy changes for your
> clients", `docs/prd.md` § GTM strategy).

Branch: `feature/s98-maintenance-cost-calculator` from `origin/main` (`7185da5` or later).
**Independent of s96**: no file of s96's is required, and no scan, API route, table or dependency.
It can merge before or after s96; the merge-order rule is under "Merge points".

Design: `docs/designs/s98-maintenance-cost-calculator.md`: the form, the result, the formula line,
the card preview with `CodeBlock`, inline field errors, 390 px and 1440 px. No research beyond this
plan's citations.

## Where the brief met the code

| Brief | Code says | Adaptation |
|---|---|---|
| "An embeddable result card" | Every response carries `frame-ancestors 'none'` (`src/lib/security/content-security-policy.ts:170`) and `X-Frame-Options: DENY` (`src/middleware.ts:312`). An `<iframe>` of our page is refused by every browser | The card is **copyable HTML** (an `<a>` with inline styles and the numbers baked in), generated in the browser. No iframe and no server image route, so the brief's "client-side only, no API" holds exactly. Weakening `frame-ancestors` for one path was rejected: it would need an ADR 059 amendment for a marketing card |
| "CTA to signup/try" | Marketing → `/signup` must be a native `<a>` (ADR 059 boundary; `src/__tests__/security/app-document-boundary-links.test.ts`). `/try` is desktop only (launch kit §11) | `/signup` via native `<a>` (with `eslint-disable-next-line @next/next/no-html-link-for-pages`, as `src/app/try/page.tsx:69`); `/try` with "on desktop" |
| Time and money output | Launch kit §11: "Customers, testimonials, time-saved numbers. None to quote." | Every number is the visitor's own arithmetic, labelled "Your numbers". No ReCopyFast average, benchmark or "save X%" anywhere |
| Analytics | None exists (launch kit §12) | None added |
| `WebApplication` JSON-LD | `src/lib/seo/json-ld.ts` on `7185da5` has `SoftwareApplication`, `BreadcrumbList`, `FAQPage` only | **Whichever of s96/s98 merges first** adds `buildWebApplicationLd({ url, name, description })` with s96 plan decision 12's exact output; the second reuses it |

## CTO decisions

1. **Pure calculation**, `src/lib/tools/maintenance-cost/calculate.ts`.
   - **Inputs:** `sites` (int 1–500, default 10), `changesPerSiteMonthly` (number 0–50, step 0.5,
     default 2), `minutesPerChange` (int 1–240, default 20), `hourlyRate` (int 0–10,000, default 60),
     `billedPercent` (int 0–100, default 0), `currency` (`USD | EUR | GBP`, default `USD`).
   - **Clamping and coercion:**
     - Inputs are clamped, never rejected, inside the function.
     - Non-finite → the default.
   - **Outputs:**
     - `hoursMonthly = sites × changes × minutes / 60`;
     - `unbilledHoursMonthly = hoursMonthly × (1 − billed/100)`;
     - `unbilledMonthly = unbilledHoursMonthly × rate`;
     - `unbilledYearly = unbilledMonthly × 12`;
     - `changesMonthly`.
   - **Display:**
     - Hours are rounded to 1 decimal; money to whole units through
       `Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 })`.
     - Locale `en-US`, so the pinned copy is deterministic.
   - **Formula:** a human sentence built from the same numbers. "10 sites × 2 changes a month × 20
     minutes = 6.7 hours a month. At $60 an hour with 0% billed, that's $400 a month and $4,800 a
     year."
   - No multiplier the visitor did not type (no "context-switch overhead"): every term is
     explainable.
2. **URL state**, `params.ts`: `?sites=&changes=&minutes=&rate=&billed=&currency=`.
   - `parseParams(searchParams)` reads only these six keys with `Number()` + clamp. Anything else is
     ignored (prototype-shaped keys never touch an object; values are read with `.get`).
   - `serializeParams` writes canonical order.
   - The client updates the URL with `router.replace` (no history spam), debounced 300 ms.
   - `canonical` stays `/tools/website-maintenance-cost`. The page is a static server component
     wrapping `<Suspense>` around the client calculator (`useSearchParams` needs it to stay static).
3. **Card snippet**, `embed-snippet.ts`: `buildEmbedSnippet(result, siteOrigin)` returns a string.
   - **Content:** one `<a>` with inline `style` attributes (no `<style>`, no `<script>`, no class,
     no event attribute) around:
     - an eyebrow, "Free copy changes cost us";
     - the yearly figure;
     - the inputs line;
     - "Calculate yours · ReCopyFast".
   - **Link:** `href` = `${siteOrigin}/tools/website-maintenance-cost?<params>&utm_source=embed&
     utm_medium=card&utm_campaign=free_tools`.
   - **Origin:** `siteOrigin` comes from the server page (`resolveSiteUrl()`) as a prop, never from
     `window.location` (a preview deployment must not hand out its own host).
   - Every interpolation goes through `escapeHtml` even though inputs are numbers and enums (defence
     in depth; the test injects a hostile currency string through a cast).
   - **Preview:** `CostResultCard.tsx` renders the same text through React; a test asserts
     preview text = snippet text.
4. **Copy**, pinned in `copy.ts`:
   - Headline: "What free copy changes cost you".
   - Result label: "Unbilled copy changes, per year".
   - Honesty line: "Your numbers, not ours. ReCopyFast doesn't publish averages or time-saved
     figures."
   - CTA block:
     - "Let clients change their own copy": `/signup?utm_source=tools&utm_medium=
       website-maintenance-cost&utm_campaign=free_tools`, native `<a>`;
     - "See it on one of your sites first" → `/try?utm_…#install`, with "(desktop)".
5. **Accessibility:**
   - Each input has a `Label`, `inputMode="numeric"` (`decimal` for changes), `min`/`max`/`step`,
     and an `aria-describedby` hint.
   - Out-of-range input shows an inline field message ("Between 1 and 500") and uses the clamped
     value. A field never shows NaN.
   - The result sits in a polite live region.
   - No horizontal scroll at 390 px; `CodeBlock` wraps (its `wrap` default).
6. **SEO:**
   - `metadata` with canonical, OG (the static per-tool image), Twitter.
   - JSON-LD `WebApplication`, `BreadcrumbList` (Home › Free tools › page; until s96 merges the
     middle crumb points to `/tools` only if it exists: see merge points) and `FAQPage` over a
     visible 3-question FAQ: how it's calculated, what's not included, what ReCopyFast does.
   - Sitemap and llms.txt per the merge-order rule.
   - OG: `src/app/tools/website-maintenance-cost/opengraph-image.tsx` (`ImageResponse`, the palette of
     `src/app/opengraph-image.tsx`, no gradient). It uses s96's `renderToolOgImage` if s96 has merged,
     else a local copy that s96 then folds in.
7. **Commits:** one story commit (the docs entry already exists through s96's docs commit; if s98
   merges first, the orchestrator adds its stories entry on main before the PR, never in it).

## Tasks (ordered, test-first)

1. [ ] **Calculate.**
   - RED `src/lib/tools/maintenance-cost/__tests__/calculate.test.ts`:
     - defaults → the exact pinned result and formula string;
     - billed 100% → 0;
     - billed 0% → full;
     - changes 0 → 0 with no division;
     - 500 × 50 × 240 × 10,000 is finite and formatted;
     - each bound clamps (below, above, NaN, Infinity, negative);
     - the 0.5 step is kept;
     - EUR/GBP symbols; an unknown currency → USD;
     - rounding (6.666… → 6.7).
   - GREEN `calculate.ts`, `copy.ts`.
2. [ ] **Params.**
   - RED `params.test.ts`:
     - round trip;
     - missing or junk → defaults;
     - `sites=1e9` → 500; `rate=-5` → 0; `currency=JPY` → USD;
     - `__proto__=x&constructor=y` → ignored, defaults, `Object.prototype` untouched;
     - extra keys ignored;
     - serialisation order stable.
   - GREEN `params.ts`.
3. [ ] **Snippet.**
   - RED `embed-snippet.test.ts`:
     - the exact markup for defaults;
     - no `<script`, no `<style`, no `on\w+=`, no `javascript:`;
     - exactly one `<a href="https://…/tools/website-maintenance-cost?…&utm_source=embed…">`;
     - a forced hostile currency is escaped;
     - the origin comes from the argument.
   - GREEN `embed-snippet.ts`.
4. [ ] **Components.**
   - RED `src/components/tools/maintenance-cost/__tests__/CostCalculator.test.tsx` (Testing Library,
     `userEvent`):
     - every input reachable by its label;
     - typing updates the result and the live region;
     - out-of-range shows the field hint and the clamped result;
     - `router.replace` called once after the debounce with the canonical params (mocked router);
     - initial state from `?sites=12&…`;
     - the card preview text equals the snippet's text;
     - the snippet sits in `CodeBlock` with its copy button.
   - RED `CostResultCard.test.tsx`: renders text only.
   - GREEN `CostCalculator.tsx` (`"use client"`), `CostResultCard.tsx`, `EmbedSnippet.tsx`.
5. [ ] **Page.**
   - RED `src/__tests__/app/maintenance-cost-page.test.tsx`:
     - canonical self;
     - JSON-LD parses with `WebApplication`/`BreadcrumbList`/`FAQPage` = the visible FAQ;
     - the honesty line present;
     - forbidden claims absent (`/time.?saved/i`, `/save \d+/i`, "free plan", "free forever",
       "instantly", "any website", "testimonial");
     - the `/signup` link is a native `<a>`;
     - the page module exports no `dynamic = "force-dynamic"`.
   - Add `src/app/tools/website-maintenance-cost/page.tsx` to `MARKETING_BOUNDARY_FILES`.
   - GREEN the page, `opengraph-image.tsx`, `twitter-image.tsx`.
6. [ ] **Discovery** (see merge points).
   - RED: the `sitemap.test.ts` and `llms-txt.test.ts` rows for `/tools/website-maintenance-cost`.
   - If s96 is on main: the catalogue-driven `tools-discovery.test.ts` row.
   - GREEN the one entry.
7. [ ] **Playwright, +1** (`e2e/tools-maintenance-cost.spec.ts`), viewport 390 × 844:
   - open with no params;
   - fill sites 12, changes 3, minutes 20, rate 60, currency EUR;
   - the yearly figure reads "€8,640";
   - the URL holds the params; reload → the same values;
   - the card snippet is in a `CodeBlock`;
   - `document.documentElement.scrollWidth <= 390`;
   - no script CSP violation (s96's `e2e/support/csp-violations.ts` if merged, else a local helper
     that s96 later dedupes).
   - Count +1 over main at rebase, in the three count files.
8. [ ] **Gates and mutations.**
   - Gates as s96 task 14. A build check: the page is static (`○`) in the route table.
   - **Mutations:**
     - drop a clamp;
     - remove `escapeHtml`;
     - read `window.location.origin` for the snippet;
     - remove `Suspense` (the build turns the route dynamic, and a test pins `○`);
     - `/signup` through `Link`.

## Tests added

| Layer | Files | Asserts |
|---|---|---|
| Unit | `calculate`, `params`, `embed-snippet` | Math, clamps, URL safety, snippet inertness |
| Component | `CostCalculator`, `CostResultCard` | Labels, live result, URL sync, preview = snippet |
| Page | `maintenance-cost-page` | SEO, JSON-LD, claims, boundary link, static |
| E2E | `e2e/tools-maintenance-cost.spec.ts`, **+1** | 390 px flow, URL round trip, CSP clean |

## Security notes

- No server surface: nothing to rate-limit, store or SSRF.
- URL params are untrusted. They are parsed to numbers and enums only and never spread into objects.
- The snippet is HTML a visitor pastes into **their** site. It holds only escaped numbers and a fixed
  link, with no script, so it cannot carry anything onto a third-party page. The link's origin is
  server-provided, so a preview deployment never ends up in a pasted snippet.
- The page is static under the marketing CSP. The calculator uses no `eval`, no inline handler
  strings, and no `dangerouslySetInnerHTML` (the snippet is shown as `CodeBlock` text, the preview
  as React).

## Performance budgets

- The page is prerendered static (`○`). Lighthouse mobile ≥ 0.9, LCP ≤ 2.5 s, CLS ≤ 0.1,
  TBT ≤ 200 ms (ADR 013/061 profile, recorded).
- Calculator client JS ≤ 10 KB gz above the marketing baseline: no new dependency, and
  `Intl.NumberFormat` is built in.
- Recalculation is synchronous, under 1 ms. The URL update is debounced 300 ms.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Read as a ReCopyFast savings claim | The honesty line; "Your numbers"; the forbidden-claims test |
| `useSearchParams` makes the route dynamic | `Suspense` boundary, plus the build-table check and a test |
| The pasted card looks wrong on a host's CSS | Inline styles with explicit font, colour, padding and `max-width`; the design shows it on white and dark grounds; the snippet is plain markup a user can edit |
| Some hosts strip `style` attributes | The card still reads as a link with three lines of text (content works unstyled) |
| s96/s98 both touch `json-ld.ts` and discovery | The merge-order rule below |

## Merge points

- **If s98 merges first:**
  - it adds `buildWebApplicationLd` to `src/lib/seo/json-ld.ts`;
  - one `/tools/website-maintenance-cost` row to `buildStaticSitemapRoutes` (`src/app/sitemap.ts`)
    and one link to `buildLlmsTxt` (`src/lib/seo/llms-txt.ts`);
  - a local OG renderer.
  - **s96 then:** reuses `buildWebApplicationLd`, moves the sitemap and llms rows into
    `src/lib/tools/catalogue.ts` (`lens: null`, `kind: "calculator"`), and replaces the local OG
    renderer with `renderToolOgImage`.
  - The breadcrumb's middle item is omitted until `/tools` exists.
- **If s96 merges first:** s98 adds one catalogue entry (`lens: null`), uses `renderToolOgImage` and
  `buildWebApplicationLd`, and touches neither `sitemap.ts` nor `llms-txt.ts`.
- **Either way:** the Playwright count files and nothing else are shared.
- **Files s98 creates:**
  - `src/lib/tools/maintenance-cost/{calculate,params,embed-snippet,copy}.ts` + `__tests__/`;
  - `src/components/tools/maintenance-cost/{CostCalculator,CostResultCard,EmbedSnippet}.tsx` +
    `__tests__/`;
  - `src/app/tools/website-maintenance-cost/{page,opengraph-image,twitter-image}.tsx`;
  - `src/__tests__/app/maintenance-cost-page.test.tsx`;
  - `e2e/tools-maintenance-cost.spec.ts`.

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
