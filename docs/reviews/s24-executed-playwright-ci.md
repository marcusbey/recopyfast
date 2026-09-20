# Review: s24-executed-playwright-ci

## Scope and verdict

Fresh-context review of `origin/main...HEAD`, from baseline
`46f810f89b8e4cfd35f93a944e9f6e5d1f18367e` to story head
`729b3ee7b9132fd1fcb36452f5d257046b00585f`.

No actionable defect was found in the reviewed diff. The original review's unit-test blocker is
withdrawn: the four failures reproduce only when the Supabase/app placeholder environment is
absent, while the exact affected paths and the full suite pass under the same safe placeholder
environment committed in CI.

This verdict authorizes the story to proceed to its draft-PR/CI evidence stage. It does not claim
that the Docker-backed stack or the 39 browser tests ran locally; those remain mandatory before
merge.

## Plan and implementation comparison

- The validated plan's target guard exists and is used before either mutating spec constructs a
  service-role client.
- The prior missing-secret success path is removed. The E2E job now installs root/server
  dependencies, starts local Supabase, builds the production app, starts Socket.IO and Next,
  waits for both readiness endpoints, runs Playwright, checks the exact terminal report, and uses
  `always()` cleanup/upload steps.
- Core and parity fixtures use fresh UUID-scoped rows and exact site-id cleanup. The former broad
  parity-domain sweep is gone. Core cleanup restores the captured content state before deleting
  the disposable fixture, with deletion in `finally`.
- All four former suite skip gates are removed. Static Playwright discovery reports exactly 39
  tests in 9 files, matching the workflow, reporter and documentation contract.
- The local twice-clean full-stack run, migration application, draft PR, and actual GitHub Actions
  execution remain open exactly as the plan records; the code does not pretend those steps were
  completed.

## Independent verification

- Exact environment-sensitive regression paths, invoked with `--runTestsByPath` and the committed
  CI placeholders: 3 suites, **64/64 tests passed**.
- Focused s24 contract suites (`local-targets`, `strict-run-contract`, `strict-reporter`, and
  `playwright-ci-contract`): 4 suites, **27/27 tests passed**.
- Full placeholder-environment `npm run precommit`: lint completed with 0 errors (39 existing
  warnings), TypeScript completed successfully, and Jest reported **209 passed suites / 2,720
  passed tests / 0 failures**, with the existing baseline of 1 skipped suite / 36 skipped tests.
- `npm run format:check`: passed.
- `npm run type-check:build`: passed.
- `npm run audit:prod`: passed with 0 vulnerabilities.
- `node scripts/build-embed.mjs --check`: passed; the committed embed artifact is current and
  remains below its ratcheted ceilings.
- Placeholder-environment `npm run build`: passed, including the embed rebuild, production
  compilation, TypeScript phase, and static-page generation.
- `git diff --check origin/main...HEAD`: passed.
- Prettier validation of the changed workflow, Playwright config, support modules and specs:
  passed.
- `playwright test --list`: **39 tests in 9 files**.
- Repository scan across `e2e/`: no `test.skip`, `test.fixme`, `test.only`, `describe.skip`, or
  `describe.only` declaration remains.
- Changed-file credential scan found no committed credential artifact. The only service-role-like
  value is the intentionally inert placeholder JWT in CI.

## Anti-hallucination and mutation checks

- Every new import resolves to an installed package, Node built-in, Playwright reporter API, or
  checked-in support module. The changed specs' service-role creation sites both call
  `createLocalServiceRoleClient`; there is no second direct service-role construction under
  `e2e/`.
- Guard mutation was performed in an isolated archive, not in the story worktree: removing the
  loopback-host predicate made **2 tests fail** (`non-loopback alias` and `bind-all address`). The
  production-safety predicate is therefore covered by tests that demonstrably bite.
