---
validated: yes
---

> **Validated 2026-08-17.** The parity criterion is decided: **editors only** —
> [ADR 022](../decisions/022-realtime-parity-is-editors-only.md). AC 4 is two editors in a
> session on a non-RecopyFast fixture, edit propagating under one second, measured. Task 8
> stands exactly as written; **no new broadcast path is built**, and `s08` AC 3's
> zero-connection guarantee is left intact.
>
> **Operator inputs, 2026-08-17 — all resolved.** Fly.io, app `recopyfast-ws`, region `iad`,
> hostname `recopyfast-ws.fly.dev`, **ONE machine**.
>
> ## ⚠ MUCH OF THIS STORY IS ALREADY DONE — verify before you build
>
> The operator carried out the infrastructure half manually on 2026-08-17, ahead of this run.
> **Do not redo it, and do not assume it.** Verify each item and tick its box, or report the
> discrepancy:
>
> | Already done | Evidence to re-verify |
> |---|---|
> | Service deployed | `curl https://recopyfast-ws.fly.dev/health` → `status: ok`, `supabase: connected` |
> | `server/fly.toml` reconciled | `internal_port = 4001` matching `WS_PORT`; `auto_stop_machines = false`; `min_machines_running = 1`; a `/health` check |
> | Missing deps declared | `server/package.json` carries `dompurify` and `jsdom` — without them the container crashed on boot |
> | Secrets set on Fly | `fly secrets list -a recopyfast-ws` shows `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
> | `NEXT_PUBLIC_WS_URL` | set to `wss://recopyfast-ws.fly.dev` in Vercel **production** and in local `.env`; the app has been redeployed since |
> | Transport pinned | `transports: ['websocket']` on the server and BOTH clients (ADR 023) |
>
> ### The instance decision CHANGED — one machine, and NO Redis adapter
>
> An earlier revision of this plan said two machines and made `@socket.io/redis-adapter`
> mandatory. **That is superseded.** The service was scaled to **one machine**, which removes the
> need for the adapter entirely: Socket.io rooms live in one process's memory, so with a single
> process they are coherent by construction.
>
> **Do NOT add `@socket.io/redis-adapter`, and do not provision Redis for it.** If you find
> yourself reaching for it, the instance count has changed and that is a separate decision.
> `server/fly.toml`'s header states the rule: scaling this service is a code change, not a scaling
> operation. ADR 023 covers the transport half, which is already shipped.
>
> **What is left is the verification half**, which is what this story is actually for: the health
> check (AC 3), the parity demo (AC 4), the legacy-snippet check, and recording the choices in
> `server/README.md`. That is a complexity-3 remainder, not the 5 the two-machine version implied.
# Plan — Story s07b-realtime-deploy

Branch: `feature/s07b-realtime-deploy`
Research: `docs/research/s07-realtime-service.md` — read it first; this plan does not repeat it.

## Target story

`s07b-realtime-deploy` — put the realtime service in front of users. Complexity 4.
Split from `s07-realtime-service` (re-scored 5) at `docs/stories.md:135`; the split's criteria are
defined in `docs/research/s07-realtime-service.md` § *Split proposal*. Inherits `s07`'s AC 1, 2, 3, 4
(`docs/stories.md:488-491`). **Depends on `s07a`. Gates `s08`** — the `s07 → s08` edge becomes
`s07b → s08` (`docs/stories.md:145`). **No UI.**

Criteria this plan must satisfy:

