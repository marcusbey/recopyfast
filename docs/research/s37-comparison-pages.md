# Research — s37-comparison-pages

Date: 2026-09-25. Base: c3b2b28. Scope prevalidated by operator.

## Premise and current implementation

Read AGENTS.md, CLAUDE.md, architecture, PRD SEO strategy, ADR 020, design system
and audit closeout. This is new marketing content, not an audit-finding repair; no
existing failing marker belongs to this scope. Existing audit guards remain intact.
The PRD has historical competitor claims: do not repeat them without current sources.

## Verified ReCopyFast claims

- `src/lib/sites/embed-script.ts:buildEmbedScript`: one script tag with site identity
  and API origin, no framework SDK. `src/lib/sites/install-recipes.ts` has WordPress,
  Next.js and HTML recipes. The embed reads existing DOM. Say stack-independent
  installation subject to script access/CSP; do not promise universal compatibility.
- `src/app/api/editor/request-code/route.ts`: active invited editor email lookup,
  verification code delivery, no account creation. `src/lib/auth/editor-crypto.ts:137`
  generates a six-digit code; `src/app/edit/EditorSignIn.tsx` is the public UI.
- `src/app/api/staging/content/[siteId]/route.ts:290`: draft saved through
  `save_staging_content_atomic`. `src/app/api/staging/publish/route.ts:165`: explicit
  `publish_staging_content_with_attributes_atomic` after publish permission checks.
- `supabase/migrations/20260924065000_agency_plan_and_founding_capacity.sql`:
  Agency $49/month, 10 websites; Founding Agency one-time $299 granting Agency,
  limited capacity. `src/lib/stripe/plans.ts` loads real catalogue, and
  `src/components/sections/Pricing.tsx` renders pricing/availability. Comparison prices
  are a dated editorial snapshot only, never a billing catalogue fallback or availability count.
- ReCopyFast edits an existing site; do not claim page building, layout creation,
  hosting, source repository writes or migration automation.

## Existing patterns and constraints

- `src/app/try/page.tsx`: pinned light wrapper, Header/Footer, slate/sky, font-display
  headings, canonical/OG/Twitter metadata with shared OG images.
- `src/app/blog/[slug]/page.tsx`: article hierarchy, related navigation, footer CTA;
  blog app colors do not override ADR 020's marketing colors.
- `src/app/sitemap.ts`: static route registry plus graceful published-blog lookup.
  Preserve blog behavior and existing entries.
- `src/components/layout/Footer.tsx`: Product links used by landing and other pages.
- No reusable comparison engine exists in this checkout. Use a small typed content
  registry plus shared server renderer and four explicit route wrappers. No dependencies.
- The user requests `/compare` instead of the older planned `/alternatives` cluster.
  Do not create duplicate canonical pages or claim the older cluster is implemented.

## Validation environment

`npm run setup` completed at root and server; both audits report zero vulnerabilities.
No root production env copied. `/tmp/recopyfast-s37-ci.py` runs commands with only
`.github/workflows/ci.yml` main-job placeholder env, plus basic local execution vars.
Targeted tests while iterating; full precommit once at the end, then build, embed
freshness/size, production dependency audit. No remote DB or provider operations.

## Current external evidence

Retrieved 2026-09-25 by the research lane from official public pages (DeepAPI
credentials unavailable, official web fetch fallback). Mark claims “as of 2026-09”.
Use qualitative pricing models and link pricing pages; omit competitor numeric amounts
to avoid mismatching billing periods, seats, site plans and feature packages.

### Webflow

- https://webflow.com/pricing — visual site building, CMS/hosting, Site plus Workspace/seat model.
- https://help.webflow.com/hc/en-us/articles/33961251014931-Edit-site-content-as-a-content-editor
  — content editor role edits copy/assets/CMS; publishing permission controlled separately.
- https://help.webflow.com/hc/en-us/articles/48412420902675-Legacy-Editor-deprecation-FAQ
  — legacy Editor and white-labeling retired August 4, 2026; clients accept an invite
  and sign into/create a Webflow account. Preserve SEO slug but explain current flow.
- Stronger for visual design, building/redesigning in Webflow, CMS and hosting together.

### Duda

- https://www.duda.co/pricing — platform and website subscription model; extra sites charged.
- https://support.duda.co/hc/en-us/articles/26519221644439-Editor-Overview
  — visual canvas, layout/design, preview and Publish/Republish.
- https://support.duda.co/hc/en-us/articles/26519392519575-Manage-Clients
  — per-site client accounts and permissions, invitation and password setup.
- https://www.duda.co/features/client-permissions — granular content/design/publish controls.
- Stronger for agencies building and managing sites in one visual builder, with
  client management and plan-dependent white-label options.

