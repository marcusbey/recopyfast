---
validated: yes
---
# Plan — Story s06b-embed-fixture-harness

Branch: `feature/s06b-embed-fixture-harness`
Research: `docs/research/s06-embed-budget-gate.md` — read it first; this plan does not repeat it.

## Target story

`s06b-embed-fixture-harness`, split out of `s06-embed-budget-gate` (`docs/stories.md` →
*Revised after research*, complexity 3). Carries **AC 7 and AC 8** of `stories.md:446-447`:
editing, publishing, staging, history, languages and image replacement each working against a
real fixture page, and the widget's contribution to bounded host-page startup CLS.

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

- [x] **1. Two origins, both local, neither of them Next.** `e2e/embed-fixture/servers.ts`:
  a *serving origin* (`node:http`) that returns `public/embed/recopyfast.js` and
  `socket.io-client.min.js` **read from disk** with `content-type: application/javascript`, and a
  *host origin* on a second port serving the fixture page. Ports default to 4181/4182 (4173 is
  taken by `share-edit-publish.spec.ts`) and are env-overridable. Modelled on the proven
  `startTargetServer` at `e2e/share-edit-publish.spec.ts:355-385`, minus its Supabase dependency.
  First spec: the page loads and the widget boots — fails if the artifact path or MIME is wrong.
- [x] **2. Stub the API surface, from the routes.** `e2e/embed-fixture/stub-api.ts`, mounted on
  the serving origin under `/api`. The widget calls ~15 endpoints (`grep "RECOPYFAST_API + '"`):
  `/content/:siteId` GET+POST, `/staging/content/:siteId`, `/staging/validate`, `/staging/verify`,
  `/staging/publish`, `/edit-board/history` GET+POST+`/:versionId`, `/edit-board/languages`
  GET+POST, `/upload/image`, plus the `/ab-tests/*` and `/ai/suggest` calls the boot path makes.
  In-memory, deterministic, and it **records every request** so a spec can assert the widget sent
  what it should. Response shapes are copied from the real `route.ts` files, with the file path in
  a comment beside each.
- [x] **3. Fixture page + flow spec: editing and publishing.** A host page with enough authored
  markup for the widget to discover elements. Drive a real text edit through the widget's own UI
  and assert the DOM changed *and* the stub received the write; then publish and assert the
  publish call carried the edited content. Fails if either branch is dead.
- [x] **4. Flow spec: staging and history.** Enter staging via the widget's staging path, assert
  the staging banner renders (`recopyfast.src.js:1644`) and that an edit lands in staging rather
  than live; open the History tab, assert it lists the stub's versions and that restoring one
  reaches `/edit-board/history/:versionId`.
- [x] **5. Flow spec: language management and image replacement.** Open the Languages tab,
  assert seeded languages render, add a supported language through the actual widget control,
  assert the recorded POST matches the real route contract and the refreshed panel shows it.
  Replace an image through `openImageEditor`; assert the actual multipart file bytes, filename,
  MIME type and site ID, the staging write and changed host `src`. This covers existing language
  add/list behavior, not page-language switching or translation delivery. The user explicitly
  approved this scope amendment on 2026-10-11. Fresh clean six-test and mutation evidence,
  including the independently verified missing-file upload repair, proves this task.
- [x] **6. Startup CLS spec, with the baseline stated.** Two loads of the *same* host page — one
  with the `<script>` tag, one without — collecting `PerformanceObserver` `layout-shift` entries
  (`hadRecentInput === false`) from navigation start through network idle plus the fixed
  `STARTUP_CLS_SETTLE_MS = 750` window. Assert
  **delta ≤ 0.001**, and print both figures. The baseline is the widget-less page, per open
  question 4: "0 absolute" is not measurable on a page whose own images shift. If the delta is
  non-zero today, that is a **finding recorded in the PR** — the threshold does not move to
  accommodate it.
