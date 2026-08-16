---
validated: no
---
# Plan — Story s06b-embed-fixture-harness

Branch: `feature/s06b-embed-fixture-harness`
Research: `docs/research/s06-embed-budget-gate.md` — read it first; this plan does not repeat it.

## Target story

`s06b-embed-fixture-harness`, split out of `s06-embed-budget-gate` (`docs/stories.md` →
*Revised after research*, complexity 3). Carries **AC 7 and AC 8** of `stories.md:446-447`:
editing, publishing, staging, history, languages and image replacement each working against a
real fixture page, and the widget's contribution to host-page CLS.

**This story sequences before `s06c` and is the reason `s06c` is reviewable at all.** Trap 3 of
the research: the 43 existing embed tests cover editor auth, element ids and the handoff
round-trip, and **none of them touches the Edit Board, the tabs, image replacement, staging or
history**. AC 6 ("full embed suite passes unchanged") can therefore be satisfied while all six of
AC 7's flows are broken. Worse for `s06c` specifically: all 43 load `recopyfast.src.js`, the
*source* — so a build-level change (esbuild flags, CSS minification, property mangling) cannot
fail a single one of them.

No UI. This story builds an instrument; it does not shrink a byte and does not change a shipped
file. Nothing a customer or an operator sees is different afterwards.

## Tasks (ordered)

- [ ] **1. Two origins, both local, neither of them Next.** `e2e/embed-fixture/servers.ts`:
  a *serving origin* (`node:http`) that returns `public/embed/recopyfast.js` and
  `socket.io-client.min.js` **read from disk** with `content-type: application/javascript`, and a
  *host origin* on a second port serving the fixture page. Ports default to 4181/4182 (4173 is
  taken by `share-edit-publish.spec.ts`) and are env-overridable. Modelled on the proven
  `startTargetServer` at `e2e/share-edit-publish.spec.ts:355-385`, minus its Supabase dependency.
  First spec: the page loads and the widget boots — fails if the artifact path or MIME is wrong.
- [ ] **2. Stub the API surface, from the routes.** `e2e/embed-fixture/stub-api.ts`, mounted on
  the serving origin under `/api`. The widget calls ~15 endpoints (`grep "RECOPYFAST_API + '"`):
  `/content/:siteId` GET+POST, `/staging/content/:siteId`, `/staging/validate`, `/staging/verify`,
  `/staging/publish`, `/edit-board/history` GET+POST+`/:versionId`, `/edit-board/languages`
  GET+POST, `/upload/image`, plus the `/ab-tests/*` and `/ai/suggest` calls the boot path makes.
  In-memory, deterministic, and it **records every request** so a spec can assert the widget sent
  what it should. Response shapes are copied from the real `route.ts` files, with the file path in
  a comment beside each.
- [ ] **3. Fixture page + flow spec: editing and publishing.** A host page with enough authored
  markup for the widget to discover elements. Drive a real text edit through the widget's own UI
  and assert the DOM changed *and* the stub received the write; then publish and assert the
  publish call carried the edited content. Fails if either branch is dead.
- [ ] **4. Flow spec: staging and history.** Enter staging via the widget's staging path, assert
  the staging banner renders (`recopyfast.src.js:1644`) and that an edit lands in staging rather
  than live; open the History tab, assert it lists the stub's versions and that restoring one
  reaches `/edit-board/history/:versionId`.
- [ ] **5. Flow spec: languages and image replacement.** Open the Languages tab, switch language,
  assert the content-map request carries the new language and the DOM re-renders. Replace an
  image through `openImageEditor` (`:4358`) and assert `/upload/image` received a body and the
  `src` changed.
- [ ] **6. CLS spec, with the baseline stated.** Two loads of the *same* host page — one with the
  `<script>` tag, one without — collecting `PerformanceObserver` `layout-shift` entries
  (`hadRecentInput === false`) until network idle plus a fixed settle window. Assert
  **delta ≤ 0.001**, and print both figures. The baseline is the widget-less page, per open
  question 4: "0 absolute" is not measurable on a page whose own images shift. If the delta is
  non-zero today, that is a **finding recorded in the PR** — the threshold does not move to
  accommodate it.
- [ ] **7. Make it actually run.** `playwright.embed.config.ts` (its own `testDir:
  e2e/embed-fixture`, **no `webServer`**, chromium only), `npm run test:embed:fixture`, and a
  **new CI job** in `.github/workflows/ci.yml` that runs `npm ci` → `npm run build:embed` →
  the harness. No secrets, no `if:` guard. The existing `e2e` job self-skips whenever
  `E2E_SUPABASE_URL` is unset (`ci.yml:140-148`) — a harness added there would never run.
- [ ] **8. Prove the net catches something.** Copy the built artifact to a scratch path, break one
  branch in the copy (e.g. neuter the History tab renderer at `:5894`), serve *that* copy, and
  confirm the harness goes red on the History spec and green on the others. Record the command
  and the observed failure in the PR description. A safety net never tested against a real break
  is a claim, not evidence.

