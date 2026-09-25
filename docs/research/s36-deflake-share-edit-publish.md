# s36 — Save/publish race investigation

## Scope and evidence

Baseline: feature/s36-deflake-share-edit-publish from c3b2b28. The failure is a
Supabase `staging_content` assertion, not a toast or overlay assertion. The two
credential paths share `exerciseShareFlow` and the same inline editor lifecycle.

Retrieved once with `gh-axi run view 36081227341 --log-failed`:
https://github.com/marcusbey/recopyfast/actions/runs/36081227341

```text
2026-09-25T01:19:33.7040197Z [playwright] passed > ... invited-editor grant edits staging content and publishes live (1176ms)
2026-09-25T01:19:39.5989064Z [playwright] failed > ... edit-session token edits staging content and publishes live (5838ms) — Error: expect(received).toBeNull() Received: "Published through edit token" Call Log: - Timeout 5000ms exceeded while waiting on the predicate
2026-09-25T01:19:54.8440714Z Playwright strict summary: 43 passed, 0 failed, 0 skipped, 1 flaky, 44 total (expected 44).
```

The inherited CI retry succeeds but the strict reporter correctly rejects the flake.
This shows the same defect affects the legacy token flow as well as the reported
invited-editor flow. No retries or timeout changes belong in this fix.

## Source trace and hypothesis

`public/embed/recopyfast.src.js:startTextEdit` keeps its document mousedown
listener active until `persistContentUpdate` returns. Its `save` closure has no
in-flight or closed-session guard. The Save button, Enter and outside clicks all
call that closure. The E2E DB poll can observe the committed staging row before
the browser has consumed the PUT response and run cleanup. A Publish mousedown
then submits another PUT. A late duplicate PUT can restore staging after the
publish RPC cleared it; waiting for a toast would conceal the product race.

A second lifecycle hole: the outside-click listener is installed by an untracked
100ms timer. A save or cancel that finishes before it fires removes a listener
that does not yet exist; the timer later installs a stale save callback.

The keyboard handlers are also anonymous and survive cleanup, allowing stale
closures to submit old edits in a later session. Regressions will distinguish
these schedules with deferred HTTP responses and controlled timers.

`server/index.js` only broadcasts content-update events; its old database write
branch was removed. `persistContentUpdate` is the HTTP staging writer. The
publish dialog's two-second close timer changes DOM only, never database state.

## Boundaries

No applied migrations, auth policy, production stack or CI contract changes.
Use CI placeholder environment for gates, loopback-only Supabase for E2E.
No existing failing audit marker belongs to this race; add ordinary regressions.

## Validation

Deterministic baseline reproduction: `npm test -- --runInBand
src/__tests__/embed/editor-save-lifecycle.test.ts` — **4 failed, 2 passed** before
source changes. Controlled pending response: Save + Ctrl-Enter + Publish
mousedown produced **3 PUTs, expected 1**. Fast completion followed only by deferred
listener installation produced **2 PUTs**, restoring simulated staging after
publish. The independent stale-keyboard/paste case produced **4 PUTs**. Cancel also left a paste listener intercepting
events after the session closed. These schedules confirm a product lifecycle
race, not a database polling or toast-wait defect.

After the fix: **6/6 lifecycle tests passed**, plus **6 related embed suites /
78 tests passed**. Cleanup now cancels the delayed listener, removes session-owned
keyboard/paste handlers and closes the save callback. An in-flight flag prevents
concurrent writes and resets on recoverable failure; later legitimate edits and
retry after a nonterminal error remain covered.

## Local stack setup

`npm run setup` installed root and server dependencies without copying any .env.
The host Supabase CLI was 2.20.5; switched to CI-pinned 2.117.0. A full local start
applied migrations but failed service health checks under heavy host load:

```text
LegacyHealthCheckTimeoutError
supabase_realtime_recopyfast container is not ready: unhealthy
supabase_storage_recopyfast container is not ready: unhealthy
supabase_studio_recopyfast container is not ready: unhealthy
```

