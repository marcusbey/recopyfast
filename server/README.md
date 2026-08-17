# RecopyFast realtime service

The Socket.io process that carries live edits between two people editing the same page.
Express + Socket.io, one `package.json` of its own, deployed separately from the Next app —
Vercel cannot host a long-lived process ([ADR 004](../docs/decisions/004-embed-transport-split.md)).

**It is an enhancement, never a dependency.** HTTP is authoritative: content is persisted by
`PUT /api/staging/content/:siteId` and read by `GET /api/content/:siteId`. With this service
stopped, editing, saving, staging and publishing all still work with no user-visible error
(ADR 004 rule 2, drilled by `e2e/realtime-additive.spec.ts`). Everything below follows from
that: it is why one machine is enough, why a realtime outage only *degrades* `/api/health`,
and why the rollback is a single environment variable.

| | |
|---|---|
| Platform | Fly.io, app `recopyfast-ws`, region `iad` |
| Origin | `https://recopyfast-ws.fly.dev` / `wss://recopyfast-ws.fly.dev` |
| Machines | **one** — see below, this is load-bearing |
| Size | `shared-cpu-1x`, 512 MB |
| Port | 4001, from `WS_PORT`; `PORT` is not read |
| Config | [`fly.toml`](./fly.toml), whose header carries the reconciliation history |

---

## The instance count: ONE, deliberately

Decided 2026-08-17. Recorded here because ADR 004 requires the number to be explicit rather
than assumed, and `fly.toml` pins it (`min_machines_running = 1`, `auto_stop_machines = false`).

**Why one is enough.** Socket.io rooms live in the memory of a single process. With one
process they are coherent by construction — no shared state, no adapter, no Redis. The service
carries broadcasts only; it holds no data that a second machine would make more available, and
the product keeps working when it is down at all. So a second machine buys availability for a
feature that already degrades gracefully, and costs the failure mode below.

**Why a second machine is a code change, not a scaling operation.** Two editors on the same
page can land on different processes, join the same room name in two separate memories, and
stop seeing each other. Every health check stays green and nothing is thrown. It presents as
"realtime randomly stopped working for some people" — the hardest possible shape of bug report
to act on, and it makes the parity criterion (AC 4) *flaky* rather than merely unproven.

So `fly scale count 2` on its own is a silent outage for co-editing. Going above one means, in
the same deploy:

1. `@socket.io/redis-adapter` in `package.json`, wired to a `REDIS_URL`;
2. **its own Upstash database**, not the one the API rate limiter uses. That limiter is
   fail-closed in production (`src/lib/security/rate-limiter.ts`): if it cannot reach Redis,
   ten API endpoints stop serving. Socket pub/sub must not be able to exhaust the command quota
   they depend on — Upstash bills per command and each rate-limit check already costs two;
3. an integration test that boots two instances against one Redis and proves a broadcast
   emitted on A reaches a client on B. Without it, "more than one machine" is a claim.

The adapter shares *rooms*, not *sessions*. The handshake half is covered separately by
[ADR 023](../docs/decisions/023-websocket-only-transport-no-sticky-routing.md):
`transports: ['websocket']` is pinned on the server and on both clients, so there is no polling
exchange to split across machines. Two independent problems — do not treat the single machine
as covering both.

---

## Deploy

### Prerequisites

- `flyctl` installed and authenticated (`fly auth login`)
- Access to the `recopyfast-ws` app
- The Supabase project URL and **service-role** key

### Secrets

Three, all required in production. `NEXT_PUBLIC_APP_URL` is read as well but defaults to
`http://localhost:3000` and nothing here depends on it.

```sh
cd server
fly secrets set \
  NEXT_PUBLIC_SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  REDIS_URL=... \
  -a recopyfast-ws
fly secrets list -a recopyfast-ws     # names only; values are never readable back
```

`REDIS_URL` points at the **same Upstash database the Next app's own rate limiter uses**
(`informed-ghost-153511`). That is deliberate and it is fine at current traffic, but it carries a
caveat with a name on it: the app's limiter is **fail-closed in production**
(`src/lib/security/rate-limiter.ts`), so if socket traffic ever exhausts the command quota, ten
API endpoints stop serving. Upstash bills per command and each rate-limit check already costs two.
**When socket volume becomes non-trivial, this service gets its own database** — and if a Redis
adapter is ever added for a second machine, it gets a third rather than sharing either.

