---
validated: no
---
# Plan — Story s07a-realtime-service-hardening

Branch: `feature/s07a-realtime-service-hardening`
Research: `docs/research/s07-realtime-service.md` — read it first; this plan does not repeat it.

## Target story

`s07a-realtime-service-hardening` — make the realtime service runnable and correct. Complexity 4.
Split from `s07-realtime-service` (re-scored 5) at `docs/stories.md:135`; the split's criteria are
defined in `docs/research/s07-realtime-service.md` § *Split proposal*. Inherits `s07`'s AC 5, 6, 7, 8
(`docs/stories.md:492-495`). **No deploy. No UI.** Sequencing: `s07a → s07b → s08`.

Criteria this plan must satisfy:

- [ ] `server/index.js` starts from `server/package.json` alone. (T1)
- [ ] The handshake origin pin refuses a connection presenting no parseable `Origin`/`Referer`, and one whose site has no registered domain — the same rule as `src/lib/security/site-auth.ts:162`, A-2 tombstone carried across. (T2)
- [ ] A fail-closed per-site rate limiter (`onStoreFailure: "deny"`) bounds connections and messages. (T3, ADR 002 rule 4)
- [ ] The socket is **broadcast-only**: no handler writes to the database. (ADR 004 rule 1 — `docs/stories.md:185-190`)
- [ ] No handler broadcasts on the public site token alone; the `!supabaseEnabled` branch cannot grant staging-room membership. (T4)
- [ ] **M5, socket half:** a grant revoked after the handshake stops the socket — it cannot broadcast, and it is disconnected. (`docs/stories.md:178-184`, `s14` AC 4)
- [ ] `src/__tests__/websocket/server.test.ts` is replaced by an integration harness that boots the server on an ephemeral port and drives it with `socket.io-client`. (T5)
- [ ] With the service stopped, editing/saving/staging/publishing still work over HTTP with no user-visible error — an explicit drill. (AC 5, ADR 004 rule 2)
- [ ] A snippet with no `data-ws-url` still works. (AC 6)
- [ ] Two editors on different elements both persist; neither overwrites. (AC 7)
- [ ] `startServer` binds the configured port or exits. (T9)

**Open question 3 of the research ("how much of AC 8 is in scope?") is answered: all of it.**
T2, T3 and T4 are in this story. Nothing about AC 8 is deferred.

## Tasks (ordered)

Nothing below task 3 is verifiable before task 3 exists. The current suite certifies nothing (T5),
so the harness is not a closing chore — it is the prerequisite for every security task after it.

1. [ ] **The manifest matches the source.** Add `dompurify`, `jsdom` and `redis` to
   `server/package.json`; regenerate `server/package-lock.json` (`npm install` inside `server/`, not
   a hand edit — `server/Dockerfile:16` runs `npm ci`, which fails on a lockfile that disagrees).
   Delete the stray `server/server/` package: it is tracked (`server/server/package.json`,
   `server/server/package-lock.json`), it declares only `nodemon`, Dependabot has already bumped it
   once (`e94463d`), and Docker's `.dockerignore` `node_modules` line matches the root path only —
   so `server/server/node_modules` is copied into the image. Change `server/.dockerignore` to
   `**/node_modules`. **Verify:** `docker build -t recopyfast-ws ./server && docker run --rm -p
   4001:4001 --env-file …` prints `✓ WebSocket server running on port 4001` and
   `curl localhost:4001/health` returns `status: ok`. Today this run dies with
   `Cannot find module 'dompurify'` before the crash handlers at `server/index.js:13-20` exist.

2. [ ] **Make the process importable and make the port non-negotiable.** `server/index.js:1210`
   calls `startServer(PORT)` at module load, and `:1197-1207` walks 4001→4010 on `EADDRINUSE`.
   Export a `createRealtimeServer({ port, supabase, rateLimitStore, revalidationIntervalMs })`
   factory; auto-start only under `require.main === module`; bind the configured port or exit
   non-zero (`port: 0` stays legal and means "ephemeral", which is how the harness binds).
   **Verify:** requiring the module starts no listener; with 4001 already bound the process exits 1
   instead of logging `trying 4002`; `docker run` still reaches the same startup line as task 1.
   *Why this is not cosmetic:* `fly.toml:33` and `fly.toml:58` pin 4001, so a silent shift to 4002
   presents as a failing deploy with healthy application logs (T9).