- [x] **7. Make it actually run.** `playwright.embed.config.ts` (its own `testDir:
  e2e/embed-fixture`, **no `webServer`**, chromium only), `npm run test:embed:fixture`, and a
  **new CI job** in `.github/workflows/ci.yml` that runs `npm ci` → `npm run build:embed` →
  the harness. No secrets, no `if:` guard. Since this plan was validated, the existing `e2e`
  job became a strict 86-test disposable-stack gate. The fixture stays separate so it neither
  joins that exact inventory nor acquires Next, Supabase, Redis or WebSocket dependencies.
- [x] **8. Prove the net catches something.** Copy the built artifact to a scratch path, break one
  branch in the copy (e.g. neuter the History tab renderer at `:5894`), serve *that* copy, and
  confirm the harness goes red on the History spec and green on the others. Record the command
  and the observed failure in the PR description. A safety net never tested against a real break
  is a claim, not evidence.

## Recovery implementation state (2026-10-10)

**2026-10-11 superseding decision:** the user approved keeping language add/list in this
test-only story. The language-switch mismatch described in the dated history below is resolved
by that explicit amendment; no product feature is added. All eight implementation tasks now have
local evidence. Final review, PR/current-head CI and manual release remain separate gates.

- The 11-file 2026-09-12 WIP was verified byte-for-byte against the primary preservation archive
  and salvage commit `7490f060`, retained as stash commit `c697a4a2`, then ported without conflict
  from `ee3942dd` onto `origin/main` `0dea1c0`. The retained commit is pinned at
  `refs/recopyfast-recovery/s06b-pre-main-20261010`.
- Tasks 1–4 and 6–8 now have fresh Chromium evidence against the built artifact. The clean local
  run is six of six; CI mode's strict reporter records 6 passed, 0 failed, 0 skipped and 0 flaky.
  The bounded startup CLS figures (navigation through network idle plus 750 ms) are
  `without=0.000000`, `with=0.000000`, `delta=0.000000`. Editing, staging,
  publishing, history restore and image replacement each assert both host/editor state and their
  recorded request. History additionally proves the restored copy reaches the host DOM after the
  widget reloads.
- A fresh credential-free HTTP contract pass exercised 18 requests across content, staging,
  publish, history, language management, image upload, A/B and AI-suggestion endpoints on two
  loopback origins. The stubs were refreshed from the current routes: public content omits staging
  fields and includes `page_path`; publish preview reports current/other-page counts; history
  restore returns the route's boolean; language creation no longer invents the removed
  auto-translate fields.
- The current main Playwright config recursively discovered the fixture directory and produced
  92 tests against its strict expected count of 86. Recovery therefore adds an explicit
  `**/embed-fixture/**` exclusion to the main config and a CI-contract regression test. Fresh
  enumeration proves the main config still owns exactly 86 tests and the isolated config owns six.
- Task 8 was run per spec group through `RECOPYFAST_FIXTURE_ARTIFACT`. Disabling History rendering,
  the publish POST, or Languages rendering each produced exactly one targeted failure and five
  passes; the Languages failure still ran and passed the image test. A delayed layout-shift mutant
  scheduled inside that startup window produced `delta=0.217101`, one targeted startup-CLS failure
  and five passes. The clean artifact remained
  byte-identical to main before and after `npm run build:embed` (`8b43d15e…` as a Git blob).
- Final review then removed the language POST Authorization header from a scratch built artifact.
  The pre-fix harness incorrectly stayed six of six green. Test-first controls now require the real
  staging Bearer credential on both language GET and POST, reject missing and wrong credentials with
  401, and retain the GET site-id plus POST body/render assertions. The exact reviewer mutant
  `d31b5137…` now produces one targeted language failure and five passes; the clean artifact remains
  six of six with no skips or flakes.
