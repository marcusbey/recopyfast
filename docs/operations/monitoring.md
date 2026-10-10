# Monitoring

What watches production, what it alarms on, and where the alarm lands. Set up in s84
(2026-10-09). No secret on this page; the Sentry DSN lives in Vercel and Fly only.

| Monitor | Watches | Alarms when | Lands in |
|---|---|---|---|
| GitHub uptime workflow | `https://www.recopyfa.st/api/health`, `https://recopyfast-ws.fly.dev/health` | not 2xx after 3 attempts | an `uptime` issue in this repository + a failed run |
| Sentry error spike (id **10589299**) | error events, `production` environment | **> 20 errors in 5 minutes** | Sentry's existing high-priority notification workflow (id **6070761**) |
| Sentry uptime, app (id **10589293**) | the app | — | **disabled** (quota) |
| Sentry uptime, realtime (id **10589296**) | the realtime service | — | **disabled** (quota) |

## Uptime: `.github/workflows/uptime.yml`

The Sentry plan includes one uptime seat and another project uses it, so the two Sentry uptime
monitors above were created and left disabled. Uptime runs from GitHub Actions instead
(owner directive, 2026-10-09).

- **Schedule:** every 10 minutes, and on demand (`gh workflow run uptime.yml`).
- **Probe:** `GET` each URL, 20 s timeout, retried twice 10 s apart. Any 2xx is up.
  `/api/health` answers 200 for `degraded`, deliberately: realtime has its own target, and a
  storage-only problem is not an outage.
- **On failure:** opens the issue **"Production down: \<target\>"** with the label `uptime`, or
  comments on it if it is already open (one comment per run while the outage lasts).
- **On recovery:** comments and closes the issue.
- **The run fails while anything is down**, so the Actions tab shows red and GitHub emails whoever
  last edited the schedule.
- **Least privilege:** the workflow defaults to `contents: read`; only the named `probe` job gets
  exactly `contents: read` plus `issues: write`. Actions are pinned by commit SHA;
  `concurrency: uptime` keeps two runs from opening two issues.
- **Decisions are code:** `scripts/uptime-check.mjs`, tested by
  `scripts/__tests__/uptime-check.test.mjs` (a blocking CI step).

Caveats you will meet:

- **The schedule is best effort.** GitHub starts scheduled runs late under load, sometimes by
  10–20 minutes, and can drop one. This is a smoke alarm, not a stopwatch.
- **Sixty days without a commit disables it.** On a public repository GitHub turns scheduled
  workflows off after 60 days of no repository activity. Re-enable it from the Actions tab
  (`gh workflow enable uptime.yml`).
- **The issues are public.** They say what a `curl` of the public URL says — an HTTP status, a
  timeout or a network error code — and nothing else; the response body is never read.

## What the health endpoints answer

`GET /api/health` (and `HEAD`, which checks the database and the rate-limit store only). Every GET
spelling runs the real dependency checks: `?quick=true` is not a shortcut and cannot manufacture a
healthy answer during an outage.

| Component | Down means | Overall |
|---|---|---|
| `database` | Postgres/PostgREST unreachable | `unhealthy`, **503** |
| `cache` (the Redis rate-limit store) | editor login refuses everyone | `unhealthy`, **503** |
| `storage` | image uploads fail | `degraded`, 200 |
| `realtime` | live co-editing off; HTTP editing unaffected (ADR 004) | at most `degraded`, 200 |

Each component is `{ "status": "ok" | "error" | "timeout", "latency": <ms> }` and nothing more.
The reason is in the logs (Vercel function logs, and Sentry for errors), never in the body: the
endpoint is anonymous. `GET /api/health/ready` answers `{ name, status, critical }` per check.
Its exact checks are `environment_variables`, `database_connection` and `storage_access`; it does
not claim that application routes passed unless it actually probes them.

All three are rate limited **per IP: 60 requests per minute**, shared, and they **fail open** —
with Redis down they still answer, and `/api/health` reports the outage as `cache: error`.
A monitor checking every 30 seconds uses a tenth of that.

`https://recopyfast-ws.fly.dev/health` is the realtime service's own answer; Fly also checks it
every 15 s (`server/fly.toml`).

## Sentry

- **Browser:** `src/instrumentation-client.ts`, through the same-origin tunnel `/monitoring`. The
  tunnel forwards only envelopes for **our** DSN's org, region and project; anything else is a
  400 (`src/lib/monitoring/sentry-tunnel-guard.ts`) — under **every spelling** the rewrite
  accepts. Next matches the rewrite case-insensitively with an optional trailing slash, so
  `/MONITORING` and `/Monitoring/` are the tunnel too; the first guard compared the exact path,
  and the s84 review relayed a stranger's envelope through `/MONITORING` on a production build.
- **Server and Edge:** `sentry.server.config.ts`, `sentry.edge.config.ts`, plus
  `onRequestError` in `src/instrumentation.ts`.
- **Release:** every Next runtime reports the build's commit SHA (`VERCEL_GIT_COMMIT_SHA`, inlined
  as `NEXT_PUBLIC_SENTRY_RELEASE`), the same name the source maps are uploaded under.
- **Realtime service:** `server/sentry.js`, on when the Fly secret `SENTRY_DSN` is set. It reports
  uncaught exceptions and unhandled rejections, with tokens, credentials and client IPs scrubbed,
  then exits 1 as before. Query names are URL-decoded for the sensitivity decision, so encoded forms
  such as `to%6ben` and `rcf_%74oken` cannot bypass filtering; malformed names filter closed. See
  `server/README.md` § Secrets.

## To do after the s84 deploy

1. `fly secrets set SENTRY_DSN=<dsn> --stage -a recopyfast-ws`, then deploy `server/`.
2. Trigger one browser error on production and confirm it arrives in Sentry with the commit SHA
   as its release — this also proves Vercel forwards the tunnel body after the middleware read it.
3. Each of these prints `400` — the exact path, another case, and another case with a trailing
   slash (`-L --post301 --post302 --post303` follows Next's 308 the way a scripted client would):

   ```sh
   for path in /monitoring /MONITORING /Monitoring/; do
     curl -s -o /dev/null -w "$path %{http_code}\n" -L --post301 --post302 --post303 \
       -X POST "https://www.recopyfa.st$path?o=1&p=1" -d x
   done
   ```

   A `200` on any of them is an open relay: roll back.
4. `gh workflow run uptime.yml`: both targets up, no issue opened.

## Turning the Sentry uptime monitors on

They exist (10589293 for the app, 10589296 for the realtime service). Enabling either needs a
free uptime seat: upgrade the plan or release the seat the other project holds. Check each one's
URL against the table at the top before enabling it. Keep the GitHub workflow running
until a Sentry monitor has fired on a real outage at least once.
