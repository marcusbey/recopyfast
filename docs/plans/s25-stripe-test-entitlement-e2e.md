---
validated: yes
---

# s25 — Prove Stripe test payment provisions access

Validated by the user's explicit "yes" on 20 September 2026 after the three plan links and
summaries were presented. This plan depends on merged s24 ephemeral-stack support.

## Tasks

- [x] Add a fail-closed opt-in test-mode provider guard: application/Supabase must be loopback,
      Stripe key/price objects must be test mode, and the user must have no existing trial/paid grant.
- [x] Build a disposable fixture that creates one confirmed ephemeral Auth/user record, signs in
      through the app and records created DB/provider IDs for the process-external janitor to reconcile.
- [x] Start a Stripe CLI test listener to the real webhook route, inject/mask its ephemeral signing
      secret, create Checkout through the authenticated API, and automate the hosted test Checkout.
      First prove the test fails before webhook/entitlement assertions are wired.
- [x] Assert completed+paid+reconciled Checkout, customer linkage, one expected subscription,
      genuine processed event IDs and effective entitlement. Replay one captured event and assert no
      duplicate effect. Never insert an entitlement directly as test setup.
- [x] Cancel/delete captured Stripe test objects; delete captured ephemeral DB/Auth rows; assert no
      mutable residue while documenting immutable Checkout/event history. Prevent secrets/card data in
      traces, screenshots, reports and logs.
- [x] Run the default provider command from clean s24 stacks and prove two consecutive, independently
      cleaned test-mode Checkout-to-entitlement passes. Keep the provider test as an explicit
      credentialed operator lane unless separately approved test secrets are added to GitHub.
- [ ] Run full precommit/prepush, obtain a fresh review, open the PR and merge only after the review
      and CI gates pass.
- [ ] After test-mode proof, pause at the exact live payment step and request the user's SKU/period,
      maximum total including tax, payer and cancel/retain/refund decision. User enters payment data;
      agent then verifies signed live event, ledger, entitlement and requested cleanup.

## Boundaries

No live charge, production DB mutation, direct entitlement fabrication, production trial callback,
secret upload, saved payment data, unscoped cleanup or claim that test mode equals live payment.
Any application behavior defect discovered by the real flow becomes a separately planned fix.

## Execution evidence and open proof

The failed attempts below are retained as incident history. Their "no provider rerun" statements
describe the state immediately after each repair; the dated final proof at the end supersedes them.

- Guard, fixture, hosted-field, disclosure, teardown, janitor, ownership, process-recovery,
  operator-contract, safe failure and redaction regressions were observed red before implementation;
  the webhook-secret and no-provider-object cleanup guards were also observed red before their fixes.
- TypeScript (full and production), explicit ESLint/Prettier, production dependency audit, embed
  freshness/ceilings, `git diff --check` and the production Next build passed. The default
  Playwright inventory remains 39; the provider file is reachable only through its separate config.
- The initial credentialed command failed closed before starting Supabase or contacting Stripe
  because that worktree/process had no `STRIPE_SECRET_KEY`. No Auth/DB/provider object was created,
  so no hosted-Checkout red/green run, provider event IDs, cleanup proof or twice-clean result was
  claimed at that point.
- A later process-injected operator attempt reached local bootstrap but created no
  Auth/DB/provider object: the global Supabase CLI 2.20.5 invoked a full `supabase start`, began
  pulling the unrelated Studio/Edge/Realtime/observability stack and stalled before containers were
  usable. The runner now fails closed unless its configurable CLI binary reports the s24/CI pin
  2.117.0 and passes the exact s24 exclusion list to `supabase start -x`; provider proof remained
  open at that point.
- The next real test-mode attempt reached hosted Checkout but failed after 95 seconds: Checkout
  defaulted to Canada, formatted the entered US ZIP as `100 01`, reported an incomplete postal code
  and stayed processing. Its failure output also retained the disposable email and complete public
  Stripe test form values despite media capture being off. Cleanup missed the Customer created only
  after submit because it refreshed the Session only on success, leaving one open/unpaid test
  Checkout and one active test Customer (zero subscriptions); the parent subsequently expired and
  deleted those exact failed-test objects after identity checks. The harness now selects US before
  ZIP, accepts the visible AI-agent disclosure, preserves no Playwright output, and always
  refreshes/expires Checkout before capturing and deleting late IDs.
