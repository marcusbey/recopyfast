# ADR 026 — One machine, no Redis adapter: the deployment shape ADR 023 assumed never shipped

- Status: accepted
- Date: 2026-08-17
- Scope: story `s07b-realtime-deploy`
- **Supersedes** [ADR 023](./023-websocket-only-transport-no-sticky-routing.md) **on the deployment
  shape only.** ADR 023's actual decision — `transports: ['websocket']` on the server and on both
  clients, and **no sticky routing, ever** — is untouched and still binding. It shipped, it is in
  production, and everything below depends on it.
- Supplements [ADR 004](./004-embed-transport-split.md); records the instance count ADR 004 requires
  to be explicit rather than assumed.

## Context

ADR 023 was written against a two-machine deployment and a plan that made
`@socket.io/redis-adapter` mandatory. **Neither is what `s07b` deployed.** The operator scaled
`recopyfast-ws` to **one** machine on 2026-08-17 and the adapter was never added — deliberately, and
recorded as such in `docs/plans/s07b-realtime-deploy.md:29-43` before implementation began.

ADR 023 is immutable (`AGENTS.md`, *Data & docs lifecycle*), so it is not edited. It states four
things that reality contradicts, and each is corrected here:

| ADR 023 | Reality |
|---|---|
| `:11` — *"The realtime service now runs **two machines**"* | It runs **one**. `server/fly.toml:97` pins `min_machines_running = 1` with `auto_stop_machines = false`. |
| `:40` — the adapter and the transport pin *"both ship in `s07b`"* | **Only the transport pin shipped.** `server/package.json` carries no `@socket.io/redis-adapter`; its `redis` dependency is `s07a`'s rate limiter, which is a different concern and not pub/sub. |
| `:66-68` — rejects option (c), *"Scale back to one machine … two machines is the recorded decision"* | **One machine IS the recorded decision**, as of 2026-08-17. The option ADR 023 rejected is the one in production. |
| `:87` — *"AC 4 becomes deterministic. **With the adapter sharing rooms** …"* | AC 4 was measured deterministic **without** the adapter, on one machine: 613 ms and 598 ms across two distinct socket ids, on a fixture served from a non-RecopyFast domain. One process makes rooms coherent by construction; there is nothing for an adapter to share. |

The correction is narrow on purpose. ADR 023's reasoning about the *handshake* is independent of the
machine count and remains exactly right: socket.io's polling handshake is stateful, the embed passed
no `transports` option at all (`public/embed/recopyfast.src.js`), and sticky routing at the Fly edge
is machinery whose only purpose is to preserve a transport we do not want. The transport pin is not
a two-machine mitigation that one machine makes redundant — it is what stops a client that ignores
the restriction from establishing a session at all, and what shrinks the delta `s08` has to make.

## Decision

**The realtime service runs exactly one machine, and `@socket.io/redis-adapter` does not ship.**

- `server/fly.toml` pins the count (`min_machines_running = 1`, `auto_stop_machines = false`) so
  that neither Fly's idle detection nor a routine scale-up can change it by accident.
- `transports: ['websocket']` stays pinned on the server and on both clients, per ADR 023. That
  decision is not reopened by this one.
- **Sticky routing stays rejected**, on ADR 023's reasoning, unchanged.
- Going above one machine is a **code change**, sequenced in `server/README.md` — the adapter, its
  own Upstash database, and a cross-instance integration test, in the same deploy.

## Considered options

- **(a) Leave ADR 023 standing as the only record.** Rejected. It is the document that tells a
  reader the adapter shipped, and "the adapter shipped" is precisely the belief that makes
  `fly scale count 2` look like a safe operation. An ADR that is wrong about what is deployed is
  worse than no ADR, because it is read as authority.
- **(b) Edit ADR 023 in place.** Rejected — ADRs are immutable; a change means a new ADR. This is
  the mistake [ADR 024](./024-bulk-import-snapshot-change-type.md) exists to record, on `s05`, and
  it is not repeated here.
- **(c) Deploy the adapter anyway, so ADR 023 becomes true.** Rejected. It would add a Redis
  dependency, a second failure mode and a shared command quota to a service that needs none of them
  at one machine, in order to make a document accurate. The plan forbids it explicitly
  (`docs/plans/s07b-realtime-deploy.md:74`); the document is what was wrong.
- **(d) Scale to two machines to match ADR 023.** Rejected for the same reason, plus the one below:
  without the adapter it is a silent co-editing outage, and with it, it buys availability for a
  feature that already degrades gracefully (ADR 004 rule 2).

## Consequences

**The instance count is now explicit and pinned, which is what ADR 004 asked for.** It is written in
three places that a person actually reaches before touching the service: `server/fly.toml`'s ⛔
header, `server/README.md`'s *"The instance count: ONE, deliberately"*, and
`docs/architecture.md`'s *Two deploy targets*. This ADR is the fourth, for the reader who arrives
via ADR 023's supersession link rather than via the code.

**No Redis pub/sub for the socket service.** `server/package.json` carries no
`@socket.io/redis-adapter`. It *does* carry `redis` — that is `s07a`'s fail-closed connection rate
limiter, and the `REDIS_URL` the service reads is its store, not a message bus. The distinction
matters when the adapter is eventually added: `server/README.md` requires it to get its **own**
Upstash database rather than sharing that one.

**AC 4 is deterministic on one machine, and that is not luck.** With a single process there is no
placement to get wrong: both editors join the same room in the same memory. The measurement is
evidence that the deployed shape works, not evidence that the adapter was unnecessary in a
two-machine world — it would have been necessary there, which is the point of the Watch below.

## Watch — the adapter is the *precondition* for scaling, and it has not shipped

`fly scale count 2` on this service today is **a silent co-editing outage, not a scaling
operation.** Two editors on the same page land on different processes, join the same room name in
two separate memories, and stop seeing each other. Every health check stays green, nothing is
thrown, and the `/api/health` `realtime` check keeps reporting `ok` — because each process is
individually healthy. It presents as *"realtime randomly stopped working for some people"*, which is
the hardest possible shape of report to act on, and it makes AC 4 flaky rather than merely unproven.

Anyone who reaches this ADR first should go to the three documents that carry the operational rule,
in this order:

1. `server/fly.toml` — the ⛔ header above the config that would be edited.
2. [`server/README.md`](../../server/README.md) — *"The instance count: ONE, deliberately"*, with
   the three things a second machine requires in the same deploy.
3. [`docs/architecture.md`](../architecture.md) — *Two deploy targets*, for why Fly at all.

And note the ordering trap that ADR 023 got right and this ADR does not relax: the adapter shares
**rooms**, not **sessions**. It fixes the first failure above and not the handshake. Dropping the
transport pin because "we only have one machine anyway" reintroduces polling, and polling is the
half the adapter never covered.