**Set `REDIS_URL` before the deploy that needs it, not after.**
`assertProductionEnvironment()` refuses to boot without it, so a deploy that lands ahead of the
secret is a crash loop rather than a degradation. It refuses on purpose: ADR 002 rule 4 requires
a fail-closed limiter on any service-role path, this process holds the service-role key, and the
credential that opens it is `data-site-token` — published in the customer's own page markup, so
readable with View Source. Refusing to start is louder than a limiter denying every connection
all day while `/health` keeps answering 200.

> **`ALLOWED_ORIGINS` is not in that list and must not be added.** It is not consulted anywhere in
> this service — `grep -rn ALLOWED_ORIGINS server/*.js` returns nothing since `s07a` rewrote the
> connection handler, so there is no code left to point at and nothing to reinstate.
> Authorisation is the per-site HMAC token check at `index.js:256` (`verifySiteToken`,
> `auth.js:50`) followed by the registered-domain pin at `:263` (`isOriginAllowed`, `auth.js:101`),
> both inside the connection handler — strictly stronger than an origin allowlist, and no redeploy
> per customer. Setting it creates false confidence about where the security boundary is. The
> variable still exists in the *Next app's* environment for unrelated reasons; it means nothing
> here.

### Deploy

**The whole procedure is two commands, and both matter.**

```sh
cd server
fly deploy
```

**From `server/`, never from the repo root.** `fly deploy` uses the directory of `fly.toml` as
the Docker build context, and `Dockerfile` is written for a `server/`-rooted one — it `COPY`s
`package.json` and runs `node index.js`. From the root, `index.js` lands at `/app/server/index.js`
and the `CMD` breaks.

**And deploy from a merged tree, not from a working one.** This service has no CI deploy: nothing
redeploys it when `main` moves, so a hand-run `fly deploy` pins the image to whatever was on disk
at that moment and it stays pinned indefinitely. That is exactly how the drift recorded at the
bottom of this file happened — the service was deployed by hand at 14:05 UTC, `s07a` merged at
15:10 UTC, and the running image kept the pre-`s07a` file for the rest of the day while `/health`
answered 200 the whole time. **Every merge that touches `server/` needs a `fly deploy` after it,
and the check is the marker probe below, not the health endpoint.** A procedure that only works
when it happens to be run in the right order is not a documented procedure.

### Verify

```sh
curl https://recopyfast-ws.fly.dev/health
# {"status":"ok","connections":0,"supabase":"connected","message":"All systems operational"}

fly status -a recopyfast-ws     # one machine, started, checks passing
fly machines list -a recopyfast-ws
```

`supabase: "disabled"` instead of `"connected"` means the secrets are missing or malformed. The
process still starts — and in that state it verifies no tokens and grants no staging rooms, by
design — but nothing works. Treat it as a failed deploy.

**`/health` is not proof that the deploy landed.** It answered `status: ok` throughout the entire
drift described at the bottom of this file, on an image five hours and one merge out of date. It
reports that *a* process is up, not *which* one. Check the code that is actually running:

```sh
fly ssh console -a recopyfast-ws -C "sh -c '
  wc -l /app/index.js
  for s in createRealtimeServer createRateLimiter revalidateSocket assertProductionEnvironment; do
    printf \"%s=%s\n\" \"\$s\" \"\$(grep -c \"\$s\" /app/index.js)\"
  done'"
```

The line count must equal `wc -l server/index.js` in the tree you deployed, and every marker must
be non-zero. `fly deploy` also prints a "not listening on the expected address" warning on a
rolling update when its probe races the bind; the health check passing immediately afterwards is
what settles it.

Then confirm the app sees it:

```sh
curl -s https://www.recopyfa.st/api/health | jq '.status, .checks.realtime'
```

### Logs and rollback

```sh
fly logs -a recopyfast-ws                 # live
fly releases -a recopyfast-ws             # version history
fly releases rollback -a recopyfast-ws    # previous image
```

A rollback of the *service* is rarely what you want, because the service being wrong is not the
failure that hurts. See the kill switch below.

---

## Environment scoping — production only

`NEXT_PUBLIC_WS_URL` is set on Vercel in the **Production** environment only.

Preview deployments inherit whatever environment they are given, and every environment shares
one Supabase project and therefore one set of site ids. Pointing previews at this service would
put preview clients and production clients in the same `site:{id}` and `site:{id}:staging`
rooms — cross-environment room bleed on live customer content, with edits from a branch build
appearing in a customer's editing session. A preview needs its own service before it gets a
value here.