- [x] Deployed at a stable origin on a platform that hosts a long-lived process; a real app name and a documented, repeatable procedure; the stale `ALLOWED_ORIGINS` instruction removed. (AC 1, T10) — the image was five hours stale when this story started; redeployed 16:39 UTC and verified by marker probe. Incident recorded in `server/README.md`
- [x] `NEXT_PUBLIC_WS_URL` set **and the Next app redeployed**, verified in both snippet producers and in the CSP `connect-src` header. (AC 2, T6) — CSP verified. The two-snippet comparison closed 2026-08-17 by a **standing test** (`src/__tests__/api/sites/ws-url-parity.test.ts`): the snippet from `GET /api/sites`, the one from `POST /api/sites/register` and the `buildEmbedScript` call behind the dashboard's client-side fallback emit the identical `data-ws-url`, and all three omit the attribute rather than emitting it empty when the variable is unset — plus a measurement that the value inlines into exactly one client chunk and both sides resolve to `wss://recopyfast-ws.fly.dev`. **Not closed by eyeball: nobody has looked at the rendered snippet on the deployed dashboard.**
- [x] Realtime appears as a check in `GET /api/health`, **degrading** the app's status rather than failing it. (AC 3, ADR 004 "Watch")
- [x] Edit in browser A appears in browser B in under 1 s, on a fixture page on a non-RecopyFast domain. (AC 4) — editors-only, settled: ADR 022. **Measured 613 ms** on `e2e-parity-1786984973.invalid:4176` against `wss://recopyfast-ws.fly.dev`, two distinct connections
- [x] A snippet predating this story, with no `data-ws-url`, keeps working unchanged against the deployed origin. (`s07` AC 6, carried to production)
- [x] **Instance count decided explicitly: ONE.** No `@socket.io/redis-adapter` — a single process
      keeps rooms coherent by construction. Recorded 2026-08-17. (Research open question 4, ADR 004)

### Operator inputs — recorded 2026-08-17

| Input | Answer |
|---|---|
| Platform | **Fly.io**, app **`recopyfast-ws`**, region **`iad`** (Ashburn). `server/fly.toml:22-23` already carries both — the placeholders happen to be correct; delete the `# change to …` comments. Vercel cannot host a long-lived process (ADR 004, `architecture.md:50`). |
| TLS hostname | **`recopyfast-ws.fly.dev`** → `NEXT_PUBLIC_WS_URL = wss://recopyfast-ws.fly.dev` (T6). |
| Instances | **One**, `shared-cpu-1x@512MB`, process group `app`, in `iad`. |
| Redis adapter | **NOT shipped, and must not be.** One machine makes it unnecessary. If the count ever rises above one it becomes mandatory in the same deploy — see `server/fly.toml`'s header. |

> #### ⛔ Kept for the day someone scales up — why >1 machine needs the adapter
>
> **1 — Room isolation (silent).** Socket.io rooms live in the **memory of one process**. Two
> editors on the same page can land on different machines, join the same room name in two separate
> memories, and never see each other — health checks green, nothing thrown. It presents as
> "realtime randomly stopped working for some people," the hardest possible shape of report to act
> on. **This makes AC 4 flaky, not merely unproven**: "edit in A appears in B under 1 s" passes or
> fails depending on machine placement.
>
> **2 — Handshake failure (loud), and it is worse than it first looks.** Socket.io's handshake
> begins with a stateful HTTP polling exchange, and a client left on the default transport takes
> *polling first*. On two machines that round-robins with no sticky routing and dies with
> `Session ID unknown`, **on every customer site**. The adapter does not fix this: it shares rooms,
> not sessions.
>
> **Settled by [ADR 023](../decisions/023-websocket-only-transport-no-sticky-routing.md):
> `transports: ['websocket']` on the clients AND on the server** — **already shipped**, so the
> handshake half is closed regardless of machine count. Sticky routing is rejected. Clients on WebSocket-hostile networks
> lose realtime with no fallback — accepted under ADR 004, since HTTP stays authoritative and
> realtime is additive. One console warning on failure, sharing `s08`'s `connect-src` warning path.
>
> **Where the pin lives, checked 2026-08-17 — verify it is still in both before scaling:**
> `server/index.js:121` (the `new Server(...)` options) and
> `public/embed/recopyfast.src.js:2908` (the `io(RECOPYFAST_WS, {…})` options; the artifact is
> rebuilt from that source, never hand-edited). This paragraph originally named a third,
> `src/lib/collaboration/realtime.ts:93`, described as the dashboard's client. **That file was
> deleted on 2026-08-17**: nothing but its own test ever imported it, the dashboard has never
> opened a socket to this service, and its production branch fell back to a placeholder origin
> (`wss://your-production-ws-server.com`) that would have defeated the widget's own
> `NEXT_PUBLIC_WS_URL`-is-empty off switch had anyone wired it up. Two pins, not three; ADR 023's
> decision is unchanged.
>
> `server/package.json` carries **no `@socket.io/redis-adapter`**, and at one machine it should
> not — nothing above is a task for this story. It *does* carry `redis`: that is node-redis, the
> store behind `s07a`'s fail-closed connection limiter (`server/rate-limit.js:82`). Different
> package, different job — the client's presence is not evidence the adapter is there, and it is
> the adapter that shares rooms across machines.
>
> When the count does rise, the adapter must get its **own** Upstash database rather than sharing
> `informed-ghost-153511`. The rate limiter is fail-closed in production
> (`src/lib/security/rate-limiter.ts:169-174`): if it cannot reach Redis, ten API endpoints stop
> serving, so socket pub/sub must not be able to exhaust the command quota they depend on. Upstash
> bills per command and `.env.example:119` notes each rate-limit check already costs two.

