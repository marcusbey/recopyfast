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

## Incoming Devin follow-up — pending re-review

PR #99 thread `PRRT_kwDOPc_I2s6reyz2` reproduced loss of authored descendant text when an
already-edited child receives a newly discovered parent. The parent captures only its owned
prefix, but route cleanup restores that prefix as a complete original and blanks the child.
The earlier independent verdict is superseded for this head. The PR is draft while the
regression, capture-scope repair, order-independent restoration and independent re-review run.

Max severity: critical
Ship allowed: no

## PR #99 follow-up re-review — final stable source, 2026-10-12

The incoming Devin finding is closed. This review binds to source SHA-256
`e012083864740b670b010b735c515e579d54bb6dbb1c56d63aa85b17312f096d` and generated artifact
SHA-256 `cefe75e9ba9ffde17ba4555f658a6b6c354f79d983617f48d3a5f826342bcf65` over base
`b890368`.

Discovery now records an explicit partial-capture bit only when the ownership walk actually prunes
an applied descendant with the exact mapped element identity. This covers an applied empty child;
it does not infer scope from owned/aggregate string inequality. Complete originals retain ADR 066's
whole-element restore, including its documented ability to blank a shared child that applied later.
Late partial parents follow ADR 068 and restore through the ownership writer.

Route cleanup snapshots every departing entry's restore eligibility before writing. It then restores
in total reverse document order while every mapping remains available, so descendants precede
ancestors regardless of `Map` insertion order or an interleaved unrelated entry. A second pass removes
markers and mappings. Shared-id descendants remain mapped, and restoring a partial parent makes zero
text writes inside them. Immediate detached-entry cleanup retains its prior one-entry path and uses the
same captured scope.

The byte-funding changes are equivalent in the reviewed contexts. Multi-node `append` calls build
detached native subtrees before their single insertion into the live document; single live insertions
ignore both the old and new return values. The four lexical-`this` callback clusters preserve the
former `self` receiver, including socket listeners and asynchronous publish handlers. The array
membership substitutions compare the same string values. No discovery spacing, trailing report,
per-page cap, shadow-root observation, write cap or 200 ms rescan hold changed.

### Independent verification

- Node 24.14.0 / zlib 1.3.1-e00f703 through `/tmp/recopyfast-with-test-env.py` for every Node,
  npm and Jest command.
- The focused affected scope passed 9/9 suites and 155/155 tests with `--runInBand --no-cache`.
- Neutralizing only partial restoration back to the old whole-element writer made 5/60
  `embed-spa` tests red: both page-scoped record orders, the retained shared child, the empty child
  and the three-level ancestor. The exact source hash was restored before the green run.
- The generated-artifact Chromium fixture passed 7/7 with no failure, skip or flake. Its nested case
  covers both late-parent insertion orders and the shared-child zero-mutation result.
- The final generated artifact is current at bundle 45,769 B ≤ 45,801 B, widget
  32,992 B ≤ 33,044 B and transport 13,141 B. The ceilings are unchanged.
- Author gate evidence on the same final runtime: lint 0 errors / 34 inherited warnings, format,
  type-check and type-check:build green; full Jest 484 suites / 6,964 tests passed with 2 suites /
  38 database-gated tests skipped; the production build completed compile, type checking and
  120/120 static pages. This reviewer did not duplicate the full suite or production build after the
  focused, mutation and browser runs passed.

### Not verified

No production host, provider, paid API or production environment was used. Real customer routers,
browsers other than bundled Chromium, an invited-editor account, cross-device behavior and the
public-host 200 ms first-paint acceptance target remain outside this local code review.

No new finding was identified.

Max severity: none
Ship allowed: yes

## Current-main pre-integration review — 2026-10-16 (`a58b6fc`)

Story head `a57bf708a15077c812a62071cf4a7d9739ecbc4d` remains internally clean. Its reviewed embed source
and generated artifact still have SHA-256 values
`e012083864740b670b010b735c515e579d54bb6dbb1c56d63aa85b17312f096d` and
`cefe75e9ba9ffde17ba4555f658a6b6c354f79d983617f48d3a5f826342bcf65`. Under Node 24.14.0,
`node scripts/build-embed.mjs --check` reports the artifact current at 45,769 / 32,992 / 13,141
gzipped bytes under unchanged ceilings, and the four directly changed Jest suites pass **4 suites /
88 tests**. The prior late-ancestor neutralization remains bound to these exact source hashes.

Current main and s67b overlap in only two files. `docs/stories.md` needs the usual additive story
resolution. `src/__tests__/e2e/playwright-ci-contract.test.ts` needs both independent contract
updates: current main's strict application inventory is **106**, while s67b raises only the separate
credential-free embed-fixture inventory from **6 to 7**. The correct combined result keeps every
main-side 106-test assertion and fake-GA check, changes the embed-harness prose/assertion to seven,
and retains `playwright.embed.config.ts` at `expected: 7`. Neither side should overwrite the other.

No application, embed-source, generated-artifact, ceiling or runtime conflict was found. The late
ancestor Devin finding remains closed on the exact reviewed source. However, this is a
pre-integration assessment: the combined `a58b6fc` tree has not yet been materialized or tested.
After the mechanical two-file resolution, rerun the Playwright CI contract, the three focused embed
suites and the Node 24 artifact check, then record a final integration verdict. Hosted checks and a
fresh private Devin run remain separate release evidence.

