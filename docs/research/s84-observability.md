# Research — s84-observability

Verified on `origin/main` `c0c40bf`, 2026-10-09, in the worktree `feature/s84-observability`.
Installed versions: `next` 16.3.8, `@sentry/nextjs` / `@sentry/node` 10.58.0 (root). Nothing here was
checked against production: no Vercel, Fly, Sentry or GitHub setting was read or changed.

## Integration addendum — 2026-10-10

The branch was reconciled with `origin/main` `0dea1c0` after this research. That baseline contains
s75, so PostgreSQL 17 and Node 24 are now authoritative: `.github/workflows/ci.yml` uses
`postgres:17` and Node 24, and `scripts/db/replay-checks.mjs` makes the database runner refuse any
other server major. References below to the earlier PostgreSQL 14 / Node 20 harness describe the
original research state, not the merged branch.

The normal merge had two textual conflicts. `docs/stories.md` retains both histories.
`src/middleware.ts` retains main's sessionless `/llms.txt` route and s84's
`isSentryTunnelPath`, so case, encoded-letter and trailing-slash tunnel spellings still reach the
allow-list without paying for a session.

A fresh isolated Node 24 run found one test-harness dependency: `rate-limit.test.ts` expected the
readiness route to answer 200 without setting `SUPABASE_SERVICE_ROLE_KEY`, although
`checkEnvironmentVariables` requires it alongside the public Supabase URL and anon key. The test
passed only when another suite leaked that variable. The recovery makes the suite set and restore
all three required values; no route behavior changed.

## Independent review addendum — 2026-10-10

- Main's s75 workflow policy is list-wide: every workflow must default to exactly `contents: read`.
  Uptime is the only job that mutates GitHub state, so the narrow compatible shape is a reviewed
  `uptime.yml#probe` override with exactly `contents: read` and `issues: write`; all other write
  scopes remain forbidden.
- `rg` found no production caller of `/api/health?quick=true`. The branch still inherited a shortcut
  that returned `200 healthy` before database, cache, storage and realtime checks, contradicting the
  s84 public component contract. The parameter now has ordinary full-probe behavior.
- Readiness inherited `critical_paths: pass`, but its function only constructed an unused route-name
  array and never called, imported or inspected a route. The truthful response has exactly the three
  checks it performs: environment, database and storage. Calling application routes from readiness
  would add authority and side effects and has no accepted design.
- The realtime scrubber tested raw query names. Standard URL parsing decodes `to%6ben`,
  `edit%54oken`, `rcf_%74oken` and `%68andoff` into sensitive names, so their values survived in
  request URLs, messages and Sentry envelopes. One bounded `decodeURIComponent` pass now decides
  sensitivity while retaining the original spelling in output; malformed or oversized names are
  filtered closed.

## 1. `/api/health` and Redis (A-30)

- `HealthStatus.checks.cache?` is declared (`src/app/api/health/route.ts:20`) and never set. `GET`
  runs `checkDatabase`, `checkStorage`, `checkExternalServices` (only with `?detailed=true`) and the
  memoised realtime probe (`:362-368`). `HEAD` runs `checkDatabase` alone (`:497-502`).
- The rate-limit store is a hard dependency of editor login: `RedisRateLimiter.checkLimit` throws
  when Redis is unreachable (`src/lib/security/rate-limiter.ts:302-364`), and `enforceRateLimit`
  defaults to `onStoreFailure: "deny"` (`src/lib/api/rate-limit.ts:106`).
- The pins (`src/__tests__/api/health/cache-check.test.ts:132,156,172`) mock
  `rateLimiter.checkLimit` and keep `RATE_LIMIT_CONFIGS`/`createRateLimitConfig` real, so a cache
  check that goes through `rateLimiter.checkLimit` makes them pass unchanged. A `PING` through a
  separate export would not: the mock spreads the real module, whose memory store never fails in
  jest. `HEAD` is called there with no argument (`:177`).
- Severity maths (`route.ts:401-411`): one `error` ⇒ `degraded` (HTTP 200), two ⇒ `unhealthy` (503).
  A database-only outage therefore answers `GET` 200 while `HEAD` answers 503. Realtime is attached
  after the count and can only move `healthy` to `degraded` (`:413-424`, ADR 004 "Watch").
- **Cost trap.** The store is Upstash, billed per command, shared with the app's fail-closed limiter
  (`server/README.md:136-141`). One `checkLimit` is two commands (`INCR`+`EXPIRE`,
  `rate-limiter.ts:324-327`). A health `GET` with a limiter and a cache probe costs four commands;
  the uptime workflow at one run per 10 minutes is ≈ 4,300 runs/month ≈ 17k commands/month.

## 2. What the health bodies leak (s69 L3)

| Where | What |
|---|---|
| `route.ts:93`, `:130`, `:165` | raw `error.message` from Postgres/PostgREST/Storage/SDK |
| `route.ts:115-119` | bucket name and its `public` flag |
| `route.ts:242-246` | realtime service's live `connections` count and Supabase state |
| `route.ts:141-148`, `:438-441` | Sentry-enabled flag and heap metrics, on `?detailed=true` |
| `ready/route.ts:41` | names of missing environment variables |
| `ready/route.ts:77-78`, `:104` | raw database/storage errors |
| `ready/route.ts:159` | `VERCEL_REGION` |

