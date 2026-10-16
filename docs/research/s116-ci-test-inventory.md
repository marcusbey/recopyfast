# Research — Story s116-ci-test-inventory

Verified on 2026-10-16 against exact remote `main`
`1cbf586a5c096eb4ee724a574588ede228b47269` in the isolated worktree
`/Users/marcusbey/.codex/worktrees/s116-ci-test-coverage/recopyfast`. No source, workflow,
package, lockfile, migration, provider, branch-protection setting, commit or other worktree was
changed. The prior `/tmp` audit disappeared after a host reset, so its reproducible findings and
the fresh analytics result are preserved here.

`docs/reviews/stories.md` currently ends `Stories ready: no`. That review predates this targeted
owner-requested repair and warns that the original backlog as a whole is not approved. The owner
validated this story's bounded plan separately on 2026-10-16; that checkpoint does not change the
older whole-backlog verdict.

## Premise verdict

The premise is true: current CI is green, but it does not run every committed test. The repair is
bounded to test discovery, durable local database coverage and removal of one obsolete skipped
suite. No product behavior or provider acceptance belongs in this story.

## Exact current evidence

GitHub Actions run `38901186424` is the current `main` CI run for `1cbf586`:

- Jest: 542 discovered files; 540 passed suites and 2 skipped suites; 8,066 passed and 38 skipped
  tests out of 8,104. Coverage was statements 77.38%, branches 71.55%, functions 75.55%, lines
  78.16%, above the 76/70/74/76 ratchet.
- PostgreSQL 17 replay: all 82 migrations; all 21 named suites ran; 188 passed and one
  PostgREST-only case skipped by design.
- The E2E Supabase/PostgREST preflight ran 179 database assertions (20 + 85 + 23 + 27 + 24), all
  passing.
- Main Playwright: 106 passed, zero failed/skipped/flaky, across all 22 non-embed spec files.
- Built embed fixture: 7 passed, zero failed/skipped/flaky, across all 5 fixture spec files.
- Four explicitly named Node test files ran 68 cases: replay checks 20, Stripe catalogue 12,
  published-snapshot tooling 14 and uptime decisions 22.

The fifth Node test file, `scripts/check-analytics-conversions.test.mjs`, is outside Jest's
`src/**` match and absent from both `package.json` and CI. Before running it, its imports were read:
every test supplies a fixture `fetcher`, rejected-argument/missing-secret cases assert it is never
called, `measurement-protocol.ts` has no import-time work, and the CLI branch is false on import.
There is no provider path in the test run. A fresh explicit Node 24 run in this worktree passed:

```text
/usr/local/bin/node --version
v24.8.0
/usr/local/bin/node --test scripts/check-analytics-conversions.test.mjs
11 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo
```

Node emitted only `MODULE_TYPELESS_PACKAGE_JSON` while reparsing the imported TypeScript module as
ESM. The result proves the file is green and fixture-only; it does not repair its CI omission and
does not prove Google receipt.

## Node test inventory and safety boundary

Exactly five `scripts/**/*.test.mjs` files exist on `1cbf586`:

| File                                                    | Current cases | Reviewed network behavior                             |
| ------------------------------------------------------- | ------------: | ----------------------------------------------------- |
| `scripts/__tests__/replay-checks.test.mjs`              |            20 | filesystem/temp reports only                          |
| `scripts/__tests__/sync-stripe-catalogue.test.mjs`      |            12 | injected recording Stripe doubles; no provider        |
| `scripts/__tests__/measure-published-snapshot.test.mjs` |            14 | owned loopback HTTP servers                           |
| `scripts/__tests__/uptime-check.test.mjs`               |            22 | owned loopback HTTP servers and recording `gh` double |
| `scripts/check-analytics-conversions.test.mjs`          |            11 | injected fetchers; no provider                        |

The workflow names four paths independently, so a new or moved test can be silently omitted.
Use discovery plus equality with an explicit reviewed fixture-only path list before executing
any child. Add a dedicated sixth file for the runner's own contract tests. Unknown files fail
before execution. For every reviewed file, require a nonempty valid result, zero failures,
cancellations, skips/todo, and consistent totals; report actual test counts.

