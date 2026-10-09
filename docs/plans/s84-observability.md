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
   DSN configured ⇒ 400. Reading the body is safe: middleware receives a clone.
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
10. **Commits.** Per the orchestrator's protocol: this docs commit, then one story commit.

## Tasks (ordered, test-first)

1. [ ] **Cache check + critical severity (A-30).** RED: flip the three `test.failing` pins in
   `cache-check.test.ts` to plain tests; add "database alone ⇒ 503" there. GREEN: `checkCache()` via
   `rateLimiter.checkLimit`, in `GET` and `HEAD`; database/cache errors ⇒ `unhealthy`.
2. [ ] **Generic public bodies.** RED: new `src/__tests__/api/health/no-leak.test.ts` — leaky DB,
   storage, env and realtime failures; asserts exact `{status, latency}` key sets, no leaked string,
   no region, no env var name, no connection count, no `metrics`; the logger received the detail.
   GREEN: strip `error`/`details`/`metrics` from `/api/health`, `message`/`region` from `/ready`,
   log server-side. Adjust `realtime-check.test.ts` assertions that pinned `details`/`error`
   (declared in the PR).
3. [ ] **Per-IP fail-open limiter.** RED: new `src/__tests__/api/health/rate-limit.test.ts` — the
   61st request in a minute from one IP is 429 before any dependency is touched (GET, HEAD,
   ready), another IP is unaffected, one request every 5 minutes for a day is never limited, store
   down ⇒ served. GREEN: `IP_HEALTH` preset, `enforceRateLimit` first in the three handlers; `HEAD`
   takes the request (test call sites pass one — declared).
4. [ ] **Tunnel allow-list.** RED: new `src/__tests__/sentry-tunnel-guard.test.ts` through the real
   middleware — foreign org/project/region, duplicated params, foreign header DSN (host or
   project), malformed/oversized/absent header, `GET`, no DSN ⇒ 400 with headers and no GoTrue;
   ours ⇒ passes. GREEN: `src/lib/monitoring/sentry-tunnel-guard.ts` + the middleware branch.
   `middleware-matcher.test.ts` sends a valid envelope on the tunnel path (declared).
5. [ ] **One release.** RED: `next-config-sentry.test.ts` (env + `_sentryRelease` agree with
   `VERCEL_GIT_COMMIT_SHA`, beating a stray `GITHUB_SHA`), `instrumentation-client.test.ts` and new
   `src/__tests__/sentry-runtime-configs.test.ts` (release from `NEXT_PUBLIC_SENTRY_RELEASE`, no
   `release` key when unset). GREEN: `src/lib/monitoring/sentry-release.ts`, next.config, three inits.
6. [ ] **Realtime server Sentry.** RED: new `src/__tests__/websocket/sentry.test.ts` — scrubber unit
   cases; `initSentry` is a no-op without `SENTRY_DSN`; the real CLI (`node server/index.js`, a
   preloaded crash) delivers a scrubbed envelope to a local fake ingest and still exits 1, for both
   an uncaught exception and an unhandled rejection; without a DSN it exits 1 and sends nothing.
   GREEN: `server/sentry.js`, crash handlers, `@sentry/node` in `server/package.json` + lock
   (`--package-lock-only`); `cd server && npm audit --omit=dev` clean.
7. [ ] **Uptime workflow.** RED: `scripts/__tests__/uptime-check.test.mjs` — probe (2xx, 503,
   timeout, retry recovers), decision table (open / comment / close / nothing), exact-title issue
   lookup, `gh` argument arrays, issue body carries no response body, exit code, workflow pins
   (schedule, dispatch, permissions, SHA pins, concurrency, timeouts). GREEN:
   `scripts/uptime-check.mjs`, `.github/workflows/uptime.yml`, CI step in `ci.yml`.
8. [ ] **Operations docs.** `docs/operations/backups.md`, `docs/operations/monitoring.md`;
   `SENTRY_DSN` in `server/README.md`'s deploy secrets.
9. [ ] **Mutations and gates.** Neutralize each guard, see its test go red, restore with
   `git checkout --`. Full jest, type-checks, lint, format, embed check, Playwright list, server audit.

## After merge (orchestrator; nothing here touches production)

- `fly secrets set SENTRY_DSN=<dsn> --stage -a recopyfast-ws`, then deploy; confirm one test event.
- Trigger a browser error on production; confirm it arrives through `/monitoring` with the commit
  SHA as release (proves Vercel forwards the body after the middleware read it).
- `curl -s -X POST 'https://www.recopyfa.st/monitoring?o=1&p=1' -d x -o /dev/null -w '%{http_code}'`
  ⇒ `400`.
- Run `uptime.yml` once with `workflow_dispatch`; both targets up, no issue opened.