> #### ⛔ T1 — the live Fly app and `server/fly.toml` are four-way inconsistent
>
> The app was created with Fly's generated defaults; the repo's hand-written `fly.toml` has never
> been applied. Reconcile them deliberately — do not assume `fly deploy` sorts it out.
>
> | | Fly (live) | `server/fly.toml` | Consequence if unresolved |
> |---|---|---|---|
> | Port | `internal_port = 8080` | `internal_port = 4001`, `WS_PORT = "4001"` | **Total failure.** `server/index.js:1177` binds `process.env.WS_PORT \|\| 4001` and ignores `PORT`. Nothing listens on 8080. |
> | Idle | `auto_stop_machines = true`, `min_machines_running = 0` | not set | Fly's idle detection is request-based, so a quiet WebSocket looks idle. **Open editing sessions drop.** Needs `min_machines_running >= 1` and autostop off. |
> | Health | none | `/health` HTTP check + TCP fallback | `/health` exists (`server/index.js:228`) but Fly is not checking it. AC 3 depends on this path. |
> | Memory | `memory = "1gb"` **and** `memory_mb = 512` both set | — | Contradictory; the dashboard reports 512MB. Pick one. |
>
> Fly's generated file uses `[http_service]`; the repo's uses `[[services]]`. They are not
> mergeable key-by-key — choose one form and make it complete.

### Cleared — AC 4 is editors-only (M6 answered 2026-08-17, ADR 022)

Research open question 1 (`docs/research/s07-realtime-service.md:250-257`) is **answered:
editors only**. The reasoning is kept below because it is what makes AC 4's literal wording
misleading, and a reviewer reading AC 4 cold will otherwise reach the wrong conclusion.
As written, AC 4 says a second browser **viewing** the page. The code
broadcasts staging edits only to `site:{id}:staging` (`server/index.js:591`); a plain viewer sits in
`site:{id}` (`:426`) and receives nothing until publish (`:1101`). So the literal reading requires a
**new broadcast path** — while `s08` AC 3 requires "no editing session open ⇒ zero WebSocket
connections", which that path would contradict, and `s08` would then rip it out.

`docs/reviews/stories.md:172` recommended **editors-only**, and that is the settled answer. Task 8
is written in that form and does not change. Visitors are served by HTTP and see new content on
their next load after publish — current behaviour, authoritative, and not degraded by this story.
**Do not add a viewer broadcast path to satisfy AC 4's literal wording.**

