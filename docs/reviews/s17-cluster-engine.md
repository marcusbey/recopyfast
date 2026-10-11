# Review — s17-cluster-engine

Reviewer: fresh-context `reviewer`, 2026-10-11. Candidate: complete story diff on `feature/s17-cluster-engine` against `origin/main` `0dea1c05babed48834ecc72700cfebef01ae6733`; hosted acceptance was reopened on exact head `e0019c792f675d824b84b46cb970e7f1b8b0ab61`.

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

## Prior local approval and evidence boundaries

The code and local story acceptance reviewed here pass. The intentional 1 ms LCP control failed while retaining a structurally complete corpus; the restored 2500 ms configuration then passed the clean final-source 40-report run.

This source and local evidence produced the earlier `Max severity: none` / `Ship allowed: yes` verdict. It remains valid dated evidence, but the subsequent hosted result below supersedes its ship decision.

Manual merge, deployment, and production verification are downstream human/release gates and are not prerequisites for `Ship allowed: yes`.

## Historical hosted acceptance failure on prior head

The first mandatory hosted Lighthouse attempt on exact head `e0019c7` produced a valid 40-report corpus with the exact approved profile, but every route failed the committed TBT <= 200 ms threshold. Independently recomputed medians are 236.849-277.251 ms. Performance, LCP, and CLS pass; current-head CI also passes, including strict Playwright 88/88 with zero failed, skipped, or flaky tests. Neither result cancels the dedicated TBT gate.

The failure is systematic across all eight routes and five runs per route, so it is not an incomplete artifact, profile mismatch, duplicate-path defect, or isolated outlier. The reports support host-sensitive parse/evaluation/layout work as a diagnosis direction, but host sensitivity is not permission to relax ADR 013's threshold.

Required closure is a bounded source repair followed by a clean first hosted Lighthouse run and a second pass on the same repaired SHA, with current-head CI green. Constraints remain unchanged: no threshold/profile/run-count relaxation, no deferral of synchronous pre-hydration Sentry, and no competing AuthModal lazy import because s79 already removes it from the integrated marketing path. The failed head must not be rerun merely to sample for green.

That required closure is now satisfied on the stacked exact head, as documented in the final section below.

Independent assessment: `.omx/ultragoal/evidence/s17/hosted-verification-20261011/hosted-attempt1-independent-assessment.md`.

## Stacked s79 candidate source verification — 2026-10-11

The frozen non-production merge has s17 `e0019c7` as `HEAD`/first parent, approved s79 `a768ca5` as `MERGE_HEAD`/second parent, and common base `0dea1c0`; no unmerged index path remains. Independent comparison of all 1,586 tracked files against the measured s17+s79 probe found exactly two differences: this review and the s17 plan's integration execution note. Every product, test, workflow, package/lock, Header, Sentry-client, Lighthouse-config, and runner byte matches the measured probe.

The candidate's 42-path visible diff against s79 has the exact same name/status set as the original s17 diff against the common base. The only merge conflicts were the three strict Playwright inventory files, resolved consistently to 93 = 86 inherited + 2 s17 + 5 s79. The saved fresh boundary proof remains 93 listed tests and 6 Jest suites / 83 tests passed.

Header and Sentry hashes match approved s79 exactly. The applied-mobile profile, five-run medians, and all four numeric limits are unchanged. This verifies the stacked source and PR-diff boundary; it does not close the hosted TBT failure. Full evidence: `.omx/ultragoal/evidence/s17/stacked-candidate/independent-review.md`.

## WebSocket hook-timeout diagnostics — 2026-10-11

The first stacked normal hook reproduced an intermittent 15-second connection/lifecycle timeout in an approved s79 WebSocket integration row. The exact row then passed 11 isolated runs; a later full-file failure moved to an unrelated key-rotation handshake, whose exact row passed 10 isolated runs. This is not a reproduced authorization or stacked-product regression, and the underlying timeout class remains unresolved.