The realtime check already returns fixed strings (s07b, `route.ts:262-275`). Consumers of the body:
`server/README.md:236` (`jq '.status, .checks.realtime'`), `docs/operations/deployment-env.md:145`
(`jq '.environment'`), `e2e/performance.spec.ts:22` (status only). None reads `error`, `details` or
`metrics`. `?detailed=true` has no caller in the repo.

## 3. Rate limiting

- `enforceRateLimit` (`src/lib/api/rate-limit.ts:98-166`) keys per IP from `x-forwarded-for`
  (first hop) and supports `onStoreFailure: "allow"`. `/api/published/[siteId]` is the precedent
  for a public fail-open per-IP limiter (`route.ts:225-237`, `IP_GENERAL` 200/min).
- Presets live in `RATE_LIMIT_CONFIGS` (`rate-limiter.ts:419-444`); no test enumerates the keys.
- Monitors: Sentry uptime's shortest interval is 1 min, common SaaS monitors 30 s–5 min, ours 10 min.

## 4. The Sentry tunnel

- `next.config.ts:173` sets `tunnelRoute: "/monitoring"`. `@sentry/nextjs` adds two `beforeFiles`
  rewrites (`node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/tunnel.js:19-71`):
  `/monitoring(/?)` with query `o=(\d*)`, `p=(\d*)` [and `r=([a-z]{2})`] →
  `https://o:orgid.ingest[.:region].sentry.io/api/:projectid/envelope/?hsts=0`. **The destination is
  taken from the query string only**; the body is forwarded as is. Any digits match, so the route
  relays to every Sentry SaaS project.
- The browser SDK builds that query from its own DSN (`@sentry/nextjs/build/cjs/client/tunnelRoute.js`,
  host regex `^o(\d+)\.ingest(?:\.([a-z]{2}))?\.sentry\.io$`), and only for SaaS DSNs.
- The middleware runs before `beforeFiles` rewrites. `/monitoring` is in `isSessionlessPath`
  (`src/middleware.ts:113`) and only gets security headers.
- **Correction (s84 review, F1).** "Two `beforeFiles` rewrites" above is wrong for this repo: our
  `rewrites()` returns an array, so Sentry returns an array and Next files both rules under
  `afterFiles` (`load-custom-routes.js` `loadRewrites`). Either way the match is
  **case-insensitive with an optional trailing slash**: `buildCustomRoute`
  (`next/dist/lib/build-custom-route.js`) compiles `/monitoring(/?)` with `sensitive: false` and
  appends `(?:/)?$`; the built `routes-manifest.json` reads `caseSensitive: false`,
  `^/monitoring(/?)(?:/)?$`, and Vercel routes by that manifest. `next start` matches the RAW path
  (a percent-encoded letter 404s), while its middleware matcher tries raw and decoded. Proved on a
  production build: a foreign envelope to `/MONITORING`, `/Monitoring`, `/MONITORING/` or
  `/MONITORING?…&r=de` was relayed while `/monitoring` answered 400.
- **Reading the body in middleware is safe for the rewrite.** Next hands middleware a clone and
  replaces the original stream with a buffered copy (`node_modules/next/dist/server/body-streams.js`,
  `getCloneableBody`, `cloneBodyStream`/`finalize`, 10 MB default `proxyClientMaxBodySize`). Vercel's
  platform forwarding is not inspectable from here — production check listed in the plan.
- The browser SDK puts `dsn` in the envelope header whenever `tunnel` is set; the header is the
  first line of the envelope, JSON.
- `src/__tests__/instrumentation-client.test.ts:128-134` pins "no `tunnel` of its own" — the SDK's
  rewrite stays; the guard goes in the middleware.

## 5. Sentry release

- `@sentry/nextjs` client init: `{ environment, defaultIntegrations, release: process.env._sentryRelease || globalWithInjectedValues._sentryRelease, ...options }`
  (`build/cjs/client/index.js:54-58`; server `build/cjs/server/index.js:86-89`, edge likewise).
  User options are spread **after** the default, so `release: undefined` erases the SDK's own value.
- `src/instrumentation-client.ts:46` reads `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`, which Vercel only
  provides when system variables are exposed; `sentry.server.config.ts:23` and
  `sentry.edge.config.ts:23` read `VERCEL_GIT_COMMIT_SHA`. Two sources, one of which can be empty.
- `withSentryConfig` resolves a release name as `release.name ?? getSentryRelease() ?? git HEAD`
  (`getFinalConfigObjectUtils.js:14-17`); `getSentryRelease` reads `SENTRY_RELEASE`, then
  `GITHUB_SHA`, …, then `VERCEL_GIT_COMMIT_SHA`. That name is used for source-map upload and put in
  `nextConfig.env._sentryRelease` (`buildTime.js:37-43`).