Two operator inputs are also required before task 1 can be executed (research open question 2): the
platform and account, and the app name / region / TLS hostname. They are decisions, not unknowns —
they do not block planning, and they block exactly one task.

## Tasks (ordered)

1. [x] **Choose the target and make `fly.toml` (or its equivalent) true.** Fly, Railway or Render —
   Vercel cannot host a long-lived process (ADR 004; `docs/architecture.md:50`). `server/fly.toml:22`
   still reads `app = "recopyfast-ws"   # change to your chosen Fly app name`. Replace it with the
   real app name and region. Delete the `ALLOWED_ORIGINS` line from the `fly secrets` example at
   `:15`: `server/index.js:174` and `:196` state it is no longer consulted, so following that comment
   produces false confidence about where the security boundary is (T10). Make the secrets list match
   what the process actually reads — `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_APP_URL` (`server/index.js:46-50`) and the `REDIS_URL` `s07a`'s limiter needs.
   **Verify:** `grep -n "change to your chosen\|ALLOWED_ORIGINS" server/` returns nothing; every env
   name in the config appears in `server/index.js` or `server/rate-limit.js`.

2. [x] **Decide the instance count explicitly and make the config say it.** ADR 004: one instance is
   acceptable to start, and the decision to run more must be explicit rather than assumed. Record the
   number and the reason in `server/README.md` (0 bytes today). If **1**: pin it in the platform
   config (`min_machines_running = 1`, autoscale off) so a routine scale-up cannot silently split the
   room set. If **> 1**: `@socket.io/redis-adapter` ships in `server/package.json` in this story and
   is wired to the same `REDIS_URL` the limiter uses — Redis is a root dependency of the Next app
   (`package.json:78`) and was **not** a dependency of `server/` before `s07a`. **Verify:** the
   recorded number and the config agree; if > 1, an integration test boots two factory instances on
   ephemeral ports against one Redis and proves a broadcast emitted on A reaches a client on B.
   Without that test, "> 1" is a claim, and the symptom of it being wrong is half the editors on a
   page missing half the edits.

3. [x] **Deploy, and prove the procedure repeats.** `fly deploy` from `server/` — not from the repo
   root; `server/fly.toml:1-8` records why (the Dockerfile is written for a `server/`-rooted build
   context). Write the procedure into `server/README.md`: prerequisites, secrets, the deploy command,
   how to read the logs, how to roll back. **Verify:** `curl https://<origin>/health` returns
   `{"status":"ok","supabase":"connected",…}` (`server/index.js:228-235`), and the whole procedure
   runs a second time from a clean checkout by following only the written steps. Paste both runs in
   the PR. A procedure that has been executed once by its author is a memory, not a document.

4. [x] **Add the realtime check to `GET /api/health` — outside the severity computation.** Extend
   `HealthStatus["checks"]` (`src/app/api/health/route.ts:17-22`) with `realtime`, fetched from the
   service's `/health` with a short timeout. **It must not be able to make the app unhealthy.**
   `route.ts:222-232` maps "one check in error" to `degraded` and "two or more" to `unhealthy`, and
   `:261-266` turns `unhealthy` into a 503; adding realtime to that array means realtime down plus a
   flaky storage check returns 503 for the whole app. Exclude realtime from the `statuses` array, cap
   its contribution at `degraded`, and leave `HEAD` (`:299-305`) reading the database alone.
   **Verify:** unit tests — realtime `error` + database/storage `ok` ⇒ `status: "degraded"`, HTTP
   **200**; realtime `error` + storage `error` ⇒ still not worse than what storage alone produced;
   `HEAD` returns 200 with realtime down. This is ADR 004's "Watch" clause, and it is the one test in
   this story whose absence would be invisible until an outage.