## Run interdicts

- The harness loads `public/embed/recopyfast.js`, the built artifact — never `recopyfast.src.js`. A harness that reads the source cannot fail on anything `s06c` will do.
- The harness runs with no Supabase, no Stripe, no `NEXT_PUBLIC_*` secret and no Next server; if it needs one, CI will skip it and it is not a safety net.
- The fixture page is served from a **different origin** than the script, because that is what a customer install is.
- The CLS threshold may not be raised to make a spec pass.
- No production code changes: this story touches `e2e/`, `package.json`, a new Playwright config and `ci.yml` only.
- The stub mimics response shapes read out of the real `route.ts` files and never becomes the widget's spec — where the two disagree, the route wins and the stub is wrong.
- No byte of the widget changes in this story; a size delta here is out of scope.
- Do not modify `e2e/share-edit-publish.spec.ts` or any of the 43 existing embed tests.

## The point everything turns on

**A safety net that does not run is not a safety net, and a safety net that reads the source
cannot see the build.** Both failure modes are live in this repo today: the `e2e` CI job
self-skips without `E2E_SUPABASE_URL`, and all 43 embed tests load `recopyfast.src.js`. `s06c`'s
whole toolkit — `esbuild.transform` flags, CSS-block minification, `mangleProps` — operates
between the source and the artifact, in exactly the gap neither of those covers. So this plan
spends its complexity on two properties before it spends any on coverage: **the artifact is what
loads**, and **zero credentials are required**. Task 8 exists because those two properties are
still only a claim until the harness has been shown going red on a real break.

**Where this could be wrong.** A stubbed API proves the widget's branches *execute*; it does not
prove they still agree with the real routes. A shrink that broke a request *contract* — a renamed
field, a dropped header — would pass this harness and fail in production. Mitigation is partial
by construction: shapes are copied from the route files with the path in a comment, and
`e2e/share-edit-publish.spec.ts` remains the real-backend check for the core flow. If a reviewer
judges that insufficient, the alternative is to run the harness against a real Supabase — at
which cost it inherits the `e2e` job's skip and stops running, which is the worse failure. Second
exposure: JSDOM-free Playwright CLS numbers are chromium-only and machine-sensitive; the
**delta** between two loads on the same machine is stable in a way an absolute figure is not,
which is why the criterion is written as a delta.

## Files touched

- `e2e/embed-fixture/servers.ts`, `stub-api.ts`, `fixture-page.ts` — new.
- `e2e/embed-fixture/{edit-publish,staging-history,languages-images,cls}.spec.ts` — new.
- `playwright.embed.config.ts` — new.
- `package.json` — one script.
- `.github/workflows/ci.yml` — one new, unguarded job.
- `docs/plans/s06b-embed-fixture-harness.md` — checkboxes.

Not touched: anything under `src/`, `scripts/`, `public/embed/`, `docs/stories.md`,
`docs/decisions/`.

## Test strategy

The harness *is* the test deliverable, so the strategy is about what makes it trustworthy rather
than what covers it.

- **Every flow spec asserts on two sides**: an observable DOM change on the host page *and* the
  request the stub recorded. A DOM-only assertion passes when the widget renders and never saves;
  a request-only assertion passes when it saves and never renders.
- **Each spec must be able to fail for its own reason.** Task 8's mutation is run per spec group,
  not once — breaking the History renderer must redden the history spec and leave the other three
  green, or the specs are coupled and prove less than they appear to.
- **Determinism before coverage.** Fixed ports, fixed stub responses, fixed settle window; a
  flaky harness will be disabled by the first agent it inconveniences, and then `s06c` ships
  unguarded.
- **Existing suites unchanged.** `npm test -- src/__tests__/embed` stays at 43 green, and
  `e2e/share-edit-publish.spec.ts` is untouched.
- **Runs from a clean checkout**: `npm ci && npm run build:embed && npm run test:embed:fixture`
  with an empty environment. That command, passing on the CI runner, is the story's evidence.

## Definition of Done

- All eight tasks ticked; checkboxes travel in the story commit.
- `npm run test:embed:fixture` passes from a clean checkout with no environment variables set.
- The six AC-7 flows each have a spec that asserts DOM *and* request, all green against the built
  artifact served cross-origin.
- The CLS spec reports the with-widget and without-widget figures and asserts the delta; the
  measured delta is stated in the PR description whatever it is.
- Task 8's mutation run is reproduced in the PR description: the command, and which spec went red.
- The new CI job runs unconditionally and is green.
- `lint`, `type-check`, `format:check`, `build`, `test` green.
- `public/embed/recopyfast.js` byte-identical to `main`.
- Single PR, `docs/reviews/s06b-embed-fixture-harness.md` ending `Ship allowed: yes`.