Recovery attempt: `npx --yes supabase@2.117.0 start --exclude
realtime,storage-api,studio,edge-runtime,imgproxy,postgres-meta,mailpit`. These
services are unused by the share spec; the real Postgres/PostgREST/Auth/Kong,
Next production app, Redis and application Socket.io service remain required.
No health-check bypass and no test timeout change.

## Superseded gate evidence (pre-review; invalidated)

The review proved these embed numbers used Homebrew Node's different zlib and
therefore do not establish a passing size gate. The remaining commands record
the earlier run only; fresh official-Node evidence is required after the fix.

Commands ran with environment reconstructed from `.github/workflows/ci.yml`,
with inherited service credentials stripped. Build/E2E used only the local
Supabase keys returned by the pinned CLI and CI's test Stripe placeholders.

- `npm run setup`: root + server installed, both audits 0 vulnerabilities.
- `npm run precommit -- -- --runInBand`: passed; lint **0 errors / 39 inherited
  warnings**, full type-check passed; Jest **234 passed / 2 skipped suites**,
  **3,096 passed / 38 inherited skipped tests**, no failures.
- `npm run type-check:build`: passed.
- `npm run format:check`: passed.
- `npm run build`: passed (production build, local E2E environment).
- `node scripts/build-embed.mjs --check`: fresh, bundle **46,601 / 46,681 B**,
  widget **33,841 / 33,865 B**, transport **13,122 B**, Node zlib level 9.
- `npm run audit:prod`: **0 vulnerabilities**.

No failing markers flipped, migrations added, dependencies changed, test
timeouts/retries adjusted or guards removed. Final local browser evidence is recorded below.

## Additional local readiness failure

The first baseline repeat attempt stopped before editing, at line 250:

```text
Locator: locator('.rcf-actions-inline')
Expected: visible
Timeout: 5000ms
Error: element(s) not found
1 failed; 39 did not run
```

Source establishes a separate test synchronization defect: `init()` displays the
banner and calls `scanForContent()` (which assigns data-rcf-id), then awaits
hydration and connection setup before installing edit listeners and setting
`isInitialized = true`. The spec clicked immediately after observing an id, so
that one click can precede the listener forever, regardless of how long it then
waits for the toolbar. Add a poll of the existing initialization flag before the
click with the default expect budget; preserve every assertion and timeout. This
does not replace or mask the duplicate-PUT product fix. A fixed-widget run that
had already loaded the old spec also reproduced this toolbar failure after four
passes (1 failed / 35 not run); the final acceptance run starts fresh with both
changes. `npx tsc --noEmit --pretty false` passed after the spec edit, and
Prettier passed for both changed test files.

## Repetition fixture isolation

The fresh run with both fixes reached **18 passed**, then stopped before editor
entry: `verificationResponse.ok()` was false. A loopback-only diagnostic request
confirmed **HTTP 429**, `Rate limit exceeded / Too many attempts`. This is the
real `IP_AUTH` guard in `src/lib/security/rate-limiter.ts`: **10 code submissions
per 15 minutes per IP**. Repeating fresh browser/site fixtures still shares the
same localhost IP and Redis across iterations and earlier diagnostic runs.

The acceptance repetition uses a temporary local reporter that unlinks only
`rate_limit:ip:::ffff:127.0.0.1:editor/submit-code:ip:*` in the dedicated
`recopyfast-s36-redis` container at run start and after each completed edit-session
test (the second test of each serial pair). All product guards and assertions
remain enabled. No other Redis key, database record, hosted service, test retry
or timeout is changed. This provides a fresh authentication budget per fixture
iteration, as an isolated CI job would have. The reporter is local tooling,
not shipped code and not a change to the CI contract.

Reproduction reporter (`/tmp/s36-repeat-isolation.cjs`):