**Verify:** a preview deployment's issued snippet carries no `data-ws-url` at all, which is the
same "off" state every install had before this story.

---

## The kill switch

`NEXT_PUBLIC_WS_URL` is the whole of it, and it is what makes this story reversible (ADR 004
rule 2). Unset it in Vercel Production and redeploy: `getPublicWebSocketUrl()` returns `""`,
issued snippets omit `data-ws-url`, `window.RECOPYFAST_WS` is never set, the widget takes its
early return before downloading socket.io at all, the CSP stops advertising the origin, and
`/api/health` stops reporting a `realtime` check rather than reporting it as failed. The product
is byte-for-byte its pre-`s07b` self. Restore by setting the value and redeploying again.

**It is a deploy, not an environment edit, and that is the whole trap.** The variable is read in
three places and one of them is resolved at *build* time:

| Read at | Where | Effect |
|---|---|---|
| **build** | `src/components/dashboard/SiteDetailView.tsx` — a `"use client"` component calling `buildEmbedScript`, so the value is inlined into the bundle | the snippet the dashboard *shows* |
| runtime | `src/app/api/sites/route.ts`, `src/app/api/sites/register/route.ts` | the snippet the API *returns* |
| runtime | `src/middleware.ts` — feeds `connect-src` | whether the browser permits the connection at all |

Set the variable without redeploying and the two snippet producers disagree: the API hands out
`data-ws-url` while the dashboard shows a snippet without it, or the reverse on rollback. Nobody
thinks to compare them, because each looks right on its own. Get the order wrong the other way
and `connect-src` lacks the origin, so the browser blocks the handshake with no server-side
trace at all.

So: **set the variable, then redeploy, then compare the two snippets.**

Two operational notes, both learned the hard way during the drill below:

- **`vercel env add` needs `--value` and `--no-sensitive`.** Piping the value on stdin
  silently stores an *empty string* in non-interactive mode, and Production defaults every new
  variable to sensitive — which means `vercel env pull` reads it back blank whether it is empty or
  not, so the two failures are indistinguishable. Always re-read the value after writing it:
  `vercel env pull` into a scratch file and diff it against what you meant to set. An empty
  `NEXT_PUBLIC_WS_URL` is not "realtime off" — it is falsy, so it behaves like off, and it would
  have looked like a successful restore.
- **Rebuild rather than re-alias.** `vercel redeploy <deploymentId> --target production --scope
  <team>` rebuilds the same git commit, so the env change is picked up without shipping a
  different source tree. `--scope` is required or it fails with "Deployment belongs to a
  different team".

```sh
curl -sI https://www.recopyfa.st/login \
  | tr ';' '\n' | grep -i connect-src
# must name wss://recopyfast-ws.fly.dev and https://recopyfast-ws.fly.dev exactly,
# and must never be a blanket wss: or https:
```

---

## Verifying realtime end to end

Two checks live in `e2e/realtime-parity.spec.ts`, both driven against a fixture page served on
`localhost:4176` — a **non-RecopyFast domain**, which is the only place either claim means
anything.

```sh
# Legacy snippets: no database, no editing session, runs against any origin.
CI=1 PLAYWRIGHT_BASE_URL=https://www.recopyfa.st npm run test:e2e:parity
```

```sh
# Parity (AC 4): two browser contexts in an editing session, measured.
CI=1 \
RUN_RECOPYFAST_PARITY=1 \
PLAYWRIGHT_BASE_URL=https://www.recopyfa.st \
NEXT_PUBLIC_WS_URL=wss://recopyfast-ws.fly.dev \
NEXT_PUBLIC_SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run test:e2e:parity
```

The parity case is gated because it needs credentials rather than code: the two editors have to
authenticate against **the same Supabase project the deployed service reads**, since the service
holds its own service-role key. Given a different project, both browsers fail the handshake and
the run reports "realtime never connected" — which looks like a service fault and is not one.

It seeds one `sites` row, one `edit_sessions` row and one `content_elements` row, and deletes them
afterwards. It prints the seeded site id, the measured interval, the fixture hostname and both
socket ids on `[s07b AC 4]` lines; those lines are the evidence.