- Under Turbopack, Sentry's value-injection loader only targets `**/instrumentation-client.*` and
  `**/instrumentation.*` and does not inject `_sentryRelease` (`turbopack/generateValueInjectionRules.js`).
  A value we put in `nextConfig.env` and reference literally in our own files is inlined by Next
  for every runtime — the robust carrier.

## 6. The realtime server

- `server/package.json`: no Sentry. Crash handlers log and `process.exit(1)` synchronously
  (`server/index.js:657-669`). Everything else catches and `console.error`s.
- `@sentry/node` 10.x: Node ≥ 18. Default integrations without tracing
  (`@sentry/node/build/cjs/sdk/index.js:10-23`, `node-core/build/cjs/sdk/index.js:26-51`) include
  `OnUncaughtException` and `OnUnhandledRejection`; with our own handlers exiting synchronously,
  theirs would either never run or never flush, and `OnUnhandledRejection` prints its own warning.
  `requestDataIntegration` attaches the request URL and headers — the socket.io handshake URL
  carries `token`, `stagingToken` and `editToken` in its query.
- `init({ dsn: undefined })` falls back to `process.env.SENTRY_DSN`, so "no-op when unset" means not
  calling `init` at all.
- Jest resolves `server/*.js` dependencies from the repo root when `server/node_modules` is absent
  (the CI unit job never installs it); the root has `@sentry/node` 10.58.0 as a direct dependency.
  `src/__tests__/websocket/server-manifest.test.ts` requires every `require()`d package to be
  declared in `server/package.json` with a lock that agrees.

## 7. Uptime from GitHub Actions

- The repository is public (`gh repo view`): Actions minutes are free; scheduled workflows are
  disabled after 60 days without repository activity; `schedule` is best effort (runs can start
  late or be dropped under load). Issues are public — bodies must carry nothing beyond what a
  `curl` of the public URL shows.
- `gh issue create --label X` fails when the label does not exist; `gh label create --force` is
  idempotent. `gh issue close <n> --comment <body>` comments and closes in one call. Labels need
  `issues: write`.
- Pins (commit SHAs, lightweight tags, verified with `git ls-remote` and `gh api`):
  `actions/checkout` v4.4.0 = `11d5960a326750d5838078e36cf38b85af677262`,
  `actions/setup-node` v4.4.0 = `49933ea5288caeca8642d1e84afbd3f7d6820020`.
- `scripts/__tests__/*.test.mjs` run with `node --test`, each named as a step in the CI test job
  (`.github/workflows/ci.yml:149-156`); jest's `testMatch` only covers `src/`.

## 8. Backups (owner's system, documented as given)

Private repo `marcusbey/recopyfast-backups`, workflow `nightly-db-backup.yml` at 03:17 UTC:
`pg_dump` custom format of `public`, `auth` and `storage` through the Supabase session pooler
(`aws-0-us-east-2.pooler.supabase.com:5432`), age-encrypted to one recipient, 30-day artifacts. Key
and password live in the owner's macOS Keychain. Supabase Free has no backups or PITR as of
2026-10-09. Not inspected from this worktree — the brief is the source.

**Addendum (s84 review, F2), read-only through `gh api`:** the job runs in `postgres:17` and dumps
with `pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=auth
--schema=storage`, artifact `recopyfast-db-backup`, file `recopyfast-<UTC timestamp>.dump.age`. The
dump therefore holds **no ACL entry**. The repository README's restore is `pg_restore --no-owner
--no-privileges -d "<target url>" recopyfast.dump`. On PG17 with `scripts/db/bootstrap-supabase-fixtures.sql`
(Supabase's default privileges) and all 72 migrations, that restore left all 8 `HIDDEN_COLUMNS`
readable by `anon` and `authenticated` and 96 definer functions executable by a web role; restoring
the schema with its privileges kept (from a dump that had them) still left 8 and 63 — pg_dump
writes GRANTs relative to PostgreSQL's built-in defaults, never REVOKEs of Supabase's. Migrations,
then `--data-only` under `session_replication_role = replica`, matched production's web-role ACL
exactly (0 differing grants). Triggers that would rewrite loaded rows: `BEFORE INSERT ON
staging_access`, `AFTER INSERT ON public.content_elements`. Migration-seeded tables: `plans`,
`copy_styles`, `founding_offers`, one `sites` row.

**Local restore drill (2026-10-10):** a fresh disposable PostgreSQL 17.11 source/target pair replayed
all 73 current migrations and ran the documented schema-first/data-only transaction with synthetic
`auth.users`, site, permission and content rows. The five named row counts matched, published copy
survived, the runbook privilege/function/RLS queries returned zero rows and effective web-role
column grants matched. Evidence:
`.omx/ultragoal/evidence/s84/restore-proof/{local-drill.py,result.json}`. Scope remains local and
synthetic: no encrypted production artifact, auth identities/storage parity, hosted Supabase or
provider restore was exercised. Read-only backup-repository metadata showed scheduled run
`38043247098` completed successfully and retained one unexpired 859,958-byte artifact; no artifact
contents or credentials were downloaded.
