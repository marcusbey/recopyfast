# Research — Story s07-realtime-service

> ⚠️ **WARNING — the story set is not review-clean.** [`docs/reviews/stories.md`](../reviews/stories.md)
> ends `Max severity: major` / `Stories ready: no`. Two of its open majors land directly on this
> story: **M6** (`s07` and `s08` disagree on who holds a connection — visitor or editor) and **M5**
> (socket revocation floats unowned between `s14` and `s08`). The operator confirmed proceeding
> anyway. This document does not resolve them; it records where they bite. See
> [Open questions](#open-questions).

> Binding: [ADR 004 — two realtime transports](../decisions/004-embed-transport-split.md) settled
> the transport model. Socket.io stays first-party, the embed moves to native `WebSocket` in `s08`,
> **HTTP stays authoritative**, and realtime must be **provably additive**.

---

## The five structuring facts

1. **The premise holds, and I verified every link.** Real-time is off in production: `src/lib/sites/embed-script.ts:80` returns `""`, `:94-96` omits `data-ws-url`, `public/embed/recopyfast.src.js:2703-2705` returns early, `docs/quality/qa-register.md:83-86` records `NEXT_PUBLIC_WS_URL` being removed.
2. **`server/index.js` cannot start from its own manifest.** It requires `dompurify` (`server/index.js:7`) and `jsdom` (`:8`); neither is in `server/package.json:10-16` nor in `server/package-lock.json`. Reproduced: `Cannot find module 'dompurify'`.
3. **The socket's origin pin is the pre-`A-2` version of the rule the HTTP side already fixed.** `server/index.js:376` reads `if (allowedDomain && requestHost && requestHost !== allowedDomain)`; `src/lib/security/site-auth.ts:162` reads `if (!isLocalDemo && requestOriginHost !== allowedDomain)`. Missing `Origin` ⇒ socket passes, HTTP refuses.
4. **`server/index.js` has zero rate limiting and uses the service-role key for everything** (`grep -i ratelimit\|redis server/index.js` → no match; client built at `:154`), which is a direct breach of [ADR 002](../decisions/002-rls-tenant-boundary.md) rule 4.
5. **`src/__tests__/websocket/server.test.ts` never imports `server/index.js`.** All 416 lines re-implement logic inline and assert on literals — `expect("site:site-123").toBe("site:site-123")` (`:110-113`). Server-code coverage is **0%**.

---

## Target story

`s07-realtime-service — turn real-time on` ([`docs/stories.md:367-414`](../stories.md)).

> **As a** site owner **I want** my edits to appear immediately for anyone else looking at the page
> **so that** working with my agency on a page feels like one shared surface.

Stated complexity **4** ("external system: a second deployed service, its own configuration, its own
uptime"). Dependencies: none. **Gates `s08`.**

### Acceptance criteria, with a verified status for each

| # | Criterion | Verified status today |
|---|---|---|
| 1 | `server/index.js` deployed and reachable at a stable origin, documented deploy procedure | **Blocked** — the process cannot boot from its own manifest (fact 2). `server/fly.toml:22` is still `app = "recopyfast-ws"   # change to your chosen Fly app name`; `[env]`/`fly secrets` block at `:12-15` names `ALLOWED_ORIGINS`, which `server/index.js` no longer reads (`:174`, `:196`) |
| 2 | `NEXT_PUBLIC_WS_URL` set in production, new snippets carry `data-ws-url` | Not set. Note the **rebuild trap** below — one of the two snippet producers is a client component |
| 3 | Health endpoint reports up, visible alongside the app's health checks | `GET /health` exists (`server/index.js:228-235`); `src/app/api/health/route.ts` has **no** realtime check. `checks` is typed `database \| storage \| cache? \| external?` (`:17-22`) — adding one is a typed, contained edit |
| 4 | Edit in browser A appears in browser B **viewing** the same page in < 1s, on a non-RecopyFast domain | **Not satisfiable as literally written.** Staging edits broadcast only to `site:{id}:staging` (`server/index.js:591`); a plain viewer sits in `site:{id}` (`:426`) and receives nothing until publish (`:1101`). This is review **M6**, unresolved |
| 5 | With the service stopped, editing/saving/staging/publishing still work over HTTP, no user-visible error | **Largely already true, by design.** `persistContentUpdate` (`recopyfast.src.js:2625`) does the PUT, then `emitRealtimeContentUpdate` (`:2663-2666`) returns immediately when the socket is null; `sendContentMap` posts over HTTP unconditionally (`:2821`). Needs a drill, not a build |
| 6 | A pre-`s07` snippet with no `data-ws-url` keeps working | True today and cheap to keep — `recopyfast.src.js:33-49` reads the attribute, absence ⇒ `RECOPYFAST_WS` undefined ⇒ early return |
| 7 | Two editors on different elements both persist, neither overwrites | Persistence is per-element over HTTP (`PUT /api/staging/content/[siteId]`); the socket path is skipped when `data.persisted` is set (`server/index.js:541`). Needs a test, not a mechanism |
| 8 | Connections authorized per site; **cannot join a room it has no grant for** | **Partially false today.** Four separate holes — see [Traps & constraints](#traps--constraints) |

---

## Current state of the code

### `server/index.js` — what it actually does (1220 lines, read in full)

Boots Express + Socket.io, resolves `.env` from four candidate paths (`:26-38`), validates three env
vars, and builds a **service-role** Supabase client at `:154`. `supabaseEnabled` is the master switch
for every DB path and, critically, for authentication.

**Connection handshake** (`:333-427`), in order:

1. `siteId` present, else disconnect (`:340`).
2. `token` present, else `auth-error` + disconnect (`:345`).
3. Site lookup by id (`:355`), then HMAC verify via a local `verifySiteToken` (`:121-149`) that mirrors `site-auth.ts` — three parts, siteId claim, digit-only `issuedAt`, 90-day max age, 60s future skew, `timingSafeEqual`. This half is correct and matches the HTTP implementation.
4. **Origin check (`:373-380`) — the weak link.** `if (allowedDomain && requestHost && requestHost !== allowedDomain)`.
5. Staging/edit grant validated only `if (isStaging && (stagingToken || editToken))` (`:386`), via `validateStagingAccess` (`:242`) or `validateEditSessionAccess` (`:295`) — both real DB lookups with `is_active` and `expires_at` checks. Permissions normalised through a hierarchy helper (`:278-293`).
6. Room join (`:422-427`): staging ⇒ `site:{id}:staging`, otherwise `site:{id}`.

**CORS**: `origin: true, credentials: false` (`:215-221`), with ~40 lines of comment (`:174-214`)
explaining why a static allowlist is wrong here — a multi-tenant widget lives on every customer's
domain. That reasoning is sound and matches `3099c07`'s intent; the allowlist is deliberately *not*
the gate. The per-site domain check at `:376` is what was supposed to replace it, and it is the one
that has the hole.

**Message handlers**, with their actual guards:

| Event | Token re-check | Staging gate | Permission gate |
|---|---|---|---|
| `content-map` (`:436`) | yes (`:442`) | — | **none** — writes `content_elements` with service-role (`:471`), `ignoreDuplicates: true` |
| `content-update` (`:501`) | yes (`:513`) | yes (`:519`) | `edit\|publish\|admin` (`:528`) |
| `join-dashboard` (`:628`) | — | — | site-id match against the handshake (`:634`) — correct, and commented |
| `bulk-update` (`:655`) | yes (`:659`) | conditional | `edit\|publish\|admin`, **only when `isStaging`** (`:665`) |
| `switch-language` (`:753`) | yes | yes (`:757`) | `edit\|publish\|admin` |
| `restore-version` (`:856`) | yes | yes | `edit\|publish\|admin` |
| `activate-theme` (`:929`) | yes | yes | `admin` (`:945`) |
| `staging-publish` (`:1042`) | yes | yes (`:1045`) | `publish\|admin` (`:1057`) |
| `ab-test-status-change` (`:1132`) | **none** | **none** | **none** — only a site-id match (`:1138`) |

Content is sanitized with `DOMPurify` stripping all tags and attributes (`:79-85`). Crash handlers
are registered at `:13-20` — **after** the requires at `:1-8`, so a missing-module throw is not
caught by them. Graceful `SIGTERM` at `:1213`. Port auto-detection retries ten times on `EADDRINUSE`
(`:1180-1208`) — sensible for `npm run dev`, actively wrong on Fly where the health check pins 4001
(`server/fly.toml:34`, `:58`) and a silent shift to 4002 presents as a failing deploy.

### The embed side

`recopyfast.src.js:33-49` reads `data-ws-url` into `window.RECOPYFAST_WS`. `:2703-2705` is the
early return. `:2758-2788` is `loadSocketIO()`, which falls back to fetching
`/embed/socket.io-client.min.js` from **our** origin — ADR 004 names this exact code as the live
trap (`SOCKET_IO_FALLBACK_URL` derived at `:58`). Turning realtime on makes that path reachable for
the first time.

`sendContentMap` (`:2790-2845`) posts over HTTP at `:2821` and only *additionally* emits on the
socket when `this.socket && this.socket.connected` (`:2833`) — the comment at `:2801-2820` records
why (register F-10: every site stuck at "Verifying"). `persistContentUpdate` (`:2625`) is
staging-only and passes `persisted: true`, which `server/index.js:541` honours by skipping its own
write. **The additive contract of ADR 004 rule 1 is already implemented in code on both sides.**

### First-party Socket.io — the half of ADR 004 with no client

`src/lib/collaboration/realtime.ts` is the only first-party socket client, and **nothing imports it**
outside two test files. It is also protocol-incompatible with the server it would talk to:

- it authenticates via `io(url, { auth: { token } })` (`:89-92`); the server reads `socket.handshake.query` (`server/index.js:336`) and never looks at `auth`, so every connection would be dropped at `:340` for a missing `siteId`;
- it emits `join-site` (`:105`); the server has no `join-site` handler, only `join-dashboard`;
- its dev URL is `ws://localhost:3001` (`:87`) while the server listens on 4001;
- its production fallback is the literal string `"wss://your-production-ws-server.com"` (`:86`).

So ADR 004's "first-party dashboard → Socket.io, unchanged" describes a leg that has **no working
client at all** today. `s07`'s ACs do not ask for one.

### Deploy assets

`server/Dockerfile` is competent — `node:20-alpine`, `npm ci --omit=dev`, non-root user, `EXPOSE
4001`. `server/.dockerignore` excludes `node_modules`, which is correct and is *also* precisely why
fact 2 is fatal: the image gets exactly the five declared dependencies and nothing else.

`server/fly.toml` is a template: placeholder app name (`:22`), a `fly secrets` example naming a
now-dead env var (`:15`), and http + tcp health checks against 4001. Git history shows `server/` has
never been touched for a deploy — the last functional commits are `9d95cfe` (CORS fix) and `3a31102`.

---

## Anchor points

| Path | Why it matters |
|---|---|
| `server/index.js` | The service. Auth handshake `:333-427`, handlers `:436-1157`, startup `:1176-1210` |
| `server/package.json` | Missing `dompurify` + `jsdom`. Also missing `redis`/`@socket.io/redis-adapter` |
| `server/package-lock.json` | Must be regenerated with the manifest, or `npm ci` in the Dockerfile fails |
| `server/Dockerfile` | Fine as-is once the manifest is right |
| `server/fly.toml:22` | Placeholder app name; `:12-15` secrets example is stale |
| `src/lib/sites/embed-script.ts:63-98` | `getPublicWebSocketUrl` / `buildEmbedScript` — the on/off switch |
| `src/lib/security/site-auth.ts:109-184` | `authorizeSiteRequest`; `:150-164` is the origin rule to port |
| `src/middleware.ts:207-233` | CSP `connect-src`; `addOrigin(process.env.NEXT_PUBLIC_WS_URL)` at `:233` |
| `src/app/api/health/route.ts:17-22, 200-219` | Where a realtime check slots in |
| `public/embed/recopyfast.src.js:2625-2845` | Persist → emit → content-map, the additive path |
| `src/__tests__/websocket/server.test.ts` | 416 lines of tautology. Replace, don't extend |
| `src/lib/collaboration/realtime.ts` | Orphaned, protocol-incompatible first-party client |
| `src/components/dashboard/SiteDetailView.tsx:98-103` | Client-side `buildEmbedScript` — the rebuild trap |
| `src/app/api/sites/route.ts:108`, `register/route.ts:190` | Server-side `buildEmbedScript` |

---

## Verified APIs / functions

Read and confirmed, not recalled:

- `getPublicWebSocketUrl(appUrl?: string): string` — `embed-script.ts:63`. Returns `NEXT_PUBLIC_WS_URL` normalised if set; else swaps `localhost:3000` → `:4001`; else `""`.
- `buildEmbedScript({ siteId, siteToken, appUrl?, wsUrl? }): string` — `:83`. `wsAttribute` is `""` when `wsOrigin` is falsy (`:94-96`).
- `verifySiteToken(siteId, apiKey, token): boolean` — `server/index.js:121`. Server-local mirror of `verifySiteTokenSignature`.
- `verifySiteTokenSignature(...)` / `authorizeSiteRequest({ siteId, token, origin, referer })` / `authorizeSiteOrigin(...)` / `authorizeFirstPartySiteRequest(...)` — `src/lib/security/site-auth.ts:77, 109, 232, 186`. `authorizeSiteRequest` throws `"Origin not allowed"` at `:163`.
- `normalizeDomain(domain)` — exists in **both** `site-auth.ts:17` and `server/index.js:87`, two implementations of one rule.
- `validateStagingAccess(stagingToken, siteId)` / `validateEditSessionAccess(editToken, siteId)` / `normalizePermissions(raw)` — `server/index.js:242, 295, 278`.
- Postgres functions the socket calls: `create_content_version` (`:683`), `restore_content_version` (`:887`), `publish_staging_content_atomic` (`:1074`).
- `GET /health` → `{ status, connections: io.engine.clientsCount, supabase, message }` (`:228-235`).
- HTTP fallbacks that must keep working: `PUT /api/staging/content/[siteId]`, `POST /api/staging/publish`, `POST /api/content/[siteId]`, `/api/staging/{access,validate,verify}`.

---

## Traps & constraints

**T1 — the service cannot boot from its own manifest. Fix this first or nothing else is testable.**
`server/index.js:7-8` requires `dompurify` and `jsdom`; `server/package.json` declares neither, and
neither is in the lockfile. It works under `npm run dev` only because `dev:ws` is `cd server && npm
run dev` (`package.json:8`), and Node walks up to the repo-root `node_modules`, which does have both
(`package.json:63, 69`). In the container, `.dockerignore` strips `node_modules` and `npm ci
--omit=dev` installs five packages. Reproduced with the real `server/node_modules`:

```
Error: Cannot find module 'dompurify'
Require stack:
- .../index.js
```

Latent since `3982504` added the requires; `server/package.json` has changed once since, for a
dependabot bump. The crash-safety handlers at `:13-20` are registered *after* the requires, so it is
an uncaught throw at load — Fly restart-loops with no useful diagnostic.

**T2 — the origin pin is fail-open on a missing header.** `server/index.js:376` requires
`allowedDomain && requestHost` to both be truthy before comparing. `site-auth.ts:162` compares
unconditionally, and the 12-line comment above it says exactly why (incident **A-2**): the site token
ships as a plain attribute in the customer's markup, so it is readable with View Source, *"nothing
obliges a non-browser caller to send either, so treating 'no header' as 'nothing to check' enforced
the pin only against the caller that could never have beaten it, and skipped it entirely for curl."*
A `wscat`/Node client with a scraped token and no `Origin` joins `site:{id}` from anywhere. The
second clause of the same expression also skips the check when `site.domain` is null or unparseable.
Porting this rule is the story's own agentic note, and AC 8 is what it satisfies.

**T3 — zero rate limiting on a service-role process.** `server/index.js` holds
`SUPABASE_SERVICE_ROLE_KEY` and has no limiter of any kind. ADR 002 rule 4 is explicit: a
service-role path *"additionally carries a fail-closed rate limiter keyed on the site
(`onStoreFailure: 'deny'`)… the credential that opens these paths is published in the customer's own
page markup."* Every argument in that rule applies verbatim to the socket. This is not optional
polish; it is the standard the rest of the codebase is held to. Note the server has no `redis`
dependency — adding this means new infrastructure inside `server/`.

**T4 — three handlers accept the public site token as sufficient authority.**
- `content-map` (`:436`) has no permission check and writes `content_elements` under service-role (`:471`). `ignoreDuplicates: true` means it cannot *overwrite* published copy, but it can create unbounded rows on attacker-chosen `element_id`s. Combined with T3, that is an uncapped write channel.
- `ab-test-status-change` (`:1132`) has **no token re-check and no permission check** — only a site-id match. Any socket holding the public token can broadcast an arbitrary `ab-test-update` to every client in `site:{id}` and `dashboard:{id}`. Commit `3099c07` ("close unauthenticated A/B writes") closed the HTTP twin of this; standing the service up re-opens it on the socket.
- The `else` branch at `:412-419`: when `supabaseEnabled` is false there is **no token verification at all**, and `if (isStaging)` sets `socket.data.isStaging = true` on the client's own say-so, joining `site:{id}:staging`. It is gated on env presence, not `NODE_ENV` — a typo'd `SUPABASE_SERVICE_ROLE_KEY` in production degrades to "anyone can watch any site's unpublished staging traffic." Damage is bounded (`stagingPermissions` stays empty, so every write handler still rejects), but the read leak is real.

**T5 — the only existing test suite certifies nothing.** `src/__tests__/websocket/server.test.ts`
does not import `server/index.js`. WS-004 "Origin validation" asserts
`expect(new URL("https://evil.com").hostname).not.toBe("example.com")`; WS-005 asserts
`` expect(`site:${testSiteId}`).toBe("site:site-123") ``. Twenty-two "WS-nnn" ids give the appearance
of a covered surface. **Any plan that reads "existing tests cover the handshake" is wrong.** A real
harness — boot the server on an ephemeral port, drive it with `socket.io-client` — has to be built
before a single security fix is verifiable. `socket.io-client` is already a root dependency.

**T6 — `NEXT_PUBLIC_WS_URL` needs a Next.js rebuild, not an env change.**
`SiteDetailView.tsx:98-103` is a `"use client"` component calling `buildEmbedScript`, so
`process.env.NEXT_PUBLIC_WS_URL` is inlined at build time. `src/app/api/sites/route.ts:108` and
`register/route.ts:190` read it at runtime. Set the var without redeploying and the dashboard shows a
snippet *without* `data-ws-url` while the API returns one *with* it — a difference nobody would think
to look for. The same var also drives `middleware.ts:233`'s CSP `connect-src`; get the deploy order
wrong and the dashboard's own connections are blocked silently by CSP.

**T7 — HTTP must stay the only writer.** ADR 004 rule 1. Already honoured
(`recopyfast.src.js` sets `persisted: true`, `server/index.js:541` skips its write). The trap is
*regression*: a plan that "simplifies" the socket into writing directly reintroduces a silent
divergence. Leave the tombstone comment.

**T8 — the fallback socket.io loader becomes reachable.** `recopyfast.src.js:2758-2788` fetches
`/embed/socket.io-client.min.js` from our origin. ADR 004 names lazy-loading from our origin as *the*
rejected option, because our origin is not the customer's `'self'`. It is currently dead code because
of the early return at `:2703`. Turning realtime on wakes it, and it will pass every local test while
failing exactly on `script-src 'self'` customers.

**T9 — port auto-detection is wrong in a container.** `startServer` (`server/index.js:1180`) walks
4001→4010 on `EADDRINUSE`. `fly.toml:34` and `:58` pin 4001. Any drift makes the app look healthy in
its own logs while every health check fails.

**T10 — `ALLOWED_ORIGINS` is documented but dead.** `fly.toml:15` tells the operator to set it;
`server/index.js:174` and `:196` say it is no longer consulted. Following the deploy comment produces
false confidence about where the security boundary is.

---

## Open questions

1. **M6, blocking: does AC 4 mean visitors or editors?** As written it says "a second browser
   *viewing* the same page." The code broadcasts staging edits only to `site:{id}:staging`
   (`server/index.js:591`); a viewer in `site:{id}` gets nothing until publish. So the literal
   reading needs a **new** broadcast path, while `s08` AC 3 requires "no editing session open ⇒ zero
   WebSocket connections." The stories review recommends **editors-only** (`reviews/stories.md:172`).
   Until this is settled, AC 4 cannot be written as a test and an agent executing it literally will
   connect every visitor of every customer site — then `s08` rips that out.
2. **Deploy target and ownership.** Fly, Railway or Render — ADR 004 lists three and picks none.
   `server/fly.toml` biases toward Fly but is an unmodified template. Who owns the account, the app
   name, the region, the TLS hostname, the secrets? All operator decisions, none in the repo.
3. **How much of the AC 8 hardening is in scope?** The criterion is one line; T2/T3/T4 are four
   distinct defects, one of which (T3) means putting Redis inside `server/` for the first time.
   Explicitly in or explicitly deferred — silence here is what produces a half-fixed auth surface.
4. **One instance or two?** ADR 004 says one is acceptable but the decision must be explicit. No
   `@socket.io/redis-adapter` exists anywhere in the repo, so "Redis is already a dependency" is true
   of the Next app and false of `server/`.
5. **Does `s07` owe a working first-party Socket.io client?** ADR 004 keeps Socket.io for the
   dashboard, but `src/lib/collaboration/realtime.ts` is orphaned and speaks a protocol the server
   does not implement. No AC covers it. Fix, delete, or leave — but name it.
6. **M5, socket revocation.** `s14` AC 4 requires an open connection to stop saving after a grant is
   revoked; `s14` declares no dependency on `s07`/`s08`. `validateEditSessionAccess` runs **once, at
   handshake** (`server/index.js:295`), never again. Standing the service up creates the gap the
   review describes. Does `s07` re-check the grant per message, or is that deferred?
7. **Which environments get `NEXT_PUBLIC_WS_URL`?** Preview deploys on Vercel share the production
   Socket service unless separately configured — cross-environment room bleed on shared site ids.

---

## Real complexity

**Re-scored: 5** (stories.md says 4).

The 4 was scored on one axis — *"external system: a second deployed service, its own configuration,
its own uptime."* That axis is real and correctly sized. The scoring misses that AC 8 is a second,
independent axis of comparable weight, and that AC 1 is blocked by a defect nobody knew was there.

What pushes it over:

- **The service does not run.** T1 is not a deploy detail; the artifact has never executed outside a dev tree that lends it two modules it does not declare. Whatever else "deployed and reachable" was estimated against, it was not this.
- **AC 8 is a security hardening pass on 1220 lines with no test coverage.** T2, T3, T4 are three separate defect classes. T3 alone means introducing Redis into `server/` — a new external dependency inside the story, which is itself the PRD's definition of a 5 (`prd.md:129`, *"5 real-time, migrations, external systems"*).
- **T5 removes the safety net.** The 22-case suite is tautological. Every security fix above needs a harness that does not exist yet, built before the first fix can be shown to work. That is real, unavoidable, un-delegatable work that the 4 does not account for.
- **The story is already real-time + external systems**, both named as 5-markers on the PRD's own scale, before any of the above.

Against splitting: the ACs read as one coherent user outcome, and `s08` is waiting. That is a
sequencing argument, not a sizing one — and the split below preserves the ordering exactly.

---

## Split proposal

Two stories, strictly sequential, same total scope, no AC dropped. The seam is **local vs.
deployed**: everything in `s07a` is verifiable on a laptop; everything in `s07b` needs an account,
a domain and a second browser.

### `s07a-realtime-service-hardening` — make the service runnable and correct (complexity 4)

Inherits AC 5, 6, 7, 8. No deploy.

- [ ] `server/index.js` starts from `server/package.json` alone — `dompurify` and `jsdom` declared, lockfile regenerated, verified by `docker build ./server && docker run` reaching "WebSocket server running". (T1)
- [ ] The handshake origin pin refuses a connection that presents no parseable `Origin`/`Referer`, and refuses one whose site has no registered domain — same rule as `site-auth.ts:162`, with the A-2 tombstone comment carried across. (T2)
- [ ] A fail-closed per-site rate limiter (`onStoreFailure: "deny"`) bounds connections and messages, per ADR 002 rule 4. (T3)
- [ ] `content-map` and `ab-test-status-change` carry the same permission gates as their HTTP twins; the `!supabaseEnabled` branch cannot grant staging-room membership. (T4)
- [ ] `src/__tests__/websocket/server.test.ts` is replaced by an integration harness that boots the server on an ephemeral port and drives it with `socket.io-client`. Every criterion above is asserted against the running server, not against a literal. (T5)
- [ ] With the service stopped, editing/saving/staging/publishing still work over HTTP with no user-visible error — an explicit drill, not an assumption. (AC 5)
- [ ] A snippet with no `data-ws-url` still works. (AC 6)
- [ ] Two editors on different elements both persist. (AC 7)
- [ ] Fixed: the port-walk in `startServer` binds the configured port or exits. (T9)

**Why this is a 4, not a 3:** it is a security-boundary rewrite on a service-role process whose
existing tests certify nothing, and it introduces Redis into `server/`.

### `s07b-realtime-deploy` — put it in front of users (complexity 4)

Depends on `s07a`. Inherits AC 1, 2, 3, 4. **Gates `s08`.**

- [ ] Deployed at a stable origin on a platform that hosts a long-lived process; `fly.toml` (or equivalent) carries a real app name and a documented, repeatable procedure; the stale `ALLOWED_ORIGINS` instruction is removed. (AC 1, T10)
- [ ] `NEXT_PUBLIC_WS_URL` set **and the Next app redeployed**, verified in both snippet producers and in the CSP `connect-src` header. (AC 2, T6)
- [ ] Realtime appears as a check in `GET /api/health`, degrading the app's status rather than failing it — realtime being down must never present as the app being down (ADR 004, "Watch"). (AC 3)
- [ ] The two-browser under-1-second demo on a fixture page on a non-RecopyFast domain, under whichever reading of M6 the operator settles. (AC 4)
- [ ] Instance count decided explicitly and recorded; if >1, the Socket.io Redis adapter ships with it. (Open question 4)

**Sequencing:** `s07a → s07b → s08`. The `s07 → s08` edge in the dependency graph
(`stories.md:64`) becomes `s07b → s08`; nothing else in the graph moves.

**Prerequisite for either:** open question 1 (M6) must be answered before `s07b` AC 4 can be written
as a test, and open question 3 before `s07a` can be planned.