5. [x] **Set `NEXT_PUBLIC_WS_URL` and redeploy the Next app (T6).** This is a deploy, not an env
   edit. `src/components/dashboard/SiteDetailView.tsx:98-103` is a `"use client"` component calling
   `buildEmbedScript`, so the value is inlined at **build** time; `src/app/api/sites/route.ts:108` and
   `src/app/api/sites/register/route.ts:190` read it at **runtime**. Set the var, then redeploy.
   **Verify:** the snippet rendered in the dashboard and the snippet returned by the API carry the
   **same** `data-ws-url` (`src/lib/sites/embed-script.ts:94-96`). If they differ, the var was set
   without a rebuild — a difference nobody would think to look for, because both snippets look right
   on their own.

   **Closed 2026-08-17, by a test rather than by a look.** The variable was set and the app
   redeployed during the story; what stayed open was the comparison, because it was written as an
   eyeball on a signed-in dashboard and so could never run twice. It is now
   `src/__tests__/api/sites/ws-url-parity.test.ts`: the three producers — `GET /api/sites`,
   `POST /api/sites/register`, and the `buildEmbedScript` call behind
   `SiteDetailView.tsx:93-98`'s client-side fallback — are asserted to emit the identical
   `data-ws-url` attribute *value* from one env, and to omit the attribute entirely (not emit it
   empty) with none configured; `SiteDetailView.test.tsx` pins that the fallback is unreachable
   whenever the API supplied a snippet, which is what makes the dashboard a consumer rather than a
   fourth producer. Alongside it, the deployed value was measured to inline into exactly one client
   chunk, with both sides resolving to `wss://recopyfast-ws.fly.dev` — reproduced here by
   `npm run build`, where `grep -rl "recopyfast-ws.fly.dev" .next/static/chunks/` returns exactly
   one file and one occurrence.

   **What the test cannot cover, and what is therefore still un-eyeballed.** Jest reads
   `process.env` at call time for all three paths, so the build/runtime split — the actual axis of
   divergence — does not exist inside the suite. It guards a code change that makes two producers
   disagree; it cannot guard a variable set without a redeploy. **Nobody has yet looked at the
   snippet rendered on the deployed dashboard**, and the set-then-redeploy order in
   `server/README.md` remains the only control on that half.

6. [x] **Confirm the CSP followed the same deploy.** `src/middleware.ts:233` feeds
   `NEXT_PUBLIC_WS_URL` into `connect-src`, adding both `https://host` and `wss://host` (`:207-231`).
   The middleware runs on the deployed build, so the header is only correct after the *same* redeploy
   as task 5. **Verify:** `curl -I https://<app>/dashboard` and read `content-security-policy` —
   `connect-src` contains the exact wss and https origins, and no blanket `wss:` or `https:`. Get the
   order wrong and the dashboard's own connections are blocked by our own CSP, silently.

7. [x] **Scope the variable to production (research open question 7).** Preview deploys share
   whatever env they inherit; pointing them at the production socket means preview and production
   clients share `site:{id}` rooms on the same site ids — cross-environment room bleed on live
   customer content. Set the var in the production environment only, or give non-production its own
   service. Record the choice in `server/README.md`. **Verify:** a preview deployment's issued
   snippet carries no `data-ws-url` (or a non-production one); checked once against a real preview
   URL and recorded.

8. [x] **The parity demo (AC 4) — editors-only (settled, ADR 022).** Two browsers in an editing session on
   the same fixture page hosted on a **non-RecopyFast domain**; an edit in A appears in B in under
   one second, measured, not eyeballed. This exercises the staging room
   (`server/index.js:589-598`), which is the only room that carries edits today. **Assert that two
   distinct connections received the event** — ADR 022's Watch: if staging rooms are ever scoped
   per user instead of per site, a weaker assertion keeps passing on a single client while proving
   nothing. **Verify:** the measured interval and the fixture's hostname recorded in the PR.

