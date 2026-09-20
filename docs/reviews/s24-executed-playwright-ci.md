# Review: s24-executed-playwright-ci

## Scope and verdict

Fresh-context review of the complete story diff from `origin/main`
(`46f810f89b8e4cfd35f93a944e9f6e5d1f18367e`) through reviewed code head
`f6f03d6caccec0d4bada4435905857c38344d5ba`.

No actionable defect remains in the reviewed diff. The story now executes the complete Playwright
inventory against a disposable local stack, fails closed on non-local mutation targets and on any
missing/skipped/flaky/failed browser case, uploads only a redacted summary, and cleans up both
processes and disposable data. The two widget defects exposed by the first executed invited-editor
runs were repaired narrowly and regression-tested.

## What the story delivers

### A real blocking browser gate

- The former missing-secret success path is gone. GitHub installs the root and realtime locks,
  starts Redis plus Supabase CLI `2.117.0`, builds production Next, starts Socket.IO and Next on
  deterministic ports, waits for both health surfaces, and runs Playwright with both mutating
  suites explicitly enabled.
- `assertLocalMutationTargets` allows only exact loopback HTTP origins on Supabase `54321`, Next
  `3000`, and Socket.IO `4001`; it also refuses the known production project reference. A missing
  opt-in throws instead of becoming a skip. Both service-role browser fixtures construct their
  client through this guard.
- The strict reporter requires exactly 39 passed tests and zero failed, skipped, or flaky tests.
  Any non-passed Playwright terminal result also fails the run. The workflow independently parses
  the final JSON and enforces the same contract.
- CI disables traces, screenshots, and video because editor credentials can appear in fixture
  URLs. The only uploaded browser artifact contains redacted titles, repo-relative paths, outcomes,
  and durations.

### Secure, isolated fixtures

- The core flow no longer seeds the rejected first-opener `staging_access` shortcut. It creates a
  run-scoped `site_editors` row and a keyed verification-code digest, submits the code through the
  real hub endpoint, carries the returned HTTP-only hub cookie to the real handoff endpoint, and
  lets the widget redeem the one-shot handoff into an origin-bound device grant.
- The invited-editor case asserts its own editor banner and Publish control; the edit-session case
  asserts the owner staging banner and owner Publish control. Each rejects the other credential's
  chrome, so a flow cannot pass while silently exercising the wrong principal.
- Fixture ids are fresh UUIDs. Cleanup explicitly deletes the captured hub-code id, restores the
  captured content row, and deletes only the captured site id; schema cascades own that site's
  editor, handoff, grant, and content children. The parity fixture likewise deletes only its
  captured site id. HTTP servers and browser contexts close in teardown/finally paths.
- Setup diagnostics name the failed fixture stage but redact URLs with queries, authorization,
  tokens, keys, codes, emails, UUIDs, JWTs, and long digests before logging. The original error is
  rethrown, so diagnostics cannot turn a failing setup into a pass.

### Two executed-run widget repairs

1. **Invited-editor banner no longer covers host content.** `showEditorBanner` reserves the
   banner's measured height in addition to the host's computed body padding. The temporary
   declaration is inline-important so an author-important stylesheet cannot defeat it. On Done,
   the widget restores the exact prior inline value and priority, or removes only its injected
   longhand when the host had none. Regression tests cover author-stylesheet `!important`,
   inline-important restoration, and credential persistence after dismissal.
2. **Inline Save chrome no longer sits behind either editor banner.** Toolbar geometry now treats
   `#rcf-editor-banner` and `#rcf-staging-banner` as equivalent top chrome and flips below the
   edited element when an above-element placement would collide. Geometry tests cover invited
   editor and owner edit-session modes. Neutralizing the selector reproduces the invited-editor
   failure (`28px` inside the banner instead of the safe `128px` position).

Both changes were made in `public/embed/recopyfast.src.js`; the permanent public artifact
`public/embed/recopyfast.js` was regenerated and passes its source-hash and gzip ratchet.

## Independent local evidence

The final reviewed code head produced:

- Placeholder-environment `npm run precommit`: lint completed with 0 errors (39 existing
  warnings), TypeScript completed successfully, and Jest reported **211 passed suites, 1 baseline
  skipped suite; 2,733 passed tests, 36 skipped tests, 0 failed tests**.
- All embed regressions: **121/121 passed**. The focused toolbar/terminal suite passed **14/14**.
- `npm run build`: production compilation, TypeScript, page collection, and static generation
  completed successfully.
- `node scripts/build-embed.mjs --check`: artifact current; gzip **46,480 B bundle / 33,707 B
  widget / 13,122 B transport**, within the committed ratchets.
- Static Playwright inventory: **39 tests in 9 files**, with no `test.skip`, `test.fixme`,
  `test.only`, `describe.skip`, or `describe.only` declaration.
- `git diff --check`: clean.

Mutation checks were run outside the story worktree:

- Removing the loopback-host predicate made the non-loopback-alias and bind-all-address tests red.
- Removing the banner-height reservation made its regression red; removing padding restoration
  also made it red.
- Dropping the temporary `important` priority made two tests red; dropping restoration of the
  saved priority made one test red.
- Reverting toolbar lookup to staging-only made exactly the invited-editor geometry case red while
  preserving the owner case.

## GitHub execution proof

### CI run 35534281982

[GitHub Actions run 35534281982](https://github.com/marcusbey/recopyfast/actions/runs/35534281982)
completed successfully for pull request head
`f6f03d6caccec0d4bada4435905857c38344d5ba`.

- Root audit, lint, production type-check, embed freshness/size gate, production build, and blocking
  Jest steps all completed successfully. The separate full TypeScript job also completed.
- Redis initialized healthy. `supabase start` and `supabase status -o env` completed under
  `set -euo pipefail`, so the disposable project started with the repository migration catalogue
  applied and returned local anon/service-role credentials. Those credentials entered
  `GITHUB_ENV`, remained masked in later logs, and the temporary status file was removed.
- The blocking browser step started realtime and Next with an `EXIT INT TERM` cleanup trap, then
  successfully passed readiness checks for `http://127.0.0.1:4001/health` and
  `http://127.0.0.1:3000/login` before invoking Playwright.
- The executed log ended with: **39 passed, 0 failed, 0 skipped, 0 flaky, 39 total (expected 39)**.
  Both secure core cases passed: invited-editor grant and edit-session token. The two-client
  realtime parity case also passed under its one-second budget.
- The downloaded `playwright-summary` artifact reports `contract: passed`, `expected: 39`,
  `total: 39`, `passed: 39`, and zeros for failed/skipped/flaky. It contains 39 test records and
  matched none of the forbidden token, Authorization, JWT, Supabase-secret, or service-role-key
  patterns checked during review.
- `supabase stop --no-backup` completed successfully; Supabase start/status files were deleted,
  the service-process trap ran on step exit, GitHub stopped the Redis container, and the redacted
  summary artifact uploaded successfully.

This run supplies the full-stack migration, readiness, executed-browser, report, and cleanup
evidence that the broken local Docker daemon could not provide earlier. It supersedes the old
review statement that the migration catalogue and 39-browser run were unobserved.

### Realtime dependency audit 35534282000

[Server Dependency Security run 35534282000](https://github.com/marcusbey/recopyfast/actions/runs/35534282000)
completed successfully on the same `f6f03d6` head. It performed a clean
`npm ci --omit=dev` in `server/`, audited 160 installed production packages, then ran
`npm audit --omit=dev --audit-level=moderate`; both reported **0 vulnerabilities**.

## Evidence boundaries

- Pull request [#21](https://github.com/marcusbey/recopyfast/pull/21) is still open as a draft and
  unmerged. This review does not claim merge, main-branch CI, production deployment, or branch
  cleanup.
- The full disposable stack was executed in GitHub Actions, not reproduced twice on this Mac after
  its Docker daemon failed. The GitHub run is the observed full-stack proof; the local limitation
  is no longer a claim that browser execution itself is missing.
- The workflow uses local Supabase/Redis and inert Stripe placeholders. It proves application
  browser behavior and isolation, not hosted-production state, real payment/provider behavior, or
  physical-device behavior.

Max severity: none
Ship allowed: yes
