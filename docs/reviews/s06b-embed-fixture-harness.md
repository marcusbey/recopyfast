# Review — Story s06b-embed-fixture-harness

> Fresh-context review by the `reviewer` subagent. Reviewed the complete story diff from
> `origin/main` (`0dea1c05`) through PR head `d0b13de9`, plus the frozen CI timing repair in
> `servers.ts`, `staging-history.spec.ts`, the plan and this review.
> Draft PR: <https://github.com/marcusbey/recopyfast/pull/88>.
> No product UI changes, so design-system and customer screenshot review do not apply.

## Plan compliance

- [x] **Task 1:** two separately bound loopback origins serve the customer fixture and the
  committed built artifact with JavaScript MIME. The boot test proves the page and script origins
  differ and the staging widget initializes.
- [x] **Task 2:** the in-memory API covers the widget endpoints named by the plan, records method,
  path, query, headers, JSON/raw/multipart bodies, and returns shapes checked against the current
  route handlers. Narrow upload, language and staging-publish credential checks prevent the stub
  from manufacturing success when a required wire field disappears; the stub does not pretend to
  implement backend authorization policy.
- [x] **Task 3:** a real widget gesture edits the host DOM, records the staging write, proves the
  published row is initially unchanged, pins preview `siteId` / `page_path` / `rcf_token` and POST
  `siteId` / `stagingToken`, then publishes the staged value and clears the draft. Missing or wrong
  fixture credentials are refused before state mutation.
- [x] **Task 4:** staging validation/banner, draft-only state, history list, Bearer credential,
  restore request, restored fixture state and restored host DOM are all asserted. The spec waits
  for the exact recorded staging PUT before reading fixture state, so an optimistic DOM update
  cannot race the asynchronous write dispatch.
- [x] **Task 5:** the user-approved 2026-10-11 scope is implemented exactly: existing language
  list/add, including site id, POST body and staging Bearer contract, plus image upload with exact
  file bytes/name/type/site id, site Bearer, staging write and changed host `src`. No language
  switching or translation-delivery feature was invented.
- [x] **Task 6:** the same host page is measured with and without the widget from navigation start
  through network idle plus the named 750 ms startup settle window. Only shifts without recent
  input count; the printed delta remains gated at `<= 0.001`. This is bounded Chromium startup-lab
  evidence, not lifetime/session or field CLS.
- [x] **Task 7:** the isolated config owns exactly six Chromium tests with no `webServer`; the main
  config excludes the fixture and still owns exactly 93 tests. The unguarded, credential-free CI
  job performs install, browser install, embed build and fixture run.
- [x] **Task 8:** scratch built-artifact mutations produce targeted red tests while unrelated
  fixture cases remain green. No product source or generated artifact was mutated.
- [x] Scope stayed within the plan: fixture/Playwright/CI wiring, package script, contract test and
  story documentation. No dependency, route, migration or product-runtime change landed.

## Anti-hallucination and contract review

- [x] Every new import and called API was opened and verified. Node 24 supplies the HTTP, `Request`
  multipart and server-close APIs used by the harness; Playwright supplies the page/request/config
  surfaces; the existing strict reporter accepts the configured expected count/output file.
- [x] Stub response and request shapes were checked against the current content, staging,
  publish, history, languages, upload, A/B and AI route handlers. The built artifact's exact
  endpoints, fields and credentials used by the named flows were checked as well.
- [x] The harness reads `public/embed/recopyfast.js`, not the source.
  `node scripts/build-embed.mjs --check` reports the artifact fresh at 45,828 bundle / 33,062
  widget / 13,141 transport gzipped bytes.
- [x] Accepted ADRs are preserved. In particular, ADR 004's forbidden external Socket.io loader
  is not introduced; existing startup and build-size tests still pin the bundled transport. The
  fixture adds no fourth authorization path and changes no service-role boundary.
- [x] AGENTS.md's permanent artifact URL, degrade-not-break, generated-source and no-secret rules
  are respected.

## Tests and verification

### Post-Devin focused proof, run by the reviewer on the frozen repair

- `CI=1 npm run test:embed:fixture` — **6 passed, 0 failed, 0 skipped, 0 flaky**.
- Exact immutable credential-less publish mutant
  `acb0ce5fa988cf35e8d71ba4b5610b52f0bd2d29ba7afd246df5b4e69b49544b` — **5 passed, 1
  targeted edit/publish failure, 0 skipped, 0 flaky**. The failure showed the POST retained
  `siteId` but lacked `stagingToken`; CLS, boot, language, image and history remained green.
- `NEXT_PUBLIC_APP_URL=http://localhost:3000 CI=1 npm test -- src/__tests__/e2e/playwright-ci-contract.test.ts --runInBand`
  — **12/12 passed**.
- `git diff --check` and product-file diff checks — passed after the clean and mutant runs.

### Post-CI staging/history timing repair

- CI run `38124306716` correctly failed the strict flake gate: first attempt observed optimistic DOM
  text before the PUT reached fixture state; retry passed; overall result remained red at one flaky.
- The repaired fixture delays the exact staging PUT by 400 ms **before** dispatch into `StubApi`,
  then polls for its exact recorded body before direct state reads. Recording and row mutation are
  synchronous with no intervening `await`, so observing the record establishes that mutation has
  completed on the same Node event loop.
- Fresh reviewer command
  `npx playwright test --config=playwright.embed.config.ts staging-history.spec.ts --retries=0`
  — **1/1 passed with no retry available**.
- Retained implementation evidence records the deterministic old `null` failure, **10/10**
  consecutive zero-retry passes after repair and strict CI mode at **6 passed / 0 flaky**.