The seeded site's domain is `e2e-parity-<unix-ts>.invalid`. `.invalid` is reserved by RFC 2606 and
can never resolve, so a row that survives a crash is recognisable as test debris at a glance and
routable by nothing. The fixture is reachable under that hostname only inside the test's own
Chromium, via `--host-resolver-rules`, which dies with the browser. Cleanup runs **before** seeding
as well as after and matches on the domain pattern rather than an in-memory id — `afterAll` does
not run when the process is killed, and a hanging parity test is exactly the one someone kills.

---

## Local development

```sh
npm run dev        # from the repo root: Next on :3000 and this service on :4001
cd server && npm run dev
```

`getPublicWebSocketUrl()` falls back to `localhost:4001` when the app is on `localhost:3000`, so
a dev snippet carries `data-ws-url` without any variable being set.

The port does not walk. `startServer` used to retry 4001→4010 on `EADDRINUSE`, which is
convenient locally and wrong in a container: `fly.toml` pins 4001, so a silent shift to 4002
presents as a failing deploy with perfectly healthy application logs. It now binds the
configured port or exits.

---

## Verification log — 2026-08-17

Recorded because a procedure that has only ever been executed by its author is a memory, not a
document.

| Check | Result |
|---|---|
| `curl https://recopyfast-ws.fly.dev/health` | `{"status":"ok","connections":0,"supabase":"connected","message":"All systems operational"}`, HTTP 200 |
| `fly machines list -a recopyfast-ws` | one machine, `iad`, `shared-cpu-1x:512MB`, checks 1/1 passing |
| `fly config show -a recopyfast-ws` | identical to `fly.toml`: port 4001, autostop off, `min_machines_running = 1`, the `/health` check, one 512 MB VM |
| `fly secrets list -a recopyfast-ws` | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL` (added and deployed 16:39 UTC) |
| Deployed code is this repo's code | `/app/index.js` 773 lines, all four `s07a` markers present, `auth.js` and `rate-limit.js` in `/app`, `REDIS_URL` in the process environment. Booted clean: no "Refusing to start", no Redis error |
| Vercel `NEXT_PUBLIC_WS_URL` | present in **Production** only; the production deploy is newer than the variable, so the build carries it |
| Production CSP `connect-src` | `'self' https://<supabase> wss://<supabase> wss://recopyfast-ws.fly.dev https://recopyfast-ws.fly.dev` — exact origins, no blanket |
| Legacy snippet vs. the deployed origin | green: no `window.RECOPYFAST_WS`, no `/socket.io/` request, no `socket.io-client.min.js` request, content fetched over HTTP, no error surface |
| `GET /api/health` realtime check | unit-tested both directions: realtime down ⇒ `degraded` + HTTP 200; realtime down alongside a second failing check ⇒ still not `unhealthy`; `HEAD` never probes it |
| **AC 4 parity, measured** | **613 ms** against a 1000 ms budget. Fixture `e2e-parity-1786984973.invalid:4176`, app `https://www.recopyfa.st`, service `wss://recopyfast-ws.fly.dev`. Two distinct connections: `socketA=6mjHGmsIc5hiQNvOAAAD`, `socketB=KwBl2sQptIqW3HCtAAAB` |
| Parity run left no trace | site `259075b5-aed7-40b8-bd00-34d3b059cdcf` seeded and purged; `sites` 4 → 4, `edit_sessions` 0 → 0, `content_elements` 0 → 0, zero rows matching `e2e-parity-%` |

The parity run doubles as the only end-to-end proof that the **fail-closed limiter reaches
Upstash**: with Redis unreachable, `consume()` denies and every one of those handshakes would have
been refused while `/health` kept answering 200 — the same failure shape as the image drift above,
from a different cause.

### The kill-switch drill, executed 2026-08-17

ADR 004 rule 2 says realtime is *provably* additive. This is the run that turns that from an
assertion into evidence: a kill switch nobody has pulled is a hypothesis.

`NEXT_PUBLIC_WS_URL` removed from Vercel **Production only** (Preview and Development never had
it), production rebuilt from the same commit, verified, then restored and rebuilt again.

| | switch OFF | restored |
|---|---|---|
| CSP `connect-src` | `'self'` + the two Supabase origins — **both realtime origins gone** | both realtime origins back |
| `GET /api/health` | `healthy`, HTTP 200 | `healthy`, HTTP 200 |
| Legacy snippet on the fixture | no `window.RECOPYFAST_WS`, no `/socket.io/` request, no fallback-loader request, content over HTTP, no error surface | unchanged |
| **Editor saves** | **`staging_content` written and read back from the database**, zero socket traffic, zero page errors | unchanged |
| Parity | n/a — nothing configured to connect to | **598 ms**, two distinct sockets |