- A second real test-mode attempt on `300076f` failed 3.853 seconds after Checkout creation and
  before payment. Output preservation correctly left zero unsafe browser artifacts and the local
  stack stopped, but the strict reporter gave no diagnostic. Cleanup was bypassed because the test
  `finally` still called `captureDatabaseRows()` outside the fixture's guarded cleanup; that read
  failed before Checkout reconciliation, again leaving one open/unpaid test Checkout and one active
  disposable Customer (zero subscriptions), which the parent subsequently removed by exact identity.
  The spec then added bounded/redacted lifecycle stages and worker cleanup. The final authority repair
  below supersedes that worker cleanup while retaining the safe failure evidence.
- A third real test-mode attempt on `d64519a` produced the new safe diagnostic at
  `checkout:hosted-form`: the proven `input[name="cardNumber"]` was absent from a one-time frame scan
  because Stripe attached its payment iframe asynchronously. The run ended in seven seconds with no
  unsafe output. External verification then found all three recent test Sessions expired/unpaid,
  zero mutable Customers, zero subscriptions and a clean local stack. Mandatory hosted fields now
  use a bounded 30-second condition poll across the current frame set; cleanup failures now report
  fixed safe operation labels instead of an unlabeled count.
- A fourth real test-mode attempt on `b74c370` reached hosted Checkout, then hit the five-minute test
  timeout because `locator.check()` targeted Stripe's hidden AI-agent disclosure input outside the
  viewport while its exact visible label was present. A timed-out inline `finally` did not complete,
  leaving one open/unpaid test Session and disposable Customer (zero non-terminal subscriptions),
  which the parent subsequently expired/deleted by exact identity; unsafe output and local residue
  remained zero. The harness now clicks the visible exact disclosure text with a five-second action
  bound and asserts the hidden input state. A later authority review moved all destructive cleanup
  out of `afterEach` and into the parent janitor.
- A fifth real test-mode attempt on `bdca263` found that exact visible label but ordinary
  `locator.click({ timeout: 5000 })` still timed out: Stripe's nested scrollport reported the label
  outside its internal viewport, so Playwright's actionability gate never delivered the event. The
  helper now dispatches a DOM `click` event on the same exact visible label without requiring
  viewport actionability, then retains the bounded assertion that the associated hidden checkbox
  became checked.
- A sixth real test-mode attempt reached disclosure discovery, where Stripe replaced a hosted frame
  while the helper was iterating it and Playwright reported `locator.count: Frame was detached`.
  The process-external parent janitor completed clean after 107 reconciliation passes. A subsequent
  remote read-only check found the run's one owned Checkout Session retained as expired, zero mutable
  Customers and the ownership manifest marked `cleaned`. The helper now abandons only this known
  detached-frame failure at count, visibility, dispatch or checked-state reads and rescans current
  frames inside the original discovery bound; repeated detachments exhaust that bound, while any
  unrelated locator failure still propagates. This run did not complete Checkout or entitlement
  proof, and no new provider run had yet been made for this repair.
- A seventh real test-mode attempt completed and paid the owned Checkout Session, then failed in the
  post-submit return poll when Stripe replaced a frame during the hosted error-text scan and
  Playwright reported `locator.count: Frame was detached`. The process-external janitor completed:
  remote read-only verification found one retained complete/paid Session, one canceled subscription,
  zero billable subscriptions, zero mutable Customers and the ownership manifest marked `cleaned`.
  Hosted-field actions, optional-field inspection, disclosure handling and post-submit text scans now
  share one bounded snapshot primitive. It reacquires `page.frames()` for every attempt, discards the
  whole attempt after only the exact detached-frame error, and never restarts the caller's original
  30-second, five-second or 90-second budget. This repair was not immediately followed by another
  provider run.
- An eighth real test-mode attempt completed the full Playwright provider proof in 15.5 seconds, but
  its first success janitor reported that it `did not reach quiescence after 17 passes`. The
  automatic cleanup retry then completed clean after 17 passes; the runner conservatively exited 1
  before run 2. Remote read-only verification after cleanup found one retained complete/paid
  Session, one canceled subscription, zero billable subscriptions, zero mutable Customers and the
  ownership manifest marked `cleaned`. The former `horizon + quiet + 1` budget allowed no complete
  replacement quiet window when cleanup or webhook activity occurred during the first one. One
  janitor invocation now reserves two complete 16-pass quiet windows plus bounded horizon slack,
  while retaining the ten-minute parent timeout. A synthetic failure-horizon regression injects
  activity on the last pass of the first quiet window and proves sixteen fresh quiet passes can
  follow. Terminal bound failures are attributed to `reconcile:quiescence`, while a real nested
  provider/database rejection retains its innermost trusted stage. No provider rerun had yet been
  made for this repair.
