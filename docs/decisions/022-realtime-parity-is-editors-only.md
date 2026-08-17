# ADR 022 — Real-time parity is defined over editors, not visitors

- Status: accepted
- Date: 2026-08-17
- Scope: story `s07b-realtime-deploy` (constrains `s08-embed-transport`)
- Settles: research open question 1 of `docs/research/s07-realtime-service.md:250-257` (ex-M6)

## Context

`s07b`'s AC 4 says a second browser **viewing** the page sees an edit appear live. Read literally,
that is not what the system does, and building it would contradict the next story.

The room topology is unambiguous in the code:

- A plain viewer joins `site:{id}` (`server/index.js:426`).
- Edits in progress broadcast **only** to `site:{id}:staging` (`server/index.js:591`).
- `site:{id}` hears nothing until publish (`server/index.js:1101`).

So a literal "viewer sees the edit live" requires a **new broadcast path** from editing to
viewers. And `s08-embed-transport` AC 3 requires *"no editing session open ⇒ zero WebSocket
connections"* — a visitor-facing live channel means every visitor to every customer page holds an
open socket, which is precisely what AC 3 forbids. `s08` would rip out whatever `s07b` built.

[ADR 004](./004-embed-transport-split.md) already fixed the frame this sits in: **HTTP is
authoritative; realtime broadcasts and must be provably additive.**

## Decision

**Parity is demonstrated between two editors in an editing session on the same page.** An edit made
in browser A appears in browser B in under one second, measured, on a fixture hosted on a
non-RecopyFast domain.

Visitors are served by HTTP. A visitor sees new content on their next page load after publish —
which is the current behaviour, is authoritative, and is not degraded by anything in `s07b`.

`s07b` therefore builds **no new broadcast path**. It exercises `site:{id}:staging`
(`server/index.js:589-598`), the only room that carries edits today, and its task 8 stands as
already written. `docs/reviews/stories.md:172` recommended exactly this.

## Considered options

- **(a) Visitors receive live updates.** Rejected on three independent grounds, any one of which
  is sufficient. It contradicts `s08` AC 3 head-on, and `s08` is the next story on the same
  branch chain — building it means building something scheduled for deletion. It contradicts
  ADR 004's "realtime is additive": a visitor-facing socket makes the socket the delivery path for
  content a visitor would otherwise get over HTTP, which converts an enhancement into a
  dependency. And it inverts the cost model — one socket per *editor* is bounded by how many
  people are editing; one socket per *visitor* is bounded by traffic, on a service that is
  currently deployed nowhere and has no capacity evidence behind it.
- **(b) Live updates for visitors, but only on pages that already have an active editing
  session.** Rejected. It sounds like a compromise and is not: it still opens a socket from every
  visitor's browser to discover whether a session exists, which is the exact connection `s08` AC 3
  counts. The check costs the thing it is trying to avoid.
- **(c) Defer AC 4 entirely until after `s08`.** Rejected. AC 4 is the only acceptance criterion
  in `s07b` that proves the deployed service does anything at all end-to-end. Removing it makes
  the story "the service is deployed and health-checks green," which is not the same claim.

## Consequences

**AC 4 becomes testable as written, and `s07b`'s gate clears.** The measurement is an interval
between two real browsers, recorded in the PR alongside the fixture's hostname — not eyeballed.

**`s08` AC 3 stands unchallenged.** The two stories now agree on the connection model instead of
requiring one to undo the other.

**Visitor-facing live content is not a deferred task; it is out of scope.** If it is ever wanted,
it arrives as a new story that must first answer the question this ADR closes — how a visitor
socket coexists with a zero-connection guarantee — and it supersedes this ADR rather than
extending `s07b`.

**Watch.** "Editors only" makes the demo depend on two clients being in the *same* staging room. If
a future change scopes staging rooms per user rather than per site, this parity test silently stops
proving anything while still passing on a single client. The test asserts two distinct connections
receive the event, for that reason.
