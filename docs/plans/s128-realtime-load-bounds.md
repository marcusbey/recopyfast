---
validated: no
story: s128-realtime-load-bounds
---
# Plan — Story s128-realtime-load-bounds

Branch: `feature/s128-realtime-load-bounds`
Research: [s128-realtime-load-bounds](../research/s128-realtime-load-bounds.md) — read it first.
No UI design. Owner validation is pending; phase 1 authorizes documentation only.

## Target story

Bound H4 database amplification and M6 transport retention, contain L22 handler failures, and
preserve s79 credentials, editor parity, fail-closed stores and authoritative HTTP persistence.
L21 remains open for a separate visitor/editor admission-isolation decision.

Proposed defaults for validation: 5 content-map events/socket/minute, 30/site/minute,
20 pending-or-open transports/address, connectTimeout 5000 ms and maxHttpBufferSize 65536 bytes.
Use existing normalized address semantics, including IPv6 /64 and a shared unknown bucket.

## Tasks (ordered)

1. [ ] **Transport reservation lifecycle — test first.** Add a small server/connection-limits.js
       helper and unit tests under src/__tests__/websocket/connection-limits.test.ts. Prove a
       synchronous reservation counts pending and established connections together; request N+1
       fails; each release is idempotent; zero-count entries disappear; failures, aborted upgrades,
       request-socket close, timeout and server shutdown do not leak reservations. Reuse exported
       addressBucket and the existing trustFlyClientIp policy. No raw attacker-string map keys,
       Redis fallback, new dependency or namespace-count shortcut. Test overlapping reservations
       before any connection event, mapped IPv4 equivalence, IPv6 /64 and untrusted Fly headers.
2. [ ] **Wire Engine.IO bounds — test first.** Extend real-transport integration tests, then
       install allowRequest and the two explicit Server options in server/index.js. Reserve before
       accepting the initial upgrade; attach failure cleanup immediately; transfer the reservation
       to the Engine.IO connection close lifecycle without double counting. Prove no-CONNECT raw
       sockets close after the configured deadline (short injected deadline for fast tests, plus
       default-option assertion), an over-64-KiB frame closes before handler DB/Redis work, and a
       normal smaller frame succeeds. Assert rejected upgrades cause zero Supabase calls. After
       close/error/abort/refusal, the next connection must regain capacity. Keep websocket-only.
3. [ ] **Close every refusal transport — test first.** Drive missing id/token, bad HMAC/Origin,
       invalid grant, limiter denial and later revocation with raw clients that do not voluntarily
       close. Assert Engine.IO clientsCount returns to baseline and other sockets survive. Route
       the existing refusal branches through consistent disconnect(true) behavior, preserving
       generic auth-error messages. Async admission must check transport liveness after awaits:
       a disconnected client must not join rooms, restore bookkeeping or emit late events.
4. [ ] **Content-map early gate and budgets — test first.** Add read/Redis-call-count regressions
       for visitor and degraded sockets: zero extra reads, increments or fan-out, even when payload
       claims stagingMode. Gate on server-owned socket.data.isStaging before the generic Redis
       message limiter. For staging maps, check message-token equality, then a synchronous local
       5/minute per-socket counter before any await/Redis work; then fail-closed per-site 30/minute
       budget in server/rate-limit.js, followed by existing general message checks and authorization.
       Keep local denial state until its window ends; clear on disconnect. Fixed-window boundaries
       permit adjacent-window bursts and tests must state that explicitly. Excess calls must neither
       reach Supabase nor amplify Redis; per-site denied calls remain bounded by the local budget.
       Different sockets share the site budget; different sites remain independent. Preserve generic
       rate-limit-error and optional failure ack behavior.
5. [ ] **Memoize only in-flight map revalidation — test first.** Within the bounded staging map
       path, concurrent events share one pending revalidateSocket promise per socket. Clear it on
       either settlement and on disconnect; never cache a failure or completed success. Prove
       simultaneous accepted maps perform one validation, a later map after rotation/revocation
       performs a fresh check and emits nothing, and failed reads close the transport. Recheck
       socket.connected before any fan-out after awaits. content-update, join-dashboard and the
       independent all-socket sweep retain their existing fresh credential checks. Update the old
       visitor-fanout limiter test to use a staging sender; retain zero-fanout visitor coverage and
       move immediate content-map rotation proof to a staging sender. Document those behavior
       changes in review/PR; preserve viewer sweep and device-binding assertions.
6. [ ] **Contain event failures — test first.** Wrap the entire common onMessage path (local gates,
       awaited limiter and awaited handler) in try/catch. Provide one guarded ack callback so a
       handler that acknowledges and then throws cannot acknowledge twice. Return a generic failure
       without exception text or raw payload/credentials; bounded diagnostics name only the event
       and safe error category. Inject a synchronous throw and async rejection through real handler
       dependencies, including a limiter rejection; prove the process/health and a second editor
       remain alive, with no unauthorized fan-out. Keep installCrashHandlers unchanged for faults
       outside this request boundary. Existing handler-level catches may remain where they preserve
       established update-error responses; do not broaden into an error-handling refactor.
7. [ ] **Document and verify the boundary.** Add incident-anchored comments and update only the
       relevant server/README.md admission, limits and rotation paragraphs. Run focused websocket
       suites first, then lint, type-check, type-check:build, format:check, full Jest, coverage and
       a credential-free local build. Check JS syntax for changed server modules explicitly because
       root lint covers src only. Use the local-only realtime parity/additive fixture if its disposable
       dependencies are available; otherwise report that gap, do not point it at hosted services.
       Record commands/results and tick tasks only when proven. Audit diff for prohibited files.
