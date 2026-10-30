# Review — s128-realtime-load-bounds

**Reviewer:** fresh-context `reviewer` subagent (Claude), 2026-10-28.
**Diff reviewed:** `git diff origin/main...feature/s128-realtime-load-bounds` (`7a9a2a3c`,
`fcca23fd`). The implementation was written by Codex.
**Judged against:** the validated plan, research, AGENTS.md, `server/README.md`, ADRs
004/022/023/026 and the s79 review.

## Summary

The production code is correct. Tasks 1–7 are implemented, and the interdicts were respected:
no change to `auth.js`, `fly.toml`, `sentry.js` or the packages, no Redis adapter, no TTL verdict
cache, and L21 is deferred.

The reviewer checked the Engine.IO/ws APIs in the installed sources. An ad-hoc probe against the
real server showed three things:

- An open socket keeps its slot after the reservation timeout.
- Closing that socket frees the slot.
- A half-sent upgrade does not leak a slot.

| Check | Result |
|---|---|
| `src/__tests__/websocket` | 5 suites, 230/230 |
| Full Jest | 8,590 passed |
| type-check, eslint/prettier on tests, `node --check` on server modules | clean |

The s79 checks still hold. Nothing is cached across messages, and the in-flight promise is
cleared in `.finally` and on disconnect.

## Neutralization

Each guard was disabled to see whether any test fails. 13 of 20 mutations go red; 7 do not.

| Mutation | Red |
|---|---|
| `refuse()` without `true` | 2 |
| Drop the `isStaging` gate | 2 |
| Local 5/min off | 1 |
| Site budget off | 1 |
| No in-flight sharing | 1 |
| Cached verdict | 1 |
| Catch rethrows | 2 |
| Cap disabled | 2 |
| No close→release | 2 |
| `allowRequest` always allows | 1 |
| No `connected` recheck before fan-out | 1 |
| No `maxHttpBufferSize` | 2 |
| Always trust `Fly-Client-IP` | 1 |
| **Remove the `hasAcknowledged` guard** | **0** |
| **Remove `released` idempotence** | **0** |
| **Remove the engine `connection` transfer** | **0** |
| **Transfer keeps the timer running** | **0** |
| **Remove `connected` after `checkHandshake`** | **0** |
| **Remove `connected` after `resolveGrant`** | **0** |
| **`await handler()` → `handler()`** | **0** |

## Findings

- **major** — Dropping the `await` in `onMessage` (the L22 defect) leaves all tests green.
  - The failure-boundary tests inject faults only through the limiter seam.
  - Plan task 6 required a synchronous throw and an asynchronous rejection through real handler
    dependencies.
- **major** — The reservation `transfer()` and its timer clearing (`server/index.js:175-177`,
  `connection-limits.js`) are untested.
  - Without them, the 5 s timer frees a slot while the WebSocket is still open, so the per-address
    cap could be bypassed with waves of reconnects.
  - This is the plan's own "the point everything turns on". A test needs to hold a socket open past
    the reservation timeout and assert that the next connection is refused.
- **major** — The `socket.connected` checks after an `await` in admission
  (`server/index.js:392,424,444,458,502`) are unproven.
  - Plan task 3 required proof that a client that disconnects mid-admission does not join rooms or
    `siteConnections`.
- **minor** — The "does not acknowledge twice" test cannot see a second ack, because the client
  discards duplicates. It needs to count ACK packets on the server side.
- **minor** — The idempotence test in `connection-limits.test.ts` asserts `limiter.size`, not
  per-address counts. Its second `close` hits a `once` listener that has already been removed.
- **minor** — `messageRateLimitCheck` is a test seam exposed as a production factory option, and
  the plan did not ask for it.
- **minor** — `maxConnectionsPerAddress` means different things in `index.js:101` and
  `rate-limit.js`: concurrent transports in one, per-site handshakes per minute in the other.
- **minor** — `connection-limits.js` uses double quotes where `server/` uses single quotes, and its
  `||` defaults turn an explicit `0` into the default value.
- **minor** — `docs/stories.md` reflows unrelated stories, against "append s128 only". The s66
  blockquote nesting changed from `>` to `> >`.
