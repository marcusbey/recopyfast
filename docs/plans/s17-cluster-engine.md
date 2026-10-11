---
validated: yes
validated_on: 2026-10-10
previously_validated: yes
validation_reopened: 2026-09-12
refreshed: 2026-10-10
---
# Plan — Story s17-cluster-engine

Branch: `feature/s17-cluster-engine`. Current implementation baseline to reconcile:
`origin/main` `0dea1c05babed48834ecc72700cfebef01ae6733`.
Research: `docs/research/s17-cluster-engine.md`. Design: `docs/designs/s17-cluster-engine.md`.
Binding decisions: ADR 012, ADR 013, ADR 020, and their route supersession ADR 032.

## Validation scope

**2026-10-11 approved measurement amendment:** the user explicitly approved applied-mobile
Lighthouse. Task 6 now uses `throttlingMethod: "devtools"`, mobile 412x823 at device scale 1.75,
562.5 ms request latency, 1474.56 Kbps download, 675 Kbps upload and 4x CPU slowdown. Preserve
all four numeric limits, five sequential runs and median aggregation on all eight registry URLs.
Validate every report's resolved profile and required finite metrics. Add immutable ADR 061;
do not edit ADR 013 or Sentry's pre-hydration contract. Prove profile/threshold failure controls,
then final-source local evidence and two same-SHA hosted runs. Earlier simulated failures and
pre-404 applied diagnostics remain historical evidence, not final acceptance. Task 6 stays open
until these gates pass. The approved implementation surface is the LHCI config, runner,
contract tests, workflow labels, research/plan and new ADR; no unrelated product changes.

This replaces the September plan for `/alternatives`. Preserve the four live `/compare`
URLs (webflow-editor, duda, tinacms, cloudcannon), their differentiated content, metadata,
pricing behavior and layout. Add contentful, storyblok and decap-cms: seven detail pages
plus the existing hub. Reuse s88's site identity, SoftwareApplication builder, catalogue
loader, serializer and generated llms.txt. Do not reimplement their shipped work.

The user explicitly approved this refreshed scope and the development-only
`@lhci/cli` dependency already selected by ADR 013. No other dependency is proposed.
The original plan remains preserved with all source WIP in the recovery evidence; no
implementation was authorized before this checkpoint. Execution may now follow this validated plan.

## Acceptance criteria

- [x] The seven canonical comparison URLs use one typed, runtime-validated data module
  and one dynamic detail route. Existing URLs and unique metadata remain unchanged.
- [x] Every comparison states concrete competitor advantages and limits of ReCopyFast;
  new claims link to current official sources and are checked before publication.
- [x] Each detail page emits SoftwareApplication, FAQPage and BreadcrumbList JSON-LD,
  with FAQ/schema agreement and no fabricated prices, ratings or reviews.
- [x] Adding one valid data entry automatically adds its route, hub, sitemap, llms.txt
  and Lighthouse target without a separate route wrapper or URL list edit.
- [x] Unknown slugs return a real 404. There is no duplicate `/alternatives` cluster.
- [ ] The hub and every detail pass ADR 013's blocking Lighthouse lab thresholds:
  performance >=90, LCP <=2500ms, CLS <=0.1, TBT <=200ms. No claim of field INP proof.

## Tasks (ordered; tests before behavior changes)

1. [x] **Recover onto current main without losing WIP.** Verify the saved source hashes and
   salvage `origin/wip/s17-cluster-engine` at `e67f0ce9`. Preserve the existing dirty work
   in a local recovery commit before a normal main merge; resolve obsolete SEO files in
   favor of the current s88 contracts, retaining useful validator/content work in the
   canonical comparison module. Remove obsolete unshipped alternatives/llms duplication
   only after its useful behavior has been accounted for. Never reset, clean or force-push.
   Proof: preservation manifest, recorded conflicts/decisions and unchanged existing-page tests.