9. [x] **Legacy snippets keep working against the live origin.** A snippet issued before this story
   — no `data-ws-url` — must behave exactly as it does today on the deployed system: no
   `window.RECOPYFAST_WS`, the early return at `public/embed/recopyfast.src.js:2703`, no request for
   `/embed/socket.io-client.min.js`, content still delivered over HTTP. **Verify:** the fixture from
   task 8 loaded with the old snippet, network log inspected. `/embed/recopyfast.js` is a permanent
   public URL baked into every snippet ever issued (AGENTS.md non-negotiable 2) — this is the check
   that turning realtime on did not quietly make the old ones second-class.

10. [x] **Prove the kill switch.** Unset `NEXT_PUBLIC_WS_URL`, redeploy, and confirm the product
    returns to its pre-`s07b` state with no user-visible error — `s07a`'s additive drill re-run
    against production. Then restore. **Verify:** editing, saving, staging and publishing all succeed
    during the window, and the recorded steps are the rollback procedure in `server/README.md`. ADR
    004 rule 2 is what makes this story reversible; a rollback nobody has executed is a hope.

## Run interdicts

- `server/index.js`, `server/auth.js` and `server/rate-limit.js` diffs stay empty. `s07a` closed the security boundary; a behaviour change here means `s07a` was incomplete — reopen it rather than patching under a deploy story.
- `public/embed/recopyfast.src.js` and `public/embed/recopyfast.js` diffs stay empty. Old snippets keep working *unchanged*; that is a criterion, not a nice-to-have.
- Do not widen the CSP to a blanket `wss:` / `https:`. `src/middleware.ts:203-231` derives origins from env deliberately, and the comment says why.
- Do not point a preview or branch environment at the production realtime service.
- Do not let the realtime check produce a 503, contribute to `unhealthy`, or reach `HEAD` in `src/app/api/health/route.ts`.
- Do not reinstate `ALLOWED_ORIGINS` as a security control. It is dead (`server/index.js:174`, `:196`); the per-site domain pin is the gate.
- Do not remove the compiled-in socket.io prefix from the embed artifact in favour of the fallback loader at `public/embed/recopyfast.src.js:2758-2788`. That loader is dead today only because `getSocketIOFactory()` (`:71-78`) always finds the bundled copy; ADR 004 names lazy-loading from our origin as *the* rejected option, and it fails on exactly the customers running `script-src 'self'` while passing every local test. The byte budget is `s06`'s and the transport is `s08`'s.
- Do not run `fly deploy` from the repo root — `server/fly.toml:1-8` explains that it breaks the `CMD`.
- Do not scale past the instance count recorded in task 2 without the Redis adapter and its cross-instance test.
- Do not edit an existing customer's installed snippet. New snippets carry the attribute; old ones keep working.

## The point everything turns on

**`NEXT_PUBLIC_WS_URL` is not configuration — it is a build input, and it turns on three things at
once.** It decides whether the issued snippet carries `data-ws-url`
(`src/lib/sites/embed-script.ts:63-96`), whether the CSP permits the connection
(`src/middleware.ts:233`), and — through the widget's early return at
`public/embed/recopyfast.src.js:2703` — whether socket.io is downloaded at all. Two of those three
are read at runtime and one at build time, so the *only* correct move is set-then-redeploy, and the
failure mode of getting it wrong is not an error anywhere; it is two snippets that disagree, or a
dashboard whose own connections are blocked by our own header.

Three places it could be wrong:

1. **The two snippet producers disagree.** Compare the snippet rendered by
   `src/components/dashboard/SiteDetailView.tsx:98-103` (client component, value inlined at build)
   against the one returned by `src/app/api/sites/route.ts:108` and
   `src/app/api/sites/register/route.ts:190` (runtime). Identical strings, or the deploy was
   incomplete. Task 5 exists only to catch this.
2. **The CSP lags the variable.** Compare the `content-security-policy` response header against the
   configured origin. `middleware.ts` runs on the deployed build; setting the var in the platform
   dashboard without redeploying leaves `connect-src` without the wss origin and the browser blocks
   the handshake with no server-side trace.