Max severity: none
Ship allowed: no

## Final current-main integration review — 2026-10-16 (`a58b6fc`)

The combined tree is now materialized as an in-progress merge of current `main`
`a58b6fc2e63975bef1c0bbe7506360828c49c2b9` into story head
`a57bf708a15077c812a62071cf4a7d9739ecbc4d`. It has no unmerged index entries and passes
`git diff --check` plus `git diff --cached --check`. The only story/main overlap resolutions are
the additive story ledger and the Playwright CI contract identified above.

The resolved CI contract correctly preserves both independent inventories: the application suite
remains **106** with its fake-GA build assertion, while the separate credential-free embed fixture
is **7** in both the test and `playwright.embed.config.ts`. The resulting story delta against
`MERGE_HEAD` remains the reviewed 15-file s67b change. The embed source and generated artifact still
match the final Devin-fix review hashes exactly; no production widget behavior or ceiling changed
during integration.

Fresh independent Node 24.14.0 verification passed the CI-contract plus the three directly changed
embed suites: **4 suites / 89 tests**. The generated artifact check also passed at 45,769 / 32,992 /
13,141 gzipped bytes under ceilings 45,801 / 33,044 / 13,141. The previously reviewed
late-ancestor neutralization remains applicable to the unchanged source hash. No LSP diagnostic was
required for the integration delta: it changes only test contract prose/assertions and the additive
Markdown ledger, while the JavaScript embed source is byte-for-byte unchanged.

No new finding was introduced. This closes the pre-integration hold and permits the ordinary merge
commit and current-head hosted checks. It does not claim that those hooks/checks, a fresh private
Devin run, production deployment, real-customer routers, cross-browser behavior or the public-host
200 ms acceptance gesture have completed.

Max severity: none
Ship allowed: yes

## Current-main integration review — 2026-10-16 (`8733f9d`)

Current main advanced through s108 to `8733f9d859284fe500fc5e02c5442c2674d0614f`. Its clean,
no-commit merge into s67b head `00da9de89749cbf4fbed237ebacaf9202df908b5` has no unmerged
entries and passes both diff checks. The resulting delta against `MERGE_HEAD` remains the reviewed
15-file s67b story; none of the embed source, generated artifact, size gate, fixture, nested-edit
tests or accepted ADRs changed during this refresh.

The embed source and artifact SHA-256 values remain
`e012083864740b670b010b735c515e579d54bb6dbb1c56d63aa85b17312f096d` and
`cefe75e9ba9ffde17ba4555f658a6b6c354f79d983617f48d3a5f826342bcf65`. The combined CI contract
still preserves the 106-test application inventory, fake-GA build assertion and separate seven-test
embed fixture. The incoming s108 release also remains intact: both bulk routes use native
`randomUUID()`, direct `uuid`/`@types/uuid` roots remain absent, and only LHCI's nested UUID node
remains.

Fresh independent Node 24.14.0 verification passed both s108 route suites and the combined
Playwright CI-contract suite: **3 suites / 33 tests**. The generated artifact check passed at
45,769 / 32,992 / 13,141 gzipped bytes under unchanged ceilings. The late-ancestor neutralization
continues to bind to the unchanged embed source hash. No LSP diagnostic was required because this
integration delta changes neither s67b nor s108 source.

No new finding was introduced. The ordinary merge commit and current-head hooks may proceed.
Hosted checks, production deployment, fresh private Devin availability, real-customer routers,
cross-browser behavior and the public-host 200 ms gesture remain separate evidence.

Max severity: none
Ship allowed: yes

## Released-s69a integration review — 2026-10-16 (`cc6ac07`)

Current main now includes released s69a at
`cc6ac07e05af0380c8aea202b768643ec0f424b6`. Its clean no-commit merge into s67b head
`704e8d26a9819171f92bbc18488e723cb12be12f` has no unmerged entries and passes both diff checks.
The resulting delta against `MERGE_HEAD` remains exactly the reviewed 15-file s67b story; every
embed source, generated artifact, size gate, fixture, nested-edit test and accepted ADR is unchanged.

The embed source/artifact SHA-256 values remain
`e012083864740b670b010b735c515e579d54bb6dbb1c56d63aa85b17312f096d` and
`cefe75e9ba9ffde17ba4555f658a6b6c354f79d983617f48d3a5f826342bcf65`. The released s69a
migration is preserved at SHA-256
`ec048ba9faa41f5aa4e54e61a0d7cbaa56bb06446fe508b32d71ed30a3695812`, with its route/tests and
replay registration unchanged from main. The combined CI contract still pins 106 application
tests, fake GA and seven separate embed-fixture tests; the story ledger retains s67b, s69a, s108 and
s113.

Fresh independent Node 24.14.0 verification passed both s69a route suites and the Playwright CI
contract: **3 suites / 69 tests**. The generated artifact remains current at 45,769 / 32,992 /
13,141 gzipped bytes under unchanged ceilings. Prior nested-edit and s69a neutralizations remain
bound to unchanged hashes. No LSP diagnostic was required because this refresh changes neither
s67b nor s69a source.

No new finding was introduced. The ordinary merge commit and current-head hooks may proceed.
Hosted checks, production deployment, fresh private Devin availability, real-customer routers,
cross-browser behavior and the public-host 200 ms gesture remain separate evidence.

Max severity: none
Ship allowed: yes
