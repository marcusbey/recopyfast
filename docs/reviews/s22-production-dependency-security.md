# Review — s22-production-dependency-security

Reviewed commit: `d6165239b23366770d164535c0a721e4fc885f3e`  
Baseline: `origin/main` at `ee3942dd1e01a43d5b04c8898c9eb29bf22b5f37`  
Date: 20 September 2026 UTC

## Verdict

The story satisfies its approved production-dependency security scope. No critical, major or
minor issue was found in the reviewed diff. The review gate passes; merge and deployment remain
conditional on the still-running real CI and the leader-owned release evidence in the validated
plan.

## Spec and scope compliance

- The only direct dependency declaration changed is Next, from `^16.1.1` to the approved patched
  floor `^16.3.3`. The only override changed is Sharp, from `^0.35.3` to `^0.35.4`.
- The lock resolves Next 16.3.5, Sharp 0.35.4, browserslist 4.29.0, fast-uri 3.1.8,
  baseline-browser-mapping 2.11.25, fflate 0.8.3 plus nested 0.6.11, and qs 6.16.0. The remaining
  lock changes are their required Next SWC/env/helpers, Sharp platform/libvips binaries, browser
  compatibility data/helpers and qs side-channel helpers.
- No other direct or development dependency changed. Application source, `server/`, CI workflows,
  test configuration and expectations, migrations, pricing, and embed source/artifacts are
  unchanged from the baseline commit.
- The implementation repairs the vulnerable primary dependency contract directly. It adds no
  fallback, swallowed error, bypass, alternate execution path, blanket `audit fix`, or weakened
  audit/test/coverage gate.
- The plan correctly leaves independent review, real CI, merge/deployment, and production replay
  tasks unfinished. The branch contains no release-phase claim.

## Independent verification

All commands below ran with Node 24.14.0 and dummy test/build environment values, never production
credentials.

- `npm run audit:prod`: passed with zero vulnerabilities.
- Clean-install proof: an archive of exact commit `d616523` was extracted outside the author tree;
  `npm ci` installed 1,108 packages successfully, the production audit remained zero, and Sharp
  0.35.4 produced a benign 2x2 PNG.
- `npm run lint`: passed with zero errors and 39 inherited warnings.
- `npm run type-check` and `npm run type-check:build`: passed. No TypeScript source file changed;
  the available full-project compiler diagnostics are therefore stronger than file-local checks
  for this Markdown/JSON-only diff.
- `npm run format:check`: passed for the configured source scope. The changed package files and
  new research/plan documents also pass direct Prettier checks. `docs/stories.md` fails Prettier on
  both baseline and head, so that inherited whole-file state is not a regression.
- `node scripts/build-embed.mjs --check`: passed; bundle 46,664 B, widget 33,853 B and transport
  13,141 B remain within the unchanged Node gzip ceilings.
- `npm run build`: passed on Next 16.3.5. The existing middleware deprecation, missing local Redis
  and dynamic billing-route diagnostics remained warnings and did not fail the production build.
- `npm test -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`: 204 suites passed, one skipped;
  2,676 tests passed and 36 skipped.
- `npm run test:coverage -- --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`: the same suite and
  test counts passed. Coverage was 52.55% statements, 45.29% branches, 48.45% functions and 52.92%
  lines, above the configured ratchet.
- Final `git diff HEAD` showed no reviewer-generated change to the package files or generated embed,
  and the author source commit remained unchanged.

The clean install's full dependency audit still reports one high and one moderate advisory in
transitive development-only packages (`js-yaml` and `@humanfs/node`). They are inherited, are not in
the shipped production tree, and are outside this story's explicitly approved `--omit=dev` gate;
they should be handled in a separate maintenance story rather than broadening this security patch.

## Regression proof

The dependency gate itself is the regression test for this lockfile-only story. In an isolated
temporary copy, the exact `origin/main` package manifest and lock failed the production audit with
seven vulnerable packages: one critical, three high and three moderate. The reviewed lock passed
the same registry audit with zero findings. This demonstrates that reverting the security delta
turns the gate red without mutating the author worktree.

## Smoke evidence and limits

Leader-provided local production-server evidence, kept separate from this reviewer's independent
commands, reports `/login` and `/edit` at HTTP 200 with the sign-in UI rendered, the expected 307
login redirect from `/dashboard/sites`, a visually rendered 62,015-byte social PNG, a 9,740-byte
PNG response from the Next image optimizer, and the unchanged 171,296-byte embed response. Direct
browser rendering of the optimized-image URL was not proven.

This review did not execute staging-backed Playwright, real owner/editor Save to Publish to fresh
visitor, revoked-session recovery, a physical second device, paid entitlement, third-party provider
behavior, or production deployment. At report time PR #19's TypeScript and Vercel checks passed and
the combined CI job was still running. Those release checks remain mandatory and must not be
inferred from the local suite or from a skipped E2E job.

Max severity: none
Ship allowed: yes
