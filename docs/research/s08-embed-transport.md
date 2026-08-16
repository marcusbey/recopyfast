# Research — Story s08-embed-transport

> ⚠️ **Warning, recorded as instructed.** `docs/reviews/stories.md` ends with
> `Max severity: major` / `Stories ready: no`. The operator confirmed proceeding anyway.
> Three of that review's findings are **still open in `docs/stories.md` as committed today**
> and they land squarely on this story — M6 (who holds a connection), M5 (`s14` socket
> revocation ownership) and m5 (protocol back-compat). They are carried into
> [Open questions](#open-questions) rather than silently resolved here.

> **Method.** Every claim below was checked against the code in this working tree on
> 2026-08-16 at `a23aca0`. Byte figures were produced with a shell in this session. Nothing
> here is recalled from the ADR or from the story text — where they disagree with the code,
> the code is reported and the disagreement is named.

---

## ⛔ False premises in the framing docs — read before anything else

The story's **central** premise is TRUE and verified. Two supporting premises are FALSE.

### ✅ TRUE — the lazy-load trap is live in the code

`ADR 004` and `stories.md:455-458` claim `recopyfast.src.js:64` derives a
`socket.io-client.min.js` URL from the script's own `src`, and that this is a live trap.
**Confirmed, and worse than stated: the derived URL is not dead code — it is injected as a
`<script>` element.**

- `public/embed/recopyfast.src.js:58-68` — `SOCKET_IO_FALLBACK_URL` rewrites the last path
  segment of `EMBED_SCRIPT_SRC` to `socket.io-client.min.js`. Line 64 is the `pathname.replace`.
- `public/embed/recopyfast.src.js:2766-2786` — `loadSocketIO()` creates a `<script>`, sets
  `script.src = SOCKET_IO_FALLBACK_URL`, sets `crossOrigin = 'anonymous'`, and appends it to
  `document.head`. This is a cross-origin script element on the customer's page.
- The target is reachable: `public/embed/socket.io-client.min.js` exists (42,162 raw), is
  written on every build (`scripts/build-embed.mjs:229`), and `/embed/**` is served with
  security headers but no session work (`src/middleware.ts:69-83`).
- Today the path is cold — the bundle concatenates socket.io first (`build-embed.mjs:225`) so
  `getSocketIOFactory()` (`recopyfast.src.js:71-77`) returns before the fallback runs. Remove
  the concatenation without removing lines 58-68 and 2758-2788, and the widget starts injecting
  a cross-origin `<script>` on every customer page — the exact bug
  `scripts/build-embed.mjs:5-8` says it was written to kill.

### ❌ FALSE — "the embed↔server protocol is three messages: `join`, `content-map`, `content-update`"

`ADR 004:36-37` and `reviews/stories.md:199` both state this. **There is no `join` message.**

Room membership is decided server-side from the Socket.io **handshake query string**, never
from a message: `server/index.js:336` destructures
`{ siteId, editMode, token, stagingMode, stagingToken, editToken }` off
`socket.handshake.query`, authorises at `:340-419`, and joins the room at `:422-427`. The
widget supplies those in `io(RECOPYFAST_WS, { query: {...} })` at `recopyfast.src.js:2710-2718`.

A `join` message is a reasonable *design* for native WebSocket (the browser `WebSocket`
constructor cannot set headers, so a first frame is one way to carry credentials), but it is
**not a description of today's code**, and the real message list is longer:

| Direction | Message | Where | Notes |
|---|---|---|---|
| C→S | *(handshake query)* | `recopyfast.src.js:2711` → `server/index.js:336` | carries siteId, token, stagingMode, stagingToken, editToken, editMode. **This is the `join`.** |
| C→S | `content-map` | `:2834` → `server/index.js:436` | fire-and-forget, no ack |
| C→S | `content-update` | `:2670`, `:2676` → `server/index.js:501` | **has an ack callback with a 2 s socket.io timeout** |
| S→C | `content-update` | `server/index.js:591`, `:601` → `:2729` | the fanout |
| S→C | `ab-test-update` | `server/index.js:1147` → `:2733` | **omitted from the ADR entirely** |
| S→C | `auth-error` | `server/index.js:346…:408` → `:2745` | drives `showStagingError` in staging |
| S→C | `update-error` | `server/index.js:520, 532, 558, 622` | **server emits it; the widget has no listener.** Dead on the wire today |

So the ADR is short by two consumed inbound messages and by the ack channel, and its `join`
does not exist. `emitRealtimeContentUpdate` (`:2663-2685`) uses
`this.socket.timeout(2000).emit(..., cb)` — native `WebSocket` has **no ack primitive**.
Replacing it needs either a correlation-id request/response layer or an explicit decision to
drop the ack. The ADR does not mention this and the story does not budget for it.

### ❌ FALSE — "First-party dashboard → Socket.io, unchanged"

`ADR 004:38-40` frames the whole decision as a split *by audience*. **There is no first-party
Socket.io consumer.** The audience it is being split from does not exist.

- The only Socket.io client in `src/` is `src/lib/collaboration/realtime.ts:1,89`
  (`CollaborationRealtime`). Its singleton is exported at `:475` and **imported by nothing
  outside `src/__tests__/`** — and the one integration test that names it (`src/__tests__/
  integration/collaboration.test.tsx:12-19`) `jest.mock()`s it away. No component, no hook,
  no page imports it.
- It also speaks a protocol `server/index.js` does not implement: it emits `join-site`
  (`realtime.ts:105`) and expects `presence-*`, `content-editing`, `edit-conflict`. Grepping
  `server/index.js` for `join-site`, `presence`, `content-editing`, `edit-conflict` returns
  **zero hits**. It could not work if it were wired up.
- Its default production URL is the literal placeholder
  `"wss://your-production-ws-server.com"` (`realtime.ts:86`).
- The server's own dashboard room is joined by `join-dashboard` (`server/index.js:628`), which
  has **zero clients** anywhere in `src/` or `public/`.
- `teams`/`collaboration_*` tables are in the PRD **graveyard** (`architecture.md:244-247`),
  which is where this module's feature set lives.

**Counted:** 7 of the server's 10 `socket.on` handlers have no client anywhere in the repo —
`join-dashboard`, `bulk-update`, `switch-language`, `restore-version`, `activate-theme`,
`staging-publish`, `ab-test-status-change`. Only `content-map`, `content-update` and
`disconnect` are reachable, and all three are reached by the embed widget alone.

Consequence for this story: the ADR's "keep Socket.io where it costs nothing" preserves a
server dependency with **no live consumer on either side**. That does not invalidate the
decision to use native `WebSocket` in the embed — that part stands on the CSP and byte
arguments, which are both verified. It does mean the "two protocols on one service" cost the
ADR accepts under *Consequences* may be avoidable. Raised as an open question, not decided
here.

---

## The five structuring facts

1. **The trap is live and it injects a script tag** — `public/embed/recopyfast.src.js:58-68`
   derives the URL, `:2771-2786` appends `<script src=…>` to the customer's `document.head`.
2. **There is no `join` message; the handshake query is the join** —
   `public/embed/recopyfast.src.js:2711-2718` → `server/index.js:336`, joined at `:422-427`.
3. **`content-update` is acknowledged with a 2 s timeout, and native `WebSocket` has no acks** —
   `public/embed/recopyfast.src.js:2669-2681` ↔ `server/index.js:502-506, 618`.
4. **The widget connects for every visitor, not only editors** —
   `public/embed/recopyfast.src.js:908` calls `establishConnection()` unconditionally in
   `init()`; `:2703` gates on `RECOPYFAST_WS` alone and `:2713` passes `editMode` as a mere
   query param.
5. **engine.io kills unclaimed upgrades on the same server after 1 s** —
   `node_modules/engine.io/build/server.js:676-694`: any `upgrade` whose path is not
   `/socket.io` is `socket.end()`ed unless `destroyUpgrade: false` is set.

---

## Target story

`s08-embed-transport` — *real-time without the 13KB* (`docs/stories.md:418-464`).

> **As a** site owner **I want** real-time editing that does not cost my visitors a payload
> **so that** I get the feature without paying for it on every page load.

**Stated complexity: 4.** Dependencies: `s07-realtime-service`, `s06-embed-budget-gate`.

### Acceptance criteria, verbatim (`stories.md:434-442`)

- [ ] `public/embed/recopyfast.js` is ≤ 30,000 bytes gzipped, enforced by `s06`'s build gate.
- [ ] The widget contains no bundled socket.io client.
- [ ] A page with the script installed and no editing session open opens zero WebSocket connections.
- [ ] Entering edit mode establishes sync, and the two-browser under-1-second criterion from `s07` still passes.
- [ ] Sync works on a host page served with `Content-Security-Policy: script-src 'self'`.
- [ ] On a host page served with `connect-src 'self'`, the widget degrades to the HTTP path, logs one explicit console warning, and editing still works — a silent failure fails this criterion.
- [ ] A dropped connection reconnects with jittered exponential backoff, capped, and a server restart does not end an open editing session.
- [ ] No uncaught exception reaches the host page's window under any of the above.

### What is binding on top of the story

`docs/decisions/004-embed-transport-split.md` (accepted, 2026-08-16). It settles:

- Embed → native `WebSocket`, 0 bytes (`:35-37`).
- Dashboard → Socket.io retained (`:38-40`) — **see the false-premise section; the dashboard
  has no Socket.io consumer.**
- `server/index.js` serves both **on separate endpoint paths** so protocols are never sniffed
  apart, and old Socket.io `data-ws-url` snippets keep working (`:41-42`).
- **Rule 1 — HTTP stays authoritative.** Real-time broadcasts; it never becomes a second write
  path (`:46-48`). Matches the code: `persistContentUpdate` (`recopyfast.src.js:2625`) writes
  over HTTP first (`:2632-2648`), *then* calls `emitRealtimeContentUpdate` with
  `persisted: true` (`:2649-2658`), and the server skips its own write when it sees that flag
  (`server/index.js:541`).
- **Rule 2 — realtime is provably additive.** With the service stopped, editing/saving/
  staging/publishing all still work (`:49-51`).
- **A silent degradation is a defect, not a graceful fallback** (`:84-86`).

---

## Current state of the code

### Real-time is off in production, end to end

- `src/lib/sites/embed-script.ts:63-81` — `getPublicWebSocketUrl()` returns `""` when
  `NEXT_PUBLIC_WS_URL` is unset (the one exception is `localhost:3000` → `:4001`, `:70-75`).
- `src/lib/sites/embed-script.ts:90-98` — an empty `wsOrigin` **omits** the `data-ws-url`
  attribute entirely; the comment at `:92-93` says why (an empty attribute is still an
  attribute and would defeat the widget's `if (!RECOPYFAST_WS) return`).
- `public/embed/recopyfast.src.js:32-45` — the widget reads `data-ws-url`, and **deliberately
  has no derived fallback and issues no warning** when absent.
- `public/embed/recopyfast.src.js:2703-2705` — `if (!RECOPYFAST_WS) { return; }`, above a
  20-line comment recording why (`:2690-2702`).
- `docs/quality/qa-register.md:82-86` — `NEXT_PUBLIC_WS_URL` removed from production.
- `server/fly.toml:22` still reads `app = "recopyfast-ws"   # change to your chosen Fly app name`.

`s07` owns turning this on. `s08` inherits a running service — **if `s07` has not landed,
`s08` is not a 4** (see [Real complexity](#real-complexity)).

### The build

`scripts/build-embed.mjs`:

- Header `:5-8` records the reason socket.io is inlined: *"the widget used to pull socket.io
  from cdn.socket.io at runtime, which any site serving `script-src 'self'` blocks outright —
  real-time editing simply died."*
- `:13` names `public/embed/socket.io-client.min.js` as the *"standalone socket.io, same-origin
  fallback"*.
- `:52` — `SOCKET_GLOBAL = "__recopyfastSocketIO"`, namespaced so it cannot clobber a
  customer's own `window.io`.
- `:77-94` `buildSocketIo()` compiles `socket.io-client` from `node_modules` to an IIFE.
- `:220-225` composes `banner + socketIo + "\n" + widget + "\n"`. The comment at `:222-224`
  explains socket.io goes **first** so no second request and no injected `<script>` element is
  needed for a nonce/hash CSP to reject.
- `:227-230` writes **both** `recopyfast.js` and `socket.io-client.min.js`.
- `:232-245` prints **raw** byte sizes only. No gzip, no ceiling — that is `s06`'s job
  (`stories.md:333-334`).
- `:154-163` the banner names the bundled socket.io version; `:189` the staleness hash covers
  source + `editingRules.core.ts`.

### The widget's socket surface — every site

| Line(s) | What |
|---|---|
| `:7` | `EMBED_SCRIPT_SRC` captured from `document.currentScript` |
| `:32-45` | `RECOPYFAST_WS` from `data-ws-url`; no fallback, no warning |
| `:47` | `const RECOPYFAST_WS = window.RECOPYFAST_WS` |
| `:49-56` | comment: socket.io must never come from a third-party CDN |
| `:58-68` | `SOCKET_IO_FALLBACK_URL` — **the trap**, line 64 is the rewrite |
| `:71-77` | `getSocketIOFactory()` — `window.__recopyfastSocketIO.io`, else `window.io`, else null |
| `:829` | `this.socket = null` in the constructor |
| `:908` | `await this.establishConnection()` — **unconditional, in `init()`** |
| `:919` | `this.sendContentMap()` — runs regardless of socket state |
| `:2663-2685` | `emitRealtimeContentUpdate` — ack + 2 s timeout, `console.warn` on failure |
| `:2687-2756` | `establishConnection` — the whole connection lifecycle |
| `:2710-2722` | `io(RECOPYFAST_WS, { query, reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 5 })` |
| `:2724-2727` | `on('connect')` → `console.log` + `sendContentMap()` |
| `:2729-2731` | `on('content-update')` → `handleContentUpdate` |
| `:2733-2735` | `on('ab-test-update')` → `handleABTestUpdate` |
| `:2737-2739` | `on('disconnect')` → `console.log` |
| `:2741-2743` | `on('error')` → `console.error` |
| `:2745-2750` | `on('auth-error')` → `console.error` + `showStagingError` in staging |
| `:2752-2755` | `catch` → `console.error` + `this.startPolling()` |
| `:2758-2788` | `loadSocketIO()` — **the trap's injection site** |
| `:2790-2843` | `sendContentMap()` — HTTP first (`:2821`), socket fanout only `if connected` (`:2833`) |
| `:2853-2954` | `postContentMap()` — the authoritative HTTP path, fingerprinted, fire-and-forget |
| `:3182-3202` | `handleABTestUpdate` |
| `:3204-3220` | `handleContentUpdate` |
| `:5107-5132` | `startPolling()` — see the traps |
| `:5138-5141` | `destroy()` → `this.socket.disconnect()` |

Note the tombstone comments at `:2801-2832` and `:2823-2832`: `sendContentMap` used to `return`
early when `this.socket` was null and emit only over the socket, so **no site ever registered
its content elements** and every customer sat at "Verifying" forever (register F-10). And
`connected` is checked, not just non-null, because socket.io buffers emits made while
disconnected into `sendBuffer` — an unbounded leak against an origin that never connects.
Both incidents constrain how the native-WS rewrite is allowed to behave.

### The server

`server/index.js`, 1,219 lines, Express + Socket.io on one `http` server.

- `:1-8` requires `express`, `http`, `socket.io`, `cors`, `crypto`, `path`, `dompurify`, `jsdom`.
- `:43` `const httpServer = createServer(app)`.
- `:215-221` `new Server(httpServer, { cors: { origin: true, methods: ['GET','POST'],
  credentials: false } })`. The 15-line comment above (`:200-214`) explains why the origin
  allowlist is *not* an env list: authorisation is per-site in the connection handler, keyed on
  the site's registered domain, which is strictly stronger.
- `:228-235` `GET /health` → `{ status, connections: io.engine.clientsCount, supabase }`.
- `:238-239` in-memory `siteConnections` / `userConnections` maps — **not Redis**. Single
  instance only today.
- Helpers: `sanitizeContent` `:79`, `normalizeDomain` `:87`, `parseHost` `:97`,
  `verifySiteToken` `:121`, `validateStagingAccess` `:242`, `normalizePermissions` `:278`,
  `validateEditSessionAccess` `:295`.
- `:333-434` `io.on('connection')`: read handshake query `:336` → require `siteId` `:340` →
  require `token` `:345` → look up site `:355` → `verifySiteToken` `:367` → origin host must
  equal the registered domain `:373-380` → optional staging/edit-token validation `:386-405` →
  join `site:{id}:staging` or `site:{id}` `:422-427` → track in `siteConnections` `:430-433`.
- Inbound handlers: `content-map` `:436`, `content-update` `:501`, `join-dashboard` `:628`,
  `bulk-update` `:655`, `switch-language` `:753`, `restore-version` `:856`, `activate-theme`
  `:929`, `staging-publish` `:1042`, `ab-test-status-change` `:1132`, `disconnect` `:1160`.
  **Only the first two and `disconnect` have any client in this repo.**
- `content-update` `:501-625`: re-checks the site token against `socket.data.siteToken` `:513`,
  **refuses non-staging writes outright** `:519-525`, requires an edit permission `:527-535`,
  sanitises `:537`, persists **only when `!data.persisted`** `:541` (this is ADR rule 1 in
  code), records staging history `:564-583`, broadcasts to the staging or live room
  `:589-607`, notifies the dashboard room `:610-616`, `reply({ ok: true })` `:618`.
- `:1177` `const PORT = process.env.WS_PORT || 4001`; `:1180-1210` port auto-detection, up to
  10 attempts.
- `server/package.json` deps: `express`, `socket.io ^4.7.2`, `cors`, `@supabase/supabase-js`,
  `dotenv`. **No `ws`** — but `ws@8.21.0` is present in both `node_modules/ws` and
  `server/node_modules/ws` transitively via engine.io, so it is resolvable today and would
  still need to become a declared dependency.

### Measured bytes (this session, `gzip -9c … | wc -c`)

| Artifact | raw | gz |
|---|---|---|
| `public/embed/recopyfast.js` (shipped) | 174,420 | **46,781** |
| `public/embed/socket.io-client.min.js` | 42,162 | **13,085** |
| widget only (bundle minus the concatenated socket.io text) | 132,258 | **33,906** |
| `public/embed/recopyfast.src.js` (unminified source) | 239,016 | 55,823 |

**Measured saving from removing socket.io from the composed bundle: 46,781 − 33,906 =
12,875 bytes gzipped.** Not 13,085 — gzip finds cross-file redundancy when the two are
compressed as one stream, so the standalone file's 13,085 overstates the delta by 210 bytes.

⚠️ **`stories.md:91` and `architecture.md:184` state the widget alone is 34,063 gz.** Measured
with `gzip -9c` it is **33,906**. 34,063 is what Node's `zlib.gzipSync(..., {level: 9})`
returns for the same bytes — a 157-byte difference in compressor defaults, not in content.
Both figures are real measurements of the same file; they simply used different tools. This
matters because `s06` AC 1-4 make one of these numbers a **committed build-gate constant**, and
a gate written against `gzip -9c` while the docs quote the zlib figure has 157 bytes of
phantom headroom. `s06` should state which compressor the ceiling is measured with.

After the swap the widget must still fit ≤ 30,000 gz. **33,906 − 0 = 33,906 > 30,000.** `s08`
alone does not reach budget; `s06` owes the remaining ~3,906 (its own target is ≤ 24,000).
This is exactly why the two stories were split (`stories.md:77-79, 349-350`).

---

## Anchor points

**Must change**

| File | Anchor | Why |
|---|---|---|
| `public/embed/recopyfast.src.js` | `:58-68` `SOCKET_IO_FALLBACK_URL` | delete, or the trap goes live the moment the bundle stops concatenating socket.io |
| " | `:71-77` `getSocketIOFactory` | delete with the above |
| " | `:2687-2756` `establishConnection` | replace with native `WebSocket` |
| " | `:2758-2788` `loadSocketIO` | delete |
| " | `:2663-2685` `emitRealtimeContentUpdate` | ack channel has no native equivalent |
| " | `:2833-2842` socket fanout in `sendContentMap` | new framing; keep `:2821` HTTP-first ordering |
| " | `:908` `await this.establishConnection()` | AC 3 — must move behind an edit-mode check |
| " | `:5138-5141` `destroy()` | `.disconnect()` → `.close()` |
| " | `:5107-5132` `startPolling` | unstoppable `setInterval`, no handle (see traps) |
| `scripts/build-embed.mjs` | `:77-94`, `:213`, `:215-218`, `:225`, `:229`, `:242-243` | stop compiling and concatenating socket.io; decide the fate of `socket.io-client.min.js` and of the `Bundled socket.io-client:` banner line |
| `server/index.js` | `:43`, `:215-221` | add a native-WS listener on the same `httpServer` at a distinct path |
| " | `:333-419` | the auth chain is the thing to reuse verbatim, not re-derive |
| `server/package.json` | `:10-16` | `ws` must become a declared dependency |

**Must not change**

| File | Anchor | Why |
|---|---|---|
| `public/embed/recopyfast.src.js` | `:2790-2822` HTTP-first `postContentMap` call | ADR rule 1; tombstone for register F-10 |
| " | `:2853-2954` `postContentMap` | the authoritative write path |
| `src/lib/sites/embed-script.ts` | `:90-98` | the snippet shape; `/embed/recopyfast.js` is a permanent public URL (`AGENTS.md` non-negotiable 2) |
| `server/index.js` | `:373-380` per-site origin check | commit `3099c07` tightened this; must not regress |
| " | `:519-525` non-staging writes refused | live writes go through staging + publish, by design |
| " | `:541` `!data.persisted` | ADR rule 1 in code |
| `src/middleware.ts` | `:69-83`, `:203-231` | `/embed/**` sessionless-but-headered; `connect-src` derived from env |

**Read-only context**

`docs/decisions/004-embed-transport-split.md` · `docs/stories.md:81-103` (byte budget),
`:320-364` (`s06`), `:367-414` (`s07`) · `docs/architecture.md:174-194` (embed widget),
`:282-293` (CSP both directions) · `AGENTS.md` non-negotiables 1-4 ·
`src/__tests__/websocket/server.test.ts` (WS-001…WS-022; pure unit assertions on handshake
shapes and token maths — it does **not** boot a server, so it will not catch a transport
regression) · `public/embed/__fidelity__/harness.js`.

---

## Verified APIs / functions

Signatures read from the code, not recalled.

**Widget (`public/embed/recopyfast.src.js`)**
- `establishConnection(): Promise<void>` — `:2687`. Gates on `RECOPYFAST_WS` only.
- `loadSocketIO(): Promise<ioFactory>` — `:2758`. Resolves the existing global, else injects a
  `<script>`.
- `emitRealtimeContentUpdate(payload): void` — `:2663`. `payload` = `{ siteId, elementId,
  content, token, stagingMode, stagingToken, editToken, persisted: true, ...extra }`.
- `sendContentMap(): void` — `:2790`. Builds `{ [elementId]: { selector, content, type } }`.
- `postContentMap(contentMap): void` — `:2853`. `POST {API}/content/{siteId}`,
  `Authorization: Bearer {SITE_TOKEN}`. Fingerprinted against `lastContentMapFingerprint` and
  `serverKnownElementIds` so rescans do not re-POST.
- `handleContentUpdate(data): void` — `:3204`. `data` = `{ elementId, content, language?,
  variant?, alt? }`. **Ignores anything where `language !== 'en'` or `variant !== 'default'`.**
- `handleABTestUpdate(data): void` — `:3182`. `data` = `{ status, test_id }`; on `'active'`
  re-runs the whole A/B pipeline.
- `startPolling(): void` — `:5107`. `setInterval(..., 5000)`, **handle discarded**.
- `destroy(): void` — `:5138`.

**Server (`server/index.js`)**
- `verifySiteToken(siteId, apiKey, token): boolean` — `:121`. HMAC-SHA256 over
  `` `${siteId}.${issuedAt}` `` keyed on the site's `api_key`.
- `normalizeDomain(domain): string` — `:87`; `parseHost(header): string` — `:97`.
- `sanitizeContent(content): string` — `:79`, DOMPurify over JSDOM.
- `validateStagingAccess(stagingToken, siteId): Promise<{valid, verified?, email?,
  permissions?, accessId?, error?}>` — `:242`. Requires `is_active`, unexpired,
  `email_verified`.
- `validateEditSessionAccess(editToken, siteId): Promise<{valid, verified?, userId?,
  permissions?, sessionId?, error?}>` — `:295`. Touches `last_used_at`.
- `normalizePermissions(raw): string[]` — `:278`. Expands `admin ⊃ publish ⊃ edit ⊃ view`.

**Snippet issuance (`src/lib/sites/embed-script.ts`)**
- `getPublicAppUrl(): string` — `:42`; `canonicalizePublicAppUrl(origin)` — `:29` (apex →
  `www`, because the apex 308s and CORS preflights cannot follow it — bug B-11).
- `getPublicWebSocketUrl(appUrl?): string` — `:63`. `""` means off.
- `buildEmbedScript({ siteId, siteToken, appUrl?, wsUrl? }): string` — `:83`.

**Third-party, verified in `node_modules`**
- `engine.io` `Server.attach(server, opts)` — `node_modules/engine.io/build/server.js:649-696`.
  Installs an `upgrade` listener; non-matching paths are `socket.end()`ed after
  `destroyUpgradeTimeout` (default 1000 ms) **unless `options.destroyUpgrade === false`**
  (`:679-693`). The guard is `if (socket.writable && socket.bytesWritten <= 0)`.
- `socket.io` `Server.attach` — `node_modules/socket.io/dist/index.js:209-233`. Line 231:
  `Object.assign(opts, this.opts)` — **so `destroyUpgrade: false` passed to
  `new Server(httpServer, {...})` does reach engine.io.** Verified, not assumed.
- `ws@8.21.0` resolvable at `node_modules/ws` and `server/node_modules/ws`.

---

## Traps & constraints

**T1 — Native `WebSocket` has no reconnection (named in the story and the ADR).**
Socket.io supplies it today: `reconnection: true, reconnectionDelay: 1000,
reconnectionAttempts: 5` (`recopyfast.src.js:2719-2721`). Native has none. AC 7 requires
jittered, capped exponential backoff, and *"a server restart does not end an open editing
session"*. Note reconnection is not only a timer: on reconnect the widget must re-authorise
(the handshake carries the tokens) **and** re-send the content map — `sendContentMap()` is
called from the `connect` handler today (`:2726`), so that wiring must survive.

**T2 — There is no ack primitive.** `emitRealtimeContentUpdate` uses
`.timeout(2000).emit(ev, payload, cb)` (`:2669-2674`) and the server replies via
`reply({ ok: true })` / `reply({ ok: false, error })` (`server/index.js:502-506, 515, 523, 533,
559, 618, 623`). Native `WebSocket` gives you `send()` and nothing else. Either build
correlation ids + a pending-request map + a timeout, or decide the fanout is fire-and-forget
and delete the warning path. **Unbudgeted in both the story and the ADR.**

**T3 — engine.io destroys unclaimed upgrades on the shared server after 1 s.**
`node_modules/engine.io/build/server.js:676-693`. A `ws` server mounted `noServer` on the same
`httpServer` will have its sockets `end()`ed 1,000 ms after upgrade **if it has written no
bytes** — and the guard is `socket.bytesWritten <= 0`, so a completed `ws` handshake usually
survives by accident. Do not rely on that. Pass `destroyUpgrade: false` in the `new Server(...)`
options at `server/index.js:215` (verified to propagate), or route `upgrade` explicitly by
pathname before socket.io sees it. This is the single most likely cause of "works locally,
drops after a second in production".

**T4 — `connect-src 'self'` detection is not a `try/catch` you can assume.** AC 6 requires
*one explicit console warning* and a working HTTP fallback; a silent failure fails the
criterion, and `ADR 004:84-86` repeats it. What the code does today: the `catch` in
`establishConnection` (`:2752-2755`) logs `console.error` and calls `startPolling()`. Whether
`new WebSocket(url)` under a blocking `connect-src` throws synchronously (`SecurityError`) or
fails asynchronously via the `error` event is **browser-dependent and was not verified in a
browser in this session** — see Open questions. Both paths must be handled, and both must
converge on exactly one warning. Note also that the browser's own CSP violation message in the
console is **not** the widget's warning: the criterion asks for the widget to say it.

**T5 — `startPolling()` is an unstoppable 5-second `setInterval`.** `:5107-5132` discards the
interval handle. `destroy()` (`:5138`) does not clear it. If T4's degradation routes into
`startPolling()`, every visitor on a `connect-src 'self'` customer's page issues a
`GET /api/content/{siteId}` every 5 s forever, and nothing can stop it. Combined with AC 3
("zero WebSocket connections when no editing session is open"), the fallback must be
edit-mode-scoped too, or `s08` trades a WebSocket per visitor for a poll per visitor.

**T6 — `script-src 'self'` (AC 5) is satisfied by *not adding* code, and broken by leaving
dead code behind.** Deleting the concatenation (`build-embed.mjs:225`) without deleting
`SOCKET_IO_FALLBACK_URL` (`:58-68`) and `loadSocketIO` (`:2758-2788`) turns the cold trap hot:
`getSocketIOFactory()` returns null, and the widget injects a cross-origin `<script>` on every
customer page. That is precisely the bug `build-embed.mjs:5-8` documents. **Delete all three
together or none.**

**T7 — Protocol versioning / old snippets, and why it is mostly vacuous.**
`ADR 004:41-42` requires old Socket.io `data-ws-url` snippets to keep working;
`stories.md:462-463` repeats it; `reviews/stories.md:184` argues to strike it under
`prd.md:221-222` (*"0 users today: no migration debt, no backwards-compatibility obligation"*).
**The code settles most of it:** a snippet only ever carries `src=".../embed/recopyfast.js"`
and `data-ws-url="{origin}"` (`embed-script.ts:98`) — it carries **no protocol**. Because
`/embed/recopyfast.js` is a permanent URL always serving the current artifact, an "old snippet"
gets the *new* widget and speaks the new protocol. The only genuine window is **cached copies
of the old artifact** still executing in a browser or a customer CDN. That is bounded, time-
limited, and addressed by cache headers plus keeping the old Socket.io path mounted for one
release — not by dual-protocol sniffing forever. **Also verify the cache-control on
`/embed/recopyfast.js` before sizing that window; it was not checked in this session.**

**T8 — Idle timeouts and heartbeats, mentioned nowhere.** Socket.io/engine.io runs its own
ping/pong (`pingInterval`/`pingTimeout`) which keeps the connection alive through proxies and
detects half-open sockets. The browser `WebSocket` API exposes **no ping** — the protocol has
one, but JS cannot send it. Fly/Railway/Render and most intermediaries idle out a silent
connection in 60 s or less. An app-level heartbeat frame plus a liveness timer is required, or
sessions die silently after a minute of not typing and T1's reconnection never fires because
no `close` event arrives. **Not in the ADR, not in the story, not in the AC list.**

**T9 — `ab-test-update` disappears if the message list is taken from the ADR.** The widget
listens for it (`:2733`) and `handleABTestUpdate` (`:3182`) re-runs the whole A/B pipeline.
It is currently unreachable (its only emitter, `ab-test-status-change` `server/index.js:1132`,
has no client) and `s11`/`s12` will make it reachable again. Implementing exactly the ADR's
three messages silently deletes a hook `s11` depends on.

**T10 — Origin authorisation must be carried across.** `server/index.js:373-380` rejects a
connection whose `Origin`/`Referer` host is not the site's registered domain. On native `ws`
this check moves into the `upgrade` handler and must read `req.headers.origin` — there is no
`socket.handshake`. `stories.md:410-413` warns not to regress commit `3099c07`.
`ADR 004:88-92` adds that once `s14` lands, revocation must terminate a live connection.

**T11 — The widget may never throw at the host page.** `AGENTS.md` non-negotiable 4 and
`architecture.md:189-191`. `establishConnection` is `await`ed inside `init()`'s `try`
(`:867, 908, 929`) — a native-WS rewrite must keep every failure inside that boundary,
including the asynchronous `onerror`/`onclose` paths, which are **outside** the `try` by
definition.

**T12 — The house comment style is load-bearing.** `AGENTS.md` → Comments;
`architecture.md:203-210`. The tombstones at `recopyfast.src.js:2690-2702`, `:2801-2832`,
`:49-56` and `build-embed.mjs:5-8` are the only thing preventing a future agent from
reintroducing the CDN bug and the "Verifying forever" bug. Deleting the socket.io code must
**move** those tombstones, not drop them.

---

## Open questions

1. **Does `ADR 004`'s "keep Socket.io for the first-party dashboard" survive the finding that
   there is no first-party Socket.io consumer?** `CollaborationRealtime` is imported by nothing
   but its own tests, speaks a protocol the server does not implement, and its feature set is
   in the PRD graveyard. If the embed moves to native WS, `server/index.js` has **zero** live
   Socket.io clients. Dropping Socket.io entirely would remove T3 outright and delete a
   dependency. This is a decision above this story's pay grade — it likely needs an ADR
   superseding 004. **Blocking for the plan's scope, not for the research.**

2. **What exactly does `new WebSocket(url)` do under a blocking `connect-src`?** Synchronous
   `SecurityError` or async `error` event — this determines whether AC 6's "one explicit
   console warning" is emitted from a `catch` or from an `onerror`, and getting it wrong yields
   either a silent failure (fails AC 6) or a double warning. **Verify in Chrome and Firefox
   against a fixture page before planning.** Not verifiable from this repo.

3. **M6 is still open in `stories.md`** (`reviews/stories.md:162-172`). `s07` AC 4
   (`stories.md:384`) says *"a second browser **viewing** the same page"*; `s08` AC 3
   (`:437`) says *"no editing session open opens **zero** WebSocket connections"*. Today
   `establishConnection()` runs for every visitor (`:908`). Editors-only is the reviewer's
   recommendation and matches `s08`; **`s07` was never edited to say so.** If `s07` ships
   literally, it connects every visitor of every customer site and `s08` rips it out.

4. **M5 is still open** (`reviews/stories.md:154-160`). `s14`'s AC 4 (`stories.md:711`)
   requires revocation to kill *"an established WebSocket connection"*, but `s14`'s declared
   dependencies (`stories.md:719`) are `s13` and `s03` — **not `s08`** — and `s08` has no
   revocation criterion.
   `ADR 004:90-92` assigns the obligation but changes no story. As it stands the socket-
   revocation path is owned by nobody. **Should `s08` take an AC: "an established connection is
   terminated when its grant is revoked or expires"?**

5. **Which compressor defines the ceiling?** `gzip -9c` says the widget is 33,906; Node's
   `zlib` at level 9 says 34,063 (both correct, both this session). `s06` bakes one of these
   into a committed constant. Pick one and name it in `s06`, or `s08` inherits 157 bytes of
   phantom headroom.

6. **Endpoint path and origin.** `ADR 004:41` says "separate endpoint paths". Socket.io owns
   `/socket.io` (`socket.io/dist/index.js:100`). What is the native path — `/ws`, `/embed-ws`,
   `/v1/embed`? Does the version live in the path (`/v1/…`) or in a first frame? A path-
   embedded version is the only one visible to a load balancer.

7. **Is `/embed/socket.io-client.min.js` retired or kept?** `build-embed.mjs:229` writes it and
   `:13` calls it the same-origin fallback. If the widget no longer needs it, keeping it is a
   42 KB file inviting exactly the trap T6 describes. If it is deleted, confirm nothing else
   fetches it. **Also: what `Cache-Control` does `/embed/recopyfast.js` carry?** Not checked —
   it sizes T7's window.

8. **Ack or no ack (T2)?** A decision, not a discovery. Fire-and-forget is smaller and simpler;
   the current `console.warn` on failed fanout (`:2672, 2678`) then disappears. Correlation ids
   cost bytes against a budget already 3,906 over.

9. **Redis / more than one instance.** `server/index.js:238-239` keeps `siteConnections` in a
   process-local `Map`. `ADR 004:54-56` says one instance is acceptable and a second must be an
   explicit decision. `s07` owns this; `s08` should confirm which world it is coding for,
   because a native-WS room registry is the same problem again.

---

## Real complexity

**Re-scored: 4 — holds, conditionally.** No split proposal is required.

Why it stays a 4 rather than rising to 5: the story moves on exactly one axis (the transport),
against a service that already exists and already authorises; there is no migration, no new
external dependency, no billing or statistical correctness, no new UI, and the byte target is
`0` by construction rather than by negotiation (`reviews/stories.md:194-208` reasons the same
way and its reasoning survives checking).

But the 4 rests on three conditions, and if any fails the story is a 5:

1. **`s07` must actually have landed.** `s08` inherits *"a running service"*. Nothing is
   deployed today: `fly.toml:22` is uncustomised, `NEXT_PUBLIC_WS_URL` is unset
   (`qa-register.md:82-86`), and the widget returns at `:2703`. Standing up the service **and**
   replacing the protocol in one story is the 5 the split was created to avoid
   (`stories.md:77-79`).
2. **T2 (acks) and T8 (heartbeat) must be explicitly in scope.** Neither appears in the ADR,
   the story, or the eight acceptance criteria. They are not optional: without a heartbeat the
   connection dies at the first proxy idle timeout and AC 7's "a server restart does not end an
   open editing session" is untestable because ordinary silence already ends it. Discovering
   them mid-execution is how a 4 becomes a 5.
3. **T3 must be handled deliberately**, not by the accident that a completed `ws` handshake
   writes bytes before engine.io's 1-second timer fires.

The genuinely hard part is **not** the wire protocol — it is four failure modes that are all
invisible on a developer's own machine: the CSP block (T4), the idle timeout (T8), the shared-
upgrade destroy (T3), and the reconnect storm (T1 + T5). The story's own risk paragraph
(`stories.md:427-429`) names exactly this shape: *"a transport that works in development and on
our own domain can fail only on customers serving a restrictive CSP — the exact customers least
likely to file a useful bug report."* That is correct, and it is the thing the plan must build
test fixtures for rather than reason about.

**Not a 5. No split.** But the plan should treat T2, T3 and T8 as first-class tasks with their
own criteria, and Open questions 1, 2 and 3 should be answered before `/ks-plan`, not during it.
