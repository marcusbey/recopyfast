# Review — s36-deflake-share-edit-publish (re-review after blocked verdict)

Reviewed head: `b12610079c7d7b4c539ee91b15ee051a96f78fe3` (draft PR #31)
Fix commit: `a5f2ea1`. `54c8316` and `b126100` are empty commits whose tree matches it
(`66875d0`).
Baseline: `main` at `c3b2b28` (confirmed with `git ls-remote`)
Previous verdict: blocked on `dc0379a` (critical), replaced by this file
Date: 25 September 2026

## Scope and verdict

This is a fresh-context re-review of `git diff main...feature/s36-deflake-share-edit-publish`,
with most attention on the commits after `dc0379a`.

All four blocking findings are fixed:

- The embed now fits both unchanged ceilings on official Node builds.
- A pending save freezes editing, so no text is lost.
- Every lifecycle guard fails at least one test when removed.
- A 15 s timeout means Cancel and Escape can no longer stay stuck.

The root-cause fix still holds, and CI has three clean, identical E2E runs.

The byte-shaving and the new status slot introduced two regressions, both proven with probes:

- The staging banner's "● Staging" badge is overwritten after the first save.
- An unguarded `AbortSignal.timeout` breaks every save on browsers older than Safari 16 or
  Chrome 103.

Both are real, scoped and visible, and neither corrupts data. The embed has only **7 gz bytes**
of widget headroom, so each fix has to pay for its own bytes.

## Prior findings → status

| # | Prior finding (on `dc0379a`) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | critical: embed over both gzip ceilings on official Node | **Resolved** | See note 1 |
| 2 | major: a second Save while one is pending is dropped, and text typed in that window is lost | **Resolved** | See note 2 |
| 3 | minor: closed-session defenses not tested one by one; the sticky `isSaving` was undocumented | **Resolved** | See note 3 |
| 4 | minor: Cancel/Escape stuck while saving, no request timeout, no "Saving…" on the staging banner | **Resolved, with a regression** | See note 4 |

1. **Embed size.** Measured with `scripts/build-embed.mjs --check`:
   - Official Node 20.15.1 (zlib 1.3.0.1-motley) and 24.14.0 (zlib 1.3.1): fresh, **bundle
     46,629 / 46,681 B, widget 33,858 / 33,865 B**, transport 13,141 B.
   - CI (Node 20.20.2) logged the same figures in all three E2E jobs.
   - The ceilings are unchanged from `origin/main`: `scripts/build-embed.mjs:110-111`,
     `build-size-gate.test.ts` and `playwright.config.ts` are not in the diff.
2. **Pending-save freeze.**
   - `save` calls `freeze(true)` (`recopyfast.src.js:4592`). That sets
     `contenteditable="false"`, makes the scalar inputs `readOnly` and disables AI (`:4552-4557`).
   - Paste is ignored while saving (`:4664`).
   - Test 1 checks: 1 PUT for Save + Ctrl-Enter + Publish mousedown, no alert, the first draft
     kept, then a later edit still saved (PUT 2).
   - See the mutation table.
3. **Guard coverage.** Every guard I neutralized turned the suite red (table below). The sticky
   flag is gone: `isSaving = false` before `cleanup()` (`:4616`) now has a comment explaining it
   and its own test. Removing that line gives 1 red.
4. **Timeout and staging status.**
   - `AbortSignal.timeout(15000)` covers the fetch and the body read (`:2913-2937`).
   - Probe P3, stalled PUT: Escape does nothing while pending. After 15 s the editor gets
     "Save timed out.", the status clears and the next Escape closes the session with the
     original text restored.
   - "Saving…" now shows in the staging banner too, but by overwriting the badge (new finding 1).
   - A timeout also leaves the write's outcome unknown (new finding 3).

## Verified behaviour (file:line)

- **Root cause still fixed.** Each session owns one `AbortController` (`:4424`). Every listener
  the session creates takes its signal, including the outside mousedown the 100 ms timer
  registers late (`:4687`). `cleanup()` calls `session.abort()` (`:4526`). By the DOM spec,
  `addEventListener` with an already-aborted signal is a no-op, which closes the late-timer hole.
- **Isolated runs against `main`'s source** (`RCF_WIDGET_SOURCE`, `-t`):
  - The 100 ms race test: 2 PUTs, expected 1.
  - The stale keydown test: 2 PUTs.
  - The post-cancel paste test: paste still intercepted.
- **The full lifecycle suite goes red on both earlier sources:** 9/12 against `main`, 10/12
  against `dc0379a`.
- **Save guard** `if (self.isMutationLocked || isSaving) return;` (`:4564`). The cancel guard
  (`:4624`) is the same.
- **Failure path.** A non-terminal failure calls `freeze(false)`, which restores editing and lets
  the user retry. A terminal 401/403 returns before `freeze(false)`. The page stays read-only,
  the draft is kept, and `handleTerminalWriteFailure` still reads the frozen element's text
  (`:1151-1156`).
- **Behaviour the refactor must keep:**
  - The shared `keydownHandler` keeps the old Enter/Escape rules for the element and its fields.
  - The cloned toolbar buttons keep `type="button"`.
  - `persistContentUpdate` no longer returns its result. No caller in `src/`, `e2e/` or the embed
    reads it (checked by grep).
  - No path calls `cleanup()` twice now that `isCleaningUp` is gone. After the first call every
    entry point is aborted.
- **E2E spec.** The only change is a poll on `isInitialized` under the default expect budget
  (`e2e/share-edit-publish.spec.ts:249-261`).
  - The diff adds no `retries`, `timeout:`, `.skip`/`.only`, `test.slow` or `jest.retryTimes`.
    The two `setTimeout` calls it does add are test-harness code.
  - The strict contract is still `expected: 44`.
  - The PR discloses the spec change, as AGENTS.md requires.
- **Test edits.** The two `dc0379a` tests that were rewritten kept every assertion. They were
  merged into test 1 and renamed.
- **Plan tasks.** All three tasks of the "Review-blocking fix run" are done:
  - Regression tests were added before the source change.
  - One session token replaces the overlapping flags.
  - The widget is −94 gz bytes against the 33,952 B baseline (≥ 90 required), with both
    ceilings unchanged.
- **Plan drift.** It is limited to the byte-shaving edits (finding 4) and the badge reuse
  (finding 1).
- **ADRs.** ADR 004 rule 1 still holds: no new write path. ADR 025 is untouched.

## Findings

1. **major — the staging banner's mode badge is destroyed by the first save.**
   - **The code.** The fix adds `rcf-editor-banner-status` to the badge container itself
     (`:2193`) and widens `setEditorSaveStatus` to a bare `.rcf-editor-banner-status`
     (`:1127`). `status.textContent = text` then replaces the pulsing dot and the "Staging"
     label.
   - **Probe P1** (jsdom, real widget):
     - Branch: before the save, `"Staging"` with a dot. After a successful save, `"Saved"`
       (rendered as SAVED) with no dot. After a failed save, `""`.
     - `main`, same probe: `"Staging"` with the dot at every step.
   - **No recovery.** The banner is never re-rendered, so the mode indicator is gone for the
     rest of the page load, Publish included. A terminal 401/403 now writes "Session ended —
     draft kept" into that badge as well (`:1176`).
   - **Why it matters.** The plan says "preserve the current UI". The PR mentions "the staging
     badge doubles as the save-status slot" but not the loss. No test checks the badge after a
     save: the new staging test only checks "Saving…". The `setEditorSaveStatus` doc comment
     still argues this audience "should not have to learn" staging versus live, which is the
     opposite of the staging banner's purpose.
   - **Fix direction.** Give the staging banner a dedicated status span next to the badge
     instead of reusing the badge. This costs bytes against 7 B of headroom.
   - **Human check.** Open a staging link, save one heading and look at the badge.
2. **major — the save path silently raises the editor's browser floor. Every save fails on Safari
   before 16, Chrome before 103 and Firefox before 100.**
   - **The code.** `const signal = AbortSignal.timeout(15000);` (`:2913`) has no feature check
     and sits before the `try`.
   - **Probe P2** (with `AbortSignal.timeout` undefined):
     - Branch: **0 PUTs**. The alert reads **"AbortSignal.timeout is not a function"** and the
       banner stays at **"Saving…"** forever.
     - `main`, same probe: 1 PUT, saved.
   - **Scope.** All three `persistContentUpdate` callers are hit: text, image and form
     placeholder.
   - **Rules at stake.**
     - Non-negotiable 4: the widget degrades, never breaks. This is exactly "editing stopped
       working on one site".
     - The repo treats raising the browser floor as a recorded decision (the embed builds for
       `target: es2018`; `docs/plans/s06c-embed-shrink.md` task 6: "a decision, not a
       freebie"). No such decision was recorded here.
   - **Browsers older still.** Where the listener `signal` option is unsupported (Safari < 15,
     Chrome < 90), aborting removes no listeners, and the stale-listener fix silently stops
     applying.
   - **Scope today.** It is editor-only and a small share in 2026. It is visible and corrupts
     nothing.
   - **Fix direction.** Feature-detect: no timeout, or `AbortController` + `setTimeout`, when
     `AbortSignal.timeout` is missing. Check `signal && signal.aborted`.
3. **minor — "Save timed out." can mislead the editor into leaving a hidden draft.**
   - The abort only stops the client from waiting. The server may still commit the PUT, and the
     PR's Risk section says so.
   - After the alert, editing reopens. If the user presses Cancel, the DOM goes back to the
     original, but staging may still hold the text. The next Publish promotes it site-wide.
   - This belongs to the same pre-existing race family as the Publish note below, now reachable
     after 15 s rather than after a browser-level network failure. Wording such as "may not have
     saved" would stop the user from assuming nothing landed.
4. **minor — unplanned user-visible copy changes made to buy bytes, and 7 B of widget headroom
   left.**
   - Tooltips changed: "AI Suggestions" → "AI tools", "Save changes (Cmd/Ctrl + Enter)" →
     "Save (Cmd/Ctrl+Enter)", "Cancel editing (Esc)" → "Cancel (Esc)" (`:4312-4322`).
   - The plan says "preserve the current UI" and does not list them.
   - At 33,858 / 33,865 B, the fixes for findings 1 and 2 must find their bytes elsewhere, or
     the gate goes red again.
5. **minor — the lifecycle suite shares one widget boot across 12 tests, so failures cascade.**
   - A single neutralization turns 8-10 tests red (contenteditable freeze, readOnly, AI disable,
     paste guard, failure reset, timeout). The red counts overstate what each guard proves
     directly, and the tests depend on their order.
   - Every guard still has at least one test that targets it directly (see the table), so this
     is diagnostic hygiene only.

Notes, not findings:

- **Publish does not wait for an in-flight save.** This is pre-existing. On the branch, "Save,
  then click Publish while the PUT is pending" races that single PUT against the publish RPC.
  The edit can miss the publish and remain as a staging draft. The E2E avoids it by polling
  staging first.
- **`startFormEdit` still has the unguarded Save/Enter/outside-click pattern.** It is outside
  this plan's `startTextEdit` scope.
- **Two banners at once.** If both banners ever coexist (an editor grant plus a staging token),
  `querySelector('.rcf-editor-banner-status')` updates whichever comes first in the DOM.
- **CI rerun commits.** `54c8316` and `b126100` are empty commits made only to rerun CI. Squash on
  merge.
- **CI run overlap.** Runs 2 and 3 overlapped in time (11:21–11:27 UTC). They were separate
  runners, so they are still three independent samples.

## Independent verification

Every Jest run used the unmodified CI placeholder wrapper, which puts official Node 20.15.1
first in PATH. No production credential was used.

- **`editor-save-lifecycle.test.ts`: 12/12 passed.**
- **Embed and staging scope** (`src/__tests__/embed`, `src/__tests__/api/staging`): **23 suites /
  236 tests passed.**
- **Full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`:**
  - **234 passed / 2 skipped suites; 3,102 passed / 38 skipped tests; 0 failed; exit 0.** This
    matches the PR.
- **Embed check:** the figures in note 1, with exit 0 on both official Nodes.
- **Formatting and lint.** Prettier is clean on the test file and the spec. ESLint is clean on
  both. Prettier flags `docs/research/s36-….md`, but `format:check` only covers `src/`, so the
  gate is unaffected.
- **CI:** `gh run list --workflow ci.yml --branch feature/s36-deflake-share-edit-publish`.
  - Runs 36128343757 (`a5f2ea1`), 36128912522 (`54c8316`) and 36128971734 (`b126100`): all
    `success`, attempt 1.
  - Each E2E job log shows `Merge <head> into c3b2b28…`, so all three tested identical merge
    trees.
  - Each shows `Playwright strict summary: 44 passed, 0 failed, 0 skipped, 0 flaky, 44 total
    (expected 44)`.
  - There are **0 `retry #` lines** and 44 `[playwright] passed` lines. Both share-edit-publish
    tests passed first time in all three.
  - The previous run (`dc0379a`, 36113686453) was the failure this review blocked.
  - `gh pr view 31` shows all checks green, Vercel included. The PR is still a draft.

## Mutation proof

Each mutation was an exact, single-match string replacement written to a scratch copy and
loaded through the suite's `RCF_WIDGET_SOURCE` hook. The shipping source was never touched, and
`git diff --exit-code -- public/embed src` returned 0 afterwards.

| Neutralized | Red / 12 | Tests that target it directly |
| --- | ---: | --- |
| `isSaving` dropped from the save guard (`:4564`) | 1 | freeze/coalesce test (3 inputs → 1 PUT) |
| `isSaving` dropped from the cancel guard (`:4624`) | 1 | freeze/coalesce test (Escape) |
| `contenteditable` not toggled in `freeze` | 10 | freeze test, then cascade |
| field `readOnly` not toggled | 8 | scalar-field freeze test, then cascade |
| `aiBtn.disabled` not toggled | 9 | AI freeze test, then cascade |
| `freeze(false)` removed on failure | 8 | failure/timeout restore, then cascade |
| success `isSaving = false` removed (`:4616`) | 1 | freeze test (`isSaving()` after success) |
| paste guard `if (isSaving) return` removed | 10 | freeze test, then cascade |
| `session.abort()` removed | 5 | 100 ms race, keyboard/paste, deferred cancel, detached Save, detached fields |
| outside mousedown loses `signal` | 2 | 100 ms race, deferred cancel |
| element keydown loses `signal` | 1 | keyboard/paste test |
| paste listener loses `signal` | 2 | keyboard/paste, deferred cancel |
| field keydown loses `signal` | 1 | detached fields test |
| Save button loses `signal` | 2 | detached Save, detached fields |
| Cancel button loses `signal` | 1 | detached fields test |
| timeout disabled (never-aborting signal) | 8 | timeout test, then cascade |
| status selector reverted to `#rcf-editor-banner …` | 1 | staging "Saving…" test |
| control: success status `'Saved'` → `''` | **0** | not asserted anywhere (outside the story) |

Every guard the story turns on bites. My counts match the research's mutation table exactly.

## Evidence boundary — not verified

- **No local Playwright run.** The E2E evidence comes only from the three CI job logs above.
- **Freeze in a real browser.** jsdom does not enforce `contenteditable="false"`. The suite's
  `typeIfEditable` simply skips typing when the element is frozen. That typing, IME input and
  drag-drop text are blocked while frozen is browser behaviour I did not observe.
  - *Human:* in Chrome and Safari, open a staging link with DevTools set to Slow 3G. Edit a
    heading and click Save, then try typing, pasting and dropping text, and press
    Escape/Cancel. Expect no change and "Saving…" in the banner. After completion, expect the
    first saved text and exactly one PUT in Network.
- **Staging badge rendering.** Probe P1 only checked the DOM. *Human:* save once on a staging
  link and look at the banner (finding 1).
- **Legacy browsers.** P2 simulated the missing `AbortSignal.timeout` in jsdom. *Human:* try a
  save on Safari 15.x (BrowserStack, iOS 15) to confirm finding 2, and again after the fix.
- **Real timeout behaviour.** Abort was exercised with a mocked fetch that honours the signal.
  Whether a server commit lands after a client abort was not observed. *Human:* delay
  `PUT /api/staging/content` by more than 15 s through a local proxy, then check the alert and
  the `staging_content` row.
- **The Vercel preview** is green in checks but was not opened.

Verdict at `b126100`: major, ship allowed. The delta review below supersedes it.

## Delta review 774461d

Scope: `git diff b126100..774461d -- public/embed src e2e docs`, a fresh-context review of fix
commit `774461d` ("preserve legacy saves and the staging badge"). The delta touches the widget
source, its generated artifact, the lifecycle test and the story docs. `e2e/` is unchanged.

### Prior findings → status

| # | Finding at `b126100` | Status at `774461d` |
| --- | --- | --- |
| 1 | major: the first save wipes the "● Staging" badge | **Resolved** |
| 2 | major: `AbortSignal.timeout` breaks every save on older browsers | **Resolved**, with a documented trade-off (note A) |
| 3 | minor: "Save timed out." can mislead | **Open, deferred.** The plan records it as a follow-up with no byte budget, and the PR says so |
| 4 | minor: three tooltips reworded for bytes | **Unchanged.** The delta rewords no copy |
| 5 | minor: shared widget boot makes failures cascade | **Resolved**, with a residual leak (delta finding 5) |

**Finding 1, the badge.**
- The staging banner now appends a dedicated `span.rcf-editor-banner-status` beside
  `span.rcf-banner-mode` (`recopyfast.src.js:2191-2202`).
  - `setEditorSaveStatus` (`:1125`) and the terminal-failure path (`:1174`) now find that span,
    not the badge.
  - Probe C (real widget, after a save) shows the `.rcf-banner-info` children as
    `rcf-banner-mode="Staging"`, `rcf-editor-banner-status="Saved"`, then the dividers, email,
    permissions and expiry.
- The new test "keeps the staging badge after successful and failed saves" checks the label and
  the dot after "Saving…", after a success and after a network failure.
  - Against `b126100`'s source it goes red, one of exactly 2 red tests.
  - Mutations 19 (status re-merged into the badge) and 22 (status span not attached) each turn
    it red, alone.

**Finding 2, the timeout API.**
- `AbortSignal.timeout ? AbortSignal.timeout(15000) : new AbortController().signal` (`:2915`).
- The new test "saves once when AbortSignal.timeout is unavailable" deletes the own property
  and restores it from a saved descriptor in `afterEach`. It then checks 1 PUT, the new text and
  no alert.
  - It is red on `b126100`.
  - Mutation 18 (the unguarded `AbortSignal.timeout(15000)` restored) turns it red, alone. So
    the `delete` really removes the API in jsdom 26.1.0.
- The 15 s deadline still works where the API exists:
  - Mutation 20 (always the no-deadline fallback), mutation 17 (deadline 15000 → 1e9) and
    mutation 23 (the `aborted` → "Save timed out." mapping dropped) each turn the timeout test
    red.
  - Probe A: 0 alerts at 14,999 ms, and "Save timed out." at 15,000 ms. After that,
    `contenteditable="true"`, `isSaving()` is `false` and the status is cleared. Escape pressed
    while pending does nothing, and after the timeout it closes the session and restores
    "Original copy". 1 PUT.
- **No other API above the baseline.** The delta adds no new global.
  - The whole story adds only `AbortController` (allowed) and the listener `{ signal }` option.
    Both arrived in `a5f2ea1` and were covered in the previous review.
  - `Element.append` already appears twice on `main`.
  - The build target is still `es2018`, and `scripts/build-embed.mjs` is byte-identical to
    `origin/main`.

**Finding 5, test isolation.**
- `beforeEach` now resets the DOM and storage, deletes `window.ReCopyFast`, re-evaluates the
  widget and restores all mocks in `afterEach`.
- The suite passes 13/13 under `--randomize` with seeds 1, 42 and 1337.

### Mutation proof (19 guards + delta probes)

- **Method.** Every mutation is one exact, single-match string replacement, written to a
  scratchpad copy and loaded through `RCF_WIDGET_SOURCE`. The test runs through the unmodified
  CI placeholder wrapper (official Node 20.15.1).
- **Restore.** The shipping source was never written. `git diff --exit-code -- public/embed src`
  returned 0 afterwards.

| # | Neutralized | Red / 13 |
| --- | --- | ---: |
| 01 | save guard drops `isSaving` | 1 |
| 02 | cancel guard drops `isSaving` | 1 |
| 03 | `freeze`: `contenteditable` not toggled | 1 |
| 04 | `freeze`: field `readOnly` not toggled | 1 |
| 05 | `freeze`: `aiBtn.disabled` not toggled | 1 |
| 06 | failure: `freeze(false)` removed | 2 |
| 07 | success: `isSaving = false` removed | 1 |
| 08 | paste guard removed | 1 |
| 09 | `session.abort()` removed | 6 |
| 10 | outside mousedown loses `signal` | 3 |
| 11 | element keydown loses `signal` | 1 |
| 12 | paste listener loses `signal` | 2 |
| 13 | field keydown loses `signal` | 1 |
| 14 | Save button loses `signal` | 2 |
| 15 | Cancel button loses `signal` | 1 |
| 16 | AI button loses `signal` | 1 |
| 17 | timeout never fires (15000 → 1e9) | 2 (1 direct + 1 leak, see finding 5) |
| 18 | legacy fallback removed | 1 |
| 19 | staging status re-merged into the badge | 1 |
| 20 | always the no-deadline fallback | 1 |
| 22 | staging status span not attached | 1 |
| 23 | `aborted` → "Save timed out." mapping removed | 1 |
| 21 | fallback signal already aborted | **0** (finding 3) |
| 26 | `freeze(false)` skipped only after a timeout | **0** (finding 2) |
| 24 | status not cleared on failure (pre-existing on `main`) | 0 |
| 25 | control: `'Saved'` → `''` | 0 |

- All 19 guards the research names go red. The counts match the research's table exactly, with
  timeout = #20.
- **Baselines.** HEAD 0/13 red. `b126100` 2/13 red: exactly the two new tests. `main` 9/13 red.

### Bytes, ceilings, copy

- **`scripts/build-embed.mjs --check`.** Same figures on official Node 20.15.1 and 24.14.0:
  "embed artifact is up to date", **bundle 46,635 / 46,681 B, widget 33,860 / 33,865 B**,
  transport 13,141 B, exit 0. These match the claim.
- **Headroom.** 46 B on the bundle and 5 B on the widget.
- **Ceilings unchanged.**
  - `origin/main` has moved to `cbfb922` (#33). Its `MAX_BUNDLE_GZ = 46681` and
    `MAX_WIDGET_GZ = 33865` are unchanged.
  - `git diff origin/main...774461d` touches none of `scripts/`, `playwright.config.ts`,
    `build-size-gate.test.ts` or `.github/`.
  - #33 changes no embed file, so these figures survive the rebase.
- **Copy.** The delta rewords **no** user-visible string. The only literals it changes are the
  class token `rcf-banner-mode rcf-editor-banner-status` → `rcf-banner-mode` and the removed
  `persisted: true` payload key. Across the whole story against `main`, the user-visible changes
  are still the three tooltips of prior minor 4:
  - "AI Suggestions" → "AI tools"
  - "Save changes (Cmd/Ctrl + Enter)" → "Save (Cmd/Ctrl+Enter)"
  - "Cancel editing (Esc)" → "Cancel (Esc)"

  The alert "Save timed out." is new copy, not a rewording.

### Suites and gates run

All runs used the unmodified CI placeholder wrapper, invoked through `bash` because the file is
not executable.

- **`src/__tests__/embed` + `src/__tests__/api/staging`: 23 suites / 237 tests passed.** That
  is the previous 236 plus the new legacy test.
- **`src/__tests__/websocket`: 3 suites / 87 tests passed.** This covers the `persisted`
  removal.
- **Lint and format.** Prettier and ESLint are clean on the lifecycle test. The lint gate is
  `eslint src/`, so `public/` is out of its scope.
- **Full Jest suite.** Not re-run, because the brief scopes this pass to the targeted suites.

### Delta findings

1. **major — no CI or E2E has run on `774461d`.**
   - **The evidence.** `gh pr view 31` reports `mergeable: CONFLICTING`.
     `git merge-tree origin/main 774461d` shows the only conflict is `docs/stories.md`, against
     #33. GitHub does not trigger `pull_request` workflows while the PR conflicts.
     - `gh pr checks 31` lists only CodeRabbit (skipped: draft), Vercel and Vercel Preview
       Comments.
     - `gh run list --commit 774461d` is empty. The branch's latest CI run is `b126100`.
   - **Why it matters.** The delta changes `persistContentUpdate`, the exact path
     `e2e/share-edit-publish.spec.ts` drives. The story's acceptance criterion is E2E stability.
     The research itself says the three green runs "do not establish the unpushed fix-mode-2
     diff".
   - **No code fix is needed.**
     1. Resolve `docs/stories.md` against `cbfb922` and push.
     2. Require CI green on the resulting head, with the strict summary `44 passed, 0 failed,
        0 skipped, 0 flaky` and 0 `retry #` lines.
2. **minor — the timeout test does not prove that editing is restored.**
   - Its last assertion, `expect(headline.hasAttribute("contenteditable")).toBe(true)`, holds
     both when the element is frozen (`"false"`) and when it is unfrozen (`"true"`).
   - Mutation 26 skips `freeze(false)` only when the message is "Save timed out.". The page then
     stays read-only after a timeout and Cancel/Escape are ignored forever: prior minor 4 comes
     back. The result is **0/13 red**.
   - The shipping code is correct (probe A). The regression is simply unguarded.
   - **Fix.** Assert `getAttribute("contenteditable") === "true"` and `isSaving() === false`
     after the 15 s advance.
3. **minor — the legacy-browser test's fetch mock ignores the signal.**
   - Mutation 21 makes the fallback an already-aborted signal: **0/13 red**. A real `fetch`
     rejects at once on an aborted signal, so every legacy save would fail with "Save timed
     out.".
   - The test proves "no `TypeError`", not "the signal is live".
   - **Fix.** Make the PUT mock reject when `signal?.aborted` is true, or assert
     `signal.aborted === false` in the legacy test.
4. **minor — the `persisted: true` removal is unplanned drift, and its safety depends on the
   deployed socket server.**
   - It was removed only to buy bytes. The research and the PR disclose it; no plan task lists
     it.
   - **Safe today.** The server stopped reading `persisted` in `225702a` (2026-08-17). The
     tombstone is at `server/index.js:455-468`, and `server.integration.test.ts:826` proves that
     a payload without it causes no write. The websocket suite passes 87/87. `extra || {}` →
     `extra` is neutral: all three callers pass an object or `undefined`, and `Object.assign`
     skips `undefined`.
   - **Stale comments.** Two comments now describe the client wrongly:
     - `server/index.js:459-462`: "emits with `persisted: true`"
     - `server.integration.test.ts:832`: "the real client always sets it"
   - **Deploy dependency.** A `recopyfast-ws` build older than `225702a` would take the old
     `!data.persisted` service-role write path on every save.
5. **minor — test isolation still leaks when a test fails mid-save.**
   - `afterEach` closes the session by clicking Cancel, but Cancel is blocked while
     `isSaving`. A test that fails with a pending save therefore leaves its session's
     `document` mousedown listener registered for the next test's fresh widget.
   - Under mutation 17, the 100 ms race test records 2 PUTs in the full run but passes alone
     (`-t "100ms race"`).
   - Passing runs are unaffected (randomized order is green). Only the red counts of failing
     mutations can still cascade.
   - **Fix.** Record each session's `AbortController` and abort it in `afterEach`, or reboot
     the jsdom document.
6. **minor — the staging banner's new status span is unstyled.**
   - The only rule is `#rcf-editor-banner .rcf-editor-banner-status` (`:1330`), which does not
     match inside `#rcf-staging-banner`.
   - So "Saving…" and "Saved" render in the banner's 13 px near-white text, not the editor
     banner's muted grey. While empty, the span still takes a 10 px flex gap before the email
     divider.
   - This was read from CSS, not rendered.

Notes, not findings:

- **A. The legacy trade-off is disclosed.** Without `AbortSignal.timeout` there is no client
  deadline. Probe B: after a stalled PUT and 600 s simulated, the element is still frozen,
  `isSaving()` is `true` and Escape is ignored, until the browser's own network timeout.
  - This is the "no timeout" option the previous review allowed. The code comment, the research
    and the PR state it.
  - An `AbortController` + `setTimeout` fallback would need bytes the 5 B widget headroom does
    not have.
- **B. The `persistContentUpdate` status clear on failure was already on `main`.** Its 0-red
  mutation (#24) is outside the story.

### Evidence boundary — not verified (delta)

- **E2E on `774461d`.** It never ran (finding 1). No local Playwright run either.
  *Human:* resolve the conflict, then read the E2E job log for the strict 44/44 summary and 0
  retries.
- **A real legacy browser.** The fallback was checked only by deleting the API in jsdom.
  *Human:* on BrowserStack Safari 15.x (iOS 15), save a heading through a staging link. Expect
  1 PUT, "Saved" and the text kept.
- **Banner rendering** (finding 6). *Human:* open a staging link, save once, and look at the
  badge and the status in the top banner, empty and filled.
- **The deployed socket server version** (finding 4). *Human:* check that the commit of the
  `recopyfast-ws` image on Fly is at or after `225702a`.
- **Late server commits after a client abort.** Still unobserved, as before.
- **The Vercel preview** for `774461d` is green in checks but was not opened.

### Verdict

- **No critical.** Both prior majors are fixed and proven: red on `b126100`, red under
  mutation, green on HEAD.
- **Bytes.** They fit the unchanged ceilings on official Node, and the artifact is fresh.
- **Ship allowed: no, until finding 1 is cleared.** The code needs no change. The PR must stop
  conflicting so CI runs, and E2E must be green on the resulting head. After that, with no
  other change, ship is allowed with findings 2-6 as next-cycle items.

Max severity: major
Ship allowed: no