Parent review rejected per-file SHA digests and pinned assertion counts. They add maintenance
for ordinary test edits, do not protect transitive imports, and the originally proposed 79-case
fixed total contradicted adding new runner tests. This is an inventory guard, not a network
sandbox. Normal review still checks that known files and imports remain fixture-only.

No `package.json` script is required: `.github/workflows/ci.yml` can invoke the runner directly.
That avoids the only manifest overlap in open draft PR #90, which adds
`test:e2e:stripe-provider` to `package.json` and touches no s116 implementation file named below.

## The six conditionally skipped database cases

The 38 base-Jest skips decompose to 30 obsolete hero cases, two
`editor-activation-concurrency` cases that the replay later runs, and these six ad-hoc cases:

| Case                                                                   | Current prerequisite                                                                              | Verdict                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `update-history-policy`: superuser seed/trigger guard                  | `RCF_DB_TESTS=1`; optional `SUPABASE_TEST_DB_URL`, default local Supabase PG at `127.0.0.1:54322` | Valid negative control                          |
| `update-history-policy`: authenticated update is `42501` and unchanged | same; full ReCopyFast schema and roles; writes roll back                                          | Valid ADR 042 invariant                         |
| `share-rls`: `pg_policies` returns an array                            | any `RCF_TEST_DB_URL`; no loopback/schema guard                                                   | Connectivity-only; no product verdict           |
| `share-rls`: authenticated INSERT policy exists                        | same                                                                                              | Knowingly stale and wrong on the current schema |
| `share-owner-lockout`: `pg_policies` returns an array                  | any `RCF_TEST_DB_URL`; no loopback/schema guard                                                   | Weak/vacuous connectivity-only guard            |
| `share-owner-lockout`: no site-scoped DELETE policy                    | same                                                                                              | Valid per-row authorization invariant           |

The stale A-9 expectation is settled by current code, not opinion:

- `src/app/api/sites/[siteId]/share/route.ts` authorizes first and performs every
  `site_permissions` read/write through `createServiceRoleClient`.
- `20261008110000_converge_replay_privileges.sql` intentionally drops authenticated
  `site_permissions` INSERT/UPDATE policies.
- `docs/plans/s75-ci-release-gates.md` already records: “the A-9 one is stale against the current
  schema.”

Exactly three original substantive assertions remain current: the content trigger/seed negative
control, the authenticated content update refusal plus unchanged content/history, and the per-row
DELETE invariant. The authenticated INSERT-policy expectation is the one stale oracle to replace;
the two `Array.isArray(rows)` cases are connectivity-only and should disappear.

The durable homes already exist. `content-write-privileges.test.ts` is required in the disposable
Supabase/PostgREST PG17 step and proves no web role has content DML while service-role retains it.
`replay-privilege-convergence.test.ts` is required by the plain PG17 replay and already proves the
service-role move and preservation of the per-row revoke policy. The valid missing semantics can be
folded into those suites as effective-role and transactional write/read-back assertions; policy text
may be an additional guard but cannot be the only proof where the harness can exercise the role.
The three ad-hoc `describe.skip` blocks and their connectivity-only guards can then be removed
without a new database runner or production connection.

## Obsolete `InteractiveHero` suite and current coverage map

`src/components/landing/__tests__/InteractiveHero.test.tsx` has 30 tests under one
`describe.skip`. The adjacent maintained suite explicitly says it targets “a version of this
component that no longer exists.” Its asserted banner, code preview, live stats, `Auto Demo`
button, old copy (`Transform Your Website`) and direct `<input>` editor are absent from the current
component. Rewriting those assertions to current strings would test a different product.

Current contracts are covered at their real boundaries:

| Current contract                                                                  | Existing proof                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `/demo` mounts the real component once, without embed credentials/API/staging     | `src/__tests__/integration/demo-page.test.tsx`                           |
| homepage places the real demo directly after the editorial hero                   | `EditorialHomePage.test.tsx` and `HeroDemo.reduced-motion.test.tsx`      |
| component mounts three-site demo and stops its attract loop on interaction/scroll | `InteractiveHero.attract.test.tsx` (4 cases with a non-vacuous observer) |
| text affordance works by keyboard and click                                       | `demo/__tests__/EditableText.test.tsx`                                   |
| image replacement uses the bounded photo pool                                     | `demo/__tests__/EditableImage.test.tsx`                                  |
| toolbar actions remain inside the dismissal/viewport boundary                     | `FloatingEditorToolbar.dismiss-guard.test.tsx` and `.viewport.test.tsx`  |
| mobile nested scrolling never snaps backward                                      | `e2e/hero-demo-mobile.spec.ts` (2 real-input cases)                      |

The mapping leaves no current behavior owned only by the skipped file. Deletion is therefore the
honest operation; its historical categories should be recorded in the implementation diff/PR so a
future reviewer does not mistake 30 fewer skips for 30 fewer current regressions.

## Files and boundaries

Expected implementation ownership is limited to:

- `.github/workflows/ci.yml`
- a new `scripts/run-node-tests.mjs`
- a new `scripts/__tests__/node-test-runner.test.mjs` for focused runner/inventory checks
- `src/__tests__/ci/release-gates.test.ts`
- `src/__tests__/db/content-write-privileges.test.ts`
- `src/__tests__/db/replay-privilege-convergence.test.ts`
- the three ad-hoc files under `src/__tests__/api/{bulk,sites}/`
- deletion of `src/components/landing/__tests__/InteractiveHero.test.tsx`
- this story's docs/review files

Out of scope: `package.json`, `package-lock.json`, dependencies, migrations, production/provider
data, browser specs/config/counts, branch protection, product code, UI, embed code and all other
worktrees. No ADR is needed: this extends s75's existing CI/replay mechanism without changing a
product or data boundary.

## Traps and required mutation proof

- Inventory must finish before the first child test starts. An unexpected test whose body writes a
  marker must be refused with the marker absent.
- Globs alone are unsafe: they auto-run an unreviewed provider test. A hand-maintained list alone is
  unsafe: it ignores a newly-added test. Discovery plus exact manifest equality is required.
- Child exit zero is insufficient. The runner must parse one stable reporter summary and reject
  skipped/todo/cancelled/failed/zero-test results while reporting actual totals.
- The stale authenticated-INSERT oracle must not be “fixed” to expect the old policy. Its
  replacement asserts no web write policy and service-role capability on current migrations.
- Standalone `Array.isArray(rows)` guards are not evidence; the durable harness must require the
  schema and at least one substantive assertion.
- The global IntersectionObserver mock is inert. Retained attract-loop coverage must keep its own
  controllable observer.
- Browser contracts are exact: 106 app and 7 embed. s116 does not spend either inventory.
- Preserve every worktree: no cleanup, archive, reset, stash, branch deletion or shared checkout
  edit belongs to this story.

## Open questions / checkpoint decisions

1. Approve the recommended six-entry reviewed fixture-only manifest with exact discovered-file set
   equality and no hashes or case-count pins. A new file requires explicit review before it can run.
2. Approve replacing the stale A-9 assertion with the current service-role/no-authenticated-write
   invariant, rather than preserving a red “production branch oracle.”
3. Approve deleting the 30-test skipped legacy hero file based on the coverage map above; no
   current-contract replacement test is needed unless implementation proves one mapping false.

Complexity remains **3**, matching the story: multiple test runners and security semantics, but no
product code, migration, dependency, UI or external system. No split is warranted.

The audit-only analytics evidence above is honestly Node 24.8.0. Later implementation gates must
use the repository's required exact Node 24.14.0 at
`/Users/marcusbey/.asdf/installs/nodejs/24.14.0/bin/node`; no runtime upgrade/downgrade belongs to
this story.

Research ready in `docs/research/s116-ci-test-inventory.md`. Next step: `/ks-plan s116-ci-test-inventory`
