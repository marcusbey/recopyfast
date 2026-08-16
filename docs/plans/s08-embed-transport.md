---
validated: no
---
# Plan — Story s08-embed-transport

Branch: `feature/s08-embed-transport`
Research: `docs/research/s08-embed-transport.md` — read it first; this plan does not repeat it.

## Target story

`s08-embed-transport` — *real-time without the 13KB* (`docs/stories.md:525-573`). Complexity 4,
confirmed at research. Dependencies as re-cut by the split (`stories.md:143-146`):
**`s07b-realtime-deploy`** (a running, reachable service to talk to) and
**`s06a-embed-byte-gate`** (the ceiling to test the artifact against).

[ADR 004](../decisions/004-embed-transport-split.md) is **binding and already decided the
approach**. It is not re-litigated here. What it settles, and this plan builds to:

- Embed widget → native `WebSocket`, 0 bundled bytes.
- Socket.io **stays mounted** for the first-party dashboard. It is not removed from
  `server/package.json` and `/socket.io` keeps working.
- `server/index.js` serves both **on separate endpoint paths**; the two protocols are never
  sniffed apart.
- **HTTP stays authoritative.** Realtime broadcasts; it is never a second write path.
- Old snippets carrying a Socket.io `data-ws-url` keep working.
- A **silent** degradation is a defect, not a graceful fallback.

**This story has no UI.** The only user-facing artefact is one console warning string.

### Two things the story's own criteria get wrong, carried as stated assumptions

**A1 — AC 1 (`≤ 30,000 bytes gzipped`) is not reachable in this story and is not this story's.**
Measured at research: artifact 46,781 gz, of which the concatenated socket.io accounts for
12,875 gz *as compressed in the bundle*. Removing it lands the artifact at **≈33,900 gz**, still
~3,900 over. That gap is `s06c-embed-shrink`'s, by construction — it is exactly why `s06` was
split from `s08` (`stories.md:77-79`). **s08's obligation is: zero bundled socket.io bytes, the
measured drop realised, and `s06a`'s ratchet lowered to the new measured artifact size.** The
30,000 ceiling is asserted by the gate, and the gate will still be above it when this story ends.
Do not shrink unrelated widget code to force AC 1 green — that is `s06c`, and doing it here
re-creates the complexity-5 story the split removed.

**A2 — AC 3 and AC 4 only cohere if "the two browsers" are both editing.** AC 3 says a page with
no editing session open opens **zero** WebSocket connections. AC 4 says the two-browser
under-1-second criterion from `s07` still passes — and `s07`'s wording is *"a second browser
**viewing** the same page"* (`stories.md:493`). Those cannot both be true. This is finding **M6**,
recorded as still open in `docs/reviews/stories.md:162-172` and in research
[Open questions §3]. **s08 resolves it in favour of its own AC 3**, which is the unambiguous one:
the propagation test runs with **both browsers holding an editing session** (each with
`rcf_token` or `rcf_edit_token`), and a third plain visitor tab asserts zero connections.
`s07b`'s AC 4 needs the same narrowing; that edit is not made here.

## Tasks (ordered)

Each task lands with its tests. Ticked as they land, travelling in the story's single commit.

---

### 1. Answer the one unverified question, then freeze the protocol as constants

- [ ] **Spike, in a real browser, both Chrome and Firefox.** Serve a fixture page over
      `http://127.0.0.1:<port>` with `Content-Security-Policy: connect-src 'self'` and record, for
      each of three cases, whether `new WebSocket(url)` **throws synchronously** and what the
      `error`/`close` events carry (`event.code`, `event.reason`, `event.wasClean`):
      **(a)** blocked by CSP, **(b)** server not listening, **(c)** server accepts then closes
      with code `4401`. Research could not establish this from the repo
      ([Open questions §2]) and **the shape of tasks 7-9 depends on the answer.**
- [ ] Record the nine results as a table in this file under this task. If (a) and (b) are
      indistinguishable — the expected outcome, both being `1006` with an empty reason — say so
      explicitly, because that is what forces the classification rule in task 9.