- Final hosted-frame deadline review found that the primitive bounded only its retry loop and sleeps:
  with the provider Playwright configuration's `actionTimeout: 0`, an awaited fill, select,
  assertion or disclosure dispatch could outlive the advertised outer bound. Snapshot inspection
  now receives one absolute deadline and every waiting Playwright action/assertion receives its
  positive remaining time explicitly. Disclosure dispatch and checked-state polling share one child
  deadline capped by both the five-second action budget and the outer discovery deadline, and the
  dispatch plus every later checked-state read form one non-idempotent action boundary: a detachment
  after dispatch propagates instead of dispatching again. Only field setters explicitly marked
  idempotent retry after an exact detached-frame error; the submit click remains outside the retry
  helper, and unrelated failures still propagate. Real wall-clock tests prove short field/disclosure
  deadlines settle instead of remaining pending. No provider run had yet been made for this review
  repair.
- Timeout review found that Playwright races the test body and then runs `afterEach`; the original
  body can therefore keep mutating after teardown begins. The harness now registers the fixture and
  complete workflow promises in teardown state before their first mutation, waits those promises in
  the separately budgeted hook, marks Checkout intent before the HTTP request, and independently
  discovers Sessions by the unique disposable user metadata/reference plus run start timestamp.
  Synthetic tests cover delayed disclosure-frame mounting, absent disclosure failure, run-owned
  Session filtering and preservation of cleanup labels beside a primary timeout diagnostic.
- A second architecture review found that even separately budgeted in-worker teardown cannot be the
  final authority: a context-owned request can outlive `page.close()`, Auth can commit before its
  response/callback, and one discovery snapshot can precede a late Checkout. The runner now
  pre-generates the run/Auth UUIDs, disposable email and timestamp, hard-bounds the Playwright child,
  and always invokes a process-external janitor before stopping the app/listener/local stack. The
  janitor reconciles by exact user metadata/reference across Auth, Customers, Sessions,
  subscriptions and local rows, proves terminal deliveries per object ID, then deletes Auth and
  verifies one final time.
- Final review hardened the parent boundary further. The external janitor now re-runs the complete
  loopback/test-mode/Price guard before client construction; paginates all provider discovery; proves
  fresh provider metadata and Customer relationships before every destructive Stripe call; and
  persists cumulative per-object terminal delivery proof across its idempotent rerun. The runner
  passes the Stripe key through environment rather than argv, clears stale evidence/summary files,
  validates run ID/index/Price/freshness, writes a `0600` ownership manifest, handles catchable
  signals with detached process-group termination, registers the listener before readiness, and
  always reconciles before service shutdown. Synthetic tests cover interruption before listener
  readiness and a surviving grandchild. This is explicitly bounded recovery, not a guarantee across
  `SIGKILL`, host/kernel failure or external Docker termination; an unfinished manifest blocks the
  next run for exact operator recovery.
- `precommit` and `prepush` reached the full Jest/coverage suite but remain red on the pre-existing
  `BulkOperations` request-body-limit test when run in the whole suite. The same file passed 13/13
  immediately in isolation without a code change; build and the targeted provider checks available
  at that point were green. The current exact provider scope is recorded below. This
  unrelated flaky test was not changed in this story.
- The final hardening reran `precommit`: lint and full type-check passed, then the 224-suite Jest run
  reported 220 passed, one skipped and three unrelated API suites red (four assertions). The content
  suite still failed 1/27 on the immediate isolated rerun; the two AI suites remained red because their refund
  path reached the repository's unconfigured Supabase service-role client and replaced the mocked
  provider error with `Internal server error`. No s25 file imports those routes or changes their
  behavior, so this harness-only story does not conceal an application/test-environment fix. The
  exact provider and E2E verification scopes are recorded below.
- The final parent-authority repair makes worker `afterEach` diagnostic/capture/browser-only. The
  process-external janitor is the sole provider/local/Auth deletion authority, so it observes an
  active pre-Session Customer and proves exact metadata ownership before deletion. Failure cleanup
  observes for at least five minutes (longer than three 80-second Stripe attempts plus retry delay),
  then requires sixteen consecutive quiet probes; success retains the short quiet window. Dedicated
  Playwright invocation now requires the exact runner manifest, every indexed manifest is checked
  before any run begins, and success evidence is finalized only after the parent janitor completes.
  This closes ordinary late-route work but does not expand the stated `SIGKILL`, host/kernel or
  external-Docker failure boundary.
- Formal review removed the obsolete fixture cleanup API, its Auth rollback callback and its dead
  cleanup tests, leaving worker teardown diagnostic/capture/browser-only and the process-external
  janitor as the sole provider/local/Auth deletion authority. The runner now records janitor failure
  before rethrowing: a validated primary failure keeps its original stage and diagnostic plus the
  fixed bounded label `cleanup failed: external_janitor`; a janitor-only failure creates the same
  owner-only four-field schema at stage `cleanup`. Neither path accepts the raw janitor exception or
  provider IDs.