2. [x] **One validated comparison registry.** Extend `src/lib/compare/comparisons.ts` rather
   than adding a parallel alternatives model. Validate slug uniqueness/key agreement,
   nonempty unique metadata, required row labels, at least three concrete fit statements
   on each side, four or more unique FAQs, safe official source URLs and complete required
   content. Retain shared truthful product caveats; do not ban legitimate shared wording.
   Add tests rejecting malformed fixtures and proving a valid new fixture is discoverable.
   Refresh official-source research for contentful/storyblok/decap-cms before writing their
   distinct entries; reuse useful preserved copy only after checking its claims.
3. [x] **Dynamic route, preserved URLs.** Replace the four explicit detail wrappers with
   `src/app/compare/[competitor]/page.tsx`. Await Next16 params; resolve only own registry
   entries, call `notFound()` for unknown values, use `generateStaticParams` and the existing
   `createComparisonMetadata`, `loadComparisonPricing`, `revalidate = 300` and renderer.
   Keep the hub and marketing frame. Test all seven slugs, inherited metadata, hostile/unknown
   slugs and HTTP404 against the production build. No wrapper may shadow the dynamic route.
4. [x] **Shared structured data with truthful catalogue offers.** Add generic FAQPage and
   BreadcrumbList builders beside s88's `buildSoftwareApplicationLd` in
   `src/lib/seo/json-ld.ts`; use `serializeJsonLd` for every emitted script. Replace the
   renderer's inline builders and emit SoftwareApplication using shared site identity and
   `loadCatalogueOffers`. Preserve the independently displayed Agency/Founding pricing
   contract. Test FAQ visible/schema equality, breadcrumb URLs, script-close escaping,
   Agency disabled and catalogue failure: no stale/fallback offers or ratings.
5. [x] **Automatic discovery and a data-only extension proof.** Keep `comparisonList` as
   the source for hub, sitemap and existing s88 `buildLlmsTxt`. Wire the dynamic params and
   performance target enumeration to it. Test exact seven-route coverage, no alternatives
   URLs, no invented modification dates, and a fixture entry flowing through all consumers
   without editing their source. Preserve the shared Footer link and attributed signup CTA;
   incorporate s79's full-document navigation boundary when integrating that story.
6. [ ] **Blocking Lighthouse job.** After explicit dependency approval, select and pin a
   Node24-compatible stable `@lhci/cli` using its current official documentation. Add one
   `lighthouse:ci` command and committed configuration following ADR013 and ADR061. Pin the
   approved applied-mobile profile and validate it in every emitted report. Derive eight URLs
   from the same registry (hub plus seven details), not a hand-maintained list. Build/serve
   the actual production app on loopback using disposable public fixtures, warm the routes,
   then run a documented repeat/aggregation policy with blocking numeric assertions. Save
   credential-free reports as CI artifacts. No production credentials, live paid API calls,
   score suppression or threshold reduction. Prove an intentionally failing threshold
   makes the command/job fail, then restore and measure every required URL locally and in CI.
7. [ ] **Browser, integration and delivery gates.** Capture before/after for the existing
   comparison surface and new content at mobile/desktop widths; check navigation, visible
   FAQs, long copy/table overflow and unknown-slug404. Run lint, type-check,
   type-check:build, format:check, build, tests/coverage, audit:prod and relevant E2E.
   Declare changed test contracts and update the strict Playwright inventory if tests are
   added. Fresh independent ks-review must pass; draft PR/automated review/current-head CI
   precede ready status. Manual merge and production verification remain separate gates.

## Recovery execution note (2026-10-10)

- Recovery is on `0dea1c05` without lost source: all 18 archived files match the preservation
  manifest and salvage `e67f0ce9` remains intact. The retained Git stash commit
  `0ce4ddcd1acf81f7d09d9668f84aa505992a2223` is pinned at
  `refs/recopyfast-recovery/s17-pre-main-20261010`; it is the recoverable pre-main WIP object,
  not a claim that the obsolete September source passed commit hooks.