- [ ] **Freeze the protocol.** New `server/embed-ws-protocol.js` (server side) and a matching
      literal block in `public/embed/recopyfast.src.js`, both carrying the same constants:

  | | Value |
  |---|---|
  | Endpoint path | `/embed-ws/v1` — **version in the path**, so a load balancer can see it. Socket.io keeps `/socket.io`. |
  | The `join` | **The upgrade request itself.** `GET /embed-ws/v1?siteId&token&stagingMode&stagingToken&editToken`, plus the `Origin` header. There is no `join` frame. ADR 004:36-37 calls this a message; research proved the handshake query *is* the join today (`server/index.js:336`), and keeping that shape is what lets the existing auth chain be **moved, not re-derived**. |
  | C→S frames | `content-map`, `content-update` |
  | S→C frames | `content-update`, `ab-test-update`, `error`, `ping` |
  | Auth failure | **Close codes, not a frame.** `4400` malformed, `4401` bad site/token, `4402` invalid editor access, `4403` origin not allowed. The browser `WebSocket` API exposes no HTTP status from a failed handshake, so `close.code` is the *only* channel that can tell an auth failure apart from a network failure. All `44xx` are terminal. |
  | Envelope | JSON, `{ "t": "<name>", ... }`. |

  `ab-test-update` is in the list deliberately: the widget listens for it today
  (`recopyfast.src.js:2733` → `handleABTestUpdate:3182`) and `s11b`/`s11c` make it reachable
  again. Implementing ADR 004's literal three-message list silently deletes that hook.
  `update-error` is **not** carried: the server emits it today and no client has ever listened
  (research, message table). Its embed-relevant case is covered by the `error` frame.

**Verifiable by:** `src/__tests__/websocket/embed-protocol.test.ts` reads both files and asserts
the four close codes and the six frame names are byte-identical across them. The spike's recorded
close codes are the constants task 10's e2e asserts against — if the spike is wrong, task 10 fails.

---

### 2. Extract the upgrade authorizer into a testable module

- [ ] New `server/embed-ws.js`, exporting `authorizeUpgrade(req, deps)` →
      `{ ok: true, siteId, room, data }` | `{ ok: false, code, reason }`.
- [ ] The body is `server/index.js:340-419` **moved, not rewritten**: require `siteId` → require
      `token` → look up the site → `verifySiteToken` → `parseHost(req.headers.origin ||
      req.headers.referer) === normalizeDomain(site.domain)` → optional
      `validateStagingAccess` / `validateEditSessionAccess` → `normalizePermissions` → room
      `site:{id}:staging` or `site:{id}`. `socket.handshake` does not exist on a native upgrade;
      the origin comes off `req.headers`.
- [ ] `server/index.js` is left importing these helpers rather than holding two copies. Commit
      `3099c07` tightened the per-site origin check (`:373-380`); a second copy is how it regresses.

**Verifiable by:** `src/__tests__/websocket/embed-upgrade.test.ts` — no `siteId` → `4400`; no
token → `4401`; forged token → `4401`; `Origin` host ≠ registered domain → `4403`; expired
staging token → `4402`; valid staging token → `ok`, room `site:{id}:staging`, permissions
normalised. `server/` is in `testPathIgnorePatterns`, so the test lives under `src/__tests__/`
and imports the module by relative path — which is only possible because it is a module with no
side effects, unlike `server/index.js`.

---

### 3. Mount the native endpoint beside Socket.io on the same server

- [ ] `attachEmbedWebSocket(httpServer, io, deps)` in `server/embed-ws.js`:
      `new WebSocketServer({ noServer: true })` + an explicit `httpServer.on('upgrade')` handler
      that claims **only** `/embed-ws/v1` and returns without touching anything else.
- [ ] Add `destroyUpgrade: false` to `new Server(httpServer, {...})` at `server/index.js:215`.
      engine.io `socket.end()`s any upgrade it does not recognise 1,000 ms after it arrives
      (`node_modules/engine.io/build/server.js:676-693`), guarded only by
      `socket.bytesWritten <= 0` — a completed `ws` handshake survives **by accident**. This is
      research trap **T3** and the single most likely cause of "works locally, drops after a
      second in production". Leave a tombstone comment saying so.
- [ ] An unauthorized upgrade **completes the handshake, then closes with the code and reason**
      from task 2 — it does not `socket.destroy()`. A destroyed upgrade reaches the browser as
      `1006` with no reason, which is exactly what a CSP block and a dead server also produce, and
      the widget would be unable to tell a revoked grant from a network blip. Comment the
      trade-off: an unauthenticated socket exists for one tick, deliberately.
