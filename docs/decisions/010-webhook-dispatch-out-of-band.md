# ADR 010 — Webhook dispatch is out-of-band: `after()` to mark, one cron to sweep

- Status: accepted
- Date: 2026-08-16
- Scope: story s16-webhook-config

## Context

`s16-webhook-config` requires: a burst of rapid edits coalesces into one delivery within a
configurable window (AC 4), a failed delivery retries with exponential backoff to a stated
limit (AC 3), and none of this may delay the edit that triggered it (AC 6).

The app runs on Vercel with no long-lived process. A serverless function's execution ends at
(or shortly after) the response it returns; `after()` from `"next/server"` extends that by one
deferred callback, already used once in this repo
(`src/app/api/editor/request-code/route.ts:115`) for "no response left to shape, do the slow
part after." But `after()` is not a scheduler: its callback still runs inside the same
invocation, bounded by the same execution-time ceiling, and disappears once the invocation
ends. It cannot itself wait out a multi-minute backoff or a multi-second coalescing window —
research confirmed the code that tries to (`manager.ts:281-283`, `setTimeout(() =>
this.retryWebhook(...), delay)` with delays up to 5 minutes) silently never fires in production,
because nothing keeps the invocation alive that long.

Coalescing has the same shape as retry: both are "do this later, once a condition is true,"
and both need that "later" to survive past the end of the request that created it. Neither can
be solved by waiting longer inside one invocation.

## Decision

**Dispatch is two-phase, and both new phases persist state instead of holding a connection
open:**

1. **Mark, fast, inside `after()`.** `POST /api/staging/publish` calls
   `webhookManager.recordQualifyingEvent(...)` inside `after()`, once the publish RPC has
   already succeeded and the response has already been built. This is a single DB upsert per
   subscribed webhook, not a delivery attempt — it either opens a new coalescing window
   (`pending_dispatch_at = now() + coalesce_window_seconds`, `pending_event_type`/
   `pending_payload` set) or, if a window is already open for that webhook, replaces
   `pending_payload` with the latest state and leaves `pending_dispatch_at` where it is. The
   window is a **throttle, not a debounce**: it is set once, on the first qualifying event, and
   is not pushed forward by subsequent events during the same window. A debounce that resets on
   every edit has no upper bound on latency under continuous editing, which is a worse failure
   mode for a "rebuild my site" trigger than delivering slightly early with a merged payload.
2. **Sweep, on a cron.** One new route, `/api/cron/webhook-dispatch`, `CRON_SECRET`-gated
   exactly like the existing (unscheduled) `/api/cron/ab-test-lifecycle`, registered in
   `vercel.json`. Each run does two independent sweeps: `sweepDueDispatches()` fires every
   webhook whose `pending_dispatch_at` has elapsed, and `sweepDueRetries()` fires every
   `webhook_deliveries` row whose `next_retry_at` has elapsed. One schedule serves both
   concerns, rather than two competing crons.

Retry state moves from `setTimeout` to the same shape: `webhook_deliveries` gains `status`
(`pending`/`delivered`/`retrying`/`failed`) and `next_retry_at`. A retry **updates the existing
delivery row** rather than inserting a new one per attempt — required for the design's "Attempt
2 of 5" row to mean anything, and a deliberate change from today's `retryWebhook`, which inserts
a fresh row per retry.

## Considered options

- **Deliver synchronously inside the publish request** — rejected outright by AC 6. A slow or
  hanging customer endpoint would delay every edit that happens to be the first one after a
  coalescing window opens.
- **`after()` alone, holding the invocation open for the coalescing window / backoff delay** —
  rejected. Vercel bounds function execution time; a 5-minute backoff or even a modest
  coalescing window is not a duration any invocation can be relied on to survive, and every
  concurrent publish would hold its own invocation open, multiplying cost for no benefit.
- **In-memory debounce/timer (the status quo's `setTimeout`)** — rejected; this is the
  mechanism already confirmed broken in production. It also cannot survive a cold start or
  coordinate across concurrent invocations, both of which are normal on serverless.
- **A `pg_net`-backed Postgres trigger that dispatches directly from the database** — rejected.
  No extension in this codebase makes outbound HTTP calls from SQL today; adding one is new
  infrastructure with its own operational surface, and it still would not solve retry — a
  failed delivery still needs persisted state and a sweep, so the trigger would not remove the
  cron, only add a second dispatch path alongside it.
- **Two separate crons, one for retry and one for coalescing** — rejected. Vercel's cron
  surface is currently one entry (`generate-blog-post`); a second is already new. A third adds
  scheduling surface to reason about for no functional gain, since both sweeps are cheap,
  idempotent, and unrelated in a way that benefits from sharing a tick rather than needing
  independent ones.

## Consequences

**Easier.** Coalescing and retry share one persisted-state pattern and one cron, rather than
inventing two. The delivery history UI's "Attempt N of M, next attempt in Y" reads directly off
columns that exist, rather than being reconstructed from a scattered set of rows.

**Harder.** The cron's interval is now a hard floor under both the coalescing window and the
retry cadence — a webhook configured for a 10-second coalescing window will not actually fire in
10 seconds if the cron runs every 5 minutes; it fires on the next sweep. The UI's window options
must be chosen with the actual cron interval in mind, not independently of it. **Watch this**:
research left the achievable cron frequency on the deployed Vercel plan unverified; if the
platform cannot sustain the interval this ADR assumes, the coalescing window's stated default
and its UI-offered options need to be revisited together, not the cron alone.

**Watch.** `sweepDueDispatches` and `sweepDueRetries` must both be idempotent under Vercel's
documented cron retry behavior — a duplicate run must not deliver the same coalesced event or
the same retry twice. Each clears its own trigger condition (`pending_dispatch_at`,
`next_retry_at`) as part of the same operation that fires delivery, not after, so a crash
between firing and clearing is the only window where a duplicate is possible, and it is the same
window every idempotent cron job in this codebase already accepts.