```js
const { execFileSync } = require("node:child_process");
function resetLocalSubmitBudget() {
  const keys = execFileSync(
    "docker",
    [
      "exec",
      "recopyfast-s36-redis",
      "redis-cli",
      "--scan",
      "--pattern",
      "rate_limit:ip:::ffff:127.0.0.1:editor/submit-code:ip:*",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (keys.length)
    execFileSync("docker", [
      "exec",
      "recopyfast-s36-redis",
      "redis-cli",
      "UNLINK",
      ...keys,
    ]);
}
module.exports = class LocalRepeatIsolation {
  onBegin() {
    resetLocalSubmitBudget();
  }
  onTestEnd(test) {
    if (
      test.title ===
      "edit-session token edits staging content and publishes live"
    )
      resetLocalSubmitBudget();
  }
};
```

Run with CI's E2E environment and local keys from `supabase status -o env`:

```sh
npx playwright test e2e/share-edit-publish.spec.ts --repeat-each=20 --workers=1 --retries=0 --max-failures=1 --reporter=list,/tmp/s36-repeat-isolation.cjs
```

Acceptance result: **40 passed in 8.9 minutes**, process exit **0**: **20
consecutive invited-editor passes and 20 consecutive edit-session passes**,
**0 failed / 0 skipped / 0 retried**. Each pass includes save to staging,
publish, staging cleared to null, and a fresh visitor reload of published copy.
The source, generated embed and final spec stayed unchanged throughout this run.
The strict CI reporter and its 44-test contract are unchanged.

Git hook duplicate runs are suppressed for this commit/push only after the
explicit required gates above passed, honoring the operator's single full-gate
instruction on a heavily loaded host. No hook or repository configuration is
modified. Independent review remains pending; no merge or deployment is performed.

## Blocked-review correction (2026-09-25)

The independent review invalidated the Homebrew-zlib size evidence and exposed a
second lifecycle loss window. Official Node 20.15.1 measures reviewed `dc0379a` at 46,723 B
bundle / 33,952 B widget, over both immutable ceilings. The accepted correction is
to freeze the editable element and scalar fields during a bounded save, surface
`Saving…` in either editor banner, restore interaction on recoverable failure, and
replace redundant cleanup guards with one session generation/token. Targeted tests
must make each retained guard mutation-sensitive, including an explicit successful
in-flight reset, before the source is changed.

## Fix-run evidence

The final source freezes text, scalar inputs and AI actions while a save is
pending. Both banners expose `Saving…`. The request and response-body read share
a 15-second timeout; recoverable failures restore editing, while terminal
401/403 responses retain the read-only recovery state. Success explicitly resets
the request lock before closing the editor. A later editing session can save
newer text. Session-owned listeners share an abort signal, including deferred
outside-click registration and detached field/toolbar controls.

The initially added freeze/timeout regressions failed on the reviewed source.
The final real-widget lifecycle suite passes **12/12** on official Node 20.15.1.
The success-reset assertion observes the closure through test-only source
instrumentation; no debugging API is shipped. Existing assertions remain.

Each neutralization used a separate temporary source file selected by
`RCF_WIDGET_SOURCE`; the shipping source was not mutated. All twelve probes
exited 1. Red-test counts:

| Neutralized protection | Failed tests |
| --- | ---: |
| Pending Save guard | 1 |
| Pending Cancel/Escape guard | 1 |
| Pending paste guard | 10 (includes cascading failures) |
| Success reset | 1 |
| Recoverable-failure reset | 8 (includes cascading failures) |
| Outside-listener signal | 2 |
| Element keydown signal | 1 |
| Paste-listener signal | 2 |
| Scalar-field keydown signal | 1 |
| Save-button signal | 2 |
| Cancel-button signal | 1 |
| AI-button signal | 1 |

The three toolbar probes were rerun against the final callback wrappers:
respectively **2/10**, **1/11**, and **1/11** failed/passed tests. The unmodified
control is **12 passed**. No failing markers were flipped and no migration,
dependency, E2E assertion, retry setting or test timeout was changed.

Official-Node freshness and size command:

```sh
~/.asdf/installs/nodejs/20.15.1/bin/node scripts/build-embed.mjs --check
```

Result: fresh; **46,629 / 46,681 B bundle**, **33,858 / 33,865 B widget**,
**13,141 B transport**. Widget reduction from the reviewed source: **94 B**.
The byte ceilings are unchanged. Node is **v20.15.1**, zlib
**1.3.0.1-motley-7d77fb7**. Earlier Homebrew measurements above are superseded.