- Authenticated Devin review then identified the same request-contract gap on staging publish. The
  permissive stub was observed red at 200 versus the required 401 before repair. Preview GET now
  requires and records exact fixture `siteId`, `page_path=/` and `rcf_token`; publish POST
  requires and records exact `siteId` and `stagingToken`; missing/wrong credential controls for
  both methods return 401 before state mutation. Exact scratch artifact `acb0ce5f…`, which removes
  only the publish POST `editorTokenBody()` call, produces one targeted edit/publish failure and
  five passes. The clean artifact remains six of six with no skips or flakes.
- CI run `38124306716` then exposed a staging/history ordering race: the first attempt asserted
  fixture state while the widget's optimistic DOM already showed the edit but its asynchronous PUT
  had not reached the stub; retry passed, correctly failing the strict zero-flake contract. A
  controlled 400 ms delay before API dispatch reproduced the old `null` state deterministically.
  The spec now waits on the recorded PUT body before reading fixture state, retaining the DOM,
  staged-versus-published and restore assertions. With that pre-dispatch delay, the case passed ten
  consecutive zero-retry runs; the full CI-mode fixture passed six of six with zero flakes.
- Repository gates are green on Node 24: the current source-level embed suite passed 305/305;
  lint exited zero with 34 existing warnings; `format:check`, full and production type-checks,
  build, full Jest (5,571 passed, 38 skipped) and coverage all passed. Coverage reported 71.60%
  statements, 64.70% branches, 68.70% functions and 72.14% lines. The first raw full-Jest run in
  this fresh worktree exposed a current-main hermeticity gap: one content-route test expects the
  `NEXT_PUBLIC_APP_URL` fallback but does not set it. The isolated test failed without that variable
  and passed with CI's non-secret `http://localhost:3000`; the final full-suite and coverage runs
  used that CI value. This is separate from the fixture's proven empty-provider environment.
- Two plan sentences still cannot be implemented without crossing the product-code interdict.
  `POST /api/staging/publish` carries `siteId` plus the editor credential; edited content travels
  in the preceding staging `PUT`, then publish consumes staged rows. The spec pins that real
  two-step contract. The current Languages tab only lists and adds languages; it has no page
  language switch and `sendContentMap()` has no language dimension. The add/list flow is green
  current-behavior evidence, not acceptance of the requested switch. The user decision remains
  pending, so task 5 stays open.
- The unguarded CI job is implemented and its exact command sequence passes locally in CI mode.
  A hosted Actions result necessarily waits for a later authorized push/PR and is not claimed here.

## Run interdicts

- The harness loads `public/embed/recopyfast.js`, the built artifact — never `recopyfast.src.js`. A harness that reads the source cannot fail on anything `s06c` will do.
- The harness runs with no Supabase, no Stripe, no `NEXT_PUBLIC_*` secret and no Next server; if it needs one, it is no longer the unconditional safety net this story requires.
- The fixture page is served from a **different origin** than the script, because that is what a customer install is.
- The CLS threshold may not be raised to make a spec pass.
- No production code changes: this story touches the fixture under `e2e/`, Playwright/CI wiring,
  `package.json`, the existing Playwright CI-contract test, and this plan only.
- The stub mimics response shapes read out of the real `route.ts` files and never becomes the widget's spec — where the two disagree, the route wins and the stub is wrong.
- No byte of the widget changes in this story; a size delta here is out of scope.
- Do not modify `e2e/share-edit-publish.spec.ts` or the existing source-level embed tests.

## The point everything turns on

**A safety net that does not run is not a safety net, and a safety net that reads the source
cannot see the build.** At validation time the general E2E job could self-skip without hosted
credentials; current main replaced that with a strict 86-test disposable stack. Neither shape is
the right owner for this instrument: adding the fixture there would now change the reviewed count
and require Next, Supabase, Redis and the WebSocket server. The source-level embed suites still
load `recopyfast.src.js`, while `s06c`'s `esbuild.transform` flags, CSS minification and property
mangling operate between source and artifact. This plan therefore keeps the built-artifact harness
credential-free, separately counted and unconditional. Task 8 proves those properties by making
each spec group go red on a real scratch-artifact break.