- Registry, shared schema and data-only extension tests pass. Independent source review checked
  all seven slugs, own-property lookup, preservation of the four existing metadata/content/pricing
  contracts, safe shared JSON-LD serialization and all five discovery consumers. Tasks 6 and 7
  remain open for performance and delivery evidence. The s79 navigation
  boundary is tracked for the combined release because s79 remains a separate unmerged PR.
- Production build, full type-check after regenerated route types and repaired fetch-mock typing,
  and the production dependency audit pass. The audit reports zero vulnerabilities. Full coverage
  also exits zero: 416 suites and 5,612 tests passed with 38 known database-dependent skips;
  coverage is 72.21% lines and 64.82% branches (`coverage-after-routing.log`). Performance,
  independent review, PR/current-head CI and production verification remain separate open gates.
- The approved `@lhci/cli` dependency is pinned at `0.15.1`. A semantic lockfile comparison
  found one new root dev dependency, 207 added transitive package nodes, zero removed nodes and
  zero version changes among packages already present on main; the large textual diff is lockfile
  ordering around that approved graph, not an unrelated upgrade.
- Task 6's runner, five-run median configuration, loopback-only Next server, registry-derived
  eight-URL invocation, filesystem-manifest validation, package command and unconditional read-only
  CI workflow are implemented. Source review removed path filters so every pull request and every
  main push runs the gate; this avoids another incomplete transitive-dependency list. Seven focused
  contract tests pass, LHCI healthcheck finds the committed config and Playwright Chromium, and the
  runner resolves exactly the hub plus seven detail URLs. The task stays unchecked until the heavy
  local eight-route run, intentional threshold-failure control and hosted CI result exist.
- The intentional failure control will change only the committed LCP ceiling from `2500` to `1`
  with `apply_patch`, run the same `npm run lighthouse:ci` command, require exit 1 while retaining
  40 filesystem reports, restore `2500` with `apply_patch`, then rerun clean. This is deferred until
  the shared browser slot is available; no alternate config or environment override can weaken CI.
- Official-source corrections changed three pinned test contracts, and only those expectations:
  Contentful's Editor access and Publishing rows now qualify plan-dependent permissions/workflows;
  Storyblok's Editor access row now qualifies custom roles/workflows by supporting plan. The
  six-suite engine check passes 57/57 after the updates.
- Performance probe 1 changes only JetBrains Mono's Next font option to `preload: false`. The first
  unchanged 40-report run failed every route at 4.0–4.2 s LCP and showed the unused mono face as a
  40,941-byte high-priority preload. The font variable, family, weights, styles, layout, copy and
  Lighthouse thresholds remain unchanged. This is a measured hypothesis, not a proven fix, until
  the exact eight-route, five-run gate is rebuilt and rerun.
- Performance probe 2 removed only the root `src/app/loading.tsx` after exact preservation under
  `.omx/ultragoal/evidence/s17/root-loading-probe/`. Its complete 40-report run still failed every
  route's LCP, so the result did not justify removing the public pending-navigation skeleton. The
  file was restored byte-for-byte (SHA-256 `e6d424ec…`, Git blob `f48ffa6…`); dashboard's nearer
  loading file was never changed. The diagnostic is rejected and no loading behavior is adopted.
- Performance probe 3 added only `experimental.inlineCss: true` after exact config preservation
  under `.omx/ultragoal/evidence/s17/inline-css-probe/`. All 40 reports still failed: median LCP
  was 4,030–4,036 ms and performance was 87, worse than the mono-only probe's 3,735–3,892 ms, while
  HTML grew to 436,832 bytes. The result confirms the documented global duplication cost (CSS in
  initial HTML and RSC, without separate stylesheet caching) outweighed any removed request
  waterfall here. `next.config.ts` was restored byte-for-byte (SHA-256 `7f43268f…`, Git blob
  `7aa574d…`). The experiment is rejected; no inline-CSS option or threshold change is retained.
- The existing SEO canonical integration test previously imported the seven removed static route
  wrappers by interpolated path. Its adapter now imports the actual `[competitor]` route module and
  passes each registry slug through `layerOf({ competitor })`, preserving Next's real
  `accumulateMetadata` chain and every per-route canonical and Open Graph assertion. This is an
  intended test-contract update for PR disclosure; no wrapper or weaker URL assertion was added.
