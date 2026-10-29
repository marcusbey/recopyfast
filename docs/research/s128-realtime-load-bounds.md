# Research — Story s128-realtime-load-bounds

**Verdict: H4 and M6 hold; L21 holds but its suggested fix is incomplete; L22 holds for
uncaught wrapper/handler failures, not every handler exception.** Verified against local HEAD
`534e792653338928fb0b78117f8639d1bc735a6b` on October 27, 2026. No production calls or load tests.
The audit's 2,400 reads/s is arithmetic capacity, not measured sustained throughput.

## The five structuring facts

1. Every admitted visitor can emit content-map and reach a fresh sites SELECT
   (`server/index.js:531-557`, `:192-198`); no server-side staging gate exists there.
2. The only message budget is 600/socket/minute (`server/rate-limit.js:56`, `:365-366`);
   it hits Redis even for refused excess messages. 240 × 600 / 60 = 2,400 reads/s on average,
   with fixed-window bursts possible; staging messages additionally resolve grant rows.
3. No transport admission cap or explicit timeout/payload bound exists in Server options
   (`server/index.js:121-147`); refusals use namespace-only disconnect (`:182-184`).
4. s79 requires current credentials before fan-out and an independent all-socket sweep
   (`server/index.js:234-306`); grant code explicitly rejects TTL caching (`server/auth.js:198-213`).
5. Only one process owns rooms; Fly's configured hard limit is 250 connections
   (`server/fly.toml:106-117`). ADR 026 supersedes ADR 023's two-machine premise, not its
   websocket-only rule. No Redis adapter is installed (`server/package.json:10-20`).

## Target story

Close H4/M6 and contain L22 without changing HTTP persistence, public embed URLs or s79's
credential boundary. Acceptance is in docs/stories.md. L21 is researched but deferred rather
than introducing visitor/editor admission architecture inside this bounded fix.

## Current state of the code

### H4 — confirmed, with qualifications

`onMessage` charges `checkMessage` before dispatch (`server/index.js:501-514`). The content-map
handler compares the message token to the handshake token (`:535-538`), calls revalidateSocket
(`:548`), then emits only URL and element count to dashboard subscribers (`:553-557`). Visitors
pass the site-key recheck and return before any editor-grant check (`:252`). Production uses the
service-role client (`:893-896`). A fabricated Origin is not proof of editor authority.

The 240-socket scenario needs time to accumulate connections: defaults admit 60 handshakes/address,
120/site and 40/site/address each minute (`server/rate-limit.js:35-50`). None is a concurrency
cap. Fly configuration is local evidence only, not a fresh deployment inventory.

A source search across src and public/embed/recopyfast.src.js finds content-map-updated listeners
only in tests, not a production consumer. The widget does send full maps on a connected socket
(`public/embed/recopyfast.src.js:3206-3214`), after unconditional HTTP discovery (`:3194`). The
64 KiB limit can therefore disconnect large-page maps; HTTP still runs first. This is an accepted
realtime-degradation risk to validate locally, not a reason to widen the requested limit.

### M6 — confirmed

The installed Socket.IO implementation defaults connectTimeout to 45000
(`node_modules/socket.io/dist/index.js:101`); Engine.IO defaults maxHttpBufferSize to 1e6
(`node_modules/engine.io/build/server.js:51`). Socket.IO's timer closes clients without a namespace
(`node_modules/socket.io/dist/client.js:49-57`); it is not a deadline for this application's async
authorization after namespace admission. Tests must distinguish those two phases.

`disconnect(close = false)` only closes the namespace unless true is supplied
(`node_modules/socket.io/dist/socket.js:592-603`); `_remove` removes namespace bookkeeping but does
not close the transport (`node_modules/socket.io/dist/client.js:125-137`). Ordinary cooperative
clients may close themselves; a hostile raw client need not. Also fix the inline refusal branches
at `server/index.js:334-456`, not just the named helper.

Engine.IO invokes allowRequest before initial session creation
(`node_modules/engine.io/build/server.js:170-177`), creates/counts the socket later and emits
connection after registering its close listener (`:315-337`). An open-only count is racy: parallel
upgrades must reserve capacity before the allow callback, release failed/aborted reservations,
then transfer ownership to Engine.IO close. Request completion alone is not transport closure.
Pin these semantics with raw local WebSocket tests; do not depend on private library methods.

### L21 — confirmed; a reorder does not close the full finding

