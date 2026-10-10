# Review: s37-comparison-pages (re-review after fix `ba25a30`)

## Scope and verdict

This is a fresh-context `/ks-review` of `git diff origin/main...HEAD` on
`feature/s37-comparison-pages` (draft PR #34). The fix commit `121c9c4..ba25a30` was also
read on its own.

- Head: `ba25a30`, the same as the PR head. Merge base: `c3b2b28`, which is current `origin/main`.
- The diff touches 22 files: +2,316 / −7. The fix commit alone touches 20 files: +808 / −137.
- I checked it against the plan (including fix tasks F1–F6), the research and design records,
  AGENTS.md, the PRD SEO section, and ADRs 012, 013, 020 and 029.
- I re-fetched every competitor source on 2026-09-25. The Duda and Webflow help-centre pages
  return 403 to a direct fetch, so I read the same article IDs through the Zendesk Help Center
  API.
- The previous review (C1 critical, M1 and M2 major, m1–m9 minor) was preserved byte-for-byte
  until this rewrite. Its SHA-256, `79765b7c…812dc`, matched the value the fix run recorded.

**Status of the earlier blockers:**

- **C1 is fixed.** The Duda page no longer says "per-site capacity to client seats". The
  replacement is supported by Duda's own pricing page, and a test pins the old line's absence.
- **M1 is fixed.** Every comparison table, every "When to choose {competitor}" section, the
  Integration boundaries block and the index now say that ReCopyFast applies published edits in
  the browser after load. They also say that visitors without JavaScript, and crawlers that do not
  render it, see the original HTML. The competitor's served-HTML delivery is credited as its
  advantage. This matches `public/embed/recopyfast.src.js`.
- **M2 is fixed.** Offers now come from the live catalogue and the Founding availability
  aggregate, per request. I proved this at runtime:
  - The same production build renders "Agency checkout is currently unavailable" and no
    offer when `AGENCY_CHECKOUT_ENABLED=false`, and does not touch the database.
  - It renders "Agency pricing is temporarily unavailable" when the switch is on and the
    database is unreachable.
  - A temporary test ran the real `plans.ts` and `founding-agency.ts` against mocked database
    rows. It rendered the live $49 / 10-site and $299 offers, with "12 of 50" spots remaining.
    When the aggregate reported sold out, it rendered "Founding Agency is sold out" and no $299.

**One new major (N1).** The fix recorded the `/compare` route change by editing the body of
accepted ADR 020. AGENTS.md makes ADRs immutable: a change needs a superseding ADR.
`docs/decisions/errata.md` repeats that no ADR body is ever mutated. This is a docs-only rule
violation. It is cheap to fix, and it should be fixed before merge, because the story commit
squashes onto `main`.

**Minors:**

- Two competitor claims are imprecise: n1 (Duda) and n2 (TinaCMS).
- Most competitor rows are still not pinned by tests (n3).
- The detail pages are uncached per request (n4).
- The comparison price source differs from the `/#pricing` feed (n5).
- `SoftwareApplication` JSON-LD is still missing (n6).
- One duplication nit (n7).

## What I ran (results observed here, not taken from the PR)

| Check | Result |
| --- | --- |
| The 3 focused suites (`comparison-pages`, `comparison-discovery`, `comparison-pricing`), run through the CI placeholder wrapper on Node 20.15.1 | 3 suites and 21 tests passed |
| Full Jest, `--ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, same wrapper | 236 suites passed + 2 skipped (238); 3,111 tests passed + 38 skipped (3,149); **0 failed**; 63 s |
| `next build`, same wrapper | Passed. `/compare` is static (`○`); the four detail pages and `sitemap.xml` are dynamic (`ƒ`) |
| ESLint `--max-warnings=0` and Prettier `--check` on the 13 changed TS/TSX files | Both clean |
| `next start` with the switch on (default) and the placeholder DB | All 5 routes return 200. `/compare/nope` returns 404. `sitemap.xml` returns 200. Details below |
| `next start` with `AGENCY_CHECKOUT_ENABLED=false`, same build | All 4 detail pages say "Agency checkout is currently unavailable". None contains `$49`, `$299`, "lifetime", "Founding" or "/month". There are 0 pricing error logs, so no DB call was made |
| Temporary integration test: real `plans.ts` and `founding-agency.ts`, mocked service client. Deleted afterwards | Available, sold-out and kill-switch cases all correct (3/3). The file was removed and `git status` showed only this review |
| Rendered HTML, parsed with `json.loads` | Details in the SEO section below |
| Production `/api/pricing` (public GET) | Agency is 49 for 10 websites. `lifetime_agency` is 299. Founding: `{remaining: 50, soldOut: false}`. `source: "stripe"`. `/compare` is 404 on production (not deployed yet) |
| `gh pr checks 34` (run once) | All pass: Lint, Test & Build; TypeScript Type-Check; **E2E (Playwright) 5m26s**; realtime audit; Vercel. CodeRabbit skipped (draft) |
| `git diff --exit-code -- src` after every neutralization | Clean each time |

## Prior findings → status

| # | Prior finding | Status | Evidence |
| --- | --- | --- | --- |
| C1 | Duda "per-site capacity to client seats" contradicted by the cited source | **Fixed** | See below |
| M1 | Browser-applied delivery not disclosed | **Fixed** | See below |
| M2 | Hardcoded Agency/Founding offer ignored the kill switch | **Fixed** | See below |
| m1 | "Per-site client accounts" imprecise for Duda | **Fixed**, with one new imprecision (n1) | See below |
| m2 | Webflow "draft to explicit publish" implied Webflow lacks it | **Fixed** | See below |
| m3 | Tests did not pin legally important claims | **Partly fixed** (n3) | See below |
| m4 | Sitemap written by hand | **Fixed** | See below |
| m5 | Route decision not recorded | **Fixed, but by breaking a repo rule** (N1) | See below |
| m6 | Story docs contradicted the delivered state | **Fixed** | See below |
| m7 | Doubled brand in title; no BreadcrumbList; no `aria-current` | **Mostly fixed** (n6) | See below |
| m8 | Editorial prices had no explanatory comment | **Fixed** | See below |
| m9 | No UTM on `/signup` | **Fixed** | See below |

**C1.**

- The line is gone. `comparisons.ts:168` now says: "You need focused copy editing for sites that
  remain on their current hosting rather than rebuilding them in Duda."
- Duda's pricing FAQ supports this in two places:
  - "All websites built on Duda are hosted by Duda"
  - "we recommend rebuilding it in Duda using our Import Content feature"
- A test asserts the old line is absent. Reintroducing it turns 1 test red.

**M1.**

- The row "How published edits reach visitors" is on all four pages: `comparisons.ts:107-112`,
  `:193-198`, `:285-290` and `:369-374`.
- `servedHtmlAdvantage()` (`:60-62`) appears in every `competitorFit`, so each "When to choose
  {competitor}" section carries the disclosure.
- It also appears in the Integration boundaries block (`ComparisonPage.tsx:228-237`) and on the
  index: the table (`compare/page.tsx:175-178`, `:193-197`) and both choice cards (`:216-221`,
  `:231-234`).
- It is accurate against the embed:
  - The widget waits for DOMContentLoaded (`recopyfast.src.js:890`, `:2592-2599`).
  - It waits for fonts, then scans, then fetches and applies stored content (`:908-918`).
  - `hydrateStoredContent` (`:3626-3638`) says so itself: "FOUC: unavoidable for a client-side
    widget".
  - There is no server-side delivery path.
- Optional: add "visitors may briefly see the original copy" for JavaScript visitors.

**M2.**

- `loadComparisonPricing()` (`comparison-pricing.ts:26-71`) calls `isAgencyCheckoutEnabled()`
  first (`plans.ts:101-103`), then `getPlanCatalogue()` (`plans.ts:429`) and
  `getFoundingAgencyAvailability()` (`founding-agency.ts:46-61`).
- The copy covers five states: available, sold out, availability unknown, unavailable and
  disabled (`ComparisonPage.tsx:63-83`).
- The detail pages use `force-dynamic`. That the build output depends on runtime env is proven
  above.
- No `$49` or `$299` remains in `src/app/compare`, `src/components/compare` or `src/lib/compare`.

**m1.**

- Rows `:184` and `:202` and FAQ `:217` now say the accounts are unlimited, assigned to sites,
  with per-site permissions on Team plans and higher, and that clients set passwords.
- All of that matches Manage Clients (updated 2026-09-18).

**m2.**

- The ReCopyFast fit is now "You want invited clients to edit without a Webflow seat or account"
  (`:82`). That is true: Webflow requires a seat and an account.
- The Publishing row now credits Webflow's drafts and its staging and production publishing
  (`:104`).

**m3.**

- Now pinned: the ReCopyFast editor-access text, the delivery text, the live price, sold-out
  and disabled copy, exact FAQ question-and-answer pairing, and the Duda correction.
- Still unpinned: most competitor claims (n3).

**m4.**

- `sitemap.ts:40-47` maps `comparisonList`, and the test compares against `comparisonList`.
- Dropping one entry turns 1 test red.

**m5.**

- The PRD (`:294`, `:304-306`, `:453`), `design-system.md:57` and `:64`, the s17 design and the
  story entries now say `/compare`.
- ADR 020 was changed by editing its body (N1).

**m6.**

- The plan boxes and "Verification status", the research ("Initial local blocker and subsequent
  delivery") and the `stories.md` boxes now match the draft delivery.
- The research's gate numbers match my run: 236/3,111 and a build with `/compare` static and the
  detail pages dynamic.

**m7.**

- `title: { absolute }` renders `<title>ReCopyFast vs Duda</title>`.
- BreadcrumbList parses and is correct.
- `aria-current="page"` is on the breadcrumb span and on the self link.
- `SoftwareApplication` is still absent (n6).

**m8.**

- There are no editorial ReCopyFast prices left.
- `COMPETITOR_FACTS_CHECKED_AS_OF`, with a boundary comment (`comparisons.ts:52-58`), is the
  single date source used in `src`.

**m9.**

- Both `/signup` CTAs carry `utm_source=comparison&utm_medium=page&utm_campaign=compare_<slug|index>`.
  That is the same pattern as `/try` (`try/page.tsx:70`).
- No code in the app reads `utm_*`; measurement depends on the analytics tool, the same as for
  `/try`.

## New findings

### Major

**N1 — Accepted ADR 020 was edited instead of superseded.**

- `docs/decisions/020-seo-clusters-on-marketing-surface.md:108-114` appends
  "## Route clarification — s37, 2026-09-25".
- AGENTS.md ("Decisions … Immutable: a change means a new ADR superseding the old one") forbids
  editing an accepted ADR. So does `docs/decisions/errata.md` ("No ADR body is ever mutated…
  anything that changes what was decided … still require[s] a superseding ADR").
- The appended text is a decision, not a pointer fix. It says `/compare` replaces
  `/alternatives/*` and that "s17 must reuse these comparison URLs".
- It also leaves two accepted ADRs silently out of step:
  - ADR 012 (s17 scope) prescribes one dynamic `[competitor]/page.tsx` with
    `generateStaticParams`, shared JSON-LD builders in `src/lib/seo/json-ld.ts` and a data
    validator. s37 ships four hand-written route files and inline JSON-LD builders.
  - ADR 013 scopes the Lighthouse gate to `/alternatives/*`.
- **Fix:**
  1. Revert the ADR 020 body edit.
  2. Add ADR 031 ("comparison cluster lives at `/compare`; supersedes the `/alternatives`
     spelling in 020/012/013").
  3. In ADR 031, state what s17 inherits: the URLs, and whether the four static routes must
     become ADR 012's dynamic route. It must also say whether the Lighthouse scope moves to
     `/compare/*`.
- This is docs only; no runtime impact.

### Minor

**n1 — Duda "Client accounts are unlimited" is not scoped by plan.**

- Where: `comparisons.ts:184` (the first sentence of the Client access row) and `:202` (the
  Pricing model row).
- Duda's plan table leaves both **Client accounts** and **Client permissions** blank for
  **Basic**. Team, Agency, White Label and Custom show "Unlimited seats".
- Manage Clients opens with "Available on Team plans and higher."
- The error favours Duda, so the legal risk is low, but it is still inaccurate.
- Suggested wording: "On Team plans and higher, client accounts are unlimited; agencies assign
  them to sites with per-site permissions."
- The FAQ at `:217` is already scoped correctly.
- (This also corrects the previous review, which said "every plan".)

**n2 — The TinaCMS delivery row overgeneralises.**

- Where: `comparisons.ts:288`, plus the index table's blanket sentence at
  `compare/page.tsx:175-178`.
- "writes **approved** content to Git": by default a save commits immediately. The editor docs
  say "Press save. This will automatically trigger an update to your site, unless you have
  editorial workflow features enabled". Approval exists only with Editorial Workflow (Team Plus
  and up).
- "published edits are served in the page's HTML": TinaCMS is headless. It "provides a
  queryable content API that your website's code consumes", on "whichever framework they
  choose". HTML delivery holds for statically generated or server-rendered sites, which is the
  usual case, but it is a property of the site, not of TinaCMS.
- Suggested wording: "TinaCMS commits saved (or, with Editorial Workflow, approved) content to
  Git; statically built or server-rendered sites then serve published edits in the page's HTML…"

**n3 — Tests still do not pin most competitor claims** (what remains of m3).

- Neutralization:
  - Flipping Webflow's client-access row to "do not need a Webflow account": **0/21** red.
  - Flipping TinaCMS's publishing row to "cannot publish without a developer deploy": **0/21**.
  - Flipping Duda's pricing row to "Client seats are billed per seat": **0/21**.
  - Deleting the index "When to choose a platform" served-HTML disclosure: **0/21**.
- The Webflow assertion passes on the integration note alone.
- Competitor statements carry the comparative-advertising risk.
- **Fix:** assert every row's exact competitor text per slug (a small table-driven test), and
  the index disclosure paragraph.

**n4 — The detail pages are uncached per request.**

- `export const dynamic = "force-dynamic"` is on all four detail routes. So every visit, crawl
  or bot hit does two things:
  - a full server render (not CDN-cacheable);
  - an uncached service-role RPC, `get_founding_agency_availability`. The catalogue itself has
    a 5-minute per-instance TTL.
- `/api/pricing`, by contrast, caches its response for 5 minutes and sends `s-maxage=300`.
- The kill switch does not need per-request rendering. The documented rollback
  (`docs/operations/stripe-setup.md`, "Safe rollback") already redeploys after changing
  `AGENCY_CHECKOUT_ENABLED`, and the redeploy discards any cached copies.
- **Fix:** replace `force-dynamic` with `export const revalidate = 300`. That keeps the pages
  fresh and gives the sold-out state the same ≤5-minute lag as `/#pricing`.
- The RPC is a cheap `COUNT` today, so this is not urgent.

**n5 — The comparison price source differs from `/#pricing`.**

- `/api/pricing` layers live Stripe `unit_amount` over the database price
  (`api/pricing/route.ts:104-154`, `:165`, `:224`). Its reason: "Stripe is what the customer is
  actually charged".
- The comparison pages show `plans.price_monthly` from the database. The comment at
  `comparison-pricing.ts:19` ("Reads the same catalogue … as `/api/pricing`") holds for the rows
  but not for the amounts.
- Today both agree ($49 / $299; the production feed is `source: "stripe"`). If the two drift,
  the comparison pages would show a different price from checkout.
- Also: a future `websites: -1` (unlimited) would render as "-1 sites".
- **Fix:** reuse the pricing feed's amount logic, or drop the "same as" wording and rely on the
  `check:stripe:live` runbook step.

**n6 — `SoftwareApplication` JSON-LD is still absent.**

- PRD `docs/prd.md:329` and the s17 acceptance criteria ask for `SoftwareApplication` +
  `FAQPage` + `BreadcrumbList`. Only the latter two shipped.
- Either add it, with offers from the same live pricing, or record the deferral to s17 in the
  N1 ADR.

**n7 — Duplication nits.**

- `comparisonSiteUrl` (`comparisons.ts:424-432`) is the fourth copy of the same origin resolver
  (`layout.tsx:48`, `robots.ts:11`, `sitemap.ts:13`). The logic is identical today; a shared
  helper would stop drift.
- Also inherited from `121c9c4`: the index reads `comparison.rows[0]` and `rows[1]` by
  position.

## Claim verification — competitors (each source re-fetched 2026-09-25)

The Webflow and Duda help-centre articles were read through `…/api/v2/help_center/en-us/articles/<id>.json`,
with the `updated_at` dates shown.

| Page | Claim (location) | Source | What the source says | Verdict |
| --- | --- | --- | --- | --- |
| Webflow | Visual design, site building, CMS and hosting together (short answer, "Best at", fit 1-3) | webflow.com/pricing | Site plans; Webflow CMS; hosted sites | Supported |
| Webflow | "Build or run the site in Webflow" (Installation) | webflow.com/pricing | Hosted site plans | Supported |
| Webflow | Content editors "accept an invitation and sign in to or create a Webflow account" (`:98`, note `:121`) | Legacy Editor FAQ (upd. 2026-07-02) | "They must accept the invitation, at which point they'll be asked to sign in or create a Webflow account." | Supported (verbatim) |
| Webflow | **Changed:** "can save drafts and publish to staging or production when Webflow permissions allow it" (`:104`) | Content-editor doc (upd. 2026-09-02) | "changes are automatically saved in draft state"; "Publish to your webflow.io staging subdomain / … production domain"; "publish (if 'Can publish' is toggled on)" | Supported |
| Webflow | **New:** "Webflow publishes edits so they are served in the page's HTML" (`:110`, fit 4) | Pricing: hosted sites; publish to domain | No verbatim line. Consistent with Webflow-hosted publishing, and it credits the competitor | Consistent |
| Webflow | Site plans plus Workspace or seat plans (`:116`) | webflow.com/pricing | "Site plans"; "Workspace plans"; full, limited and free seats; "1 free client seat per paid site" | Supported |
| Webflow | Legacy Editor and its white-labeling retired on 2026-08-04 (note, FAQ 1) | Legacy Editor FAQ | "Starting August 4, 2026, the legacy Editor will no longer be available"; "Editor branding (whitelabeling) … will also be deprecated" | Supported |
| Webflow | **Changed ReCopyFast fit:** edit "without a Webflow seat or account" (`:82`) | Same FAQ plus pricing | Webflow editing needs a client, limited or full seat, and an account | Supported (m2 fixed) |
| Duda | One visual builder; layout, design, preview, publish (short answer, `:173`, fit 1-2, FAQ 1) | duda.co/pricing; Editor Overview (upd. 2026-09-21) | Design panel; "Preview Changes"; "Publish or Republish" | Supported |
| Duda | Granular client permissions; plan-dependent white label (fit 3) | duda.co/features/client-permissions; pricing table | Site-specific access, full or content editing permissions; "White-label client access" only on White Label and Custom | Supported |
| Duda | "Sites are built and managed through Duda" (`:178`) | Pricing FAQ | "All websites built on Duda are hosted by Duda" | Supported |
| Duda | **Changed:** "Client accounts are unlimited. Agencies assign them to sites and set per-site permissions on Team plans and higher." (`:184`) | Manage Clients (upd. 2026-09-18); pricing table | "Available on Team plans and higher."; "There is no limit to how many clients you can create."; "Clients are given access to each site individually … different permissions for each site"; Client accounts blank on Basic | Supported; the first sentence is unscoped (n1) |
| Duda | Preview plus Publish or Republish, subject to permissions (`:190`) | Editor Overview; Manage Clients | "Site publish" and "Site republish" permissions | Supported |
| Duda | **New:** "Duda publishes edits so they are served in the page's HTML" (`:196`, fit 4) | Pricing FAQ | Hosted by Duda; "readable, logical code" for SEO. No verbatim line | Consistent; it credits the competitor |
| Duda | **Changed:** "Client accounts are unlimited. Platform subscriptions include site allowances, with additional published sites priced separately." (`:202`) | Pricing | "All plans include at least one site … Agency and White Label plans including four"; "Price per additional published Website Builder project $19/mo … $17/mo"; Client accounts blank on Basic | Supported, except "unlimited" is unscoped (n1) |
| Duda | **Changed FAQ 2:** unlimited, per-site permissions on Team and higher; clients accept invitations and set passwords (`:217`) | Manage Clients | "Set up URL … Invitation Email"; "they will need to define their password to access the editor" | Supported |
| Duda | **C1 replacement:** existing hosting vs rebuilding in Duda (`:168`) | Pricing FAQ | "hosted by Duda"; "we recommend rebuilding it in Duda" | Supported |
| TinaCMS | Git-backed structured content; developer-defined schemas (short answer, `:264`, fit 1, 3) | tina.io/docs (edited 2026-02-05) | "open-source, Git-backed headless content management system"; modelled in `tina/config.ts` | Supported |
| TinaCMS | React-oriented visual editing (fit 2) | tina.io/docs | "For sites using React, TinaCMS supports 'Visual Editing'" | Supported |
| TinaCMS | Developers configure TinaCMS, schema, content files and integration (`:270`) | tina.io/docs | `tinacms init`; collections | Supported |
| TinaCMS | Editors invited; GitHub access and workflow depend on setup and plan (`:276`) | usage-editors (edited 2025-07-15; a TinaDocs guide) | "You'll need a GitHub account"; "Add your account to the project in TinaCloud (or ask your admins to add you)" | Supported (hedged) |
| TinaCMS | Saves commit to Git; Editorial Workflow adds approval (`:282`) | docs; usage-editors; pricing | "a commit is made back to your Git repository"; "unless you have editorial workflow features enabled (giving teams a Git based approval workflow)"; Editorial Workflow on Team Plus, Business and Enterprise | Supported |
| TinaCMS | **New:** "writes approved content to Git so the site can rebuild it and published edits are served in the page's HTML" (`:288`, fit 4) | docs; usage-editors | "Headless … provides a queryable content API that your website's code consumes"; "whichever framework they choose"; save updates the site directly unless Editorial Workflow is on | **Overgeneralised (n2)** |
| TinaCMS | Plans vary by project, users and workflow (`:294`) | tina.io/pricing | "Billing unit Per project"; Included Users 2/3/5/20; Editorial Workflow tiers | Supported |
| CloudCannon | Git-based visual CMS; static-site workflows; repository sync (`:348`, fit 1-2, short answer) | cloudcannon.com/git-cms | "Git-based CMS for visual editing"; "Build locally with your favorite SSG"; "Supports the static site generators" | Supported |
| CloudCannon | Connect a repository and configure (`:354`) | cloudcannon.com/pricing | "Connect as many repositories as you like" | Supported |
| CloudCannon | Client Sharing with no CloudCannon account and a site password; full users also supported (`:360`, note, FAQ 1) | what-is-client-sharing | "Clients do not need to have a CloudCannon account. Instead, they log into CloudCannon using a site-specific password." | Supported, and credited fairly |
| CloudCannon | Shared access cannot attribute changes (note, FAQ 1) | what-is-client-sharing | "If multiple people share a password, you cannot determine which Client was responsible for which changes." | Supported |
| CloudCannon | Sync and publishing depend on the configured workflow (`:366`) | intro-to-syncing-and-publishing | "Publishing is when CloudCannon publishes changes from one copy of your website to another"; "Not all Sites will have a Publishing Workflow" | Supported |
| CloudCannon | **New:** syncs through repository and build so edits are served in the HTML (`:372`, fit 4) | Sync-doc glossary; git-cms | A Site includes everything "needed to edit, build, and host a complete website"; SSG-centred | Supported |
| CloudCannon | Plans bundle user allowances; extra users and site shares; Standard lists unlimited sites (`:378`) | cloudcannon.com/pricing | "3 users … add more for $10/month per user"; "User or site share $10 / person"; "We don't charge per site or repository. Unlimited" | Supported ("may vary by plan" over-hedges; harmless) |
| Index | Webflow and Duda for building and hosting; TinaCMS and CloudCannon for Git workflows; competitors serve edits in HTML | All of the above | Consistent; the n2 caveat applies to the TinaCMS row | Supported |

**Framing.** There is no disparaging language, no logos, and no competitor trademarks beyond
nominative names. Each page credits where the competitor is stronger, including the served-HTML
advantage the previous review asked for.

## Claim verification — ReCopyFast (code on this branch; product code unchanged from `c3b2b28`)

| Claim on the pages | Where on the page | Code | Verdict |
| --- | --- | --- | --- |
| One script, not a framework SDK | Shared Installation row; FAQs; boundaries block | `src/lib/sites/embed-script.ts:98` (a single `<script … data-api-url>`) | Built |
| Existing site kept; no content migration; authored text discovered in the rendered page | Shared row; TinaCMS FAQ 3; notes | `public/embed/recopyfast.src.js:2623` (`scanForContent`), called at `:912` | Built |
| Script access and a compatible CSP required | Shared row; boundaries block | The snippet loads from and calls the app origin (`embed-script.ts:98`) | Accurate hedge |
| Invited clients request a **six-digit** email code | Shared "Client/Editor access" row; Webflow FAQ 3; fits | `src/lib/auth/editor-crypto.ts:136-139` (`generateVerificationCode`, CSPRNG, 6 digits); `src/app/api/editor/request-code/route.ts:115` (`after()`) | Built |
| No ReCopyFast account for the editor | Same | No `createUser`, `signUp` or `inviteUserByEmail` in `request-code` or `submit-code` (grep) | Built |
| Editors save drafts | Shared Publishing row | `src/app/api/staging/content/[siteId]/route.ts:290` (`save_staging_content_atomic`) | Built |
| A permitted editor explicitly publishes | Same; index | `src/app/api/staging/publish/route.ts:90`, `:119` (`requireEditorPermission(…, "publish")`); `src/app/api/editor/editors/route.ts:215` (`normalizePermissions`) | Built |
| Individual (attributable) editor authentication | CloudCannon fit 2 and note | `staging/content/[siteId]/route.ts:299` (`p_user_email`) | Built |
| **New:** published edits applied in the browser after load; no-JS visitors and non-rendering crawlers see the original HTML | Delivery row ×4; competitor fits ×4; boundaries block; index ×3 | `recopyfast.src.js:890` (`waitForDOM`), `:2592-2599` (DOMContentLoaded), `:908-918` (fonts → scan → hydrate), `:3626-3638` (FOUC comment; `hydrateStoredContent` fetch). No server-side path | Built and accurate |
| **Changed:** Agency price and sites; Founding price and remaining spots, or sold out, unavailable or disabled | Pricing row; Pricing context | `src/lib/compare/comparison-pricing.ts:26-71` → `src/lib/stripe/plans.ts:101-103`, `:429`; `src/lib/billing/founding-agency.ts:46-61`; copy at `ComparisonPage.tsx:63-83`. Seed: `supabase/migrations/20260924065000_agency_plan_and_founding_capacity.sql` (49 for 10 websites; 299 one-time granting `agency`). Production feed today: 49/10, 299, 50 of 50 | Built, live; see n4 and n5 |
| `/#pricing` shows current availability | Pricing context | `src/components/sections/Pricing.tsx:112` (`id="pricing"`) | Built |
| Stores and publishes through its own workflow; no Git writes | TinaCMS and CloudCannon FAQs; fits | No Git or GitHub client in `src` (grep for octokit, isomorphic-git, simple-git and api.github.com: none) | Built; the trade-off is now disclosed |
| Does not build layouts, host or migrate | Every page | Negative claim, consistent with the code | Accurate |
| `/signup` and `/try` exist | CTAs | `src/app/signup/page.tsx`, `src/app/try/page.tsx` | Built |
| Revoke, AI, real-time, A/B testing, white-label | — | Not claimed on any page | n/a |

**No social proof.** A grep of the added `src` lines finds no logos, `<img>` or `<Image>`,
testimonials, "trusted by" lines, customer names or usage counts. The only icons are Lucide icons
with `aria-hidden`.

## SEO and technical (rendered HTML from the local production build)

- **Titles.**
  - `/compare` renders "Compare website editing tools | ReCopyFast" (root template).
  - The detail pages render "ReCopyFast vs Webflow Editor / Duda / TinaCMS / CloudCannon"
    (absolute), with no doubled brand.
  - OG and Twitter titles equal the absolute title.
- **Canonical and `og:url`.** Both match the route on all five pages. `metadataBase` in this build
  was the CI placeholder `http://localhost:3000`.
- **JSON-LD.** Every block was parsed with `json.loads`.
  - Each detail page has one `FAQPage` (3 Q/A; every name and answer is found in the visible
    text) and one `BreadcrumbList`: position 1 "Comparisons" → `/compare`, position 2
    `<Competitor>` → `/compare/<slug>`.
  - The index has one `FAQPage` (3 Q/A).
  - `<` is escaped.
  - The breadcrumb origin comes from `comparisonSiteUrl`, which uses the same resolution order as
    `metadataBase` (`layout.tsx:48-72`).
- **`aria-current="page"`.** Present on the breadcrumb `<span>` and on the self link in "Related
  comparisons"; absent on the siblings.
- **Sitemap.** All five URLs are present, derived from `comparisonList`. The test also covers
  database failure.
- **Unknown slug.** Returns 404 (the inherited App-surface not-found, as before; the gap was
  already open under ADR 020).
- **Mobile layout.** Not re-measured in this pass. The table wrapper and grid classes are
  unchanged since the prior 390px and 320px measurement; only table rows were added. The fix run
  records 15 route/viewport renders with `AGENCY_CHECKOUT_ENABLED=false`.

## Tests — neutralization

For each mutation: one file was changed, the 3 focused suites (21 tests) were run, the file was
restored with `git checkout`, and `git diff --exit-code` confirmed it clean.

| # | Neutralized | Red |
| --- | --- | --- |
| 1 | Kill-switch guard dropped (`if (false && !isAgencyCheckoutEnabled())`) | 1 / 21 |
| 2 | Sold-out branch dropped | 1 / 21 |
| 3 | Live price replaced by the old hardcoded "$49/month for 10 sites" | 7 / 21 |
| 4 | Disabled state advertises Agency and Founding anyway | 1 / 21 |
| 5 | Delivery disclosure (table) replaced by "live instantly for every visitor" | 4 / 21 |
| 6 | Served-HTML competitor advantage removed from the Duda fit | 1 / 21 |
| 7 | C1 line reintroduced | 1 / 21 |
| 8 | Editor-access claim flipped to "create a ReCopyFast account and a password" | 4 / 21 |
| 9 | FAQ JSON-LD answers shifted to the next question | 4 / 21 |
| 10 | Webflow client-access competitor row flipped | **0 / 21** (n3) |
| 11 | TinaCMS publishing row flipped | **0 / 21** (n3) |
| 12 | Duda pricing-model row flipped to "billed per seat" | **0 / 21** (n3) |
| 13 | Index "When to choose a platform" served-HTML disclosure removed | **0 / 21** (n3) |
| 14 | Breadcrumb `aria-current` dropped | 4 / 21 |
| 15 | Sitemap drops the last comparison | 1 / 21 |
| 16 | UTM dropped on the detail-page CTA | 4 / 21 |
| 17 | `title.absolute` reverted to a plain string | 1 / 21 |
| 18 | Founding remaining count hardcoded to "50 of 50" | 5 / 21 |

The guards that matter bite: the kill switch, sold-out, live price, disclosure, the C1
regression and FAQ pairing. My mutations #3, #8 and #9 reproduce the fix run's claimed mutation
counts (7, 4 and 4). Competitor rows are the remaining gap.

**Playwright.** The diff does not touch `e2e/`, `playwright.config.ts`, `package.json`, the lock
file, `supabase/` or `public/embed/`. The E2E job on `ba25a30` passed.

## Plan, research and ADR conformance

- **Plan tasks 1–6 and fix tasks F1–F6:** all present in the diff and ticked.
  - F1, F2, F3 and F4 are done as described.
  - F5 is done, but it edited the ADR 020 body instead of adding a new ADR (N1).
  - F6: CI is green, and the draft PR was updated.
- **Outside the plan:** nothing substantive.
  - `comparisonSiteUrl` supports F4's BreadcrumbList.
  - `force-dynamic` supports F3 (see n4).
- **Research:**
  - The fix-mode verification numbers match my runs: 236 suites / 3,111 tests, and the
    static/dynamic split in the build.
  - The research inherits my predecessor's "unlimited on every plan" reading of Duda (n1).
- **AGENTS.md:**
  - Server components; no dependencies, migrations or embed changes; lint and format clean.
  - Non-negotiable 7 (no hardcoded Stripe prices) is now met.
  - The ADR immutability rule is broken (N1).
- **ADRs:**
  - ADR 020's surface decision is followed: pinned `data-theme="light"`, slate and sky only,
    `font-display` on headings.
  - ADR 012's route and builder shape is not followed, and ADR 013's gate scope is stale. Both
    should be settled in the superseding ADR (N1).
  - ADR 029: the Founding cap and sold-out state are honoured via the aggregate RPC.

## Not verified — gestures for a human

- **Deployed pages.** Production `/compare` returns 404 (not merged), and the Vercel preview is
  behind SSO.
  - After deploy, open `/compare/duda` and confirm the pricing row reads "Agency is $49/month for
    10 sites. Founding Agency is $299 lifetime; N of 50 founding spots remain."
  - View the source and confirm the canonical, `og:url` and BreadcrumbList `item` URLs use
    `https://www.recopyfa.st`.
  - Run one page through Google's Rich Results Test and the Schema.org validator.
- **Kill switch in production.** Proven only locally (same build, env flipped). During the next
  rollback drill, confirm `/compare/*` shows "Agency checkout is currently unavailable" after the
  redeploy.
- **Sold-out path against a real database.** Proven only with a mocked service client and the real
  parsing code.
  - In a test-mode environment, set completed Founding sales to 50 and confirm the pages say
    "sold out".
- **Browsers.** I did not render in a browser this pass (the fix run reports 1440, 390 and 320px
  in Playwright CLI). Safari and iOS were never rendered.
- **Visible text swap for JavaScript visitors.** Not observed in a browser. Load a real site with
  a published edit and confirm the swap is acceptable next to the disclosure's "after the page
  loads" wording.
- **Editor flow end to end.** Not run; code reading only. Invite a test editor and confirm:
  - the code email arrives;
  - no account is created;
  - drafts save, and a permitted editor can publish.
- **Strict-CSP host.** The CSP hedge was not exercised.
- **Competitor sources.**
  - The Duda and Webflow help articles were read through the Zendesk API, not the rendered page.
  - The Webflow pricing page is heavily scripted; only its plan and seat structure was
    confirmed.
  - The served-HTML statements for Webflow and Duda have no verbatim source. They are
    consistent with hosted publishing and favour the competitor.
  - Re-check every source before each change to the "as of" date.
- **Attribution.** No app code reads `utm_*`. Confirm the analytics tool records the query
  parameters for `/signup`.
- **Legal.** I am not counsel. Have a person with comparative-advertising judgement read the
  five pages, especially after the n1 and n2 wording fixes.

## Delta review 7d9b95f

Fresh-context delta review of `ba25a30..7d9b95f` (a merge commit: `ba25a30` + `cbfb922`/#33),
2026-09-25. The story's own changes were isolated with `git show --remerge-diff 7d9b95f`
(19 files). The s35 content that came in with the merge was not re-reviewed.
`git diff cbfb922 7d9b95f` touches none of the s35 files, so the merge carried them over
unchanged.

### What I ran

| Check | Result |
| --- | --- |
| The 4 focused suites (comparison pages, discovery, pricing, `site-url`), run with the CI wrapper (`bash ci-run-ssh.sh …`; the file has no exec bit, and I did not modify it) | 4 suites and 28 tests passed |
| Full Jest, `--ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, same wrapper | 241 passed + 2 skipped suites; 3,173 passed + 38 skipped tests; **0 failed**; 89 s. This matches the research's claim |
| `next build`, same wrapper | Passed. `/compare` is `○` (static). All four details are `○` with **Revalidate 5m, Expire 1y**. `prerender-manifest.json` has `initialRevalidateSeconds: 300` for all four |
| `next start` on that build | Details: `200`, `Cache-Control: s-maxage=300, stale-while-revalidate=31535700`. Index: `s-maxage=31536000`. `/compare/nope`: `404` |
| Rebuild with `AGENCY_CHECKOUT_ENABLED=false` (simulating the redeploy) | All 4 prerendered details say "currently unavailable" (×2 each). None contains `$49`, `$299`, "lifetime", "Founding" or "/month". There were 0 pricing error logs, so no DB call was made. **The kill switch is honoured after a redeploy** |
| The build with the switch on and the placeholder DB | Prerendered HTML says "temporarily unavailable" and shows no price. That is the correct degraded state |
| `gh pr checks 34` (once) | Head `7d9b95f`, draft, MERGEABLE. All pass: Lint, Test & Build; Type-Check; E2E 5m19s; realtime audit; Vercel. CodeRabbit skipped (draft) |
| `.next` | Removed after the runs. It was absent before. `git status` shows only this review |

### Prior findings → status

**N1 — Fixed.**

- ADR 020 is byte-identical to `origin/main` (SHA-256 `3aaa2ac2…1346` on both).
- ADRs 012 and 013 are unchanged against `origin/main`.
- The only change under `docs/decisions/` is the new `032-comparison-routes-supersede-alternatives.md`.
- **Numbering.** I checked `git log --all -- 'docs/decisions/03*'` and ran `ls-tree` on every local and
  remote ref:
  - 030 is on main.
  - 031 exists only on `feature/s34-checkout-hardening` (`031-checkout-hold-expiry-and-recoverable-subscriptions.md`).
  - 032 exists only on s37.
  - No number is used twice. The gap at 031 on `main` is expected until s34 merges.
- **Form.** It follows the repo's supersession precedent (ADR 024 → 008, ADR 026 → 023):
  - A new ADR with `Status: accepted` and a scoped "Partially supersedes 012, 013, 020" header.
  - The superseded ADR bodies are left untouched.
  - No `errata.md` entry, which is correct, because this changes a decision, not a pointer.
- **Content.** ADR 032's claims about 012 match the text of 012:
  - the dynamic `[competitor]/page.tsx` route;
  - `generateStaticParams`;
  - `notFound()`;
  - the shared `src/lib/seo/json-ld.ts` builders, including `buildSoftwareApplicationLd()`;
  - the runtime validator.

  Its claim about 013 also matches: 013 scopes the gate to `/alternatives/*`.
- **What s17 inherits.** ADR 032 settles everything the previous review asked for:
  - s17 migrates the four wrappers to the dynamic route.
  - The Lighthouse scope moves to `/compare/*`, with the thresholds unchanged.
  - The `SoftwareApplication` deferral is recorded.
- The s17 story entry links to ADR 032 (`stories.md:1013`).

**n1 — Fixed.**

- I re-fetched Manage Clients (Zendesk API, `updated_at` 2026-09-18). It says "Available on
  Team plans and higher." and "There is no limit to how many clients you can create." It also
  says "Clients are given access to each site individually … different permissions for each
  site."
- `duda.co/pricing` (200) lists "Client accounts | Unlimited seats" four times, for five plan
  columns: Basic is blank; Team, Agency, White Label and Custom are unlimited.
- The new row ("On Team plans and higher, client accounts are unlimited; agencies assign them to
  sites with per-site permissions.") is accurate.
- The new Pricing row ("Team plans and higher include unlimited client accounts.") is accurate.

**n2 — Fixed.** I re-fetched each source (all 200):

- `usage-developers`: "In production mode (with TinaCloud), changes are committed directly to
  your Git repository." That supports "In TinaCloud production, saves commit directly to Git".
- `tinacloud/editorial-workflow`: "Instead of saving your content directly to a protected
  branch … a new branch is created. A draft pull request is generated…". The feature is on
  "select paid plans". That supports "or through Editorial Workflow when it is enabled".
- `tina.io/docs`: "TinaCMS is 'Headless' … a queryable content API that your website's code
  consumes". `separate-content-repo`: a webhook is "the recommended way to trigger a rebuild".
  Together these support "Whether edits appear in served HTML depends on the site's build and
  deployment". The same caveat is now in the TinaCMS fit and on the index.
- The three new citation URLs resolve.

**n3 — Fixed.** Every competitor claim is now pinned twice:

- by the rendered table cell, per slug and per label;
- by the registry (`expectedCompetitorRows`, 24 literals written independently of
  `comparisons.ts`).

The index platform-choice paragraph, the ReCopyFast-choice paragraph, the competitor-choice
disclosures and the Integration-boundaries paragraph are pinned as exact text.

The neutralizations are below. For each one I changed a single file, ran the 4 suites (28 tests),
restored the file with `git checkout`, and confirmed `git diff --exit-code -- src` was clean:

| # | Neutralized | Red (previous run) |
| --- | --- | --- |
| D1 | Webflow client-access row flipped to "do not need a Webflow account" | **2 / 28** (was 0/21) |
| D2 | TinaCMS publishing row flipped to "cannot publish without a developer deploy" | **2 / 28** (was 0/21) |
| D3 | Duda pricing row flipped to "Client seats are billed per seat" | **2 / 28** (was 0/21) |
| D4 | CloudCannon client-access row flipped to "requires a paid CloudCannon account" | **2 / 28** (new) |
| D5 | Index "When to choose a platform" served-HTML disclosure deleted | **1 / 28** (was 0/21) |
| D6 | Duda `revalidate = 300` replaced by `dynamic = "force-dynamic"` | **1 / 18** (comparison-pages suite) |

**n4 — Fixed.**

- `export const revalidate = 300` is on all four detail routes, and a test pins it (D6).
- The build and `prerender-manifest` confirm ISR at 300 s.
- The kill switch is honoured after a redeploy (see the table above).
- See d2 for a nuance in how ADR 032 describes the lag.

**n5 — Fixed (by wording).**

- The `comparison-pricing.ts` doc comment no longer claims it uses the "same" source as
  `/api/pricing`. It names the `plans.price_monthly` versus Stripe `unit_amount` split, and it
  names the live Stripe catalogue check as the guard against drift.
- The `check:stripe:live` script exists (`package.json:35`), and it is in
  `docs/operations/stripe-setup.md`.
- The "-1 sites" point was not addressed. Nothing in `plans.ts` or `Pricing.tsx` uses a `-1`
  or unlimited site convention today, so this is speculative and I have dropped it.

**n6 — Fixed (deferral recorded).**

- ADR 032 §5 defers `SoftwareApplication` to s17's `buildSoftwareApplicationLd()`.
- It says the PRD and s17 criterion stay open.
- It forbids invented reviews and offers.

**n7 — Fixed.**

- `src/lib/seo/site-url.ts` `resolveSiteUrl()` is the one resolver. Its body is identical to the
  three removed copies.
- It is used by `layout.tsx` (`metadataBase`), `robots.ts`, `sitemap.ts` and
  `comparisonSiteUrl`.
- It has 3 tests covering the precedence order, scheme handling, trailing slash and the fallback.
- The index now selects rows by label via `getComparisonRow`, which throws on a missing label,
  instead of by position.

### New findings (delta)

**d1 (minor) — The TinaCMS "How published edits reach visitors" row repeats the Publishing row
verbatim.**

- `comparisons.ts:283` and `:289` both open with "In TinaCloud production, saves commit directly
  to Git, or through Editorial Workflow when it is enabled."
- So two adjacent rows on `/compare/tinacms` start with the same sentence.
- The index TinaCMS cell (Installation + Delivery) repeats it once more.
- This is copy polish only; the claim itself is accurate. Suggested delivery row: "Whether saved
  edits appear in served HTML depends on the site's build and deployment…"

**d2 (minor) — ADR 032 §6 understates how stale a detail page can be.**

- ADR 032 says prices and Founding availability "can lag by five minutes, matching the public
  pricing feed's cache interval".
- The build uses Next's default expire of 1 year. The response is
  `s-maxage=300, stale-while-revalidate=31535700`.
- So the first request after an idle period is served the stale copy, of any age, while the page
  regenerates in the background.
- `/api/pricing` bounds this at `stale-while-revalidate=600`.
- The practical risk is small:
  - checkout still enforces the Founding cap (ADR 029);
  - a redeploy purges the cache, so the kill switch is unaffected;
  - only one visitor per regeneration sees the stale copy.
- Still, the ADR sentence is not literally true.
- **Fix, if wanted:** set `expireTime` in `next.config` to bound it, or reword in a follow-up.
  ADR 032 is now accepted, so a rewording would need an erratum-level note or a later ADR, not an
  edit.

**d3 (nit) — `stories.md:1435` still reads "extending … ADR 020 at the explicitly requested
`/compare` URLs".**

- This is not wrong: ADR 020's surface decision still applies.
- ADR 032 is the route authority. The design doc already says so (`designs/s37…:19`).

### Not verified in this delta

- **Deployed behaviour.** The Vercel preview is behind SSO, and production `/compare` is 404
  (not merged).
  - After deploy, `curl -I /compare/duda` should show `s-maxage=300` and `x-vercel-cache`.
  - Confirm the prerendered page shows real prices, meaning the build had DB access. A build
    without DB access would bake in "temporarily unavailable" for up to 5 minutes plus the stale
    serve.
- **The kill switch on Vercel.** Proven locally by rebuilding with the switch flipped. During the
  next rollback drill, confirm `/compare/*` flips after the redeploy, and not before.
- **Sources.**
  - The Duda help article was read through the Zendesk API. The Duda pricing table was read as
    stripped HTML, so the blank Basic cell is inferred from 4 values across 5 columns, and it is
    corroborated by "Available on Team plans and higher."
  - The TinaCMS pages were read as server-rendered HTML.
- **Lint and format of the delta files.** I did not rerun them. CI "Lint, Test & Build" and
  "Type-Check" passed on `7d9b95f`.
- **Browser rendering of the new copy.** Not done.
- **Legal read.** Still recommended.

### Delta verdict

N1 is resolved correctly, and n1–n7 are resolved as claimed. I checked each one myself: sources
re-fetched, mutations turn tests red, and ISR and the kill switch were proven on a real build.
The only remaining items are minor: d1, d2 and d3.

Max severity: minor
Ship allowed: yes
