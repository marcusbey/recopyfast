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
  `src/components/sections/Pricing.tsx` renders pricing/availability. The initial
  implementation used an editorial price snapshot; review M2 rejected that choice. Fix mode reads live catalogue/availability and respects the Agency switch.
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
  — client accounts assigned to sites with per-site permissions (Team and higher),
  invitation and password setup. Accounts are unlimited; Duda bills additional sites.
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

## Initial verification history — 2026-09-25 (superseded by fix run)

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

### Initial local blocker and subsequent delivery

The initial run of unchanged `src/__tests__/db/function-grants.test.ts:209` failed on
`update_translation_coverage(uuid) -> authenticated` in the auto-detected local
Supabase database. This same inherited finding is documented at
`docs/reviews/s33-agency-plan.md:133`. The test, DB harness and migrations are
unchanged from c3b2b28. No remote database was contacted or migrated.

Those results describe the initial local attempt, not current delivery state.
Commit `121c9c4` was subsequently pushed as draft PR #34. The independent review
records a fresh full Jest pass (235 suites, 3,101 tests; 2 suites/38 tests skipped).
This record does not infer a historical gate exception. The 2026-09-25 operator
request starts a new fix run with all required gates rerun before push; the original
review remains unmodified and uncommitted, with its blocked verdict intact.

Marker flips: none. Migrations: none. Dependencies/embed: unchanged. Playwright pinned
count: unchanged at 44. No customer claims, logos, testimonials or usage numbers added.

## Fix-mode source verification — 2026-09-25

Re-fetched Duda's official pricing, Editor Overview, Manage Clients and client
permissions pages listed above. The reviewer was correct: unlimited client
accounts are not a seat-based charge; additional published sites are billed per
site. Client accounts are assigned to sites, with per-site permissions (Team and
higher). The visual-builder, layout/design, preview/publish, hosted-site and
plan-dependent white-label claims remain supported. The false pricing contrast
is replaced with the existing-hosting versus Duda-builder distinction. No Duda
numeric price is copied into editorial content.

Webflow's cited documentation already establishes draft state and separately
permissioned publishing; draft-then-publish is removed as a differentiator.
The comparisons explicitly credit competitors' served-HTML delivery and disclose
ReCopyFast's browser-after-load behavior, original HTML without JavaScript and
for non-rendering crawlers, and source updates for SEO-critical copy.

## First fix-mode verification — 2026-09-25 (historical, ba25a30)

Commands use `/tmp/recopyfast-s37-fix-ci.py`, which reads only the main CI job's
placeholder environment and uses official Node 20.15.1. No production environment
files, remote migrations, live Stripe or hosted database credentials were used.

- Initial focused red: 11 tests failed and 6 passed across 3 suites.
- Focused green: 3 suites, 21 tests passed.
- Mutation proof: reversing editor access caused 4 failures; hardcoding an incorrect
  table price caused 7; using FAQ questions as answers caused 4. Each mutation was
  restored before the final green run.
- `npm run precommit -- -- --runInBand --coverage --silent --no-cache`: passed;
  lint 0 errors / 39 inherited warnings, full type-check passed, Jest 236 suites
  passed / 2 skipped, 3,111 tests passed / 38 skipped / 0 failed (3,149 total).
  Coverage: statements 55.89%, branches 49.43%, functions 52.02%, lines 56.35%;
  all ratchets passed.
- `npm run format:check`: passed across src.
- `~/.asdf/installs/nodejs/20.15.1/bin/node scripts/build-embed.mjs --check`:
  fresh; bundle 46,601 / 46,681 B, widget 33,837 / 33,865 B, transport 13,141 B.
- `npm run audit:prod`: 0 vulnerabilities.

The initial full-gate attempt stopped at 9 JSX lint errors, which were fixed.
An intermediate type-check and a Jest run hit ENOSPC, not an assertion failure.
Only this worktree's generated Next/Jest/coverage caches were cleared; the final
standard type-check and full gate above passed without disabling checks or
changing test timeouts. No audit markers flipped and no migrations were added.

- `npm run build`: passed under official Node 20.15.1; `/compare` is static and
  all four detail pages are dynamic. Prebuild produced identical embed bytes.
- Local production-browser smoke with `AGENCY_CHECKOUT_ENABLED=false`: all five
  routes at 1440, 390 and 320px returned 200 (15 renders), without document overflow.
  Every detail page disclosed unavailable Agency checkout; FAQ answers matched
  their visible paired descriptions, BreadcrumbList and titles were correct, and
  signup CTAs carried comparison UTM tags. Unknown slug returned 404; sitemap
  contained all five URLs. Desktop Duda and mobile CloudCannon screenshots were
  visually inspected in ignored `output/playwright/s37-fix/`.
- Preferred Chrome wrapper failed with an undefined `pageId`; Playwright CLI
  supplied the browser evidence. No committed Playwright tests or count changed.
- `git diff --check`: passed. Independent review SHA-256 remains
  `79765b7cf06c91609487cfaed4d194af4136c3e212bf34973fe02834108812dc`.

At that delivery, all C1/M1/M2 and m1-m9 fixes were implemented. The then-blocked
review was preserved for its owner; the subsequent re-review and narrow fix
mode 2 below supersede that historical verdict status.
The operator authorizes this fix commit/push to the existing draft PR, not release.