- [ ] Declare `ws` in `server/package.json` (resolvable today only transitively via engine.io).
      **Do not remove `socket.io`.**

**Verifiable by:** `src/__tests__/websocket/embed-mount.test.ts`, against a real `http.Server`
with both mounts attached: `/socket.io` still upgrades; `/embed-ws/v1` upgrades and authorises;
`/anything-else` is refused; **an idle authorised native connection is still `OPEN` after
2,000 ms** (the T3 regression test); a forged token yields `close.code === 4401` with a non-empty
reason.

---

### 4. Route the embed frames, and fan out across both transports

- [ ] `content-map` and `content-update` handlers reuse the bodies at `server/index.js:436` and
      `:501` — same per-message token re-check, same non-staging refusal (`:519-525`), same
      permission check, same `sanitizeContent`, same **`!data.persisted` skip (`:541`)**.
- [ ] **No acks.** Native `WebSocket` has no ack primitive (research **T2**), and
      `emitRealtimeContentUpdate`'s 2-second ack (`:2669-2681`) only ever produced a
      `console.warn` — it changes no state, because HTTP has already persisted before the fanout
      is emitted. Correlation ids would cost bytes against a budget already over. The server's
      `reply()` stays (harmless: `ack` is `undefined` on the native path); refusals additionally
      send an `error` frame so the failure is not silent.
- [ ] **`broadcastToRoom(room, frame, payload, exceptClient)`** in `server/embed-ws.js`, replacing
      the direct `socket.to(room).emit(...)` calls at `:589`, `:601`, `:610` and `:1147`. Socket.io
      rooms are internal to Socket.io — a native client is not in one. Without this, a Socket.io
      editor and a native editor on the same page never see each other. Native clients get their
      own room registry beside `siteConnections` (`:238-239`), and `exceptClient` reproduces
      `socket.to()`'s sender exclusion.
- [ ] **Heartbeat (research T8, in neither the story nor the ADR).** Server sends
      `{"t":"ping"}` every 25 s to every native client, and separately runs the standard `ws`
      protocol-level `ping` + `isAlive` sweep to reap dead sockets. The app-level frame exists
      because browser JS **cannot observe a protocol-level ping** — without an inbound frame the
      widget's liveness timer (task 7) fires on a healthy but quiet connection. The widget does
      not reply; `ping` is one-directional and costs the widget one line.

**Verifiable by:** `src/__tests__/websocket/embed-frames.test.ts` — a native client receives a
`content-update` broadcast originated by a Socket.io client in the same room, and vice versa; the
originating client does not receive its own; a non-staging `content-update` is refused with an
`error` frame and writes nothing; `persisted: true` writes nothing; a client that answers no
protocol pong for two intervals is closed; a client receives a `ping` frame within 30 s of
connecting.

---

### 5. Widget: delete the socket.io surface and speak native WebSocket

**All of the deletions in this task land together.** Removing the build's concatenation
(task 9) without removing `SOCKET_IO_FALLBACK_URL` turns a cold trap hot: `getSocketIOFactory()`
returns null and `loadSocketIO()` starts appending a **cross-origin `<script>` to every
customer's `document.head`** (`:2771-2786`) — the exact bug `scripts/build-embed.mjs:5-8` was
written to kill. Research trap **T6**.

- [ ] Delete `SOCKET_IO_FALLBACK_URL` (`:58-68`), `getSocketIOFactory` (`:71-77`), `loadSocketIO`
      (`:2758-2788`), and the socket.io body of `establishConnection` (`:2687-2756`).