3. [ ] **Replace the test file with an integration harness.** Delete
   `src/__tests__/websocket/server.test.ts` (416 lines, never imports `server/index.js`, asserts
   `expect("site:site-123").toBe("site:site-123")` at `:110-113`). Add
   `src/__tests__/websocket/server.integration.test.ts` with `/** @jest-environment node */` —
   `jest.config.js` sets `testEnvironment: 'jsdom'` globally and `testPathIgnorePatterns` contains
   `<rootDir>/server/`, so the suite must live under `src/` and declare node itself. It boots the
   factory on port 0 with an injected fake Supabase client that **records every call**, and drives
   it with `socket.io-client` (already a root dependency, `package.json:82`). First assertions:
   valid handshake joins `site:{id}`; missing `siteId`, missing token, bad HMAC, a token older than
   90 days and a future-dated token each disconnect. **Verify:** delete the guard at
   `server/index.js:367-371` and the suite goes red.

4. [ ] **ADR 004 rule 1 — the socket stops writing. This is the story's centre.** Remove every
   database write reachable from a socket message:
   - `content-map` (`:436`) — drop the `content_elements` upsert at `:471`. The authoritative path
     is `postContentMap` → `POST /api/content/:siteId`, called unconditionally at
     `recopyfast.src.js:2821`; the socket emit at `:2833` is fan-out only and the comment at
     `:2801-2820` (register F-10) says so. Keep the `content-map-updated` notification to
     `dashboard:{siteId}`.
   - `content-update` (`:501`) — delete the `!data.persisted` write branch at `:541-583`, including
     the `staging_history` insert at `:575`. `persistContentUpdate` (`recopyfast.src.js:2625`) does
     the `PUT /api/staging/content/:siteId` and then emits with `persisted: true`, so the real
     client never reaches this branch; only a hand-crafted client does. Keep the broadcast at
     `:589-616`.
   - Delete `bulk-update` (`:655`), `switch-language` (`:753`), `restore-version` (`:856`),
     `activate-theme` (`:929`) and `staging-publish` (`:1042`) outright. Each writes
     `content_elements` or calls `create_content_version` / `restore_content_version` /
     `publish_staging_content_atomic` under the service-role key, and **no client emits any of
     them** — verified by grep across `src/` and `public/embed/recopyfast.src.js`. Their HTTP twins
     (`/api/bulk/update`, `/api/edit-board/{languages,history,themes}`, `/api/staging/publish`) stay.
   - Delete `ab-test-status-change` (`:1132`). It has no token re-check and no permission check,
     only a site-id match at `:1138`, so any holder of the public site token can broadcast an
     arbitrary `ab-test-update` to every client in `site:{id}` and `dashboard:{id}`. `3099c07`
     closed the HTTP twin; standing the service up re-opens it on the socket. Nothing emits it.

   Leave a tombstone above each removal naming the HTTP route that owns the write and the ADR.
   **Verify:** the harness's recording Supabase client observes **zero** `upsert` / `insert` /
   `update` / `rpc` calls across every event the server still accepts, including a `content-update`
   sent *without* `persisted: true`; each removed event produces no broadcast and no write.

5. [ ] **Port the origin pin (T2).** `server/index.js:376` reads
   `if (allowedDomain && requestHost && requestHost !== allowedDomain)` — two truthiness guards that
   turn a missing `Origin` into "nothing to check", and a site with a null or unparseable `domain`
   into "no pin at all". `src/lib/security/site-auth.ts:162` compares unconditionally; copy the rule
   and copy the 12-line A-2 comment at `:147-161` with it. **Verify:** absent `Origin` *and*
   `Referer` ⇒ refused; mismatched host ⇒ refused; site row with `domain: null` ⇒ refused; matching
   `Origin` ⇒ accepted; `Referer` alone ⇒ accepted when it matches. A `wscat`-shaped client (no
   `Origin`, valid scraped token) is the case that passes today and must fail after.