Local gates use only the `ci` job's exact placeholder environment from
`.github/workflows/ci.yml`, with inherited service credentials removed and the
official Node directory first in PATH. No production service was contacted.

- `npm run precommit -- -- --runInBand`: passed; lint **0 errors / 39 inherited
  warnings**, type-check passed; **234 passed / 2 skipped suites**, **3,102 passed /
  38 inherited skipped tests**, zero failures.
- `npm run audit:prod`: passed, **0 vulnerabilities**.
- `npm run build`: passed with official Node and CI placeholders.
- `npm run format:check`: passed.
- `npm run type-check:build`: passed.

The final read-only diff review found no blocking regression. The staging mode
badge doubles as the save-status slot. All in-repository `persistContentUpdate`
callers await completion without consuming its former resolved result object.
Git hooks' duplicate full runs are suppressed only for this already-validated
commit/push invocation, honoring the requested single full gate under host load;
no hook or persistent git setting is modified.

## Ship-allowed fix mode 2 (2026-09-25)

The ship-allowed review found two scoped regressions that must be fixed before
merge. `AbortSignal.timeout(15000)` is called before the save `try`, so a browser
without that newer static API sends no PUT and leaves the banner stuck on
`Saving…`. The chosen feature detection keeps the 15-second deadline where the
helper exists and supplies a plain `AbortController` signal without a client
deadline on older browsers, so those browsers still save. The staging banner also assigns
`rcf-editor-banner-status` to its mode badge, so the first save replaces the
pulsing dot and `Staging` label. Save status needs a sibling status element.

The same pass makes each lifecycle test boot a fresh widget instance so mutation
red counts describe each guard directly instead of cascading through shared DOM
and closure state. The timeout message should disclose the ambiguous server
outcome and Cancel should re-read staging for that element after a timeout if the
immutable embed ceilings permit it; otherwise the plan records that minor item as
a follow-up. The reviewer verdict remains unmodified and uncommitted.

The two major regressions are covered by tests that first failed on the reviewed
source: deleting `AbortSignal.timeout` produced zero PUTs, and the staging badge
became `Saving…`. The fixed suite boots a new real widget for every test and passes
13/13. Nineteen separate scratch-source mutations selected through
`RCF_WIDGET_SOURCE` all remain red with independent boot state: pending save 1,
pending cancel 1, contenteditable 1, scalar read-only 1, AI disable 1,
recoverable-failure reset 2, success reset 1, paste guard 1, session abort 6,
outside listener signal 3, element keydown signal 1, paste signal 2, field
keydown signal 1, Save signal 2, Cancel signal 1, AI signal 1, timeout 1, legacy
fallback 1, and dedicated staging status 1. The log is
`/tmp/s36-fix2-mutations.log`.

Official Node 20.15.1 measures the fresh artifact at **46,635 / 46,681 B bundle,
33,860 / 33,865 B widget, and 13,141 B transport**. The five-byte widget margin
is not enough for the minor timeout-ambiguity wording plus cancel refetch, so
that item is deferred rather than weakening a guard or changing more visible
copy. The offset removes the realtime `persisted` field that `server/index.js`
explicitly documents as unread, and redundant `extra || {}` operands that
`Object.assign` already ignores when undefined.

The leader's final CI-placeholder gate run passed: lint with 0 errors and the 39
inherited warnings, both type checks, format, production build, and audit with 0
vulnerabilities. Full Jest passed **234 suites / 2 skipped, 3,103 tests / 38
skipped, 0 failed**; coverage was 55.43% statements, 49.29% branches, 51.22%
functions, and 55.91% lines. Logs are under `/tmp/s36-fix2-gates`.

PR #31's three post-push CI E2E runs tested the earlier identical `b126100` tree;
they do not establish the unpushed fix-mode-2 diff. The independent ship-allowed
review file is deliberately preserved byte-for-byte, unmodified and uncommitted.