- Retry policy, strict reporter, assertions and the six-test inventory are unchanged.

### Earlier reviewer gates on locked PR source `2b8273e3`

- Source embed suite — **24 suites, 305/305 tests passed**.
- Full Jest — **412 suites passed, 2 skipped; 5,571 tests passed, 38 database-dependent tests
  skipped**.
- Full TypeScript check — passed.
- Playwright enumeration — main config **93 tests in 17 files**; fixture config **6 tests in 4
  files**.
- `node scripts/build-embed.mjs --check` — artifact fresh at 45,828 bundle / 33,062 widget /
  13,141 transport gzipped bytes.

Those earlier full-suite gates predate only the post-Devin fixture assertions, CLS naming and docs;
they remain locked-source evidence rather than being presented as a repeat of the final focused
repair. The normal report commit/push hooks own the next complete build/coverage pass.

All reviewer commands used the lockfile-exact Node 24 install after the stale local dependency tree
was replaced. Product files remain unchanged:

- `public/embed/recopyfast.js` SHA-256
  `2756a6897f09bbea2684460cab24b8fa39cfffb74d8a353d67d0bd725d4723df`, Git blob
  `8b43d15ee40104b700cd0018ec90f3c4ad4711a9`;
- `public/embed/recopyfast.src.js` SHA-256
  `9c6248ced63111d179b5a2fa9e771eb500a3cc287c204bfd6871d7ba2ca39b27`.

## Mutation proof

- The earlier file-less upload mutant removed the sole `FormData.file` append. After the review
  repair it produced **one image failure and five passes**; the reviewer independently verified
  that repair in `upload-contract-fix-independent-review.md`.
- During this final review, removing only the language POST `Authorization` property from a scratch
  built artifact initially left all six tests green. The frozen repair now requires the exact
  staging Bearer on language GET and POST. Re-running the same immutable mutant
  (`d31b51373c151d5e43e62f477d911d26803d0d8816fde4de6e34638098dd9d38`) produced **one targeted
  language failure and five passes**, including a green image case.
- Authenticated Devin review exposed the same false-positive class on staging publish. Removing
  only `editorTokenBody()` from the built POST initially escaped the fixture. The repaired stub now
  refuses missing/wrong preview and POST staging credentials before reading or mutating pending
  rows, and the browser spec pins the exact GET query and POST body. The unchanged mutant
  (`acb0ce5fa988cf35e8d71ba4b5610b52f0bd2d29ba7afd246df5b4e69b49544b`) now produces **one
  targeted edit/publish failure and five passes**.
- The retained History-renderer, publish-action, Languages-renderer and delayed-CLS mutants each
  produced one targeted failure and five passes. The CLS mutant measured `0.217101`, above the
  unchanged `0.001` ceiling inside the named startup window.
- All mutations targeted scratch copies through `RECOPYFAST_FIXTURE_ARTIFACT`; product files stayed
  byte-identical and required no restoration.

## Findings

No unresolved critical, major or minor finding remains in the reviewed story diff.

Three major false-positive gaps were found before this verdict: missing multipart-file validation,
missing language Bearer validation and missing staging-publish credential validation. All three
were fixed test-first and independently neutralized again; the exact broken artifacts now fail only
their intended cases. They are recorded as resolved review history, not open findings.

CI also exposed one test-ordering defect after PR head `d0b13de9`: optimistic DOM text did not prove
the asynchronous staging PUT had reached fixture state. The strict zero-flake reporter kept the job
red. The frozen repair synchronizes on the recorded PUT, preserves every state/DOM/history
assertion, and passes under a deterministic pre-dispatch delay with retries disabled. It is resolved
review history, not an open finding.

## Evidence boundaries

- This fixture is intentionally a deterministic browser/widget instrument with stubbed API
  responses. It proves built-artifact branch execution and selected wire contracts; it does **not**
  substitute for `e2e/share-edit-publish.spec.ts` against the disposable Supabase/Next stack, a
  deployed customer host, or production authorization/data behavior.
- The reviewer did not start a provider stack, make paid/provider calls, deploy, merge or exercise
  production. Earlier hosted results do not prove this frozen post-Devin repair; current-head CI
  after the report/fix commit and push remains required and is not claimed here.
- Greptile availability could not be verified with the repository permissions available in this
  recovery, as disclosed in the draft PR. No Greptile score is claimed; the repository's
  `Ship allowed` review gate remains authoritative.
- Chromium is the only browser used by this story. The CLS result covers navigation start through
  network idle plus the unchanged 750 ms settle interval. It is startup lab evidence, not
  lifetime/session or field performance evidence; the authenticated Devin UI flag remains for the
  PR owner to answer or resolve.
- The locked production build and coverage gates will run again through the repository's normal
  review-report commit/push hooks. The earlier pre-push build used a stale installed Next version,
  so it is not treated here as locked-current build evidence.

## Verdict

Authenticated Devin review exposed a real major publish-credential false positive and correctly
questioned the CLS observation boundary. The publish gap is now repaired and independently proven
with the exact broken artifact. The CLS code, plan and report now state the intended bounded startup
window explicitly; the 750 ms duration, `0.001` threshold and in-window mutation were not relaxed.
The later CI-only staging/history race is also repaired at the request-dispatch boundary without a
sleep after mutation, retry increase or assertion removal; the independent zero-retry case passes.

No unresolved finding remains. PR readiness still depends on root-owned commit/push hooks,
current-head hosted CI and the separate PR-review UI disposition; those delivery gates are not
collapsed into this code-review verdict.

Max severity: none
Ship allowed: yes