- [ ] **Move the tombstones, do not drop them.** `:49-56` ("socket.io must never come from a
      third-party CDN") becomes "the transport must never be *fetched* at all, from anywhere —
      here is what fetching it from our own origin costs on a `script-src 'self'` customer".
      `:2690-2702` and `:2823-2832` (register F-10, the `sendBuffer` leak) both still apply and
      must be rewritten against the new code, not deleted. AGENTS.md → Comments; research **T12**.
- [ ] New `RealtimeTransport` inside the widget's IIFE: `new WebSocket(RECOPYFAST_WS +
      '/embed-ws/v1?' + query)` inside a `try`; `onopen` → reset backoff, `sendContentMap()`;
      `onmessage` → `JSON.parse` inside a `try`, dispatch `content-update` →
      `handleContentUpdate`, `ab-test-update` → `handleABTestUpdate`, `error` → one
      `console.warn`, `ping` → reset the liveness timer and nothing else.
- [ ] `send(frame)` **no-ops unless `readyState === OPEN`.** It never queues. `sendContentMap`
      already checks `connected` rather than non-null for exactly this reason
      (`:2833`, tombstone at `:2823-2832`): socket.io's `sendBuffer` grew a full content map per
      MutationObserver rescan against an origin that never connected.
- [ ] `emitRealtimeContentUpdate` (`:2663-2685`) keeps its position **after** the HTTP write in
      `persistContentUpdate` (`:2632-2658`) and keeps sending `persisted: true`. ADR 004 rule 1.
- [ ] `sendContentMap`'s HTTP-first ordering (`:2821` `postContentMap` before any fanout) is
      untouched.

**Verifiable by:** `src/__tests__/embed/transport-frames.test.ts` with a stubbed `global.WebSocket`
— each inbound frame reaches its handler; an unknown `t` is ignored; malformed JSON does not
throw; `send()` while `CONNECTING` drops the frame and nothing is flushed on open. Plus
`src/__tests__/embed/no-socket-io.test.ts`, a source-and-artifact assertion: neither
`recopyfast.src.js` nor `recopyfast.js` contains `socket.io`, `__recopyfastSocketIO`, or
`socket.io-client.min.js` (this is AC 2's mechanical form).

---

### 6. Widget: connect only for an editing session, and only once

- [ ] `establishConnection()` is removed from `init()`'s unconditional path (`:908`) and reached
      only through a single guarded entry point that returns early unless an editing session is
      active. `sendContentMap()` at `:919` stays unconditional — that is register F-10's fix and
      it is not a socket concern.
- [ ] Edit mode is not always known by the end of `init()`: `:994` and `:1578` both set
      `editMode = true` **after** an async verification overlay. The guarded entry is called from
      those sites too, and is **idempotent** — a second call while a socket is open or connecting
      is a no-op.
- [ ] `destroy()` (`:5138-5141`): `.disconnect()` → `.close()`, and **clear the polling
      interval**. `startPolling()` (`:5107-5132`) discards its `setInterval` handle today and
      nothing can stop it — research **T5**. Capture the handle, guard against a second interval,
      clear it in `destroy()`.

**Verifiable by:** `src/__tests__/embed/connect-gating.test.ts` — a page with no `rcf_token` and
no `rcf_edit_token` constructs `WebSocket` **zero** times (AC 3); a staging page constructs it
exactly once even when `init()` and the late activation path both run; `destroy()` calls
`close()` and `clearInterval`; `startPolling()` called twice creates one interval.

---

### 7. Widget: reconnection — jittered, capped, terminal on 44xx

Socket.io supplied this for free (`reconnection: true, reconnectionDelay: 1000,
reconnectionAttempts: 5` at `:2719-2721`). Native supplies none. Written wrong, a routine deploy
silently ends every open editing session.

- [ ] Delay = `Math.random() * Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** attempt)`.
      Full jitter, named constants (base 1,000 ms, cap 30,000 ms). **Not** a fixed delay, and not
      a jitter added to a fixed delay — a synchronised herd of reconnects after a deploy is the
      thing jitter exists to prevent.
- [ ] Retries are unlimited **while the editing session is open**, and stop on `destroy()`. A
      server restart must not end the session (AC 7), so a fixed attempt count fails the criterion.
- [ ] **A close code in `44xx` is terminal.** No timer is scheduled; in staging,
      `showStagingError(event.reason)` is called — that is the surface `auth-error` drove at
      `:2745-2750` and it must not be lost. A revoked or expired grant that reconnects forever is
      a hammer, not a fallback.
- [ ] On reconnect the credentials travel on the upgrade again (task 1), so re-authorisation is
      automatic; `onopen` re-sends the content map, preserving the `connect`-handler wiring at
      `:2726`.
- [ ] **Liveness:** no inbound frame for 60 s → `close()` → the reconnect path. Without this a
      proxy idle timeout (Fly/Railway/Render idle at ≤ 60 s) kills the connection with no `close`
      event, so reconnection never fires and the session dies in silence. Research **T8**.

**Verifiable by:** `src/__tests__/embed/reconnect-backoff.test.ts` with fake timers and a seeded
`Math.random` — every scheduled delay lies in `[0, min(cap, base * 2**n)]`; after 20 attempts the
delay never exceeds the cap; two runs with different random sequences produce different delays
(proves the jitter is real and not a constant); a `4401` close schedules **no** timer and calls
`showStagingError` once in staging; a `1006` close after a successful open schedules a timer and
the subsequent `onopen` re-sends the content map; advancing 60 s with no inbound frame closes the
socket, and a `ping` frame at 30 s prevents that.

---

### 8. Widget: the degradation path — exactly one warning, and editing still works

- [ ] One `warnRealtimeUnavailable()` behind a once-per-page flag. Called from **both** the
      synchronous `new WebSocket(...)` throw and the asynchronous failure path, per task 1's
      recorded browser behaviour. Both converge on the same call; neither can double-warn.
- [ ] The wording is a committed constant, and it does **not** assert CSP as the cause — a CSP
      block and a cold server are indistinguishable to the page (see *The point everything turns
      on*). It names the symptom, states editing still works, and names the fix:

      `ReCopyFast: real-time sync unavailable — falling back to HTTP. Editing and saving still
      work. If this page sends a Content-Security-Policy, allow connect-src <ws-origin>.`

- [ ] After `MAX_COLD_FAILURES` consecutive failures where **`onopen` has never once fired**, stop
      retrying and stay on the HTTP path for the rest of the page's life. A connection that had
      opened and then dropped is a different case and keeps retrying (task 7).
- [ ] The degraded path is edit-session-scoped like everything else, so a `connect-src 'self'`
      customer does not trade one WebSocket per visitor for one poll per visitor (research **T5**).
- [ ] Nothing may reach the host `window`. `onerror`/`onclose` fire **outside** `init()`'s
      `try/catch` by definition (research **T11**, AGENTS.md non-negotiable 4); every handler
      carries its own.

**Verifiable by:** `src/__tests__/embed/csp-degradation.test.ts` — a `WebSocket` constructor that
throws produces **exactly one** `console.warn` whose text equals the constant, and
`persistContentUpdate` still saves over HTTP afterwards; `MAX_COLD_FAILURES` async `1006` closes
produce **exactly one** warning in total, and no timer is scheduled afterwards; a `window.onerror`
and an `unhandledrejection` spy record **zero** events across every case in tasks 5-8. Asserting
`toHaveBeenCalledTimes(1)` is the criterion: zero fails it just as loudly as two.

---

### 9. Build: stop bundling socket.io, delete the fallback file, lower the ratchet

- [ ] `scripts/build-embed.mjs`: remove `buildSocketIo()` (`:77-94`), `SOCKET_GLOBAL` (`:52`), the
      concatenation (`:225`), the `SOCKET_OUT` write (`:229`), the `Bundled socket.io-client:`
      banner line (`:157`) and the `fallback` size line (`:243`).
- [ ] Delete `public/embed/socket.io-client.min.js`. Grep the repo first and confirm nothing else
      fetches it; a 42 KB same-origin socket.io left lying next to the widget is a standing
      invitation to task 5's trap.
- [ ] **Rewrite the file header (`:5-8`), do not delete it.** It is the load-bearing record of why
      socket.io was inlined. The replacement says: the widget speaks native `WebSocket` because it
      costs zero bytes *and* because any fetched transport — from a CDN **or from our own
      origin** — is blocked by a customer's `script-src 'self'`, our origin not being their
      `'self'`. Keep the layout block, minus the deleted file.
- [ ] `npm run build:embed`, then measure with `gzip -9c public/embed/recopyfast.js | wc -c` and
      **record the number in this file**. Lower `s06a`'s ceiling constant to it. The ratchet only
      ever goes down (`stories.md` `s06` AC 3).
- [ ] Note the compressor. Research [Open questions §5]: `gzip -9c` reports 33,906 for the widget
      where Node's `zlib` level 9 reports 34,063 — a 157-byte difference in tooling, not content.
      Use whichever `s06a` committed, and say which in the commit message.

**Verifiable by:** the `no-socket-io` artifact assertion from task 5; `node
scripts/build-embed.mjs --check` still fails on a hand-edited artifact; the `s06a` gate fails when
the ceiling is exceeded and passes at the recorded value; `git status` shows
`socket.io-client.min.js` deleted and `recopyfast.js` rebuilt in the same commit.

---

### 10. e2e: the CSP matrix, on an origin that is not ours

The failure this story is about is invisible on a developer's machine and on our own domain. It
has to be **executed** under each policy, not reasoned about.

- [ ] A local static server inside the test, on `http://127.0.0.1:<port>` — a genuinely foreign
      origin — serving three fixture pages that differ only in their response header:
      **(A)** no CSP, **(B)** `Content-Security-Policy: script-src 'self'`,
      **(C)** `Content-Security-Policy: connect-src 'self'`. Each fixture is loaded twice: once as
      a plain visitor, once with an `rcf_edit_token` query parameter.
