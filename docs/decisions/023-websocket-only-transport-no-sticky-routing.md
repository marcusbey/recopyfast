# ADR 023 — WebSocket-only transport; the multi-instance answer is the adapter, never sticky routing

- Status: accepted
- Date: 2026-08-17
- Scope: story `s07b-realtime-deploy` (constrains `s08-embed-transport`)
- Supplements [ADR 004](./004-embed-transport-split.md); depends on the two-machine decision
  recorded in `docs/plans/s07b-realtime-deploy.md`

## Context

The realtime service now runs **two machines** (`recopyfast-ws`, `iad`, `shared-1x-cpu@512MB`).
Socket.io was written for one process, and two changes it in two independent ways. The adapter
addresses one of them. The other is a transport problem and has to be decided separately.

**Socket.io's handshake is stateful.** A connection begins with an HTTP polling exchange, and every
request in that exchange must reach the *same* process — the session id issued by machine A means
nothing to machine B. Without sticky routing, a polling handshake across two machines fails with
`Session ID unknown`.

The two clients differ, and neither is safe:

- **The embed** (`public/embed/recopyfast.src.js:2710`) passes **no `transports` option at all**,
  so it takes socket.io-client's default: **polling first, then upgrade**. Every customer site
  starts on polling. This breaks for everyone, immediately, on two machines.
- **The dashboard** (`src/lib/collaboration/realtime.ts:93`) sets
  `transports: ["websocket", "polling"]`, so it attempts WebSocket first and usually succeeds — but
  it still falls back to polling on a WebSocket-hostile network, and then fails the same way.

The server (`server/index.js:215-221`) constrains neither: `new Server(httpServer, { cors: … })`
passes no `transports`, so both are enabled.

`@socket.io/redis-adapter` does **not** fix this. The adapter shares *room membership and
broadcasts* between processes; it does not make a session id portable across them. Adapter plus
polling plus two machines still fails the handshake.

## Decision

**Force `transports: ["websocket"]` on both clients and on the server. Do not implement sticky
routing.** The Redis adapter handles cross-process room membership; the transport restriction
handles the handshake. They are separate fixes for separate failures and both ship in `s07b`.

- **Embed** — add `transports: ['websocket']` to the `io(RECOPYFAST_WS, {…})` options in
  `public/embed/recopyfast.src.js`, then rebuild. (Source of truth is the `.src.js`; the artifact is
  built, never hand-edited — AGENTS.md non-negotiable 1.)
- **Dashboard** — drop `"polling"` from `realtime.ts:93`.
- **Server** — set `transports: ['websocket']` on the `Server` options, so a client that ignores the
  restriction is refused at the door rather than silently establishing a session that breaks on its
  second request.
- **One console warning when the WebSocket cannot be established**, on the embed. Silence is the
  designed behaviour for the widget (non-negotiable 4), and this ADR removes a fallback — a
  customer on a WebSocket-blocking network must have *something* to find. `s08` already requires
  exactly one explicit warning when a host page's `connect-src` blocks the socket; this is the same
  warning for a different cause, and the two should be one code path, not two.

## Considered options

- **(a) Sticky routing at the Fly edge.** Rejected. Fly has no first-class session affinity for
  this; achieving it means application-level `fly-replay` logic — inspecting the socket.io session
  id, mapping it to an instance, and replaying requests — which puts a routing table in the request
  path of every polling request and a new failure mode in front of every connection. It is a large
  amount of machinery whose only purpose is to preserve a transport we do not want, and it would
  have to be maintained through `s08`, which removes socket.io from the embed entirely.
- **(b) Keep polling, pin all socket traffic to one machine.** Rejected: it reintroduces the
  single-instance ceiling while paying for two machines, and does so invisibly — the second machine
  would be up, healthy, and serving nothing.
- **(c) Scale back to one machine.** Rejected at the operator's direction; two machines is the
  recorded decision. Worth stating that it *would* have solved the handshake problem, and that this
  ADR is a direct consequence of choosing two.
- **(d) Adapter only, leave transports alone.** Rejected because it is the option most likely to be
  reached for by mistake. The adapter looks like "the multi-instance fix" and is not: it shares
  rooms, not sessions. Shipping it alone leaves every embed handshake broken while creating a
  strong impression that multi-instance support is done.

## Consequences

**Clients on networks that block WebSocket lose realtime entirely, with no fallback.** This is the
real cost and it is accepted deliberately, on the authority ADR 004 already established: **HTTP is
authoritative and realtime is provably additive.** Editing, saving, publishing and content delivery
all continue over HTTP for such a client; what they lose is live co-editing propagation. That is a
degradation of an enhancement, not a loss of function — which is precisely the property ADR 004
requires realtime to have, and the first case where that property is actually spent.

**It reduces the work `s08` has to do.** ADR 004 already commits the embed to native `WebSocket`.
Forcing websocket-only now moves the embed in exactly that direction and shrinks the behavioural
delta `s08` must make — `s08` changes the client library, not the connection semantics.

**AC 4 becomes deterministic.** With the adapter sharing rooms and no polling to misroute, "edit in
A appears in B under one second" no longer depends on which machine each browser landed on.

**The server-side restriction is the part that must not be dropped.** Setting the transport on the
clients alone leaves a server that still accepts polling — so any client that misses the option, a
cached older embed artifact among them, establishes a session that appears to work and fails on its
next request. Refusing at the server converts a confusing intermittent bug into an immediate,
legible one.

**Rollout is safe, and this was measured rather than assumed** (2026-08-17, against production):

```
GET https://www.recopyfa.st/embed/recopyfast.js
  200 · cache-control: public, max-age=0, must-revalidate
      · etag: "489475dff486f36755347aa611cddd11" · 174420 bytes
```

`must-revalidate` with `max-age=0` means **every page load revalidates**, so a rebuilt artifact is
picked up on the next load rather than lingering in caches. There is no stale-artifact window to
plan around, and the concern that a cached polling client would keep failing after deploy does not
apply. No cache rule anywhere sets this deliberately — `next.config.ts` defines only security
headers and `vercel.json` only a cron — so it is Vercel's default for `public/`, which means it is
**inherited, not chosen, and could change without anyone noticing.** If a future story adds
long-lived caching to `/embed/*` as an optimisation, it silently reintroduces exactly the rollout
hazard this paragraph rules out.

That same check confirmed **zero drift between the committed artifact and production**: the
deployed ETag is precisely the md5 of `public/embed/recopyfast.js` on `main`, at the identical
byte count. The build-artifact discipline (non-negotiable 1) is holding in production, not just in
the repo.

**Watch — `NEXT_PUBLIC_APP_URL` is set to the apex, which 308s.** The same check found
`https://recopyfa.st/embed/recopyfast.js` returning `308 → https://www.recopyfa.st/…`. This is
incident B-11's exact setup, live. It is currently harmless because `canonicalizePublicAppUrl`
(`embed-script.ts:29-40`) rewrites that one hostname at snippet-generation time — the tombstone is
load-bearing, working, and one deleted line away from breaking every widget. Any code path that
reads `NEXT_PUBLIC_APP_URL` and builds a customer-facing URL **without** passing it through that
function reproduces B-11. That is a live grep-able invariant, not a hypothetical.