- **minor** — The plan's evidence says "4 suites, 193 tests"; the actual count is 5 suites and 230
  tests.
- **minor** (partly pre-existing) — A successful `content-map` never calls the ack, so a client
  that passes an ack waits forever.

## Not verified

- Fly-Client-IP keying behind the real fly-proxy, and how 20 connections per address behave
  behind NAT.
- A real widget editing large or infinite-scroll pages: more than 5 rescans per minute, maps over
  64 KiB.
- Fail-closed behaviour of the site budget against a real Redis.
- The local Supabase + Redis parity fixture.
- Load or DDoS measurement. A per-address cap does nothing against many addresses.

## Fix run

Completed locally on 2026-10-28. The new tests were run against the correct implementation,
then each guard below was temporarily neutralized, observed red, restored and run green.
The reviewer findings and verdict above/below are preserved as the original review record.

| Finding / mutation | Observed red evidence |
|---|---|
| Major 1: remove `await` from `await handler(...args)` | Both real `join-dashboard` dependency cases failed: no generic failure ACK, plus escaped Error (synchronous room join) / TypeError (asynchronous credential revalidation after the injected sites read). |
| Major 2: remove Engine.IO reservation transfer | After the 30 ms reservation timeout, a second raw WebSocket was accepted while the first remained open; the refusal assertion failed. |
| Major 2: transfer without clearing its timer | The same held-open connection test wrongly admitted the second transport. |
| Major 3: remove liveness check after `checkHandshake` | Database reads became `["sites"]` instead of `[]` after the client disconnected. |
| Major 3: remove liveness check after the site lookup | Limiter calls became 3 instead of 1. |
| Major 3: remove liveness check after the verified site's bucket | Reads continued into `staging_access` and `site_editors`. |
| Major 3: remove liveness check after `resolveGrant` | A late `Set.add(socketId)` restored connection bookkeeping (1 instead of 0). |
| Major 3: remove degraded-mode liveness check after its site bucket | A late `Set.add(socketId)` likewise restored bookkeeping (1 instead of 0). |
| Minor: remove `hasAcknowledged` | Server-side ACK packet count became 2 instead of 1; duplicate suppression by the client no longer hides the defect. |
| Minor: remove reservation `released` guard | Engine.IO close followed by explicit release reduced the address count to 0 instead of preserving the other live reservation at 1. |

The real-handler cases also assert exactly one generic failure ACK at the server packet layer,
a healthy second client and HTTP `/health` 200. The admission tests use delayed real store/read
paths and inspect room membership plus socket-id additions to connection bookkeeping; no new
admission injection option was added. The transport case also proves closing frees capacity.

The concurrent transport option is now `maxConcurrentTransportsPerAddress`, distinct from the
handshake rate limiter. Connection-limiter defaults use `??`, and the module follows server
single-quote style. Its read-only `count(address)` supports direct per-address lifecycle assertions.
`messageRateLimitCheck` remains explicitly documented as test-only: the existing store injection
intentionally converts faults to fail-closed verdicts and cannot exercise a rejected limiter.
`docs/stories.md` now differs from `origin/main` only by the s128 append; the plan's focused
inventory is corrected to five suites and 230 tests for the reviewed baseline.

Validation: focused websocket suites passed **5/5, 238/238 tests** after restoration. Explicit
`node --check` passed for all three server modules, and `git diff --check` passed. A credential-cleared
`npm run build` passed. Full Jest (`NEXT_PUBLIC_APP_URL=http://localhost:3000`, `--runInBand`)
passed **574 suites, 8,598 tests** (1 suite / 2 tests skipped), with no retry needed.
Lint passed with 0 errors / 34 existing warnings; type-check and format:check passed.
The final commit runs the same normal pre-commit gates without bypassing hooks.

Follow-up retained: successful `content-map` still does not ACK. Its pre-existing behavior is
unchanged by this fix run; any success-ACK contract change needs separate follow-up. L21 remains
deferred. No production access, push, PR or deployment was performed.

Max severity: major
Ship allowed: yes
