# Research — Story s17-cluster-engine

Refreshed 2026-10-10 against `origin/main` `0dea1c05babed48834ecc72700cfebef01ae6733`.
The September research and partial source are preserved in the recovery snapshot referenced
by the plan. They are historical, not current absence claims.

## Verified current repository facts

- ADR032 replaces `/alternatives` with `/compare`, explicitly preserving the four s37 URLs
  and assigning dynamic-route migration, validation, shared schemas and Lighthouse to s17.
- `src/lib/compare/comparisons.ts` exports a four-slug union, typed data, `comparisonList`,
  pricing-row lookup and `createComparisonMetadata`. It lacks the planned structural runtime
  content validator. Entries already include honest fit statements and official-source links.
- Four explicit `src/app/compare/<slug>/page.tsx` wrappers call the same renderer and
  `loadComparisonPricing`, and each revalidates every300seconds. They must be replaced, not
  left to shadow a dynamic route. The hub and Footer discovery already exist.
- `src/components/compare/ComparisonPage.tsx` provides the approved marketing layout and
  builds FAQPage/BreadcrumbList inline. It distinguishes Agency disabled/unavailable and
  Founding sold-out/availability failure; do not replace these contracts with a guessed price.
- s88 shipped `src/lib/seo/json-ld.ts` with SoftwareApplication and safe serialization,
  `catalogue-offers.ts`, site identity and shared site URL helpers. Catalogue offers exclude
  free and disabled Agency, omit one-time capacity-limited products and return no offers
  on failure. Reuse them rather than restoring the legacy untracked SEO modules wholesale.
- `src/lib/seo/llms-txt.ts` generates comparison links from `comparisonList`; sitemap and
  hub also consume that registry. Existing tests pin truthful product copy and discovery.
- Current package scripts contain no Lighthouse command. ADR013 still mandates Lighthouse
  and numeric lab thresholds; ADR032 moves its scope to hub plus every comparison URL.
  The old PR16 lockfile-ordering note is no longer an implementation prerequisite. A new
  dev dependency still requires the human approval stated in the refreshed plan.
- Current design-system docs explicitly place comparisons on the pinned-light sky/slate
  Marketing surface. The old design's objection to data-theme pinning is superseded by
  the accepted docs and actual s37 renderer.

## Integration considerations

s79 is being finished on a separate branch. Its marketing-to-auth links require full document
navigation to establish nonce CSP, including comparison signup CTAs and shared Header.
Preserve that fix when branches integrate. s89 owns drafts-only blog behavior; s17 neither
fixes nor copies the old auto-publication route. New competitor facts need current official
source verification before content is implemented; historical WIP copy is not proof.

## Evidence boundaries

This refresh is source inspection and planning. No s17 implementation, dependency install,
Lighthouse measurement or production verification has been performed. The user approved the refreshed plan and development-only `@lhci/cli` on2026-10-10;
its implementation gates remain unexecuted. Local snapshots preserve11/18/11files across s06b/s17/s25 respectively;
s17's own snapshot contains18files plus binary patches and hashes.

## Current official-reference validation (2026-10-10)

The three added comparisons were checked against current official documentation. Contentful
role/workflow claims now distinguish plan-dependent features, and its preview FAQ distinguishes
Content Preview setup from the SDK required for live updates/inspector mode. Storyblok custom
roles/workflows are qualified by plan. Decap no longer implies every backend requires an OAuth
proxy or rebuild. The four inherited entries keep their September fact-check dates; new entries
carry October dates. Retrieval and source links are retained at the primary checkout's
`.omx/ultragoal/evidence/s17/reference-check/official-reference-check.md`.

The same reference check verified stable `@lhci/cli`0.15.1 with Lighthouse12.6.1 (Node>=18.20),
five-run median assertions and filesystem reports. Existing `tsx` resolves the registry helper
and produces the exact eight URLs; no additional transpilation dependency is needed. Metadata
compatibility is not a measured Node24/Lighthouse pass; local/CI measurements remain open.

## Applied-mobile measurement decision (2026-10-11)

The owner approved ADR 061's applied DevTools mobile method after three bounded diagnostics. The
retained mono-only simulated run measured performance 88–89 and LCP 3,735–3,892 ms across all eight
five-run medians; CLS and TBT passed. Removing the root loading boundary did not change that result,
and global inline CSS worsened LCP while expanding HTML to 436,832 bytes. Both probes were restored.

The full applied diagnostic used Lighthouse 12.6.1 `devtools`, mobile 412 x 823 at scale 1.75,
562.5 ms request latency, 1474.56 Kbps download, 675 Kbps upload and 4x CPU. Its 40 reports measured
performance 98–99, LCP 1,643–1,679 ms, CLS <= 0.0107 and TBT 82–94 ms without changing thresholds,
run count or aggregation. Evidence is under the primary checkout's
`.omx/ultragoal/evidence/s17/applied-mobile-all-routes/` and
`lighthouse-font-probe-summary.json`.

That applied build predates the `dynamicParams = false` real-404 fix. It proves why the methods are
not interchangeable, not that the final source passes. Sentry's static pre-hydration entry remains
outside this amendment; the Lighthouse fixture has no DSN and is not live telemetry proof.
