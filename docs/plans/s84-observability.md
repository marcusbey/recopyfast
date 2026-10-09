---
validated: yes
---
# Plan — Story s84-observability

> CTO decision under the owner's 2026-10-09 directive.

Branch: `feature/s84-observability` (from `origin/main` `c0c40bf`).
Research: `docs/research/s84-observability.md` — read it first; this plan does not repeat it.
No Design step: no screen changes. No migration, no embed change (0 bytes).

## Decisions (CTO, recorded here because no ADR settles them)

1. **Status vocabulary stays.** Components keep `ok | error | timeout`, the overall status keeps
   `healthy | degraded | unhealthy`. The brief's "ok/degraded/down" is the same information; the
   A-30 pins assert `error`, and every runbook (`server/README.md:236-246`) reads these words.
2. **Public body = `{ status, latency }` per component.** No `error`, no `details`, no `metrics`;
   `?detailed=true` still adds the external check, as status and latency. Detail goes to the logger.
   The readiness route keeps `{ name, status, critical }` per check and drops `region`.
3. **The cache probe is one `rateLimiter.checkLimit`** on a fixed, never-enforced key — the exact
   operation editor login depends on, and the seam the A-30 pins mock. Two Upstash commands.
4. **Database and cache are critical.** Either failing on its own ⇒ `unhealthy`/503 on `GET` (cache
   on `HEAD` too). Storage alone stays `degraded`; realtime stays capped at `degraded`. Without this
   the `GET`-based uptime monitor would read a database outage as "up".
5. **Limiter: `IP_HEALTH` = 60 requests per minute per IP, fail-open, one bucket for `GET`/`HEAD`
   `/api/health` and `GET /api/health/ready`.** One request a second, sustained, from one address.
   Our monitor uses 1 per 10 minutes (600× headroom); Sentry uptime's tightest interval (1/min) and
   a 30-second SaaS monitor (2/min) stay ≥ 30× under it, and a person `curl`-looping during an
   incident is not refused. A single-address flood is cut to 60/min before any database, storage
   or realtime work. **Fail-open** because this endpoint exists to report a Redis outage: failing
   closed would answer "throttling unavailable" instead of the truth, and AGENTS.md has public
   reads fail open. Cost bound: a refused request costs 2 Upstash commands, an admitted one 4.
6. **Tunnel guard checks both the query and the envelope header.** The query (`o`, `p`, `r`) is
   what the rewrite turns into the destination, so it must name exactly our DSN's org, project and
   region (one value each). The envelope header's `dsn` must name our host and project (the brief's
   check, and defence in depth). Non-`POST`, missing or unparsable header, header over 16 KiB, no
   DSN configured ⇒ 400. Reading the body is safe: middleware receives a clone. **The guard runs on
   every path the rewrite accepts** (review F1): any case, trailing slashes, and the
   percent-decoded form — never `=== "/monitoring"`.
7. **One release value.** `next.config.ts` puts the build's `VERCEL_GIT_COMMIT_SHA` in
   `env.NEXT_PUBLIC_SENTRY_RELEASE` and in `withSentryConfig`'s `release.name` (source maps). The
   three inits pass `release` only when that value exists, so the SDK's own fallback is never
   erased by an explicit `undefined`.
8. **Realtime server: `SENTRY_DSN`, server-only.** No fallback to `NEXT_PUBLIC_SENTRY_DSN` (the
   server loads the repo-root `.env.local` in development, which would report local crashes to
   production). Captured: the two fatal paths, through our existing crash handlers (capture, flush
   ≤ 2 s, then the same `exit(1)`); Sentry's own global handlers are removed so nothing is
   captured twice and the SDK prints nothing of its own. No tracing, `sendDefaultPii: false`.
   Scrubbing: query parameters, header names and object keys matching token/key/secret/password/
   auth/cookie/session/signature/credential, IP headers, URL userinfo, in the request, breadcrumbs,
   messages and exception values. Version: the `@sentry/node` 10.x line the root already resolves,
   so the code tested in jest is the code shipped. Release: the SDK's default (`SENTRY_RELEASE`).
9. **Uptime from GitHub Actions** (owner directive: the one Sentry uptime seat is taken). One issue
   per target, titled `Production down: <host/path>`, label `uptime`. A target is up on any 2xx;
   `degraded` (200) is up — realtime has its own target. The job exits 1 while anything is down,
   so the run shows red as well. `concurrency: uptime` so two runs never open two issues.
10. **Commits.** Per the orchestrator's protocol: this docs commit, then one story commit; the
    review fix is a third commit on the branch.