3. **The health check makes realtime able to take the app down.** Compare against
   `src/app/api/health/route.ts:222-232` — the severity math counts errors across `checks`, and two
   errors return 503 at `:261-266`. Realtime is now a second thing that can be down; ADR 004's
   "Watch" clause says it must never be a thing that takes editing down with it. If the realtime
   check lands inside that array, the first Fly restart during a storage blip pages the whole app.

## Files touched

| Path | Change |
|---|---|
| `server/fly.toml` | real app name and region, stale `ALLOWED_ORIGINS` removed, secrets list matched to the code, instance count pinned |
| `server/README.md` | **written** (0 bytes today) — deploy procedure, secrets, instance-count decision and reason, environment scoping, rollback |
| `server/package.json` / `package-lock.json` | `@socket.io/redis-adapter` **only if** task 2 decides > 1 |
| `src/app/api/health/route.ts` | `realtime` check, excluded from the severity computation and from `HEAD` |
| `src/__tests__/api/health/…` | new unit tests for the degradation rule |
| `e2e/` | fixture page on a non-RecopyFast host for tasks 8 and 9, if one is added |
| `.env.example` | `NEXT_PUBLIC_WS_URL` (`:160`) comment updated to say it requires a rebuild |
| `docs/architecture.md` | `:35`, `:50`, `:276`, `:328` all say "not deployed" — update as part of this story |
| `docs/plans/s07b-realtime-deploy.md`, `docs/research/s07-realtime-service.md` | travel with the branch |

Platform configuration (env vars, secrets, DNS, TLS) lives outside the repo. Everything decided
there gets written into `server/README.md`; a setting that exists only in a platform dashboard is a
setting the next person cannot reproduce.

## Test strategy

- **Unit** — the health degradation rule (task 4). Table-driven over the combinations of
  database/storage/realtime statuses, asserting both the `status` field and the HTTP code. This is
  the only automated guard on the criterion that matters most in an outage.
- **Integration** — cross-instance fan-out, **only if** task 2 chooses more than one instance: two
  factory instances on ephemeral ports, one Redis, a broadcast emitted on A observed on B.
- **E2E / manual, recorded** — tasks 3, 5, 6, 7, 8, 9 and 10 are verified against the deployed
  system and their evidence goes in the PR: the `/health` response, the two snippet strings side by
  side, the `content-security-policy` header, the preview snippet, the measured parity interval and
  the fixture hostname, the legacy-snippet network log, and the kill-switch window.
- **Regression** — `s07a`'s harness and e2e drill must still pass unchanged. They are the proof that
  turning realtime on did not make the HTTP path conditional on it.

An honest note on the shape of this story: most of its verification is evidence recorded against a
running system rather than a suite that runs in CI. That is inherent to "deploy an external system",
and it is why the evidence has to be written down instead of remembered — the PR description is the
test report.

## Definition of Done

- Single PR on `feature/s07b-realtime-deploy`, structured description carrying every recorded
  verification above, readable diff.
- `lint`, `type-check`, `format:check`, `build`, `test` green; CI's `audit:prod` and
  `type-check:build` green.
- The service answers `GET /health` at the recorded origin, and `GET /api/health` shows it.
- Realtime down ⇒ the app reports `degraded` with HTTP 200, proven by a test and by the kill-switch
  drill.
- Both snippet producers emit the same `data-ws-url`; the CSP `connect-src` carries the origin.
- The deploy procedure in `server/README.md` has been followed end-to-end by someone reading only
  the document.
- The instance count is written down with its reason, and the config matches it.
- `docs/architecture.md` no longer says the realtime service is deployed nowhere.
- AC 4 satisfied under the M6 reading the operator settled — or the story stops at task 7 and
  returns to `/ks-stories-review`. Do not ship a half-answer to AC 4.
- Review passed (`/ks-review`), no open critical. **`s08` unblocks only after this merges.**