- [ ] The fixture site row's registered domain is `127.0.0.1`, so the server's per-site origin
      check (`server/index.js:373-380`, tightened by `3099c07`) is exercised rather than bypassed.
- [ ] `e2e/embed-transport-csp.spec.ts` asserts, per cell:

  | Fixture | Visitor | Editing session |
  |---|---|---|
  | **A** no CSP | 0 WebSocket connections | connects; an edit propagates to a second editing browser in < 1 s (AC 4, per assumption **A2**) |
  | **B** `script-src 'self'` | 0 connections; the widget script still executed | connects and syncs (AC 5) — this is the criterion the whole transport choice exists for |
  | **C** `connect-src 'self'` | 0 connections; **0 warnings** (nothing was attempted) | 0 connections; **exactly 1** console warning equal to task 8's constant; a save round-trips over HTTP and the content is readable back (AC 6) |

- [ ] Every cell additionally asserts **zero** `pageerror` events (AC 8) and that the fixture's own
      authored copy is intact.
- [ ] A server-restart cell: with an editing session open on fixture A, restart the WS service and
      assert the session resumes without a reload (AC 7).

**Verifiable by:** the spec itself. A cell that passes because nothing was asserted is the failure
mode here — every cell asserts a count, never a truthiness.

## Run interdicts