8. [ ] **Independent review and PR handoff, later phase only.** Review the final story diff against
       the acceptance criteria, lifecycle races, credential regressions and no-write invariant.
       docs/reviews/s128-realtime-load-bounds.md must end with the mechanical Max severity and
       Ship allowed lines. Only after a passed review and separately authorized shipping phase,
       prepare the PR. Merge is manual; no Fly deployment is authorized by this plan.

## Run interdicts

- Phase 1: no source/test/config edits; no push, PR, validation flag change or implementation.
- No production access, including read-only calls; no Supabase/Fly/Vercel/Stripe operations.
- Never read .env* files, run server CLI startup against inherited credentials, or use hosted
  services in tests. Use factory injection, fake credentials and local ephemeral listeners.
- No existing migration changes, new migration, secret handling, history rewrite or git stash.
- No edits to credit_purchases, copy_styles or src/app/api/edit-board/styles/** (s125 ownership).
- Keep server/auth.js credential logic, server/fly.toml, server/sentry.js, all HTTP routes and
  public/embed/** unchanged. No Redis adapter, scaling, polling or new package/lockfile changes.
- Do not weaken s79 grant expiry, revocation, key rotation, live permission intersection or
  device binding. A 10-second completed-verdict cache is not authorized by this plan.
- No claim that L21 is fixed, that Fly is deployed, or that a local capacity test proves
  distributed-DDoS resistance. A per-IP cap does not prevent an attack from many IPs.
- Never bypass git hooks. Export NEXT_PUBLIC_APP_URL=http://localhost:3000 for checks/commit.

## The point everything turns on

**Bound work before it reaches a shared service without caching away credential checks.**

- Compare content-map's gate/order with index.js:501-548: leaving the visitor gate inside the
  existing wrapper still spends Redis on every visitor event. Local rejection must precede it.
- Compare memoization with auth.js:198-213 and the s79 rotation tests at
  server.integration.test.ts:2233-2284: completed-success TTL caching changes the security contract.
  Sharing one outstanding validation preserves the later-message check; disconnect races must
  still suppress delayed fan-out.
- Compare allowRequest accounting with Engine.IO's actual lifecycle: it runs before a session
  exists. Counting only connection events permits parallel upgrades to exceed the cap; releasing
  at HTTP request completion drops counts while upgraded WebSockets are still alive.

No new ADR: this plan preserves the existing authorization and single-process architecture.
If the owner instead chooses TTL-cached authorization or L21 budget isolation, return to planning
and record the actual structural decision and alternatives; ADR 075 remains reserved by s125.

## Files touched

Phase 1 only:
- docs/stories.md (append s128 only)
- docs/reviews/security-audit-2026-10.md (supplied copy, unchanged)
- docs/research/s128-realtime-load-bounds.md
- docs/plans/s128-realtime-load-bounds.md

After owner validation:
- server/index.js, server/rate-limit.js, server/connection-limits.js (new), server/README.md
- src/__tests__/websocket/server.integration.test.ts
- src/__tests__/websocket/connection-limits.test.ts (new)
- src/__tests__/websocket/harness.ts (only bounded failure/read instrumentation if necessary)
- Story plan/progress and docs/reviews/s128-realtime-load-bounds.md (later independent review)

## Test strategy

Use real Socket.IO and raw WebSocket connections to an ephemeral local factory with
RecordingSupabase and recording memory/throwing stores. Unit tests control time for fixed-window
budgets and reservations; deferred promises exercise overlapping revalidation and disconnect races.
Assert observable transport closure, call counts and absence of writes/fan-out, not merely options.
Preserve auth-parity.test.ts, all server revocation/room isolation tests and server-manifest.test.ts.
No dependency is added for raw clients: use an already installed transport test capability and
verify its API before implementation. Root Jest does not discover server/ tests.

Large map fixture: a payload over 64 KiB loses realtime while the embed's HTTP discovery/save
path remains functional. No UI error, widening payload limit or embed rewrite is part of the fix.
Record any local-stack gap separately from unit/integration evidence; no network load test.

## Definition of Done

**Phase 1:** the four documentation files are committed on the correct branch after npm ci and
normal pre-commit checks, validated remains no, and there are no code changes/push/PR/deploy.

**Later implementation:** tasks 1–7 pass with fresh evidence; no prohibited diff; planned behavior
changes to the two visitor tests are explicit; independent review allows shipping. Full feature
completion still requires manual merge and separately authorized deployment/verification. A local
pass or opened PR must never be reported as a deployed security fix.

## Owner validation questions

1. Approve the proposed 20/address connection cap and 30/site/minute inventory cap?
2. Approve in-flight-only memoization to preserve immediate s79 checks, instead of a 10-second TTL?
3. Approve keeping L21 open for a separately scoped admission-isolation story?

Plan awaiting validation. Rerun /ks-plan s128-realtime-load-bounds to validate.


## Phase 1 validation evidence — October 27, 2026

- npm ci completed successfully; no tracked package/lockfile changes.
- Normal git commit invoked with NEXT_PUBLIC_APP_URL=http://localhost:3000, without bypasses.
- Hook lint passed (34 warnings, zero errors), type-check passed, format:check passed.
- Full Jest: 572 suites passed, 1 failed, 1 skipped; 8570 tests passed, 1 failed, 2 skipped.
  Failure: src/lib/tools/extract/__tests__/extract-page.test.ts, “extracts a 2 MB page in
  under 2 s”, returned refused: too_complex. Hook refused the commit.
- Isolated unchanged-suite rerun with --runInBand also failed that case (101 passed, 1 failed).
  Host one-minute load was 406 during the full run and 389 after retry; resource pressure is
  a plausible contributor, not a proven root cause. No application/test edits were made.
- Four documentation files remain staged; HEAD remains 534e7926. Commit is blocked pending
  a passing normal hook. No hook bypass, push, PR, production access or implementation occurred.