**Where this could be wrong.** A stubbed API proves the widget's branches *execute*; it does not
prove they still agree with the real routes. A shrink that broke a request *contract* — a renamed
field, a dropped header — would pass this harness and fail in production. Mitigation is partial
by construction: shapes are copied from the route files with the path in a comment, and
`e2e/share-edit-publish.spec.ts` remains the real-backend check for the core flow. If a reviewer
judges that insufficient, the alternative is to run the harness against a real Supabase — at
which cost it inherits the disposable stack's setup and provider failure modes and stops being
the unconditional credential-free gate this story needs. Second exposure: JSDOM-free Playwright
Startup CLS numbers are chromium-only and machine-sensitive; the bounded interval does not claim
full-session or field CLS after network idle plus 750 ms. Within that startup interval, the
**delta** between two loads on the same machine is stable in a way an absolute figure is not,
which is why the criterion is written as a delta.

## Files touched

- `e2e/embed-fixture/servers.ts`, `stub-api.ts`, `fixture-page.ts` — new.
- `e2e/embed-fixture/{edit-publish,staging-history,languages-images,cls}.spec.ts` — new.
- `playwright.embed.config.ts` — new.
- `playwright.config.ts` — exclude the isolated fixture from main's strict 86-test inventory.
- `package.json` — one script.
- `.github/workflows/ci.yml` — one new, unguarded job.
- `src/__tests__/e2e/playwright-ci-contract.test.ts` — pin the separate ownership and CI contract.
- `docs/plans/s06b-embed-fixture-harness.md` — checkboxes and recovery evidence.

Not touched: production code under `src/`, anything under `scripts/` or `public/embed/`,
`docs/stories.md`, and `docs/decisions/`.

## Test strategy

The harness *is* the test deliverable, so the strategy is about what makes it trustworthy rather
than what covers it.

- **Every flow spec asserts on two sides**: an observable DOM change on the host page *and* the
  request the stub recorded. A DOM-only assertion passes when the widget renders and never saves;
  a request-only assertion passes when it saves and never renders.
- **Each spec must be able to fail for its own reason.** Task 8's mutation is run per spec group,
  not once — breaking the History renderer must redden the history spec and leave the other three
  green, or the specs are coupled and prove less than they appear to.
- **Determinism before coverage.** Fixed ports, fixed stub responses, and the named 750 ms startup
  settle window; a
  flaky harness will be disabled by the first agent it inconveniences, and then `s06c` ships
  unguarded.
- **Existing suites unchanged.** The current source-level embed suites stay green, main's strict
  Playwright inventory stays at 86, and `e2e/share-edit-publish.spec.ts` is untouched.
- **Runs from a clean checkout**: `npm ci && npm run build:embed && npm run test:embed:fixture`
  with an empty environment. That command, passing on the CI runner, is the story's evidence.

## Definition of Done

- All eight tasks ticked; checkboxes travel in the story commit.
- `npm run test:embed:fixture` passes from a clean checkout with no environment variables set.
- The six AC-7 flows each have a spec that asserts DOM *and* request, all green against the built
  artifact served cross-origin.
- The startup CLS spec reports its navigation-through-network-idle-plus-750-ms boundary, the
  with-widget and without-widget figures, and the delta; the measured delta is stated in the PR
  description whatever it is.
- Task 8's mutation run is reproduced in the PR description: the command, and which spec went red.
- The new CI job runs unconditionally and is green.
- `lint`, `type-check`, `format:check`, `build`, `test` green.
- `public/embed/recopyfast.js` byte-identical to `main`.
- Single PR, `docs/reviews/s06b-embed-fixture-harness.md` ending `Ship allowed: yes`.