- **Never fetch the transport.** Not from `cdn.socket.io`, not from `/embed/socket.io-client.min.js`, not from anywhere. Our origin is not the customer's `'self'`; `build-embed.mjs:5-8` records what that cost last time.
- **Do not delete `SOCKET_IO_FALLBACK_URL`, `getSocketIOFactory`, `loadSocketIO` and the build concatenation separately.** In the gap the trap goes live and the widget injects a cross-origin `<script>` onto every customer page.
- **Never queue a frame while `readyState !== OPEN`.** The `sendBuffer` tombstone at `recopyfast.src.js:2823-2832` is an unbounded leak, not a style note.
- **The WebSocket is never a write path.** HTTP persists first, the fanout carries `persisted: true`, and `server/index.js:541` must keep skipping the write. ADR 004 rule 1.
- **Never open a connection for a visitor.** The connect call is reachable only from an active editing session — AC 3 says *zero*, not *few*.
- **Never retry a `44xx` close.** A revoked or expired grant that reconnects forever is a hammer aimed at our own service.
- **Never use a fixed reconnect delay.** The jitter is `Math.random()`-scaled and the cap is a named constant; a synchronised herd after a deploy is what jitter prevents.
- **Exactly one console warning on degradation — never zero, never two.** A silent degradation fails AC 6 outright; the test asserts a count.
- **Every `onerror` / `onclose` / `onmessage` handler carries its own try/catch.** They fire outside `init()`'s boundary by construction. AGENTS.md non-negotiable 4.
- **Never edit `public/embed/recopyfast.js`.** Edit `recopyfast.src.js`, then `npm run build:embed`. AGENTS.md non-negotiable 1.
- **Do not remove `socket.io` from `server/package.json` or unmount `/socket.io`.** ADR 004 keeps it; old cached artifacts still speak it.
- **Do not modify an existing test to accommodate the transport change.** Change the behaviour, or change the test and say so in the PR. AGENTS.md → Tests.
- **Do not restate the byte ceiling in this plan, the story, or the widget.** `s06a` owns that constant; a second copy drifts.
- **Do not shrink unrelated widget code to make AC 1 go green.** That is `s06c`. See assumption **A1**.

## The point everything turns on

**The widget cannot tell "the customer's CSP blocked me" from "the server is down".** Both arrive
as a `close` event with code `1006`, an empty reason, and `wasClean === false`. The browser prints
its own CSP violation message, but that is the browser's, not ours — AC 6 asks the *widget* to say
it, and the widget cannot read that console line.

