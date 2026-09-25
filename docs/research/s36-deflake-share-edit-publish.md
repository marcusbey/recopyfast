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

## Gate evidence

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
const { execFileSync } = require('node:child_process');
function resetLocalSubmitBudget() {
  const keys = execFileSync('docker', [
    'exec', 'recopyfast-s36-redis', 'redis-cli', '--scan', '--pattern',
    'rate_limit:ip:::ffff:127.0.0.1:editor/submit-code:ip:*',
  ], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  if (keys.length) execFileSync('docker', [
    'exec', 'recopyfast-s36-redis', 'redis-cli', 'UNLINK', ...keys,
  ]);
}
module.exports = class LocalRepeatIsolation {
  onBegin() { resetLocalSubmitBudget(); }
  onTestEnd(test) {
    if (test.title === 'edit-session token edits staging content and publishes live')
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