- Production HTTP probes found `/compare/not-a-real-competitor`, `/compare/__proto__` and
  `/compare/constructor` returning 200: page-level `notFound()` ran after the root loading boundary
  had streamed its shell. Installed Next 16 documents `dynamicParams = false` as returning 404 for
  a dynamic value absent from `generateStaticParams`, so the detail segment now exports that one
  restriction while retaining registry-derived params, `revalidate = 300`, metadata and rendering.
  The rebuilt production app succeeded, and the request-only Playwright proof passed 2/2: all eight
  registered routes returned 200, while all three recorded paths returned 404 without redirecting
  (`build-real-404.log`, `production-404-green.log`). The function-level hostile-slug test remains
  useful, but production HTTP now owns the acceptance result.
  A request-only Playwright spec now owns that production contract in two tests (known registry
  routes 200; the three recorded unknown/hostile paths 404 without redirect), raising the strict
  Playwright inventory from 86 to 88. Its no-server focused config reproduced the immutable
  pre-fix build red at 200, then passed against the rebuilt candidate.
- Browser evidence under `.omx/ultragoal/evidence/s17/browser-proof/` reaches all seven detail pages
  from the hub and back through each breadcrumb at 390×844 and 1440×900. Every page rendered its
  expected heading and four FAQs with no document overflow; the comparison table remained the one
  labeled horizontal scroll region on mobile and keyboard scrolling worked. The JSON summary and
  screenshots preserve the observations. This closes the responsive/navigation slice of task 7,
  while its full gates, independent review, PR/CI and production checks remain open.
- The approved applied-mobile amendment is implemented in config, runner validation, focused
  contract tests, workflow labels and ADR 061. The focused LHCI contract suite passes 8/8 under
  Node 24. Changing only `devtools` back to `simulate` fails the pinned-profile test, and restoring
  `devtools` passes it. Independent preflight then found Lighthouse serializes the approved
  1474.56 Kbps download value as `1474.5600000000002`; the validator now accepts only
  machine-epsilon numeric drift, a faithful fixture pins that representation, and a 0.00001 Kbps
  change still fails. The repaired validator accepts the complete retained corpus (8 routes,
  40 reports, 8 representatives). Task 6 remains open: the threshold mutation, clean 40-report
  final-source run and two same-SHA hosted runs require the shared browser/performance slot.


- Final approved local Lighthouse acceptance passed on2026-10-11 after all three independent
  source findings were repaired. The exact command produced40 distinct reports across8 routes,
  five runs per route, with all80 JSON/HTML paths globally unique and every resolved mobile profile,
  URL and required finite metric verified. Median ranges: performance97–98, LCP1688–1731ms,
  CLS0.000922–0.010677, TBT122–154ms. The intentional1ms LCP control failed exactly its8 intended
  assertions, preserved40 valid reports, and the approved2500ms config was restored byte-exact.
  Final clean BUILD_ID was `yym7ZNYTgn42vGFBVBFS-`; app/runner/config hashes stayed unchanged
  during collection, with review/design documentation changes recorded separately. Local proof
  is archived under `.omx/ultragoal/evidence/s17/applied-final-clean-20261011/`; this does not
  replace the two required same-SHA hosted runs or the remaining delivery/production gates.

## Scope limits

No blog generation/publication changes (s89), s18/s19 implementation, new marketing design,
provider settings, migrations, runtime dependency or duplicate content/SEO engine. No
existing ADR is edited. A required architectural departure gets a new ADR and approval;
it does not silently substitute a different performance metric or weaken a threshold.

## Preservation

Pre-refresh working files, index/worktree patches and SHA256 manifest are saved under the
primary checkout's `.omx/ultragoal/evidence/legacy-preservation/20261010T120752Z/s17/`.
The historical HTML design remains evidence of the old proposal, not the current implementation target.
