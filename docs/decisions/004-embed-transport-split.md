# ADR 004 — Two realtime transports: native WebSocket for the embed, Socket.io for first-party

- Status: accepted
- Date: 2026-08-16
- Scope: framing (settles the connection model shared by stories `s07` and `s08`)

## Context

The PRD scores real-time multi-user sync a 5 and calls it *"the demo"*. It is switched off in
production. The chain, verified in code:

- `src/lib/sites/embed-script.ts:63-81` — `getPublicWebSocketUrl()` returns `""` when
  `NEXT_PUBLIC_WS_URL` is unset; `:92-96` then omits `data-ws-url` from the issued snippet.
- `public/embed/recopyfast.src.js:2703-2705` — `if (!RECOPYFAST_WS) { return; }`, commented
  *"nothing is listening: server/index.js is a separate Express process that Vercel cannot host."*
- `docs/quality/qa-register.md:83-86` records `NEXT_PUBLIC_WS_URL` being removed from production.

So content persists over HTTP (`postContentMap` → `POST /api/content/:siteId`), and the
Socket.io service in `server/` has never been deployed. `server/fly.toml:22` still reads
`app = "recopyfast-ws"   # change to your chosen Fly app name`.

Two constraints collide. First, **bytes**: `socket.io-client` is 13,085 of the artifact's
46,781 gzipped, against a 30,000 budget the widget already breaches on its own (34,063). Second,
**the customer's CSP**: `scripts/build-embed.mjs` records why socket.io is compiled *into* the
artifact — the widget used to pull it from `cdn.socket.io`, which any site serving
`script-src 'self'` blocks outright, killing real-time editing silently.

The story review left the `s07`/`s08` connection model unsettled, and `s08`'s acceptance
criteria cannot be written against an undecided transport.

## Decision

**Split the transport by audience.**

- **Embed widget → native `WebSocket`.** Zero bytes, built into every browser, unaffected by
  the customer's `script-src`. The embed↔server protocol is three messages: `join`,
  `content-map`, `content-update`.
- **First-party dashboard → Socket.io, unchanged.** The CSP there is ours, the payload is
  already in the app bundle rather than a customer's page, and Socket.io's reconnection and
  fallbacks are worth keeping where they cost nothing.
- **`server/index.js` serves both**, on separate endpoint paths so the two protocols never have
  to be sniffed apart. Old snippets carrying a Socket.io `data-ws-url` keep working.

Two rules bind both transports:

1. **HTTP stays authoritative.** Content is persisted over HTTP today and continues to be.
   Real-time *broadcasts*; it never becomes a second write path. If both write, they will
   disagree, and the disagreement will be silent.
2. **Realtime is provably additive.** With the WebSocket service stopped, editing, saving,
   staging and publishing must all still work with no user-visible error. `s07` makes that an
   acceptance criterion, and it is the reason `s07` can ship before `s08`.

Deploy target: a platform that hosts a long-lived process — Fly, Railway or Render. Vercel
cannot. One instance is acceptable to start; Redis pub/sub (already a dependency) is what makes
a second instance possible, and the decision to run more than one should be explicit, not
assumed.

## Considered options

- **Keep Socket.io in the widget, accept the 13KB** — rejected. The budget is breached by
  16,781 bytes and the widget alone is over by 4,063 with socket.io entirely removed. There is
  no allocation in which 13,085 fits.
- **Lazy-load `/embed/socket.io-client.min.js` from our origin on demand** — rejected, and this
  is the trap. It works in development and on our own domain, and fails on exactly the customers
  running `script-src 'self'` — because our origin is not their `'self'`. It reintroduces the
  original bug in a form that passes local testing. `recopyfast.src.js:64` already derives that
  URL, so the trap is live in the code today.
- **Supabase Realtime instead of a self-hosted service** — genuinely attractive: it is already
  a dependency, `middleware.ts` already allows `wss://` to the Supabase host in `connect-src`,
  and it removes a deploy target entirely. Rejected for now because authorization is the
  problem: a widget connection is authorized by a site token, and Supabase Realtime authorizes
  by Supabase JWT and RLS — the same mismatch [ADR 002](./002-rls-tenant-boundary.md) describes.
  Bridging it means minting a Supabase session per anonymous visitor. Worth revisiting if the
  GUC-based site-token claim in ADR 002 is ever built, at which point this ADR should be
  superseded rather than patched.
- **Server-Sent Events for the widget** — rejected. One-directional, and the widget needs to
  send. It would mean SSE down plus HTTP up, which is two mechanisms where WebSocket is one.
- **Polling** — rejected. The parity criterion is under one second; polling at that interval
  across every visitor on every customer site is more request volume than the feature is worth.

## Consequences

**Easier.** `s08` has a stated target instead of an open question, and its byte allocation is
0 rather than a negotiation. The customer-CSP failure mode is designed for up front: on
`connect-src 'self'` the widget degrades to the HTTP path, logs one explicit console warning,
and editing still works — a *silent* degradation is a defect, not a graceful fallback.

**Harder.** Two protocols on one service, and native `WebSocket` gives no reconnection. Backoff
with jitter has to be written by hand, or a routine deploy silently ends every open editing
session. Revocation also has to reach the socket: once `s14` lands, revoking a grant must
terminate a live connection, because an HTTP-only check leaves a socket writing content after
revocation.

**Watch.** Realtime is now a second thing that can be down. It must never be a thing that can
take editing down with it — that is what rule 2 protects, and it is the criterion to re-run
after every change to either transport.
