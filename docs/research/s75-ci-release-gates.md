# Research — Story s75-ci-release-gates

Verified against `origin/main` at `72f4cff` on 2026-10-09. No production access: no production
SQL, no connector, no Vercel or Fly call. All SQL ran on a throwaway PostgreSQL 17.11 cluster
(Homebrew `postgresql@17`, keg-only, installed for this story; TCP loopback only, deleted after).
Docker was not running on the author machine, so nothing that needs `supabase start` ran locally.

## The structuring facts

1. **Every migration already replays cleanly on PostgreSQL 17.** `scripts/db/bootstrap-supabase-fixtures.sql`
   plus all 72 files in `supabase/migrations/`, in name order, with `ON_ERROR_STOP=1` and the
   runner's `search_path=public,extensions`, applied on 17.11 with no error. The four
   migrations the runner re-applies for idempotence (`20260925120000`, `20261005000000`,
   `20261008100000`, `20261008110000`) re-applied cleanly. So the change is the runner and the
   CI image, never a migration. That is expected: production (17.4) already holds every one of
   them (`docs/research/s56-rls-content-writes-need-plan.md:7`, ledger head at the time
   `20260928130000`; later ones were applied by their stories).
2. **The runner's six suites pass on 17 unchanged:** 6 suites, 50 passed, 1 skipped. The skip is
   `column-privileges.test.ts`'s `testWithPostgrest` (`:168-169`), which skips without PostgREST
   by design and runs in the e2e step where PostgREST exists. PostgreSQL 17's new `MAINTAIN`
   privilege (`m`) breaks nothing: the privilege suites enumerate the privileges they forbid
   (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `TRIGGER`, `REFERENCES`) and never compare a whole
   ACL string. The migrations' comments saying "parsed on PostgreSQL 14" (`20260928110000:74`,
   `20260928140000:46-47`, `20261008100000:44-45`) become history; they are applied, so they stay.