Every remaining decision in this story is downstream of that one fact:

- Treat every failure as *retry with backoff* → the `connect-src 'self'` customer gets a silent
  infinite retry loop and no warning. **AC 6 fails silently** — the precise failure mode the story
  says it exists to prevent.
- Treat every failure as *CSP, warn and degrade* → a transient blip permanently kills a healthy
  editing session and warns wrongly. **AC 7 fails.**

The resolution is to classify on the one signal that *is* observable: **whether the socket ever
reached `onopen`.** Repeated immediate failures with no open ever having occurred → cold, treated
as blocked: warn once, stop, degrade to HTTP. A close after a successful open → a drop: back off
and retry forever. And because auth failure must be distinguishable from both, the server accepts
the upgrade and then closes with a `44xx` code rather than destroying the socket — close codes are
the only channel the browser exposes.

**Where this could be wrong, in three places:**

1. **The classification is a heuristic, not a fact.** A customer whose WS service is merely down
   gets the "real-time unavailable" warning too. That is why task 8's wording must not assert CSP
   as the cause. If the wording says "your CSP is blocking us" and the real cause is our own
   downtime, we have shipped a support ticket that blames the customer.
2. **The sync-versus-async question is genuinely unverified.** Research could not establish from
   the repo whether `new WebSocket(url)` under a blocking `connect-src` throws a `SecurityError`
   synchronously or fails asynchronously, and it is plausibly different in Chrome and Firefox. Get
   it wrong one way and the warning never fires (silent failure, AC 6 fails); get it wrong the
   other way and it fires twice (AC 6 also fails, since it says *one*). **Task 1 exists solely to
   remove this guess**, and both paths must converge on the same once-guarded function regardless
   of the answer.
3. **`MAX_COLD_FAILURES` is a guess about a customer's network, not about their CSP.** Set it too
   low and a customer on a slow or flaky first connection is permanently degraded on a page that
   would have worked. Set it too high and the warning arrives long after the editor gave up. It is
   a named constant so it can be moved without archaeology.

## Files touched

**Widget (source only — `recopyfast.js` is generated)**

- `public/embed/recopyfast.src.js` — delete `:58-68`, `:71-77`, `:2758-2788`; rewrite
  `:2687-2756`; adjust `:908`, `:919`, `:2663-2685`, `:2833-2842`, `:5107-5132`, `:5138-5141`;
  move the tombstones at `:49-56`, `:2690-2702`, `:2823-2832`. **Do not touch** `:2790-2822`
  (HTTP-first ordering) or `:2853-2954` (`postContentMap`, the authoritative write path).

**Build**

- `scripts/build-embed.mjs` — header `:5-8`, `:13`, `:52`, `:77-94`, `:157`, `:213-218`, `:225`,
  `:229`, `:242-243`.
- `public/embed/socket.io-client.min.js` — **deleted**.
- `public/embed/recopyfast.js` — rebuilt artifact.
- `s06a`'s ceiling constant — lowered (file named by `s06a`; do not create a second one).

**Server**

- `server/embed-ws.js` — **new.** `authorizeUpgrade`, `attachEmbedWebSocket`, `broadcastToRoom`,
  the native room registry, the heartbeat.
- `server/embed-ws-protocol.js` — **new.** Frame names and close codes.
- `server/index.js` — `:215-221` (`destroyUpgrade: false`), `:43` (attach), `:238-239` (native
  registry beside `siteConnections`), `:340-419` (moved into the module, called from both
  transports), `:589`, `:601`, `:610`, `:1147` (→ `broadcastToRoom`). **Do not touch** `:373-380`
  (per-site origin, `3099c07`), `:519-525` (non-staging refusal), `:541` (`!data.persisted`).
- `server/package.json` — add `ws`. `socket.io` stays.

**Tests** (all new; no existing test is modified)

- `src/__tests__/websocket/embed-protocol.test.ts`
- `src/__tests__/websocket/embed-upgrade.test.ts`
- `src/__tests__/websocket/embed-mount.test.ts`
- `src/__tests__/websocket/embed-frames.test.ts`
- `src/__tests__/embed/transport-frames.test.ts`
- `src/__tests__/embed/no-socket-io.test.ts`
- `src/__tests__/embed/connect-gating.test.ts`
- `src/__tests__/embed/reconnect-backoff.test.ts`
- `src/__tests__/embed/csp-degradation.test.ts`
- `e2e/embed-transport-csp.spec.ts` + its fixture pages