6. [ ] **Fail closed when Supabase is absent (T4).** `server/index.js:412-419` skips token
   verification entirely when `supabaseEnabled` is false and sets `socket.data.isStaging = true` on
   the client's own say-so, joining `site:{id}:staging`. It is gated on env presence, not
   `NODE_ENV` — one typo'd `SUPABASE_SERVICE_ROLE_KEY` in production degrades to "anyone can watch
   any site's unpublished staging traffic". In production the process refuses to start at all when
   the required env is missing or invalid (AGENTS.md non-negotiable 8: validate at startup, fail
   loudly). Outside production, keep the degraded mode but never set `isStaging` and never join a
   staging room. **Verify:** production env + missing service-role key ⇒ non-zero exit with a named
   error; non-production + no Supabase ⇒ socket lands in `site:{id}`, never `site:{id}:staging`.

7. [ ] **Fail-closed per-site rate limiter (T3, ADR 002 rule 4).** `server/index.js` holds
   `SUPABASE_SERVICE_ROLE_KEY` (`:154`) and has no limiter of any kind. Add `server/rate-limit.js`
   backed by `redis` (node-redis 5, the same client `src/lib/security/rate-limiter.ts:1` uses), with
   two buckets: connections per site per window, and messages per socket per window. On store
   failure, **deny** — the credential opening these paths is published in the customer's own page
   markup, so losing Redis must not remove the limit. It runs **before** the `sites` lookup at
   `:355`: AGENTS.md's rule is "rate limit before authorization" precisely because authorization
   itself costs a database round trip. Bucket the connection limit on the handshake's `siteId` plus
   the client IP. **Verify:** the harness injects a store; over-limit connection refused with
   `auth-error`; over-limit message dropped with an error and no broadcast; a store whose calls
   throw ⇒ refused, not admitted.

