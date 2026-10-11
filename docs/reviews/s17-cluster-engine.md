# Review — s17-cluster-engine

Reviewer: fresh-context `reviewer`, 2026-10-11. Candidate: complete story diff on `feature/s17-cluster-engine` against `origin/main` `0dea1c05babed48834ecc72700cfebef01ae6733`. Source and the initial review were committed through normal hooks as `c8c25ab`; the final reviewed amend adds the route unit test that the first staging pass missed and this resolved review verdict.

## Verdict summary

The reviewed source now implements the validated comparison-engine scope without an unresolved code finding. Seven canonical comparisons share one runtime-validated registry and one dynamic detail route. The four existing URLs and their metadata, claims, pricing states, and renderer remain present; Contentful, Storyblok, and Decap CMS add distinct, dated, first-party-sourced copy. Registry data drives static params, the hub, sitemap, llms.txt, and the eight Lighthouse targets. Unknown and prototype-shaped slugs are rejected with the production 404 contract, and no `/alternatives` route exists.

Detail pages emit shared FAQPage, BreadcrumbList, and SoftwareApplication JSON-LD through the shared safe serializer. Catalogue failures omit structured offers; visible Agency/Founding states remain catalogue-backed and fail closed. The hub now uses the same FAQ builder and serializer. The registry also enforces the live-pricing marker only on the ReCopyFast `Pricing model` row, so a future data-only entry cannot validate with hardcoded product pricing.

The Lighthouse workflow is unconditional for pull requests and main pushes, read-only, pinned, Node 24, and capped at 45 minutes. Its runner targets only an explicit loopback origin, derives all eight URLs from the registry, warms the built routes, uses Playwright Chromium, saves filesystem reports, cleans its working directory, and validates every report's requested/final URL, finite metrics, and exact ADR 061 applied-mobile profile. The config retains five-run median assertions at performance 0.90, LCP 2500 ms, CLS 0.1, and TBT 200 ms.

## Findings and repair verification

The first source pass found two major issues and one minor issue:

1. manifest entry counts did not require distinct JSON and HTML files;
2. the comparison hub still built and serialized FAQ JSON-LD inline; and
3. registry validation allowed a `Pricing model` row to replace catalogue-backed ReCopyFast pricing with arbitrary text.

All three are fixed. A second review found the first manifest repair still allowed one path to occupy both JSON and HTML roles; the final repair uses one global resolved-path set across both fields.

Independent Node 24.21.0 verification:

- focused comparison/registry/schema/Lighthouse set at the first repair freeze: 6 suites / 57 tests passed;
- final Lighthouse contract after the runner-only follow-up: 1 suite / 12 tests passed;
- an independent copied-corpus probe rejected duplicate JSON, duplicate HTML, same-entry JSON-as-HTML, cross-entry JSON-as-HTML, and cross-entry HTML-as-JSON paths;
- the clean copied corpus and retained real failure-control corpus each validated 8 routes / 40 reports / 8 representatives;
- restored config SHA-256 `33415cc022dd139c412d18920f4c60b573792c6448dc50b292d4d687fa0f34ce`;
- final runner SHA-256 `bb6fa0014bec7fe0667257956e154010d9e077a28b2aa70f12334b972fe6b9ba`;
- `git diff --check origin/main` passed.

The writer's post-repair production build passed with build ID `yym7ZNYTgn42vGFBVBFS-`. Only the live runner and its contract test changed afterward; neither enters the Next application build. The normal story commit then passed lint, full type-check, format check, and 416 Jest suites / 5,619 tests, with 38 known database-dependent skips. Production type-check and `audit:prod` also passed with zero production vulnerabilities.

The independently reviewed final local Lighthouse archive contains 40 JSON and 40 HTML files at 80 globally unique paths. All 89 archived checksums pass; every report has the exact URL and approved applied-mobile profile. Independently recomputed medians pass on all eight routes: performance 97-98, LCP 1688.283-1731.235 ms, CLS 0.000922-0.010677, and TBT 122.100-153.992 ms. Run-start, post-run, built-source, config, runner, and build-ID provenance agree; concurrent changes were documentation-only and the measured non-doc tree remained byte-identical.

The reviewed route unit file `src/app/compare/[competitor]/__tests__/page.test.tsx` derives every static param from the registry, checks all seven inherited metadata/render inputs, preserves 300-second revalidation, and proves hostile/unknown slugs call `notFound()` before pricing or offer reads. The full 5,619-test run included it; it is part of the final amend.

## Anti-hallucination and architecture check

The reviewed imports and APIs exist in the installed source: Next 16 async params, `generateStaticParams`, `dynamicParams`, `notFound`, `loadComparisonPricing`, `loadCatalogueOffers`, site URL/identity helpers, shared JSON-LD builders, Playwright Chromium, and local LHCI 0.15.1. The lockfile adds the approved exact development dependency and its transitive graph without changing an existing package version.

The implementation follows ADRs 012, 013, 032, and 061. It keeps the Marketing surface, catalogue source of truth, honest browser-applied-copy caveat, first-party source boundary, and s79 integration note. When branches integrate, s79's native full-document Marketing-to-auth navigation must win over this branch's inherited `Link` CTA; that is an integration requirement, not a defect in this isolated s17 diff.

## PR-readiness and evidence boundaries

The code and local story acceptance reviewed here pass. The intentional 1 ms LCP control failed while retaining a structurally complete corpus; the restored 2500 ms configuration then passed the clean final-source 40-report run.

Before the draft PR can be marked ready, the dedicated Lighthouse workflow must pass twice on the same pushed commit and current-head GitHub CI must be green. Those hosted checks calibrate runner stability and the 45-minute job budget; they remain mandatory PR-readiness evidence, but they do not change this source-review verdict. The existing responsive before/after and production 200/404 evidence must remain attached to the PR.

Manual merge, deployment, and production verification are downstream human/release gates and are not prerequisites for `Ship allowed: yes`.

Max severity: none
Ship allowed: yes