11. **A restore rebuilds the schema from `supabase/migrations` and loads the backup's rows only**
    (review F2, CTO decision). The nightly dump is `--no-owner --no-privileges` (read from the
    private repo's workflow): it carries no GRANT or REVOKE, and a new Supabase project's default
    privileges hand `anon`/`authenticated` every table and function created in `public`. Rejected:
    restoring the dump's schema "keeping privileges" — measured, it still exposes all 8 secret
    columns and 63 definer functions, because pg_dump writes GRANTs relative to PostgreSQL's
    built-in defaults and never revokes Supabase's; and changing the backup job to keep ACLs, for
    the same reason. Migrations are the reviewed, CI-tested source of every privilege (ADR 033).
    Rows load in one transaction under `session_replication_role = replica` (triggers would
    rewrite `staging_access` and `content_elements` rows), after emptying the migration-seeded
    `public` tables in the same transaction. Verification adds three read-only checks that must
    return zero rows: secret columns readable by a web role, definer functions executable by one
    beyond the RLS-predicate allowlist, tables without RLS.

## Tasks (ordered, test-first)

1. [x] **Cache check + critical severity (A-30).** RED: flip the three `test.failing` pins in
   `cache-check.test.ts` to plain tests; add "database alone ⇒ 503" there. GREEN: `checkCache()` via
   `rateLimiter.checkLimit`, in `GET` and `HEAD`; database/cache errors ⇒ `unhealthy`.
2. [x] **Generic public bodies.** RED: new `src/__tests__/api/health/no-leak.test.ts` — leaky DB,
   storage, env and realtime failures; asserts exact `{status, latency}` key sets, no leaked string,
   no region, no env var name, no connection count, no `metrics`; the logger received the detail.
   GREEN: strip `error`/`details`/`metrics` from `/api/health`, `message`/`region` from `/ready`,
   log server-side. Adjust `realtime-check.test.ts` assertions that pinned `details`/`error`
   (declared in the PR).
3. [x] **Per-IP fail-open limiter.** RED: new `src/__tests__/api/health/rate-limit.test.ts` — the
   61st request in a minute from one IP is 429 before any dependency is touched (GET, HEAD,
   ready), another IP is unaffected, one request every 5 minutes for a day is never limited, store
   down ⇒ served. GREEN: `IP_HEALTH` preset, `enforceRateLimit` first in the three handlers; `HEAD`
   takes the request (test call sites pass one — declared).
4. [x] **Tunnel allow-list.** RED: new `src/__tests__/sentry-tunnel-guard.test.ts` through the real
   middleware — foreign org/project/region, duplicated params, foreign header DSN (host or
   project), malformed/oversized/absent header, `GET`, no DSN ⇒ 400 with headers and no GoTrue;
   ours ⇒ passes. GREEN: `src/lib/monitoring/sentry-tunnel-guard.ts` + the middleware branch.
   `middleware-matcher.test.ts` sends a valid envelope on the tunnel path (declared).
5. [x] **One release.** RED: `next-config-sentry.test.ts` (env + `_sentryRelease` agree with
   `VERCEL_GIT_COMMIT_SHA`, beating a stray `GITHUB_SHA`), `instrumentation-client.test.ts` and new
   `src/__tests__/sentry-runtime-configs.test.ts` (release from `NEXT_PUBLIC_SENTRY_RELEASE`, no
   `release` key when unset). GREEN: `src/lib/monitoring/sentry-release.ts`, next.config, three inits.
6. [x] **Realtime server Sentry.** RED: new `src/__tests__/websocket/sentry.test.ts` — scrubber unit
   cases; `initSentry` is a no-op without `SENTRY_DSN`; the real CLI (`node server/index.js`, a
   preloaded crash) delivers a scrubbed envelope to a local fake ingest and still exits 1, for both
   an uncaught exception and an unhandled rejection; without a DSN it exits 1 and sends nothing.
   GREEN: `server/sentry.js`, crash handlers, `@sentry/node` in `server/package.json` + lock
   (`--package-lock-only`); `cd server && npm audit --omit=dev` clean.
7. [x] **Uptime workflow.** RED: `scripts/__tests__/uptime-check.test.mjs` — probe (2xx, 503,
   timeout, retry recovers), decision table (open / comment / close / nothing), exact-title issue
   lookup, `gh` argument arrays, issue body carries no response body, exit code, workflow pins
   (schedule, dispatch, permissions, SHA pins, concurrency, timeouts). GREEN:
   `scripts/uptime-check.mjs`, `.github/workflows/uptime.yml`, CI step in `ci.yml`.
8. [x] **Operations docs.** `docs/operations/backups.md`, `docs/operations/monitoring.md`;
   `SENTRY_DSN` in `server/README.md`'s deploy secrets.
9. [x] **Mutations and gates.** Neutralize each guard, see its test go red, restore with
   `git checkout --`. Full jest, type-checks, lint, format, embed check, Playwright list, server audit.

## Execution notes (implementer, 2026-10-09)

Existing tests changed, and why (AGENTS.md § Tests):

- `cache-check.test.ts`: the three `test.failing` pins are plain `it`s; the rate-limiter mock now
  dereferences `mockCheckLimit` lazily (the route imports `rateLimiter` at load, which ran the
  factory before the double existed); `HEAD()` calls pass a request. Two cases added.
- `realtime-check.test.ts`: assertions on `checks.realtime.details` and the fixed `error` strings
  now assert their absence (decision 2); one test renamed (HEAD reads the cache too now); the
  memo comment no longer says a limiter is the wrong answer; `HEAD()` passes a request.
- `route.test.ts`: `HEAD()` passes a request; the vacuous "memory metrics when detailed=true"
  test (it never called the route) is deleted — the behaviour it named no longer exists.
- `middleware-matcher.test.ts`: the tunnel path is sent as an accepted envelope (POST, our DSN in
  query and header); its assertions are unchanged.

Beyond the plan: the realtime scrubber also filters `handoff` and `grant` (the edit link's
`rcf_handoff` code has no "token" in its name); `docs/operations/database-setup.md` no longer
claims Supabase Free keeps seven days of backups. A production build with a fake DSN and Sentry's
`_SENTRY_TUNNEL_DESTINATION_OVERRIDE`, served by `next start`, forwarded a 20 KB envelope intact
through the guarded tunnel to a local ingest and refused every foreign variant with 400 —
self-hosted Next only; Vercel's forwarding is the after-merge check below.

## Review fixes (2026-10-09, findings F1–F8 of the s84 review)

> CTO decision under the owner's 2026-10-09 directive. Rebased onto `origin/main` `fc5968b` first.

12. [x] **F1 (critical) — the tunnel guard sees every spelling.** RED: `sentry-tunnel-guard.test.ts`
    sends a foreign envelope to `/MONITORING`, `/Monitoring`, `/MONITORING/`, `/%6Donitoring`, … and
    our own to `/Monitoring` (sessionless); new `sentry-tunnel-route-coverage.test.ts` compiles the
    real next.config through Next's own `loadCustomRoutes` + `buildCustomRoute` and sends every
    accepted candidate (3,205 spellings) through the middleware. Reproduced first on `next build` +
    `next start` with a fake DSN and a local ingest: `/MONITORING`, `/Monitoring`, `/MONITORING/`
    and `?r=de` relayed a foreign envelope. GREEN: `isSentryTunnelPath` (decode, lower-case, strip
    trailing slashes) in the guard and in `isSessionlessPath`.
13. [x] **F2 (major) — a restore keeps privileges.** Decision 11; `docs/operations/backups.md`
    § Restoring rewritten, its checks run verbatim on a PG17 replay of all migrations.
14. [x] **F3 — scrub by key at every depth, and `key: value` text.** RED: the reviewer's six planted
    secrets, six text forms, and the real CLI crashing after logging a handshake. Beyond the
    finding: an object past the walk's depth limit is now dropped, not passed through unread, and
    `event.modules` (package name → version) is kept whole — the deep key filter would otherwise
    blank `jsonwebtoken`'s or `cookie`'s version. A nested `code` key is now filtered too (it can
    be the handoff code); error codes stay readable in exception messages.
15. [x] **F4 — never `NEXT_PUBLIC_SENTRY_DSN`.** Pinned in unit and through the real CLI.
16. [x] **F5 — uptime defaults.** `RETRIES` (probe and run) and the unfollowed redirect pinned.
17. [x] **F6 — `@sentry/node` loads only with a DSN.** RED: a fresh process's `require.cache`.
18. [x] **F7** — `cache-check.test.ts` comment. **F8** — rebased, `docs/stories.md` keeps s73 then
    s84; no lockfile changed on `main`, so no `npm ci`.

Existing tests changed by the review fix (AGENTS.md § Tests): `sentry-tunnel-guard.test.ts`'s
`tunnelRequest` takes a path (default unchanged); `websocket/sentry.test.ts`'s crash preload takes
optional statements to run first, on lines of their own (default output byte-identical);
`cache-check.test.ts` comment only. No test deleted.

## After merge (orchestrator; nothing here touches production)

- `fly secrets set SENTRY_DSN=<dsn> --stage -a recopyfast-ws`, then deploy; confirm one test event.
- Trigger a browser error on production; confirm it arrives through `/monitoring` with the commit
  SHA as release (proves Vercel forwards the body after the middleware read it).
- `curl -s -X POST 'https://www.recopyfa.st/monitoring?o=1&p=1' -d x -o /dev/null -w '%{http_code}'`
  ⇒ `400`, and the same for `/MONITORING?o=1&p=1` and `/Monitoring/?o=1&p=1` (with
  `-L --post301 --post302 --post303`) — the loop is in `docs/operations/monitoring.md`. A `200` on
  any spelling is an open relay.
- Update the private backups repository's `README.md` restore steps to match
  `docs/operations/backups.md` § Restoring (its step 5 is the procedure review F2 replaced).
- Run `uptime.yml` once with `workflow_dispatch`; both targets up, no issue opened.