## Narrow fix mode 2 — N1 and n1–n7 (2026-09-25)

The supplied re-review is ship-allowed with one major documentation correction
and seven minor fixes. It remains unmodified and uncommitted, with SHA-256
`a21878a0bc17782402e64a3ff5d3d9f2460181eb62b2713441c362c69c12dd0f`.

### Decision and scope evidence

Initial fetched origin/main was `c3b2b28`. The final pre-commit fetch found
`cbfb922` (s35/#33); it is merged into the fix commit, preserving every story
entry from both branches. All local gates are rerun on the combined tree. Inventoried `docs/decisions` on every local
and fetched remote branch: s34 owns ADR 031; 032 is unused. ADR 020 is restored
byte-for-byte from origin/main; ADRs 012/013 are not edited. New ADR 032 records
`/compare` supersession, s17 dynamic-route migration and Lighthouse scope, and
explicit deferral of SoftwareApplication JSON-LD to s17. PRD Technical SEO and
s17's schema acceptance criterion remain outstanding.

### Official claims rechecked

Read-only official-source research on 2026-09-25 (DeepAPI credentials absent;
official-site web fetch fallback):

- [Duda Manage Clients](https://support.duda.co/hc/en-us/articles/26519392519575-Manage-Clients):
  “Available on Team plans and higher.” and “There is no limit to how many clients
  you can create.” The [pricing table](https://www.duda.co/pricing) has no client
  accounts allowance for Basic. Unlimited client accounts therefore apply only
  to plans that include client management, not all Duda plans or unlimited sites.
- [Tina developer editing documentation](https://tina.io/tinadocs/docs/using-tinacms/usage-developers):
  “In production mode (with TinaCloud), changes are committed directly to your Git
  repository.” Local mode writes local files instead.
- [Tina Editorial Workflow](https://tina.io/docs/tinacloud/editorial-workflow):
  protected-branch editing uses a separate branch and draft pull request, then
  merges to the protected branch; approval is not the default save path.
- [Tina separate content repository guide](https://tina.io/docs/guides/separate-content-repo):
  a content-change webhook can trigger a site rebuild. Thus updated served HTML
  depends on the site's build/deploy configuration; this is a conditional
  implementation consequence, not a universal TinaCMS delivery guarantee.

### Runtime and pricing boundary

Comparison detail pages use five-minute revalidation instead of per-request
rendering and availability RPCs. They read database `plans.price_monthly` and
Founding availability. The landing `/#pricing` component reads `/api/pricing`,
which overlays available live Stripe `unit_amount` values on the database
catalogue. The existing operator catalogue verification runbook owns drift
checks; this task makes no live Stripe call. Cached availability may lag by
five minutes; checkout remains the enforcement point.

### Verification

- Targeted TDD red: missing revalidate exports, Duda/Tina exact row mismatches,
  missing index disclosure and missing shared canonical resolver failed as expected.
- Targeted green: 4 suites / 28 tests passed (comparison pages, discovery, pricing,
  and shared site URL). All 24 competitor row claims are literal-pinned independently
  of the production registry; disclosure assertions cover both index choice paragraphs,
  detail competitor-choice blocks and Integration boundaries. Rendered table cells
  also pin every exact claim after the bounded review improvement.
- Mutation proof: changing a Webflow competitor row produced 1 failure / 17 passes;
  removing the index platform disclosure produced 1 failure / 17 passes. Both were
  restored and the final focused run passed.
- The shared canonical resolver keeps the original layout/robots/sitemap precedence;
  its 3 tests pin explicit app URL, stable Vercel URL, deployment URL and fallback.
  The index selects Best at, Installation and Delivery by row label, not position.
- Independent read-only docs review: passed, no blockers. No reviewer verdict was
  written or changed by this fix lane.

Final local gates, all with the exact CI main-job placeholders and Node 20.15.1:

- Lint: passed, 0 errors / 39 inherited warnings.
- Both `type-check` and `type-check:build`: passed.
- `format:check`: passed across src.
- Full Jest with coverage: 241 suites passed / 2 skipped; 3,173 tests passed /
  38 skipped / 0 failed (3,211 total). Coverage: statements 57.02%, branches
  50.51%, functions 53.52%, lines 57.49%; all ratchets pass.
- Rendered-row test strengthening after review: focused comparison suite 18/18
  passed; all six rendered rows per competitor now assert exact literal claims.
- Build: passed. All four details prerender with 300-second revalidation; checked
  `.next/prerender-manifest.json` rather than relying only on source exports.
- Embed check using official Node: fresh, bundle 46,601 / 46,681 B; widget
  33,837 / 33,865 B; transport 13,141 B. No generated embed diff.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Local built-server smoke: all five URLs 200, unknown comparison 404, updated
  Duda/Tina wording and original-HTML disclosures present. Each detail response
  emits `s-maxage=300`; index remains static. Only localhost:3137 was contacted.
- Independent source/test re-review: passed after pinning rendered cells.
  `git diff --check` and review checksum verification pass.

No production operation is authorized or performed. The review remains the only
intentionally uncommitted file after delivery; SoftwareApplication is explicitly
deferred to s17, not claimed implemented.