3. **None of the seven unwired suites needs PostgREST or GoTrue.** Against the same 17 replay,
   with `RCF_TEST_DB_URL`, `RCF_S29_DB_URL` and `RCF_REQUIRE_TEST_DB=1`: 7 suites, 40 tests, 0
   failed, 0 skipped, none `[gated]` (Jest `--json` read per test). How each one gates:

   | Suite | Gate | Needs |
   |---|---|---|
   | `content-version-concurrency`, `content-version-i18n`, `restore-reports-rows`, `site-delete-cascade`, `sites-install-status` | `describeDb` (`db-harness.ts:272-290`): `RCF_TEST_DB_URL`, throws under `RCF_REQUIRE_TEST_DB=1` | the replayed schema |
   | `content-attributes-lifecycle` | `RCF_TEST_DB_URL` present (`:381`, `:415-424`); loopback, explicit port ≠ 54322 (`:389-409`) | `CREATE DATABASE` on the server; builds its own pre-s27 schema and drops it `WITH (FORCE)` (`:577-586`) |
   | `editor-activation-concurrency` | `RCF_S29_DB_URL` loopback, else **`describe.skip`** (`:47-62`) | `CREATE DATABASE`; own fixture schema |

   So all seven belong in the replay step (the `ci` job's PostgreSQL service on port 55438), not
   the Supabase step: `content-attributes-lifecycle` refuses 54322, and the other six only need
   the replayed schema. The two scratch-database suites do **not** honour `RCF_REQUIRE_TEST_DB`;
   one of them skips silently when its variable is missing. That is why the replay step needs a
   guard on what actually ran, not only on what failed (task 3).
4. **The `test.failing` pins still pin real defects on 17.** Flipped to plain `test` for a probe
   (restored with `git checkout`): A-23 — 17 of 20 concurrent `create_content_version` calls
   raise `duplicate key value violates unique constraint "content_versions_site_id_version_number_key"`;
   A-15 — the snapshot keeps one of four language/variant values and restore writes
   "Edit your site, live" into the German row; A-16 — a zero-match restore returns `true`. Their
   `guard:` siblings pass. Nothing to unpin and no new `test.failing` needed.
5. **Supabase CLI 2.117.0 (the pinned version, `ci.yml:227`) accepts `major_version = 17`.** In
   its source at tag `v2.117.0` (`apps/cli-go/pkg/config/config.go:1028-1055`) 13, 14, 15 and 17
   are valid; 17 keeps the default image, which its template pins to
   `supabase/postgres:17.6.1.167` (`apps/cli-go/pkg/config/templates/Dockerfile:2`); the CLI's own
   `config.toml` template defaults to `major_version = 17`. With 15 today, CI starts
   `supabase/postgres:15.8.1.085`. The migrations use only `uuid-ossp` and `pgcrypto`
   (`20250817000000:8-9`), both shipped by the 17 image.
6. **Coverage is far above its floors.** `npx jest --ci --coverage` on `72f4cff` with the CI
   placeholder environment: statements 68.62 % (12467/18166), branches 61.56 % (6936/11266),
   functions 65.72 % (1912/2909), lines 69.23 % (11868/17142); 381 suites passed, 2 skipped;
   4942 tests passed, 38 skipped; 112 s. Floors are 41/34/39/41. Rounded down: 68/61/65/69.
   Slack is thinnest on lines (0.23 points), so the final ratchet uses the measurement of the
   final tree, not this one.
7. **`npm run format:check` is clean on `72f4cff`.** Adding it to CI blocks nothing today.
8. **Actions and runtimes.** The last CI run on this repo (run 37931502508, 2026-10-09) annotates
   every job: "Node.js 20 is deprecated. The following actions target Node.js 20 but are being
   forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4,
   actions/upload-artifact@v4." The first release of each that declares `runs.using: node24`,
   and its stated changes:

   | Action | Tag | Commit (verified with `git ls-remote`) | Change vs today's major |
   |---|---|---|---|
   | `actions/checkout` | v5.1.0 | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` | node24; `allow-unsafe-pr-checkout` affects `pull_request_target` only (unused here) |
   | `actions/setup-node` | v5.0.0 | `a0853c24544627f65ddf259abe73b1d18a591444` | node24; auto-cache only when `packageManager` is set (it is not; `cache: npm` stays explicit) |
   | `actions/upload-artifact` | v6.0.0 | `b7c566a772e6b6bfb58ed0dc250532a479d7789f` | node24 (v5 still defaulted to node20) |
   | `supabase/setup-cli` | v3.0.1 | `45a513f8c64c0bc8e0e3dfe572b5c95be85f6359` | none — `@v3` already resolves to v3.0.1 (composite) |

   Later majors exist (checkout v7, setup-node v7, upload-artifact v7); they carry behaviour
   changes this story cannot prove locally, so they are left to a deliberate bump.
9. **Node.** Node 20 reached end of life on 2026-04-30. Node 22 is in maintenance until
   2027-04-30; Node 24 is the active LTS (maintenance until 2028-04-30). Vercel's build-utils
   (`packages/build-utils/src/fs/node-version.ts`) lists `24.x` (newest) and `22.x`, and gives
   `20.x` a `discontinueDate` of 2026-10-01. Vercel honours `engines.node` in `package.json` over
   the dashboard setting; `vercel.json` here holds only crons. The repo already runs Node 24.14.0
   in `server-security.yml:26` (pinned by `server-manifest.test.ts:117`) and on every author
   machine (all local gates). Some Jest code needs `zlib.crc32` (s23 review: it failed on Node
   20.11, passed on 24.14). The realtime server has no native dependency (`server/package.json`).
10. **The root billing spec is superseded and partly invalid.** `e2e-billing-tests.spec.ts`
    (349 lines, from `30c3b76`) hardcodes `$9`/`$19`/`$39` Starter/Pro/Enterprise cards, an
    Enterprise "Contact sales" link, "+$6 per additional website" and yearly `$7.47`/`$15.77`/`$32.37`
    — the catalogue is the `plans` table (`Pricing.tsx:19`, AGENTS.md Non-negotiable 7) and now
    sells lifetime offers. It calls `/api/billing/tickets`, which does not exist (no
    `src/app/api/billing/tickets/`). It hardcodes `http://localhost:3000`, sleeps with
    `waitForTimeout`, and writes screenshots, which CI turns off on purpose
    (`playwright.config.ts:22-28`). What it meant to cover is covered: pricing and toggles by
    `e2e/landing.spec.ts` E2E-010…018 (from the live catalogue), signup/login and unauthenticated
    redirects by `e2e/auth.spec.ts` E2E-001…006 and `e2e/dashboard.spec.ts` E2E-020…026,
    `/api/billing/subscription` 401 by `e2e/dashboard.spec.ts:46` and
    `src/__tests__/security/auth-guards.test.ts:85`, `/api/billing/dashboard` 401 by
    `dashboard-unentitled.test.ts:227`. Not separately pinned anywhere: 401 on
    `payment-methods` GET/POST/DELETE, `subscription` PUT/DELETE (the route exports GET, PUT and
    DELETE; it has no POST — the spec's POST call was already invalid) and
    `subscription/reactivate` POST (each route returns 401 before any work:
    `payment-methods/route.ts:31,71,141`, `subscription/route.ts:28,70,128`,
    `reactivate/route.ts:19`). Reviving the spec would mean rewriting it; deleting it loses no
    running check. *Review fix pass:* those six 401s are now pinned by
    `src/__tests__/api/billing/unauthenticated.test.ts`, each with a signed-in sibling proving the
    401 is the session check.

## Traps

- **A misspelled path is a silent drop.** Jest treats positional paths as patterns; one that
  matches nothing is ignored while the others run, and the exit code stays 0. The replay step
  must check that every suite it names produced a result.
- **`describe.skip` and `[gated]` both exit 0.** Jest `--ci` does not fail on skipped tests. The
  guard is: each named suite ran, has at least one passing real test, and registered no `[gated]`
  placeholder except "no PostgREST target configured". Neither a blanket "no skipped tests" nor
  a blanket "no `[gated]`" rule works here: `column-privileges`'s PostgREST test skips in the
  replay step by design, and `edit-sessions-privileges` registers a PostgREST placeholder there
  by design (found at execution; both halves run in the e2e job).
- **Local PostgreSQL 14 is first on this machine's `PATH`** (`/usr/local/bin/psql` → 14.17), and
  `findBinary` checks `/usr/local/bin` before `/opt/homebrew/bin` (`run-db-invariants.mjs:40-47`).
  Locally, `RCF_POSTGRES_BIN=/opt/homebrew/opt/postgresql@17/bin` is required; the version error
  must say so.
- **Unix socket path length.** A cluster whose socket directory sits under the session
  scratchpad exceeds the 103-byte limit and refuses to start; the runner uses `/tmp` defaults
  and is unaffected.
- **The coverage gate has 0.23 points of slack on lines** at today's measurement; CI may measure
  marginally differently from a laptop only if env-gated code paths differ. The CI placeholder
  environment (`ci-env.sh`) was used for the measurement to keep that difference at zero.
- **`share-rls.test.ts:738` and `share-owner-lockout.test.ts:495`** also gate on
  `RCF_TEST_DB_URL`, outside `src/__tests__/db/`. They are production "branch oracles" for B-3,
  not schema invariants: against the 17 replay the A-9 oracle is red because it expects an
  `authenticated` INSERT policy on `site_permissions` that the service-role move removed on
  purpose. Wiring them would add a false failure; they are a follow-up, not this story.
- **`docs/architecture.md:431`** still says "Jest floor is 22% lines". Architecture is not the
  implementer's to edit; reported as a follow-up.

## What only CI can prove

- `supabase start` on `supabase/postgres:17.6.1.167`, and the e2e job's eight named DB suites
  plus the 80 Playwright tests on it.
- The coverage threshold on the GitHub runner's measurement.
- Node 24 for `npm ci`, the build and the e2e app/server processes on the runner.
- The SHA-pinned actions resolving and running.
- `node:24-alpine` for the realtime image is proven only at the next `fly deploy` (CI does not
  build the image; the e2e job does run `server/` on Node 24).