The only follow-up source is test diagnostics. `waitForHandshake` preserves each existing predicate and 15-second deadline, then appends allowlisted socket/manager/engine/transport booleans or state plus the count of tracked errors. It does not expose auth values, messages, tokens, URLs, socket/site/editor ids, queries, headers, or payloads. Its new fail-path test asserts the exact state/count output and proves a seeded sensitive auth-error message is absent. No server, retry, timeout, assertion, dependency, or product behavior changed.

The writer's five post-diagnostic full-file runs passed 455/455 with type-check, focused lint, formatting, and diff checks green. Those passes show the diagnostic is non-regressive; they do not prove the intermittent timeout fixed because it did not recur. Independent delta review found no diagnostic defect. Evidence: `.omx/ultragoal/evidence/s17/stacked-candidate/websocket-timeout-diagnosis/independent-review.md`.

## Final stacked exact-head acceptance — 2026-10-11

The prior hosted TBT major is closed on reviewed source head `ad175824ad858d2e5ca60bae773b2ddf5cc2681d`. CI run `38135556546` passed, including the strict Playwright inventory at 93 expected / 93 total / 93 passed / 0 failed / 0 skipped / 0 flaky. Server dependency security run `38135556901` also passed on the same head.

Two distinct attempts of Lighthouse workflow run `38135556522` then passed on that exact SHA. Independent raw-artifact review verified both downloaded archives byte-for-byte against their extracted corpora, recomputed all medians from the 80 Lighthouse JSON reports, and checked all 184 captured hashes:

- attempt 1 artifact `11701396398`, archive SHA-256 `7e45ff256041948b1d65ac5f1d1dcd198475d5135f466dee9e1c24e96eb9e260`: 40 reports / 8 exact URLs / 5 runs per URL / 8 representatives / 80 globally distinct report paths; median performance 96-97, LCP 1673.366-1686.994 ms, CLS 0.001092-0.015045, and TBT 171.361-179.121 ms;
- attempt 2 artifact `11702056992`, archive SHA-256 `05e184e07bd47723a187364cc8df2e9bd62d49c3a1b71bd8f9f193f43d86f776`: the same complete inventory; median performance 98-99, LCP 1620.024-1637.301 ms, CLS 0.001092-0.015045, and TBT 82.573-100.870 ms.

Every report preserves the approved ADR 061 applied-mobile profile and exact loopback URL, contains finite required metrics, and passes the unchanged performance >= 0.90, LCP <= 2500 ms, CLS <= 0.1, and TBT <= 200 ms five-run-median thresholds. The artifact ids, digests, filenames, and corpora are distinct while the workflow run id and head SHA agree.

Fresh independent Node 24.21.0 verification on the frozen tree passed 15 focused comparison, registry, dynamic-route, SEO, Lighthouse/Playwright-contract, Header, CSP, and document-boundary suites with 206/206 tests. The exact sanitized WebSocket diagnostic test also passed. That focused diagnostic result does not change the limitation recorded above: the intermittent inherited WebSocket suite timeout remains unresolved and is not claimed fixed.

The final merge topology remains correct: s17 `e0019c7` is the first parent, approved s79 `a768ca5` is the second parent and merge base, and the visible diff against s79 is all 42 original s17 paths plus only the two reviewed diagnostic-only WebSocket test paths. Header and Sentry stay byte-identical to approved s79; Lighthouse config and runner retain their independently pinned bytes. No new actionable source, test, workflow, or artifact finding was identified.

This verdict approves the s17 source/configuration stacked on exact approved s79. A subsequent review/plan documentation-only commit may move the PR SHA without invalidating these same-source Lighthouse proofs; current-head CI after that commit remains a PR-readiness gate. Parent/main refresh, the human decision to merge it, deployment, and production proof remain separate downstream gates and are not prerequisites for this source-review verdict.

Final independent evidence: `.omx/ultragoal/evidence/s17/stacked-candidate/final-review-20261011/independent-final-review.md`.

Max severity: none
Ship allowed: yes
