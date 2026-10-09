# Stripe test Checkout entitlement proof

This is an explicit operator lane, not a default CI test. It proves that a real Stripe-hosted
test-mode subscription Checkout reaches RecopyFast through Stripe CLI signed webhooks and becomes
one durable Pro entitlement in a disposable local Supabase stack. It never points at production,
never inserts an entitlement directly and never treats test mode as evidence of a live charge.

## Prerequisites

- Docker, Supabase CLI 2.117.0, Chromium and Stripe CLI are installed. The runner checks the
  Supabase version exactly and refuses any other global CLI. To avoid changing a global install,
  set `RECOPYFAST_SUPABASE_CLI_BIN` to the path of an executable pinned to 2.117.0; that executable
  must accept ordinary Supabase CLI arguments and report `2.117.0` from `--version`.
- `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and
  `STRIPE_PRO_PRICE_ID` name non-placeholder objects in the same Stripe test account. Keep them in
  the shell or an ignored `.env.local`; never upload them or add them to GitHub Actions.
- Ports 3000, 4001, 54321, 54322 and 6379 are free.
- `STRIPE_LIVE_MODE` is not `true` and `VERCEL_ENV` is not `production`.

Run:

```bash
npm run test:e2e:stripe-provider
```

The command runs twice by default. Each pass starts the exact lean s24-shaped local stack with
`supabase start -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`.
That leaves the database, Kong, Auth, PostgREST and Storage running for the application and health
checks without pulling the unrelated Studio, Edge, Realtime and observability services. It then
starts Redis, Socket.IO, production Next and a Stripe CLI test listener, injects the listener's
ephemeral signing secret into that local Next process only, completes hosted Checkout and tears the
entire stack down with `supabase stop --no-backup`. `--runs=1` exists only for focused local
diagnosis; release evidence is the default twice-clean command.

## Confirmed operator outcome

On 24 September 2026, the default command completed two consecutive runs successfully. Each strict
Playwright invocation passed its one expected test with zero failed, skipped or flaky tests. Each
run proved complete, paid and reconciled Checkout; Pro entitlement; exactly one active subscription
during the assertion; four processed genuine events; a signed replay reported as a duplicate; and
successful scoped cleanup. The process-external parent janitor reached clean state after 18 passes
in each run.

An independent read-only Stripe aggregate immediately afterward found two cleaned manifests, two
retained paid Checkout Sessions and two retained canceled subscriptions, with zero open Sessions,
zero billable subscriptions and zero mutable Customers. Local inspection found zero s25 containers,
no Stripe listener and all task ports free. Every retained provider evidence, summary, manifest and
janitor-state file was owner-only (`0600`). No provider identifier, disposable identity, payment
value or secret is recorded here.

The Stripe test secret is inherited by the CLI through its supported `STRIPE_API_KEY` environment
variable; it is never placed in the process argument list. Before entering the run loop, the runner
checks every indexed provider manifest in `test-results/`, including indices excluded by `--runs=1`.
Any malformed or non-`cleaned` manifest blocks the whole command, so a new run 1 cannot erase the
ownership identity of an unfinished run 2. Before each pass the runner removes the exact prior
summary, evidence, failure and janitor-state files for that run index.

## What must pass

- The guard verifies exact loopback app/Supabase origins, explicit opt-in, test key shapes and the
  active monthly USD Pro Price with `livemode=false` before it creates a user.
- A directly confirmed disposable Auth user signs into an app-compatible cookie session without
  visiting `/auth/callback` or `/auth/confirm`, so no production trial callback can mask payment.
- The authenticated real `/api/billing/checkout` route creates the Session; Stripe-hosted Checkout
  uses Stripe's public success test value entirely in memory, explicitly selects the United States
  before entering its ZIP code, and dispatches a click event on the visible exact AI-agent
  disclosure text before asserting its associated hidden checkbox is checked. The DOM event avoids
  Playwright's viewport actionability gate: a real run found the exact visible label but Stripe's
  nested scrollport still reported it outside the internal viewport. The helper rescans newly
  mounted frames for the exact label/control pair, has its own five-second discovery/action bounds,
  fails when the pair never appears, and never targets the hidden input with `check()`. Mandatory
  field discovery and fill/select, optional-field inspection, disclosure interaction and the
  post-submit hosted error-text scan all use one bounded frame-snapshot primitive. Stripe may replace
  a hosted frame while that primitive is counting, checking visibility, acting or aggregating text.
  Only Playwright's exact `Frame was detached` failure during inspection or an explicitly idempotent
  setter discards the whole partial snapshot and resumes from a fresh `page.frames()` set; the caller's
  original 30-second field, five-second disclosure or
  90-second return budget is not restarted. The primitive threads that one absolute deadline through
  snapshot inspection and supplies every waiting Playwright action/assertion with the positive
  remaining timeout; zero can therefore never disable Playwright's timeout. Disclosure dispatch and
  checked-state polling share a child deadline capped by both the action and outer discovery bounds.
  They also share one non-idempotent action boundary, so a checked-state detachment after dispatch
  propagates rather than dispatching a second time. Only fill/select setters explicitly marked
  idempotent retry after detachment; the submit click is outside this retry path, and unrelated
  failures still propagate. An optional field remains optional only after one complete stable
  snapshot proves it absent. Each mandatory hosted field is rescanned every 250 ms using the proven
  field names, never an arbitrary fixed sleep or selector. The post-submit scan likewise never treats
  a partial or detached count as zero evidence.
- Checkout is complete, paid and reconciled; the captured customer, one active subscription,
  processed genuine event IDs and `/api/billing/entitlement` all agree on Pro.
- One captured event is re-signed with the ephemeral local listener secret and replayed. The route
  reports it as a duplicate and neither the subscription nor ledger count changes.
- The process-external janitor cancels the captured test subscription, deletes the captured test
  customer, deletes only captured IDs from local tables, deletes the captured Auth user and proves
  no mutable residue. It repeatedly rediscovers run-owned Checkout Sessions, Customers,
  subscriptions and local rows, including objects created after form submission, and expires every
  owned Session that remains open. The Playwright fixture exposes no provider/local/Auth cleanup API.

The safe evidence files under `test-results/` contain the run ID, provider object IDs, statuses,
event types and cleanup booleans only. The runner accepts evidence only when its run ID, run index,
configured Price and timestamp match the current pass; a stale prior pass cannot be reported as a
success. These files contain no API key, signing secret, Auth token, email, password, card value,
hosted Checkout URL or Checkout Session secret. Trace, screenshot and video capture stay off even on failure. Playwright is configured with
`preserveOutput: "never"`, and the runner removes its exact per-run provider output directory again
in `finally`; a failed run must not retain `error-context.md` or any other browser artifact.

On failure the spec writes one owner-only (`0600`) JSON file named
`stripe-provider-failure-run-<n>.json`. Its schema is deliberately closed to four fields:
`mode=test`, the run index, a bounded lifecycle stage such as `checkout:inspect-open` or
`checkout:hosted-form`, and a redacted diagnostic. The runner validates that schema and rejects any
email, card, key, signing secret or JWT shape before printing it. The next run removes the previous
safe failure file before starting; raw Playwright output is never retained.

The janitor keeps its detailed stage diagnostics on stderr for the operator, while the persisted
failure artifact receives only the fixed `external_janitor` cleanup label. Raw provider errors and
object IDs never enter the safe failure JSON.

The state-backed `afterEach` hook is deliberately non-destructive. It writes bounded failure
diagnostics, gives the still-running flow ten seconds to settle, aborts its harness signal and closes
the page when needed, and may persist already-captured success IDs. It never expires a Checkout
Session, cancels a subscription, deletes a Customer, deletes local rows or deletes Auth. This keeps a
Customer created just before a late Checkout response active until the parent can discover it and
prove its metadata ownership. The runner pre-generates the run ID, exact Auth UUID, disposable email
and start timestamp, bounds the Playwright child, and launches the sole mutation authority: a
separate janitor process while Next, Stripe CLI and local Supabase are still alive. Direct invocation
of the dedicated Playwright config fails closed unless its exact runner-owned starting manifest and
internal runner flag are present.

The janitor independently repeats the complete local/test-mode guard and validates the configured
Price before constructing clients or mutating anything. It fully paginates Customers, Checkout
Sessions and subscriptions and fails closed if a provider page cannot advance. Every destructive
Stripe call is preceded by provider-truth ownership proof: `livemode=false`, creation no earlier than
the run, exact `metadata.user_id`, exact Checkout reference/metadata and an owned Customer
relationship. A foreign test-mode ID discovered through a local row is refused and preserved.

The janitor repeatedly discovers the exact Auth user, Customers, Sessions, subscriptions and local
rows, then expires/cancels/deletes only proved objects. Terminal webhook delivery is cumulative and
keyed by every discovered Customer and subscription ID; its owner-only state lets the final
idempotent janitor rerun retain that proof after the first janitor deletes local rows. On success,
sixteen consecutive clean observations require at least 30 quiet seconds. After Playwright error,
timeout or interruption, observations made during the first five minutes are discovery-only and do
not count as quiet proof; only after that horizon can sixteen consecutive quiet probes complete.
Five minutes exceeds the application Stripe SDK's ordinary worst request lifetime of three 80-second
attempts plus retry delay, closing the late-route-call race. The janitor process receives a ten-minute
timeout so the failure horizon, consecutive proof and ordinary provider latency fit inside its parent
bound. Its pass budget includes two complete sixteen-pass quiet windows beyond the observation
horizon, plus one boundary pass. The second window is deliberate: a real successful proof produced
cleanup/webhook activity during the first window and exhausted the old 17-pass budget before it could
observe sixteen new quiet passes. The failure-horizon budget schedules at most 364 seconds of polling
intervals, remaining below the ten-minute process bound. A pass that discovers or mutates owned
provider objects, local rows or terminal-event proof
resets the consecutive count even when that pass finishes with zero residue; sixteen new quiet passes
must follow the last activity. Once the explicit parent pass succeeds, final service cleanup records
completion without needlessly repeating the observation horizon; if it fails or never starts, the
final cleanup state machine retries it before stopping services. Cleanup therefore does not depend on
the Checkout response, fixture resolution, browser context or timed-out test body completing.

The runner writes an owner-only (`0600`) manifest before the first local mutation, installs
`SIGINT`/`SIGTERM` cleanup handlers, launches child process groups detached, and terminates the whole
group before the janitor rerun. Teardown sends `SIGTERM`, polls the process group until the kernel
proves it absent with `ESRCH`, escalates to `SIGKILL` after the grace deadline, and then performs one
more bounded poll. A Darwin `EPERM` probe can represent a zombie-only group, so it remains
unknown/present rather than being accepted as successful cleanup; expiry of the post-kill deadline
fails closed. The listener is registered for cleanup immediately on spawn, before its readiness
secret is awaited. Janitor reconciliation always runs before app, listener and local Supabase
shutdown once the guarded app environment exists.

This is a bounded recovery design, not a crash-proof guarantee. Catchable interrupts and configured
timeouts run the state machine; an uncatchable `SIGKILL`, host power loss, kernel failure or external
Docker termination can still stop it. In that case the unfinished manifest is intentionally retained
and creates a fail-closed human recovery gate: a new run is blocked until an operator reconciles that
exact test run from provider truth. The manifest and janitor state never contain credentials, email,
card data or Checkout URLs.

When the external janitor fails after a validated primary Playwright failure, the safe failure JSON
keeps the primary stage diagnostic and appends only the fixed label
`cleanup failed: external_janitor` within the same bounded/redacted four-field schema. If the janitor
is the only failure, the runner creates an owner-only four-field failure at stage `cleanup` with that
same fixed diagnostic. Raw janitor exceptions and provider IDs are never copied into this artifact.

Stripe retains immutable Checkout Session and event history after cleanup. The evidence reports
that history as retained; it must never claim those immutable records were deleted. A canceled
subscription likewise remains as Stripe history but is no longer billable, while the test customer
is deleted.

## Live-payment boundary

Stop after this test-mode proof. A live payment is a separate human financial action. Before any
live step, the user must explicitly choose the exact SKU and period, maximum total including tax,
identify the payer, and choose whether the resulting subscription is retained, canceled or
refunded. The payer enters payment details directly. Only then may an operator verify the signed
live event, durable ledger, entitlement and requested cleanup. Never reuse this automated lane,
its test values or its cleanup assumptions against production.