8. [ ] **M5 — re-resolve the grant per message, and sweep idle sockets.** `server/index.js:386-405`
   resolves the grant once at handshake and caches it on `socket.data`; `:527` reads that cache on
   every `content-update`; nothing re-reads. Re-resolve on every message that reaches a permission
   check, using the same predicates plus the two the current queries omit:
   `is_active = true AND revoked_at IS NULL AND expires_at > now()` — `edit_sessions.revoked_at`
   exists (`20250817000000_complete_database_setup.sql:380`) and neither `server/index.js:301-308`
   nor `src/lib/auth/editor-access.ts:293-300` consults it. Where the resolved grant carries an
   editor email (`staging_access`), also refuse when the matching `site_editors` row for that site
   has `revoked_at` set — that is the durable allowlist `revokeSiteEditor`
   (`src/lib/auth/editor-directory.ts:189-193`) actually writes to. On failure: `auth-error` then
   `socket.disconnect()`. Add a revalidation sweep on `revalidationIntervalMs` so a *silent* revoked
   socket is dropped too, not just a talking one — after task 4 the residual exposure is disclosure
   (it still receives other editors' staging broadcasts), and the sweep is what closes it.
   **Verify:** harness flips `is_active` to false ⇒ the next `content-update` is refused and the
   socket disconnects; sets `revoked_at` on the `site_editors` row ⇒ same; a socket that sends
   nothing is disconnected within one sweep interval (injected at ~50 ms).
   *No per-message cache:* the socket emit is one-per-save (`persistContentUpdate` already performs
   an authenticated HTTP `PUT` for the same event), not one-per-keystroke, so one indexed select per
   message is proportionate — and the limiter from task 7, not a TTL, is what bounds the rate.

9. [ ] **The additive drill (AC 5) and the legacy snippet (AC 6).** With the service not running,
   an editing session must save, stage and publish with no error surface on the page. Add an e2e
   spec under `e2e/` alongside `share-edit-publish.spec.ts` that runs the flow twice: once with
   `data-ws-url` absent (AC 6 — asserts `window.RECOPYFAST_WS` unset, the early return at
   `recopyfast.src.js:2703` taken, and **no** request for `/embed/socket.io-client.min.js`), once
   with `data-ws-url` pointing at a closed port (AC 5 — asserts saves still succeed and nothing is
   rendered to the user). **Verify:** both runs green with the WS server stopped. This is ADR 004
   rule 2, and it is the reason `s07a` can ship before `s07b`.

10. [ ] **Two editors, two elements (AC 7).** After task 4 the socket never persists, so this is an
    HTTP concurrency test, not a socket test: two concurrent `PUT /api/staging/content/:siteId`
    calls for different `elementId`s both land, and each element's `staging_content` holds its own
    value. Add it beside the existing staging-content route tests. **Verify:** the test fails if
    either write is made to clobber the row rather than the element.

## Run interdicts

- `public/embed/recopyfast.src.js` and `public/embed/recopyfast.js` diffs stay empty. The widget is `s08`'s; every criterion here is server-side or a test.
- Do not set `NEXT_PUBLIC_WS_URL`, do not touch `server/fly.toml`, do not deploy anything. That is `s07b`.
- Do not modify `src/lib/security/site-auth.ts`. The origin rule is ported **from** it; changing it changes the HTTP boundary too.
- Do not "deduplicate" the two `normalizeDomain` implementations (`site-auth.ts:17`, `server/index.js:87`) into a shared module. `server/` ships as its own npm package via `server/Dockerfile`; importing from `src/` would couple the container to the Next build.
- No `require("../src/…")` anywhere under `server/`. `server/.dockerignore` and the `server/`-rooted build context mean such an import passes locally and `MODULE_NOT_FOUND`s in the image.
- Do not fix, wire or delete `src/lib/collaboration/realtime.ts`. It is orphaned and speaks a protocol this server does not implement (`auth` vs `handshake.query`, `join-site` vs `join-dashboard`, port 3001 vs 4001). No AC covers it; research open question 5 is left open on purpose.
- Do not delete the HTTP twins of the removed socket handlers or their tests: `/api/bulk/update`, `/api/edit-board/{languages,history,themes}`, `/api/staging/publish`, `/api/content/[siteId]`. Frozen means unexposed, not deleted.
- Do not reintroduce a socket write "for symmetry" or "because the HTTP call is slow". The tombstones exist to stop exactly that.
- Do not modify an existing test to accommodate a behaviour change (AGENTS.md). The one deletion authorised here is `src/__tests__/websocket/server.test.ts`, replaced wholesale.
- Do not lower any threshold in `jest.config.js`.
- Do not add `@socket.io/redis-adapter`. Multi-instance is `s07b`'s decision to make explicitly.

## The point everything turns on

**The socket becomes broadcast-only (task 4).** Every other task defends a channel; task 4 decides
what that channel is worth breaking into. Keep one write path and the origin pin, the limiter and
the revocation re-check are each guarding a service-role write, and a gap in any one is a
defacement of a customer's live site performed with our credentials. Remove them and the worst case
across the whole surface collapses to disclosure — a revoked editor who still receives broadcasts.
That is the difference between the security review this story can pass and the one it cannot.

Three places it could be wrong:

1. **A client we did not find emits one of the removed events.** Compare against: `grep` over `src/`
   and `public/embed/recopyfast.src.js` returns no emitter for `bulk-update`, `switch-language`,
   `restore-version`, `activate-theme`, `staging-publish`, `ab-test-status-change` or
   `join-dashboard`; the only emitters are `content-map` (`recopyfast.src.js:2834`) and
   `content-update` (`:2670`, `:2676`). Re-run that grep before deleting. An out-of-repo client
   cannot exist — the service has never been deployed (`docs/architecture.md:50`).
2. **`POST /api/content/:siteId` does not register what the socket upsert registered.** Compare the
   row shape built at `server/index.js:452-465` (`original_content` / `current_content` /
   `published_content` all set to the sanitized text, `language: 'en'`, `variant: 'default'`,
   `metadata.{type,url}`, `onConflict: 'site_id,element_id,language,variant'`,
   `ignoreDuplicates: true`) against the route's upsert. If they differ, removing the socket write
   silently changes what a site's element inventory contains — and `GET /api/sites` derives a site's
   "active" vs "Verifying" status from exactly that table (register F-10).
3. **Per-message re-resolution (task 8) is the wrong grain.** Compare the socket message rate
   against `persistContentUpdate` (`recopyfast.src.js:2625`): the emit follows a completed HTTP
   `PUT`, so it is one per save. If a future client emits at a higher rate the added select becomes
   load-bearing — which is why task 7 lands before task 8, and why the answer is the limiter rather
   than a TTL cache that would make revocation eventually-consistent by exactly the TTL.

## Files touched

| Path | Change |
|---|---|
| `server/package.json` | declare `dompurify`, `jsdom`, `redis` |
| `server/package-lock.json` | regenerated |
| `server/.dockerignore` | `node_modules` → `**/node_modules` |
| `server/server/` | **deleted** (stray tracked manifest inside the build context) |
| `server/index.js` | factory export + `require.main` guard, port-or-exit, all write handlers removed, fail-closed dev branch |
| `server/auth.js` | **new** — token verify, origin pin (A-2 tombstone), grant resolution + per-message revalidation |
| `server/rate-limit.js` | **new** — fail-closed per-site limiter over node-redis |
| `src/__tests__/websocket/server.test.ts` | **deleted** |
| `src/__tests__/websocket/server.integration.test.ts` | **new** — the harness |
| `e2e/realtime-additive.spec.ts` | **new** — AC 5 + AC 6 drill |
| `src/__tests__/api/staging/…` | AC 7 concurrency test beside the existing staging-content tests |
| `docs/plans/s07a-realtime-service-hardening.md`, `docs/research/s07-realtime-service.md` | travel with the branch |

`server/index.js` is 1220 lines today; the removals in task 4 take roughly 490 of them, and the two
new modules keep every file under the 800-line ceiling. Where code moves unchanged, move it
verbatim so the reviewer can diff by content rather than re-reading it.

No new ADR: ADR 002 (rule 4, service-role + fail-closed limiter) and ADR 004 (rules 1 and 2) already
decide everything this plan chooses. If execution reaches a structural choice they do not cover,
write `docs/decisions/006-*.md` on the branch rather than deciding it in a commit message.

## Test strategy

- **Integration (the spine)** — `src/__tests__/websocket/server.integration.test.ts`, node
  environment, real `socket.io-client` against the factory on port 0, with an injected recording
  Supabase double and an injected rate-limit store. Covers: handshake auth (5 cases), origin pin
  (5 cases), zero-writes across every accepted event and every removed event, room membership
  (`site:{id}` vs `site:{id}:staging`, `join-dashboard` with a foreign site id refused), revocation
  (talking socket, silent socket, `site_editors` revoked), rate limit (over-limit, store-throws).
  Every criterion is asserted against a running server — never against a literal.
- **Unit (node)** — `verifySiteToken`, `normalizeDomain`, `parseHost`, `normalizePermissions` as a
  parity table against the `site-auth.ts` behaviour they mirror. This is where a future drift
  between the two implementations shows up as a red test rather than as an incident.
- **Container smoke** — `docker build ./server && docker run …` reaching the startup line, plus
  `curl /health`. Not a jest suite; the terminal output goes in the PR description. It is the only
  thing that actually proves T1 is fixed, because it is the only run with `.dockerignore` applied.
- **E2E** — `e2e/realtime-additive.spec.ts` for AC 5 and AC 6, run with the WS server stopped.
- **HTTP** — the AC 7 concurrency test on `PUT /api/staging/content/[siteId]`.

Coverage note: `jest.config.js` collects from `src/**` only, so exercising `server/index.js` from a
suite that lives in `src/` produces **no** coverage movement. Do not read a flat number as "the
harness is not running" — read the suite. Thresholds stay where they are.

## Definition of Done

- Single PR on `feature/s07a-realtime-service-hardening`, structured description, readable diff.
- `lint`, `type-check`, `format:check`, `build`, `test` green; CI's `audit:prod` and
  `type-check:build` green.
- `docker build ./server && docker run` output pasted in the PR, showing the startup line and a
  `/health` response — the artifact has never executed outside a dev tree that lends it two modules
  it does not declare, and this is the evidence that changed.
- Every criterion in *Target story* has a named test in the harness; the reviewer can map criterion
  → assertion without reading the implementation.
- `grep -nE "\.(upsert|insert|update|rpc)\(" server/` returns nothing outside the rate limiter.
- The A-2 tombstone appears in `server/auth.js`, and a tombstone naming the owning HTTP route
  appears at each site of a removed handler.
- The AC 5 drill has been run with the service stopped and the result recorded.
- Review passed (`/ks-review`), no open critical. **Not deployed** — deployment is `s07b`.
