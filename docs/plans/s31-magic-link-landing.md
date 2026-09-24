---
validated: yes
---

# s31 — Magic-link landing hotfix

The operator explicitly pre-validated this scope and these decisions in the 2026-09-24
user instruction. Branch: `feature/s31-magic-link-landing`, base `a9e3f21`.

## Tasks

- [x] Add route regression tests first and record their red result: absolute callback
  redirect with/without nested `/dashboard/sites`, auth-internal destinations, apex/www
  canonical origins, cross-origin refusal, unsafe direct/nested next values; callback
  no-code verified session/default/next, absent session, explicit error and failed exchange.
  Preserve trial guards and all existing tests. No in-scope failing markers exist to flip.
- [x] In confirm's `resolveDestination`, after same-origin validation unwrap `/auth/`
  destinations using `sanitizeNext(target.searchParams.get("next"))`; preserve direct-next
  precedence and non-auth paths. Keep origin policy and sanitizer unchanged.
- [x] In callback, prioritize an explicit `error` parameter. Only when no code exists,
  accept `getUser()` returning a user without an error; otherwise redirect to `/auth/error`.
  Preserve exchange-failure behavior and existing trial calls; do not add trial calls to
  the no-code fallback. Catch lookup failure as an authentication error.
- [x] Verify focused tests, `npm run precommit`, `npm run build`, embed freshness/gzip,
  `npm run audit:prod`, production type-check and formatting. Record exact counts and
  inherited warnings; do not weaken tests or unrelated gates.
- [x] Prepare the focused commit and draft-PR handoff with Why / What changed / Decisions /
  Verification / Risk & rollback. Review file contains only `pending independent review`;
  independent review and production delivery remain separate. Push and open the draft after gates.

## Execution boundaries

The implementer owns only the two auth routes and their route tests; the leader owns docs,
full gates, commit and draft PR. Use `/tmp/recopyfast-s31-ci.py <command...>` to clear inherited
credentials and load only `.github/workflows/ci.yml` main-job placeholders. No `.env` copies,
production access, schema/config changes, dependencies, merge, ready transition or deploy.
No ADR or UI design is required. Rollback is a revert of the single hotfix commit.

## Verification evidence (2026-09-24)

Commands run with an environment cleared of inherited service credentials, populated from the
main CI job's exact placeholders. No local env file or production credential was used.

- `npm run setup`: root and server installed; dependency files unchanged.
- TDD red: focused confirm-destination/callback suites initially **13 failed, 21 passed**;
  the added empty-error case then produced **1 failed, 38 passed** before its fix.
- Focused auth green: **4 suites, 62 tests passed**, including existing confirmation-trial
  and public-origin guards. Existing origin/trial helper tests: **2 suites, 29 passed**.
- **23 new test cases** (13 confirm destinations, 10 callback); **0 markers flipped**.
  The old callback no-code test now explicitly mocks no user, retaining its error assertion.
- `npm run precommit`: **211 suites passed, 1 skipped; 2,756 tests passed, 36 skipped;
  0 failed**. Lint: **0 errors, 39 inherited warnings**, identical to the baseline.
- `npm run type-check:build`: passed.
- `npm run build`: passed. Existing middleware deprecation warning remains.
- `node scripts/build-embed.mjs --check`: fresh before and after build; Node zlib level 9
  bundle **46,480 / 46,681 B**, widget **33,707 / 33,865 B**, transport **13,122 B**.
- `npm run audit:prod`: **0 vulnerabilities**. No dependency or lockfile change.
- Global `npm run format:check` baseline and final changed-file Prettier check passed;
  the commit hook rechecks global formatting, lint, types and the full test suite.
- `git diff --check`: passed. No SQL, template, configuration or embed change.

Independent review is deliberately pending. Browser/production verification is not claimed;
this lane stops at a draft PR and never merges, marks ready or deploys.