- Reporter behavior is covered directly by the focused suite: a green Playwright `FullResult`
  containing a skipped test must return `{ status: "failed" }`, while the strict run contract
  separately rejects failed, skipped, flaky, and missing-test summaries. Static inspection also
  confirms any non-passed runner status marks the report failed and that the workflow independently
  rejects any terminal summary other than exactly 39 passed / 0 failed / 0 skipped / 0 flaky.
- A separate reporter neutralization run was not completed before review finalization. No source
  file in the story worktree was mutated for either check; the completed guard mutation was
  isolated from it.

## Security and workflow review

### Local-target guard

`assertLocalMutationTargets` accepts only plain HTTP origins on the exact loopback hosts and fixed
ports: Supabase `54321`, Next `3000`, and Socket.IO `4001`. It rejects missing/invalid URLs,
non-loopback hosts, bind-all addresses, credentials, paths, queries, fragments and wrong ports.
It also rejects the known production project reference in either raw credential text or a decoded
JWT payload. The explicit mutating flag must equal `1`; absence is a hard failure, not a skip.
Consequently a hosted/production Supabase target cannot pass merely by supplying a valid
service-role credential.

### Strict reporter and artifact secrecy

The reporter derives final outcomes from Playwright's aggregate outcome plus the final attempt,
counts the complete discovered suite, and converts wrong count, failure, skip, flake, interruption,
timeout or other non-passed runner result into a failed process status. The workflow performs a
second exact JSON check after Playwright returns.

CI disables traces, screenshots and video because editor credentials occur in fixture URLs. The
uploaded artifact contains only redacted titles, repo-relative paths, final outcomes and durations;
it contains no environment, request/response, console, error, screenshot, video or trace payload.
The summary is written mode `0600`. Test-title logging applies the same token/JWT/secret redaction.

### Setup, credentials and cleanup

The workflow uses the disposable loopback stack only. Local Supabase anon/service-role values are
parsed from `supabase status -o env`, appended to `GITHUB_ENV` without being printed, and the
temporary status file is removed. Supabase startup output and status files are removed by the
`always()` cleanup step and are not uploaded. App and WebSocket processes have an `EXIT INT TERM`
trap; Supabase has a separate unconditional `supabase stop --no-backup` step. Redis is a GitHub
service container with a health check and no hosted credential.

### Fixture cleanup and restoration

Both mutating suites generate their own site UUID. Cleanup filters every explicit delete by that
captured UUID and finishes with the exact site row, relying on its schema-owned cascades for any
children created by the widget. Core restoration filters by both captured `site_id` and discovered
`element_id`, then deletion still executes in `finally`. Fixture HTTP servers and parity browser
contexts are closed in `finally`/`afterAll` paths.

### Migration applicability

The story changes no migration. Static inspection confirms the two historical from-scratch
ordering hazards named in `supabase/README.md` are guarded with `to_regclass(...)` and re-applied
after their tables exist by `20260731010000_deferred_billing_constraints.sql`. The workflow pins
the CLI and uses the repository's local config/ports rather than a linked hosted project.
Actual application of all 51 migrations was not observed on this host, so this is a static
compatibility check only.

## Evidence limits and mandatory next evidence

- Docker failed on this host, so `supabase start`, application of the 51-migration catalogue,
  Redis/Supabase-backed service readiness, and the real 39-test Chromium run were not executed in
  this review.
- The local twice-clean isolation run was therefore not performed.
- No deployed, provider, payment, or physical-device behavior is claimed by this CI-infrastructure
  story.
- The draft PR's GitHub Actions E2E job must be treated as mandatory completion evidence. Before
  merge, its logs must show Supabase start/migration completion, both readiness checks, an actual
  Playwright invocation, and the uploaded strict summary reporting exactly **39 passed, 0 failed,
  0 skipped, 0 flaky**. A skipped, cancelled, setup-failed, placeholder-only or absent run does not
  satisfy the story despite this code-review verdict.

Max severity: none
Ship allowed: yes