- Fresh provider-focused verification after the final activity-reset repair used this exact command:

  ```bash
  npm test -- --runInBand src/__tests__/e2e/redacted-diagnostics.test.ts src/__tests__/e2e/stripe-agent-disclosure.test.ts src/__tests__/e2e/stripe-hosted-fields.test.ts src/__tests__/e2e/stripe-provider-contract.test.ts src/__tests__/e2e/stripe-provider-failure.test.ts src/__tests__/e2e/stripe-provider-fixture.test.ts src/__tests__/e2e/stripe-provider-guard.test.ts src/__tests__/e2e/stripe-provider-janitor-entry.test.ts src/__tests__/e2e/stripe-provider-janitor.test.ts src/__tests__/e2e/stripe-provider-ownership.test.ts src/__tests__/e2e/stripe-provider-process.test.ts src/__tests__/e2e/stripe-provider-teardown.test.ts
  ```

  Result after the absolute hosted-frame deadline repair: 12 suites passed, 107 tests passed, zero failures.
  The broader exact command `npm test -- --runInBand src/__tests__/e2e` passed 19 suites and 144 tests
  with zero failures.

  After the janitor-window repair, the focused janitor file passed 13 tests, the exact provider
  scope passed 12 suites and 111 tests, and the broader E2E scope passed 19 suites and 148 tests,
  all with zero failures.
  The full Jest rerun passed 221 suites and 2,864 tests, skipped one suite and 36 tests, and retained
  the same three unrelated API-suite failures documented above (four assertions total).

### Confirmed twice-clean provider proof — 24 September 2026

- The default `npm run test:e2e:stripe-provider` command exited successfully after two consecutive
  runs. Each strict Playwright invocation passed its single expected test with zero failed, skipped
  or flaky tests.
- In each run, Checkout was complete, paid and reconciled; entitlement was Pro; exactly one active
  subscription existed during the assertion; four genuine events were processed; and the signed
  replay returned `duplicate=true` without changing the subscription or ledger count.
- Each process-external parent janitor reached clean state after 18 reconciliation passes. Both
  owner manifests are `cleaned`, and the owner-only evidence, summary, manifest and janitor-state
  files are mode `0600`. Cleanup proved the disposable Auth user, Customer, local rows and billable
  subscription were removed or canceled while immutable Checkout/event history was retained.
- An independent read-only Stripe aggregate immediately after the command found two retained paid
  Checkout Sessions and two retained canceled subscriptions, with zero open Sessions, zero billable
  subscriptions and zero mutable Customers. No provider identifiers, disposable identity or secret
  is retained in this plan.
- Local post-run inspection found zero s25 containers, no Stripe listener and all task ports free.
  At that checkpoint, full precommit/prepush, fresh review, PR/merge/CI and the separate live-payment
  human gate remained open.

### Process-group teardown hardening — 24 September 2026

- A macOS coverage failure showed that waiting only for the detached leader's exit was not proof
  that its process group was gone. Darwin may return `EPERM` for a zombie-only process group, so the
  teardown now polls the negative PGID with signal `0`, accepts only `ESRCH` as gone, escalates from
  `SIGTERM` to `SIGKILL` after a bounded grace period, and fails closed if the bounded post-kill poll
  never reaches `ESRCH`. Test finalizers use the same group-aware teardown instead of interpreting
  every probe error as a dead process.
- The focused process test passed 20 consecutive real-process stress iterations. Its real detached
  grandchild installs a `SIGTERM` handler, proves the leader can exit while the child survives TERM,
  observes the KILL escalation, and returns only after the group probe reaches `ESRCH`. Deterministic
  tests also prove `EPERM`, `EPERM`, `ESRCH` resolves while persistent `EPERM` rejects at the deadline.
- Fresh CI-dummy prepush components both passed: `npm run build` completed the embed byte gates and
  Next production build, then
  `npm run test:coverage -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` passed 224 suites and
  2,870 tests with one suite and 36 tests skipped. Coverage was 52.61% statements, 45.37% branches,
  48.45% functions and 52.96% lines, above the configured ratchet. Full type-check also passed; lint
  remained at zero errors with the 39 inherited warnings. The amended commit's exact pre-commit hook
  then passed lint, type-check, configured formatting and the same 224 suites/2,870 tests under those
  benign dummy values. Fresh review, PR/merge/CI and the separate live-payment human gate remain open.