The middle row is the one that matters: with realtime switched off entirely, an editor on a
third-party domain still saved, and the write still landed authoritatively. That is the whole of
ADR 004 rule 2, measured rather than asserted.

**One honest limitation, since closed.** `GET /api/health` reporting `healthy` through the window
above is *not* a test of AC 3's asymmetry. Production ran `main` at the time, where the `realtime`
check did not exist, so production's `checks` object contained only `database` and `storage` in
**both** columns — "healthy with the check absent" proves nothing about a check that is not there.

### AC 3 confirmed against production, 2026-08-17 17:53 UTC

Run after this story merged (`26397ca`) and Vercel deployed it — the deploy was confirmed first by
`checks.realtime` appearing at all, since the whole point is that it was previously absent. The
realtime machine was then **stopped**, not merely made unreachable:

```
fly machine stop 8654414c646128 -a recopyfast-ws     # → stopped, 1 check warning
GET  /api/health   → HTTP 200   status "degraded"    realtime "timeout"   database ok   storage ok
HEAD /api/health   → HTTP 200
fly machine start 8654414c646128 -a recopyfast-ws    # → started, 1/1 passing
GET  /api/health   → HTTP 200   status "healthy"     realtime "ok"
```

Both halves of the asymmetry hold in production: a dead realtime service **degrades** the app and
never fails it (200, not 503), and `HEAD` does not consult realtime at all. Recovery surfaced on
the first poll ~12 s after restart, consistent with the 10 s probe memo in
`src/app/api/health/route.ts`. Outage window ~24 s; HTTP saves were unaffected by construction —
that is the row above that matters.

Wait at least 12 s after any state change before reading `/api/health`, or the memo will answer
with the previous result and the drill will look like it failed.

Still owed by a human: the two-snippet comparison (needs a signed-in dashboard), and a second run
of the deploy procedure by someone who did not write it.

### Incident, 2026-08-17: the running image was five hours and one merge out of date

**Resolved the same day.** Kept because the failure was silent in every signal an operator looks
at, and the next hand-run deploy can reproduce it exactly.

The service was deployed by hand at ~14:05 UTC from a working tree. `s07a` — the security
hardening — merged into `main` at 15:10 UTC. Nothing redeploys this service on a merge, so the
running image kept the **pre-`s07a`** file, while `NEXT_PUBLIC_WS_URL` was pointed at it in
production. What was live for those hours:

- no rate limiter of any kind on a process holding the service-role key (ADR 002 rule 4);
- the handshake origin pin fail-open on a missing `Origin`/`Referer`;
- `content-map` writing `content_elements` under service-role with no permission gate, and
  `ab-test-status-change` with no token re-check;
- grants validated once at handshake and never re-checked, so revocation never reached a live
  socket.

**Every signal said healthy.** `/health` answered 200 the whole time. Worse, the one spot check
that *looked* like a code-version probe passed too: the deployed file had ADR 023's transport pin
hand-edited into it, so `curl 'https://recopyfast-ws.fly.dev/socket.io/?EIO=4&transport=polling'`
correctly returned `{"code":0,"message":"Transport unknown"}` — a green answer from a stale image.
It was only detectable by reading the filesystem:

| | before | after |
|---|---|---|
| `wc -l /app/index.js` | 1237 | **773** (matches the repo) |
| `createRealtimeServer` | 0 | 3 |
| `createRateLimiter` | 0 | 2 |
| `revalidateSocket` | 0 | 4 |
| `assertProductionEnvironment` | 0 | 2 |
| `isOriginAllowed` | 0 | 3 |
| files in `/app` | `index.js` only | `index.js`, `auth.js`, `rate-limit.js` |

Closed by `fly secrets set REDIS_URL=... -a recopyfast-ws --stage`, then `cd server && fly deploy`
— **in that order**, because the code being deployed is the code that refuses to boot without that
secret. Deploying first would have replaced a stale-but-running service with a crash loop, with
`NEXT_PUBLIC_WS_URL` already live.

**The lasting fix is the procedure, not the deploy.** See "deploy from a merged tree" above, and
use the marker probe rather than `/health` to confirm.