### TinaCMS

- https://tina.io/docs — open-source Git-backed headless CMS; Markdown/MDX/JSON,
  developer-configured content schema, visual editing for React.
- https://tina.io/tinadocs/docs/using-tinacms/usage-editors — project invitation/GitHub
  access, /admin, saves commit to Git; editorial workflow changes approval flow.
- https://tina.io/pricing — TinaCloud priced per project, user allowances and
  editorial workflow vary by plan.
- Stronger for teams that want structured content under version control and a
  developer-managed integration. Do not imply a universal framework prohibition.

### CloudCannon

- https://cloudcannon.com/git-cms/ — Git-based visual CMS connecting repositories.
- https://cloudcannon.com/pricing/ — plans bundle user allowances; extra users/site
  shares may cost more; Standard includes unlimited sites. Do not repeat old PRD
  claim of a required charge per site.
- https://cloudcannon.com/documentation/user-articles/introduction-to-syncing-and-publishing/
  — sync to repository, publishing between site copies when workflow configured.
- https://cloudcannon.com/documentation/user-articles/what-is-client-sharing/
  — clients can edit without a CloudCannon account, using site-specific password;
  shared password cannot attribute different editors. Permissions vary by plan.
- Stronger for Git/static-site workflows, visual editing and repository sync.
  Never say ReCopyFast is the only no-account option.

## Complexity and open questions

Complexity 3: five static routes sharing an accessible renderer; no backend or schema
change. No product decisions pending. Independent review remains outside this lane.

## Implementation evidence

- Red, 2026-09-25: the focused CI-placeholder Jest command failed because the
  comparison routes, footer link and five sitemap entries did not exist.
- Green, 2026-09-25: the same focused command passed 2 suites and 11 tests,
  covering all five pages, metadata, semantic tables, visible/JSON-LD FAQ parity,
  dated citations, sibling/CTA links, footer discovery, database-failure sitemap
  behavior and preserved published-blog URLs.
- Changed source and test files pass Prettier and targeted ESLint. The leader owns
  the full precommit/build/audit gates and browser verification.

## Final verification — 2026-09-25

All commands used the CI main-job placeholders through `/tmp/recopyfast-s37-ci.py`
(Node 22.22.0), without production env files.

| Check | Result |
|---|---|
| `npm run setup` | Root and server installed; 0 vulnerabilities each |
| Focused comparison Jest suites, `--runInBand` | 2 suites, 11 tests passed; final typography fix rechecked |
| `npm run precommit -- -- --runInBand --coverage` | Lint 0 errors / 39 inherited warnings; full type-check passed; Jest 231 suites passed, 4 failed, 2 skipped; 3,122 tests passed, 7 failed, 38 skipped |
| Four affected suites rerun, `--runInBand` | 3 suites passed, 1 failed; 66 tests passed, 1 failed. All six timing-related failures cleared without test changes |
| Coverage | Statements 55.80%, branches 49.38%, functions 51.93%, lines 56.25%; ratchets passed |
| `npm run format:check` | Passed across src; final one-class typography edit also formatted |
| `npm run build` | Passed again after final typography edit; all five compare routes statically prerendered |
| `node scripts/build-embed.mjs --check` | Fresh; bundle 46,474 B <= 46,681; widget 33,717 B <= 33,865 |
| `npm run audit:prod` | 0 vulnerabilities |
| Production-build browser smoke | All 5 routes at 1440, 390 and 320px: HTTP 200, no document overflow, contained tables, valid FAQPage, both CTAs and expected canonicals |
| `git diff --check` | Passed |

Browser inspection found a 7px overflow in the CloudCannon h1 at 320px. Its base
font was reduced to text-4xl while retaining sm:text-6xl; final browser checks passed.
Screenshots are local ignored artifacts under `output/playwright/s37/`. The preferred
Chrome wrapper failed a pageId tool-argument compatibility check; Playwright CLI
provided the real-browser fallback without changing committed E2E tests.

### Delivery blocker

The unchanged `src/__tests__/db/function-grants.test.ts:209` fails on
`update_translation_coverage(uuid) -> authenticated` in the auto-detected local
Supabase database. This same inherited finding is documented at
`docs/reviews/s33-agency-plan.md:133`. The test, DB harness and migrations are
unchanged from c3b2b28. No remote database was contacted or migrated.

The user explicitly requires a green precommit before push. That gate is NOT green,
so no commit, push or draft PR has been attempted. Fixing grants is outside this
marketing-only, no-migrations lane; an explicit gate exception or separate DB repair
is required for delivery. Independent review remains pending.

Marker flips: none. Migrations: none. Dependencies/embed: unchanged. Playwright pinned
count: unchanged at 44. No customer claims, logos, testimonials or usage numbers added.
