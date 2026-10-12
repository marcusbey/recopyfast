# Review — s67b-nested-edit-composition

Reviewer: fresh-context `reviewer` subagent, 2026-10-12. Diff:
`git diff origin/main...feature/s67b-nested-edit-composition` (merge-base `bc6e503`;
implementation commit `da0738c`).

## Verdict summary

The research, accepted ADR 066, validated plan and implementation agree on applied-descendant
ownership, exact element identity, whitespace preservation, editor/realtime/variant composition,
whole-parent compatibility and whole-element route restoration. Plan tasks 1–4 are present; task 5's
independent review is this gate. The new Playwright fixture imports resolve and execute against the
generated artifact. The size ledger is internally consistent under the repository runtime, and the
ceilings went down rather than up.

One route-restoration branch violates the accepted whole-element exception and reproduces duplicated
copy. Because this can ship wrong public text during ordinary same-document navigation, the finding is
critical and blocks shipping.

## Findings

### Critical

1. `public/embed/recopyfast.src.js:3733,3744,3823-3824` — whole-element route restoration can return
   before it reaches the whole-element writer. `dropEntry` correctly asks
   `applyContentToElement(data, data.originalContent, true)` to restore the complete authored parent,
   but `applyContentToElement` first compares `content` with ownership-aware
   `getElementText(target)`. If the parent's applied owned text happens to equal its original aggregate
   text, that comparison returns early even though an applied child still differs. The child is then
   restored separately, duplicating its authored text.

   Reproduced with an added-and-restored Jest probe: boot page-scoped
   `<h1>Buy <span>now</span></h1>` with only the child's published edit (`now` → `today`), apply a
   realtime parent update of `Buy now`, then navigate through the Navigation API. Expected route
   restoration is parent `Buy now` with the child blank until the host renders the new route. Actual
   result is `Buy nownow` with child `now`. This violates ADR 066 decision 5 and plan task 3. The
   existing navigation case uses parent copy `Shop `, so its owned-mode comparison differs from
   `originalContent` and does not cover this equality branch. Make the early comparison use whole text
   when the whole restore flag is set, and retain this exact regression case.

## Verification

- Runtime: Node 24.14.0, zlib 1.3.1-e00f703, always through
  `/tmp/recopyfast-with-test-env.py`.
- Targeted Jest: 4 suites / 80 tests passed (`embed-spa`, React writes, size gate and Playwright CI
  contract).
- Full Jest: 484 suites / 6,956 tests passed; 2 database-gated suites / 38 tests skipped.
- Generated-artifact Chromium fixture: 7 passed, 0 failed, including nested composition.
- `node scripts/build-embed.mjs --check`: artifact current; bundle 45,790 B ≤ 45,801 B, widget
  33,019 B ≤ 33,044 B, transport 13,141 B.
- Anti-hallucination neutralization: changing the ownership guard to exclude every mapped child,
  rather than only an applied exact-node child, made 3 of 59 SPA/React tests red (the convergence
  mutation count in both suites and legacy whole-parent behavior). The source was restored and
  `git diff --exit-code HEAD` proved the source, test and generated artifact clean before this report.
- The adversarial route probe above made 1 test red with expected `Buy now`, received `Buy nownow`;
  the temporary test was removed and proved clean before reporting.

## Plan, API and rule checks

No unplanned dependency, migration, API, authorization, rate-limit or production configuration change
is present. `startFixtureServers`, `waitForWidget`, fixture constants and fixture types exist at the
imported locations; the real Chromium run exercised them. The generated artifact is derived from
`recopyfast.src.js`. Discovery's 10-second spacing, trailing report, ten-report page cap, open shadow-root
walk and the 200 ms rescan hold remain present. The behavior-funding changes are local callback,
collection and DOM-removal equivalents; the targeted suites and browser fixture passed with them.

## Not verified

No production host, provider, paid API or production environment was used. The existing SPA E1–E5
suite, real customer frameworks, browsers other than bundled Chromium, a real invited-editor session,
cross-device behavior and the public 200 ms first-paint acceptance target were not independently run in
this review. Those gestures remain required after the critical fix and a fresh review.

Max severity: critical
Ship allowed: no

## Re-review after fix `ce1dc95` — 2026-10-12

The critical finding is closed. Whole-element restoration now selects aggregate text for its
pre-write comparison through `getElementText(element, whole)`, while discovery, overwrite repair,
editor preview and `dropEntry` keep their one-argument owned-text reads. All call sites are direct;
the optional argument is never supplied by `map`, `forEach` or another callback that could pass an
unintended numeric index. The writer receives the same explicit whole-mode predicate, so comparison
and mutation now use the same mode.

Independent verification under Node 24.14.0 / zlib 1.3.1-e00f703:

- The exact equality regression passed in Jest: 1 passed, 52 unrelated tests skipped.
- Reverting only the mode-aware comparison to its old owned-only call made that test red with
  expected `Buy now`, received `Buy nownow`. Restoring the repair made it green again, and
  `git diff --exit-code HEAD` proved source, regression tests, generated artifact and Chromium
  fixture identical to the fix commit.
- All embed Jest scopes passed: 27 suites / 351 tests.
- The generated-artifact Chromium fixture passed 7/7, including the same route-restoration equality
  branch in the nested-composition case.
- The generated artifact is current at bundle 45,798 B ≤ 45,801 B, widget 33,027 B ≤ 33,044 B and
  transport 13,141 B. Neither ceiling changed.
- The full Jest suite was not duplicated after this two-line repair; the implementation evidence
  records 6,957 passed with 38 database-gated skips. The previous independent review ran the full
  pre-fix suite (6,956 passed), and the added test plus the relevant post-fix scopes above account for
  the changed behavior.

No new finding was identified. The production, real-customer, cross-browser and invited-editor
gestures listed above remain deployment-stage evidence rather than blockers to this code review.

Max severity: none
Ship allowed: yes