A valid public token and matching, forgeable Origin spend the site bucket at
`server/index.js:417`, before resolveGrant (`:424`). Visitors also legitimately spend it; a staging
request without a credential falls through to the live room (`:423`, `:479-484`). Thus moving
checkConnection below resolveGrant protects against invalid editor credentials but still lets
ordinary public-token visitors exhaust the same site bucket. server/README.md's admission section
already acknowledges this residual. Full closure needs isolated visitor/editor budgets or a broader
editor-only connection policy; neither is silently assumed here. The per-address pre-auth limiter
must stay before all DB work regardless (`:360-366`).

### L22 — partly qualified, actionable

The wrapper awaits the limiter outside a catch and returns the handler promise without containing
its rejection (`server/index.js:501-514`). join-dashboard has no local catch (`:682-726`).
content-map and content-update already catch their own normal errors (`:532-561`, `:573-678`),
and the normal limiter converts store failures to denied verdicts (`server/rate-limit.js:312-328`).
Therefore an ordinary failed DB read is not automatically a process crash. An uncaught throw or
rejected promise still reaches the CLI's fatal unhandledRejection handler (`server/index.js:828-831`).
The fix belongs in the shared wrapper and must await dispatch inside try/catch; a bare return of
an async handler does not catch its rejection. Keep fatal process handling for genuine uncaught faults.

## Anchor points

- server/index.js:85 factory injection; :121 transport options; :182 refuse; :234 revalidation;
  :290 sweep; :501 event wrapper; :531 content-map; :797 lifecycle close.
- server/rate-limit.js:105 addressBucket handles IPv4, mapped IPv4, IPv6 /64 and unknown input;
  :300 createRateLimiter owns fail-closed Redis budgets.
- src/__tests__/websocket/server.integration.test.ts:1 real server/real socket harness;
  harness.ts:76-85 records reads/writes and controls failures.
- server/README.md:77 admission policy and key-rotation contract need a narrow implementation update.

## Verified APIs / functions

- createRealtimeServer(options = {}) injects supabase, rateLimitStore, rateLimit,
  revalidationIntervalMs and trustFlyClientIp; returns listen, close and revalidateAll (:85-95, :808).
- resolveClientAddress(handshake, { trustFlyClientIp }) (:62) trusts Fly-Client-IP only when enabled;
  reuse that policy for request headers and TCP remoteAddress in allowRequest.
- createRateLimiter({store, limits}) returns checkHandshake({address}),
  checkConnection({siteId,address}), checkMessage({socketId}) (rate-limit.js:300-367).
- revalidateSocket(socket, {lookupSite = readSiteKey} = {}) (:234) refreshes permissions, refuses
  missing/rotated keys and failed lookups; sweep memoizes the site lookup per pass only (:291-295).

## Traps & constraints

- An approximately 10-second completed-success cache conflicts with s79's current-message rotation
  contract and auth.js's explicit no-TTL rule. Recommend in-flight-only promise memoization for
  content-map, cleared on settlement/disconnect; preserve fresh checks for later messages and
  privileged events. The tighter budget provides the sustained bound. Owner validation must settle
  this distinction before implementation; no ADR is needed for the recommended non-TTL approach.
- Current tests expect visitor map fan-out (server.integration.test.ts:975-1044) and immediate
  key-rotation refusal on a visitor map (:2262-2284). Those assertions must change explicitly:
  visitor maps are now zero-work drops; a staging sender retains the immediate-rotation proof.
  Preserve viewer sweep tests and all edit/grant/device revocation tests, never simply delete them.
- Root Jest excludes server/ (jest.config.js testPathIgnorePatterns). New executable regression
  suites belong under src/__tests__/websocket, exercising actual server/ modules.
- Production-only limits cannot be tested solely by reading configuration literals. Use raw
  Engine.IO/WebSocket clients, pending upgrade races, close events, and recorded DB/Redis counts.
- s125's story is absent in this branch's docs/stories.md; use s124 and supplied template shape,
  without reading or editing sibling worktrees. ADRs currently end at 074; 075 stays reserved.
- No codebase-memory tools were exposed; targeted source reads/searches supplied the evidence.

## Open questions

1. Approve 20 concurrent transports per normalized address and 30 content-map events/site/minute?
   These are conservative proposed defaults, not measured NAT/office capacity.
2. Approve in-flight-only memoization to retain s79, instead of the audit's suggested 10-second
   successful-verdict cache? A TTL would require a separately documented security tradeoff.
3. Keep L21 deferred to an admission-isolation story? A mere grant/bucket reorder is insufficient.

## Real complexity

**3**, matching the story: transport lifecycle accounting, concurrent async work and regression
preservation need real integration tests, but no schema/UI/dependency change. H4, M6 and L22 fit
one server boundary. L21 is the explicit cut line; no further split is needed for this scope.