**Not touched:** `src/lib/sites/embed-script.ts` (the snippet shape carries no protocol, and
`/embed/recopyfast.js` is a permanent URL), `src/middleware.ts`, `src/lib/collaboration/realtime.ts`.

## Test strategy

The story's own risk paragraph is the strategy: *"a transport that works in development and on our
own domain can fail only on customers serving a restrictive CSP — the exact customers least likely
to file a useful bug report."* So the suite is built in three layers, and **the CSP layer is not
optional**.

**Layer 1 — Jest, jsdom, widget, with a stubbed `global.WebSocket`.** This is where the counts
live, because counts are what the criteria are made of: connections opened (`0` for a visitor, `1`
for an editor), warnings emitted (`exactly 1` on degradation), timers scheduled (`0` after a
`44xx`), `pageerror`s (`0` everywhere). A stub gives deterministic control over throw-vs-async,
close codes, and timing that a real browser cannot. jsdom 26 provides `WebSocket`, so the stub is
an explicit override, not a polyfill.

**Layer 2 — Jest, server modules.** Possible only because tasks 2-4 extract `server/embed-ws.js`
as a side-effect-free module; `server/index.js` starts listening on import and `server/` is in
`testPathIgnorePatterns`. The existing `src/__tests__/websocket/server.test.ts` (WS-001…WS-022)
asserts handshake *shapes* without booting anything and **will not catch a transport regression** —
it is not the safety net here and it is not modified.

**Layer 3 — Playwright, three CSP variants, on `127.0.0.1`.** The only layer that can falsify AC 5
and AC 6, because the policy has to be a real response header interpreted by a real browser on an
origin that is not ours. Both the visitor row and the editor row are run for each policy: the
visitor row is what proves AC 3, and it is the row most likely to be skipped.

Three things the strategy deliberately covers that neither the story nor the ADR mentions, and
which research found: **the shared-upgrade destroy** (T3 — the 2,000 ms idle assertion in task 3),
**the idle timeout** (T8 — the 60 s liveness assertion in task 7), and **the cross-transport
fanout** (task 4 — two protocols in one room, which nothing else would exercise).

Coverage thresholds in `jest.config.js` are a ratchet: they go up with these tests, never down.

## Definition of Done

- [ ] Task 1's browser table is recorded in this file, and the widget's classification matches it.
- [ ] `public/embed/recopyfast.js` contains no socket.io client; `public/embed/socket.io-client.min.js` is deleted; nothing in the repo references it. *(AC 2)*
- [ ] The new artifact size is measured, recorded here with its compressor, and `s06a`'s ratchet is lowered to it. **AC 1's 30,000 ceiling is still breached at ≈33,900 and is `s06c`'s** — see assumption **A1**. The gate is green against the lowered ratchet, not against 30,000.
- [ ] A visitor page with the script installed opens **zero** WebSocket connections, asserted under all three CSP variants. *(AC 3)*
- [ ] Two browsers **both holding an editing session** propagate an edit in under 1 s against a fixture on a non-RecopyFast origin — assumption **A2** applies. *(AC 4)*
- [ ] Sync works under `script-src 'self'`. *(AC 5)*
- [ ] Under `connect-src 'self'`: exactly one console warning matching the committed constant, a successful HTTP save, and readable-back content. *(AC 6)*
- [ ] A dropped connection reconnects with delays provably inside the jittered capped envelope; a server restart does not end an open editing session; a `44xx` close is terminal. *(AC 7)*
- [ ] Zero `pageerror` / `unhandledrejection` events across every case above. *(AC 8)*
- [ ] `/socket.io` still upgrades and an old cached artifact still connects; `destroyUpgrade: false` is set and an idle native connection survives 2 s. *(ADR 004; T3)*
- [ ] HTTP remains authoritative: with the WS service stopped, editing, saving, staging and publishing all still work with no user-visible error. *(ADR 004 rule 2 — re-run after every change to either transport)*
- [ ] `lint`, `type-check`, `format:check`, `build`, `test`, `test:e2e` green. No existing test modified.
- [ ] Tombstones moved, not dropped: the CDN incident, register F-10, and the `sendBuffer` leak each still have a comment anchored to the new code.
- [ ] One commit on `feature/s08-embed-transport`, carrying research and this plan.
