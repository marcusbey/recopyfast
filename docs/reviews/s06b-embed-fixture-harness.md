# Review — Story s06b-embed-fixture-harness

> Fresh-context review by the `reviewer` subagent. Reviewed the complete story diff from
> `origin/main` (`0dea1c05`) through committed head `1d7581d8`, plus the frozen three-file
> review repair in `stub-api.ts`, `languages-images.spec.ts` and the plan evidence note.
> Draft PR: <https://github.com/marcusbey/recopyfast/pull/88>.
> No product UI changes, so design-system and customer screenshot review do not apply.

## Plan compliance

- [x] **Task 1:** two separately bound loopback origins serve the customer fixture and the
  committed built artifact with JavaScript MIME. The boot test proves the page and script origins
  differ and the staging widget initializes.
- [x] **Task 2:** the in-memory API covers the widget endpoints named by the plan, records method,
  path, query, headers, JSON/raw/multipart bodies, and returns shapes checked against the current
  route handlers. Narrow upload and language credential checks prevent the stub from manufacturing
  success when a required wire field disappears; the stub does not pretend to implement backend
  authorization policy.
- [x] **Task 3:** a real widget gesture edits the host DOM, records the staging write, proves the
  published row is initially unchanged, then publishes the staged value and clears the draft.
- [x] **Task 4:** staging validation/banner, draft-only state, history list, Bearer credential,
  restore request, restored fixture state and restored host DOM are all asserted.
- [x] **Task 5:** the user-approved 2026-10-11 scope is implemented exactly: existing language
  list/add, including site id, POST body and staging Bearer contract, plus image upload with exact
  file bytes/name/type/site id, site Bearer, staging write and changed host `src`. No language
  switching or translation-delivery feature was invented.
- [x] **Task 6:** the same host page is measured with and without the widget; only shifts without
  recent input count; the printed delta is gated at `<= 0.001`.
- [x] **Task 7:** the isolated config owns exactly six Chromium tests with no `webServer`; the main
  config excludes the fixture and still owns exactly 86 tests. The unguarded, credential-free CI
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

## Tests run by the reviewer

- `CI=1 npm run test:embed:fixture` — **6 passed, 0 failed, 0 skipped, 0 flaky**.
- `NEXT_PUBLIC_APP_URL=http://localhost:3000 CI=1 npm test -- src/__tests__/e2e/playwright-ci-contract.test.ts --runInBand`
  — **12/12 passed**.
- `NEXT_PUBLIC_APP_URL=http://localhost:3000 CI=1 npm test -- src/__tests__/embed --runInBand`
  — **24 suites, 305/305 tests passed**.
- `NEXT_PUBLIC_APP_URL=http://localhost:3000 CI=1 npm test -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`
  — **412 suites passed, 2 skipped; 5,571 tests passed, 38 database-dependent tests skipped**.
- `npm run type-check` — passed.
- Playwright enumeration — main config **86 tests in 15 files**; fixture config **6 tests in 4
  files**.
- `git diff --check` and product-file diff checks — passed.

The review used the lockfile-exact Node 24 install after the stale local dependency tree was
replaced. Product files remain unchanged:

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
- The retained History-renderer, publish-action, Languages-renderer and delayed-CLS mutants each
  produced one targeted failure and five passes. The CLS mutant measured `0.217101`, above the
  unchanged `0.001` ceiling.
- All mutations targeted scratch copies through `RECOPYFAST_FIXTURE_ARTIFACT`; product files stayed
  byte-identical and required no restoration.

## Findings

No unresolved critical, major or minor finding remains in the reviewed story diff.

Two major false-positive gaps were found before this verdict: missing multipart-file validation and
missing language Bearer validation. Both were fixed test-first and independently neutralized again;
the exact broken artifacts now fail only their intended cases. They are recorded as resolved review
history, not open findings.

## Evidence boundaries

- This fixture is intentionally a deterministic browser/widget instrument with stubbed API
  responses. It proves built-artifact branch execution and selected wire contracts; it does **not**
  substitute for `e2e/share-edit-publish.spec.ts` against the disposable Supabase/Next stack, a
  deployed customer host, or production authorization/data behavior.
- The reviewer did not start a provider stack, make paid/provider calls, deploy, merge or exercise
  production. Root verified that initial PR head `1d7581d8` passed every hosted check, including
  the fixture and disposable-stack E2E jobs. The reviewed language repair has not yet been pushed;
  hosted CI for that final source/report head remains required and is not claimed here.
- Greptile availability could not be verified with the repository permissions available in this
  recovery, as disclosed in the draft PR. No Greptile score is claimed; the repository's
  `Ship allowed` review gate remains authoritative.
- Chromium is the only browser used by this story. The CLS result is a local comparative lab
  measurement, not field performance evidence.
- The locked production build and coverage gates will run again through the repository's normal
  review-report commit/push hooks. The earlier pre-push build used a stale installed Next version,
  so it is not treated here as locked-current build evidence.

## Verdict

Max severity: none
Ship allowed: yes
