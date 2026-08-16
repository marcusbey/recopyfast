---
validated: no
---
# Plan — Story s16-webhook-config

Branch: `feature/s16-webhook-config`
Research: `docs/research/s16-webhook-config.md` — read it first; this plan does not repeat it.
Design: `docs/designs/s16-webhook-config.md` — the Webhooks panel on `SiteDetailView.tsx`, the
show-once secret `Dialog`, and every component listed under "Reused components" come from here
verbatim.
Decision: `docs/decisions/010-webhook-dispatch-out-of-band.md` — the out-of-band dispatch
architecture every task after Task 1 builds on. Read it before Task 3.

## Target story

`s16-webhook-config` (`docs/stories.md:889-919`). Complexity **4** at research (up from 3) — a
new scheduled job, a new security-critical validation module, and one inherited correctness bug
that must be fixed as a precondition, not three separate stories' worth of work but more than
"wiring." No split proposed by research; none proposed here.

Acceptance criteria carried forward verbatim from `docs/stories.md`:
1. An owner can configure a webhook URL per site and see recent delivery history.
2. A content change delivers a signed POST, verifiable with a secret shown once at creation.
3. A failed delivery retries with exponential backoff to a stated limit, then is marked failed
   and visible as such.
4. Rapid successive edits are coalesced within a configurable window so a burst of edits does
   not trigger a burst of rebuilds; the default is stated in the UI.
5. The URL is validated against SSRF — private, loopback and link-local addresses refused — at
   configuration time **and** again at delivery time.
6. A slow or hanging endpoint times out and does not delay the edit that triggered it.
7. Test delivery can be triggered manually from the dashboard.

**Scope decisions this plan settles (research left them open):**
- **Anchor point: `POST /api/staging/publish`, not a DB trigger.** Per the assignment's own
  steer ("hook the right seam... the publish path") and research's own hesitation about a DB
  trigger being "a bigger design commitment... to make unilaterally." Consequence, stated
  plainly: bulk-imported content changes (`src/app/api/bulk/import/route.ts`) do **not** fire
  webhooks. `s05` is independent of `s16` in the story graph and this gap is not silently
  dropped — it is Run Interdict 4 below, reviewer-checkable.
- **DNS-rebinding defense: resolve-and-recheck, not pin-and-connect.** The AC's own wording
  ("resolve and re-check the address at delivery time") and the assignment's framing describe
  the narrower fix. The fully-pinned version (a custom `fetch` dispatcher forcing the TCP
  connection to a pre-validated IP) is materially more work and is not what either text asks
  for. See "The point everything turns on" for the residual risk this leaves.
- **Coalescing is a throttle, not a debounce.** Fixed window from the first qualifying event;
  not extended by subsequent events in the same window. Justified in ADR 006.
- **Secret storage stays plaintext-at-rest, unlike API keys' `key_hash`.** The "show-once,
  never re-displayed" *behavior* is reused from `api-keys/route.ts`; the *one-way hash*
  mechanism is not, and must not be, because `deliverWebhook` needs the plaintext secret to
  compute an HMAC signature at delivery time — a hash cannot be reversed for that. See "The
  point everything turns on."
- **A missing design-system primitive, found during planning, not by research or design.**
  `docs/design-system.md` lists `Select` as one of the "17 primitives" in
  `src/components/ui/`, and `@radix-ui/react-select` is a declared dependency — but no
  `src/components/ui/select.tsx` file exists, and nothing in `src/` imports one (confirmed by
  directory listing and grep). The design brief for this story specifies a `Select` for the
  coalescing window and was written against the documented (not actual) component set. Task 8
  below creates the missing primitive; this is treated as filling a **captured-but-missing**
  floor component the design system already claims exists, not as inventing a new one beside
  it.

## Tasks (ordered)

1. [ ] **Schema: extend `webhooks` and `webhook_deliveries`; update the hand-written types.**
   New migration `supabase/migrations/20260816150000_webhook_dispatch_and_secrets.sql`, forward
   only, no edits to any applied migration:
   - `webhooks` gains: `secret_prefix TEXT` (set at creation, never updated — the
     `key_prefix` analogue for display), `coalesce_window_seconds INTEGER NOT NULL DEFAULT 30`,
     `pending_event_type TEXT`, `pending_payload JSONB`, `pending_dispatch_at TIMESTAMPTZ`.
   - `webhook_deliveries` gains: `status TEXT NOT NULL DEFAULT 'delivered' CHECK (status IN
     ('pending','delivered','retrying','failed'))`, `next_retry_at TIMESTAMPTZ`.
   - No new RLS policy needed: both are column additions to already-policied tables (RLS is
     row-scoped, not column-scoped), confirmed against
     `supabase/migrations/20260731004000_missing_tables_integrations.sql`'s existing policies.
   - Update `Webhook`/`WebhookDelivery` in `src/types/index.ts` (`:513-540`) to match.
   Test: `npx supabase db reset` (or the project's documented local-apply path) applies cleanly;
   `npm run type-check` passes with the widened interfaces; a one-off local check (not
   committed) that inserting a row omitting every new column still succeeds, confirming the
   defaults are non-breaking for the existing manager code before Task 3 changes it.

2. [ ] **New module: `src/lib/security/webhook-url-safety.ts` — the SSRF check.**
   Exports `assertSafeWebhookUrl(rawUrl: string): Promise<ValidationResult<string>>` (the
   `ValidationResult<T>` shape from `src/lib/api/validation.ts`, per ADR 003 — no zod). Steps:
   parse with `new URL`; reject any scheme other than `http:`/`https:`; if the hostname is a
   literal IP, parse it directly with `ipaddr.js`; otherwise resolve with
   `dns.promises.lookup(hostname, { all: true, verbatim: true })` and check **every** returned
   address. For each address, reject if `ipaddr.process(addr).range()` is one of `private`,
   `loopback`, `linkLocal`, `unspecified`, `multicast`, `carrierGradeNat`, `reserved` (IPv4) or
   `uniqueLocal`, `loopback`, `linkLocal`, `multicast`, `unspecified`, `reserved` (IPv6) —
   **including unwrapping an IPv4-mapped IPv6 address** (`::ffff:169.254.169.254`) via
   `isIPv4MappedAddress()`/`toIPv4Address()` before checking its range, since an unwrapped
   check would let that specific smuggling pattern through.
   Test (`src/__tests__/security/webhook-url-safety.test.ts`): table-driven — public IPv4/IPv6
   literal passes; `127.0.0.1`, `169.254.169.254`, `10.0.0.5`, `192.168.1.1`, `::1`, `fe80::1`,
   `fc00::1`, `::ffff:169.254.169.254` all refused; a hostname mocked to resolve to a public
   address passes, to a private one is refused; `file://`, `ftp://` refused by scheme; malformed
   URL refused; a mocked DNS resolution failure is refused (fails closed, not open).

3. [ ] **`WebhookManager`: secret handling stops leaking, coalescing entry point added.**
   In `src/lib/webhooks/manager.ts`:
   - `createWebhook` drops the caller-supplied `secret` parameter entirely — always
     `generateSecret()` — and additionally computes `secret_prefix` (first 8 hex chars) at
     creation, stored alongside.
   - `getWebhooks` selects an explicit column list excluding `secret` (include
     `secret_prefix`); the plaintext `secret` is returned **only** from `createWebhook`'s
     return value, which the route layer (Task 6) is responsible for surfacing exactly once.
   - New `recordQualifyingEvent({ siteId, eventType, payload }): Promise<void>` — for each
     active webhook subscribed to `eventType`: if `pending_dispatch_at` is null, set it to
     `now() + coalesce_window_seconds` and set `pending_event_type`/`pending_payload`; if
     already set, replace `pending_payload` only (see ADR 006 — throttle, not debounce).
   - New `sweepDueDispatches(): Promise<{ dispatched: number }>` — selects webhooks where
     `pending_dispatch_at <= now()`, calls the existing per-webhook delivery path with the
     merged payload, then clears `pending_event_type`/`pending_payload`/`pending_dispatch_at`
     as part of the same operation that records the delivery (ADR 006's idempotency note).
   Test (extends `src/__tests__/webhooks/manager.test.ts`): `createWebhook` ignores a
   caller-supplied `secret` and returns a 64-hex-char generated one; `getWebhooks` output never
   contains a `secret` key on any row; `recordQualifyingEvent` sets `pending_dispatch_at` on
   first call and leaves it unchanged but replaces `pending_payload` on a second call within the
   window; `sweepDueDispatches` fires exactly the webhooks whose window has elapsed and clears
   their pending state, leaving not-yet-due webhooks untouched.

4. [ ] **`WebhookManager`: replace the `setTimeout` retry engine with persisted state.**
   Remove `setTimeout` from `handleWebhookFailure`; `deliverWebhook` and (the now-unified) retry
   path write `status`/`next_retry_at` onto the delivery row instead of scheduling in-process.
   A retry **updates the original delivery row** (same `id`, incremented `attempt_number`) —
   not a new row per attempt, a deliberate change from today's `retryWebhook`, needed for the
   design's "Attempt N of M" row to correspond to one thing. `calculateRetryDelay`'s formula is
   unchanged (`2^attempt * 1000ms`, capped at 5 minutes) — only its *trigger mechanism* changes,
   from `setTimeout` to `next_retry_at` plus a sweep. On reaching `MAX_DELIVERY_ATTEMPTS` (a new
   named constant, 5 — matching the existing `max_failures` default so the UI's "gave up after 5
   attempts" copy and the webhook's own auto-disable threshold agree, though the two remain
   distinct concepts: `max_failures`/`failure_count` govern disabling the *webhook* across
   deliveries, `MAX_DELIVERY_ATTEMPTS` governs retrying *one* delivery), set `status='failed'`,
   `next_retry_at=null`; the row stays queryable, never pruned.
   New `sweepDueRetries(): Promise<{ retried: number }>` — selects `webhook_deliveries` where
   `status='retrying'` and `next_retry_at <= now()`, re-attempts each, updates its row.
   `src/__tests__/webhooks/manager.test.ts`'s existing `setTimeout`-based assertions no longer
   hold and are rewritten, per `AGENTS.md`'s "change the test and say so" rule — say so in the
   PR description, not just the diff.
   Test: a failed first attempt sets `status='retrying'` with a `next_retry_at` matching the
   existing backoff formula; `sweepDueRetries` picks up a due row, re-attempts it, and on
   success sets `status='delivered'`; on exhausting `MAX_DELIVERY_ATTEMPTS`, `status='failed'`
   and `next_retry_at` is null; a not-yet-due retrying row is left alone by the sweep.

5. [ ] **Delivery-time SSRF recheck, wired into every outbound call site.**
   `deliverWebhook`, the retry path (Task 4), and `testWebhook` each call
   `assertSafeWebhookUrl` (Task 2) immediately before their `fetch()` — no caching of Task 2's
   config-time result across the gap. On failure, record the delivery/test outcome as failed
   with a distinct reason string identifying DNS rebinding specifically (matching
   `docs/designs/s16-webhook-config.md`'s required copy: the endpoint resolved to a private
   address **at send time**, not a generic connection failure), and never call `fetch()`.
   Test: a URL that passes Task 2's check at config time but whose mocked DNS resolution now
   returns a private address at delivery time is refused; the delivery row records the
   DNS-rebinding-specific reason; `fetch` is asserted never called for that case.

6. [ ] **CRUD routes: config-time SSRF, PUT allowlist, DRY auth, rate limiting.**
   `src/app/api/webhooks/route.ts`, `src/app/api/webhooks/test/route.ts`:
   - New shared helper `src/lib/webhooks/access.ts` exporting
     `requireWebhookSitePermission(supabase, siteId, userId): Promise<boolean>` — the
     `site_permissions` `["edit","admin"]` lookup, currently duplicated five times across the
     two files, in one place.
   - Convert the hand-rolled `createServerClient(...)` cookie boilerplate (4 call sites) to
     `createClient()` from `@/lib/supabase/server.ts` (`getAll`/`setAll`), matching every other
     first-party route and `api-keys/route.ts` specifically.
   - `POST`/`PUT` call `assertSafeWebhookUrl` (Task 2) before persisting; on refusal, return 400
     naming the specific address class refused, matching the design's config-time `Alert` copy.
   - `PUT` moves off `{ webhook_id, ...updates }` spread-through to an explicit allowlist:
     `url`, `events`, `coalesce_window_seconds`, `is_active`. `secret` and `failure_count` are
     never settable via this route — the field-allowlist gap research flagged.
   - `POST /api/webhooks` gets `enforceRateLimit` (reuse `API_UPLOAD`'s preset — an
     infrequent, meaningfully-costed write, the closest existing shape); `POST
     /api/webhooks/test` gets it too, tighter reasoning: an unrate-limited manual test button is
     a free SSRF probe / DoS-the-customer's-endpoint vector once the URL check exists to probe
     against (research's own flag). `onStoreFailure: "deny"` for both — these are
     service-costing writes, not public reads.
   - Route-level `POST /api/webhooks` response includes `webhook` (without `secret`) plus a
     top-level `secret` field present **only** in this response, with the same
     "will not be shown again" warning shape `api-keys/route.ts:104` already uses.
   Test: existing GET/DELETE auth-and-permission tests, ported to the new shared-helper call
   path, still pass. New: POST/PUT with a private/loopback/link-local URL refused 400 naming the
   address class; a PUT body containing `secret` or `failure_count` does not change either
   column (assert via a follow-up GET); exceeding the configured rate limit on `POST
   /api/webhooks/test` returns 429; a normal create returns the plaintext secret once and a
   subsequent GET for the same site never includes it.

7. [ ] **New cron: `/api/cron/webhook-dispatch`, registered in `vercel.json`.**
   `src/app/api/cron/webhook-dispatch/route.ts` — `CRON_SECRET`-gated exactly like
   `src/app/api/cron/ab-test-lifecycle/route.ts` (`Bearer` header check, 401 on mismatch), calls
   `webhookManager.sweepDueDispatches()` then `sweepDueRetries()`, returns counts from both.
   `vercel.json` gains a second `crons` entry (`"path": "/api/cron/webhook-dispatch"`) —
   interval per ADR 006 (5 minutes, matching the documented-but-unscheduled precedent in
   `ab-test-lifecycle`'s own header comment); ADR 006's "Watch" note about this interval being a
   hard floor under the coalescing window is carried into Task 8's UI copy, not silently
   dropped.
   Test (`src/__tests__/api/cron/webhook-dispatch.test.ts`): missing/wrong `Authorization`
   header → 401, neither sweep called; correct header → both sweep functions invoked exactly
   once and their counts appear in the response body.

8. [ ] **Hook the publish path: `POST /api/staging/publish` records a qualifying event.**
   After `publish_staging_content_atomic` succeeds (`route.ts:111-119`), call
   `webhookManager.recordQualifyingEvent({ siteId, eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
   payload: { elements: publishedRows } })` inside `after()` from `"next/server"` — not
   awaited before the response is built, per the `request-code/route.ts` precedent this repo
   already uses for exactly this "no response left to shape" reasoning.
   Test (`src/__tests__/api/staging/publish-webhook-hook.test.ts`): a publish with an active
   webhook subscribed to `content.updated` results in `recordQualifyingEvent` being called
   (mock `webhookManager`) with the published elements; the response is built and returned
   without awaiting that call — assert by resolving the route's promise before the mocked
   `recordQualifyingEvent`'s own promise resolves, proving the two are not serialized.

9. [ ] **Design-system floor: add the missing `Select` primitive; add `Dialog`'s `showClose`.**
   `src/components/ui/select.tsx` — a Radix wrapper over the already-installed
   `@radix-ui/react-select`, matching the composition and `cva`/`cn()` conventions of
   `dialog.tsx`/`dropdown-menu.tsx` in the same directory: `Select`, `SelectTrigger`,
   `SelectValue`, `SelectContent`, `SelectItem`. Scoped to exactly what a flat, ungrouped
   dropdown needs — no `SelectGroup`/`SelectLabel` unless Task 10 turns out to need them.
   `src/components/ui/dialog.tsx` — add an optional `showClose` prop to `DialogContent`,
   default `true` (today's unconditional behavior, unchanged for every existing call site),
   `false` omits the corner `X` only; overlay-click and Escape dismissal already pass through
   via the existing `...props` spread and are suppressed by the show-once dialog itself passing
   `onInteractOutside`/`onEscapeKeyDown` handlers that call `preventDefault()`, not by a change
   here.
   Test: a `select.test.tsx` colocated in `src/components/ui/__tests__/` (matching
   `badge.test.tsx`/`button.test.tsx`'s existing pattern) — renders, opens, selects an item,
   fires `onValueChange`. A `dialog.test.tsx` addition (new file, none exists today) asserting
   `showClose={false}` omits the close button and role="dialog" still traps focus, while every
   existing `Dialog` call site (grep confirms none pass `showClose` today) keeps rendering the
   `X`.

10. [ ] **`WebhooksPanel`: the dashboard surface (AC 1, 4, 7).**
    New `src/components/dashboard/WebhooksPanel.tsx`, wired into `SiteDetailView.tsx` alongside
    `DomainVerification`/`VersionHistoryPanel` (`:369-374`), following
    `docs/designs/s16-webhook-config.md` exactly: `Card` shell; header (`IconTile accent` +
    `.text-title` "Webhooks"); config form (URL `Input`, coalescing-window `Select` with the
    default restated as helper text below it — the design's fix for AC 4's "default is stated
    in the UI" since a closed `Select` alone doesn't show it — Save/Update `Button`, "Send test
    delivery" `Button variant="outline"`); delivery history as `<ul>/<li>` rows (not a `Table` —
    none exists), each with a `StatusBadge` mapped `pending→neutral`, `retrying→warning`,
    `delivered→success`, `failed→danger`, `.tabular` attempt count, next-attempt note when
    retrying; show-once secret `Dialog` (`showClose={false}` from Task 9, no overlay/Escape
    dismiss) presented immediately after creation; all four states (`Skeleton` shaped as
    header+form+two rows / `EmptyState` "no webhook configured" / `Alert variant="destructive"`
    on load-or-save failure / the configured state itself); the two distinct SSRF-refusal
    moments per the design's copy (config-time inline under the URL field, delivery-time as a
    `failed` row reason); manual-test-result as an inline `Alert` under the test button (no
    toast — design-system gap #1, per the design's own resolution).
    Test (`src/__tests__/components/dashboard/WebhooksPanel.test.tsx`, RTL + `userEvent`,
    querying by role/label per this repo's testing convention): renders each of the four states;
    submitting a valid URL calls `POST /api/webhooks` and shows the secret dialog exactly once,
    which does not close on `Escape` or an outside click; delivery rows render the correct
    `StatusBadge` tone per fixture status; "Send test delivery" calls `POST
    /api/webhooks/test` and shows an inline result `Alert`; a config-time SSRF 400 response
    renders the specific refusal copy inline under the URL field, not a generic error.

## Run interdicts

- `src/app/api/webhooks/stripe/route.ts` — diff must be empty. It is Stripe's **inbound**
  webhook, a different concern sharing only a parent directory name; confirmed unentangled by
  research (no shared import in either direction) and re-confirmed here — nothing in this plan
  touches it.
- No `zod` in `package.json` or anywhere in the diff. ADR 003 stands; the SSRF module (Task 2)
  and every new validator use `src/lib/api/validation.ts`'s `ValidationResult<T>` shape.
- `src/app/api/bulk/import/route.ts` — diff must be empty. Bulk-imported content changes do not
  fire webhooks in this story (Anchor point decision above); this file is not touched to make
  that true by construction, and it is not touched to make it false either.
- Do not fix `verifySignature`'s known length-mismatch defect
  (`src/__tests__/webhooks/manager.test.ts`'s `it.failing`, `manager.ts:375-381`). It is the
  *receiving*-side verification helper; nothing in `src/` calls it, and no AC touches it. Leave
  the `it.failing` exactly as it is — flipping it is a different, unrelated fix.
- Do not add a toast/transient-feedback primitive. Design-system gap #1 stays a gap; both
  transient-feedback moments in this story resolve to an inline `Alert` or a button-label swap,
  per the design.
- `src/components/ui/dialog.tsx` — diff must be exactly the `showClose` prop addition (default
  `true`). No other line changes; every existing `<Dialog>` call site (grep confirms none pass
  `showClose` today) must render identically to before.
- `public/embed/**` — diff must be empty. Research confirmed no widget surface for this story;
  it carries no byte-budget dependency on `s06`.

## The point everything turns on

**The whole story stands on ADR 006's two-phase dispatch (`after()` to mark, one cron to
sweep) — every other task either produces state for it or consumes state from it.** Get the
throttle-vs-debounce choice or the cron interval wrong and three ACs degrade at once: AC 4
(coalescing), AC 3 (retry), and AC 6 (does-not-delay), because all three now depend on the same
sweep cadence rather than on independent mechanisms. Two places this could be wrong, and what to
compare each against:

1. **Throttle vs. debounce for coalescing (Task 3).** This plan fixes `pending_dispatch_at` on
   the *first* qualifying event in a window and does not extend it on subsequent ones. The
   story's own wording — "coalesced within a configurable window" — is genuinely ambiguous
   between "fire once, N seconds after the first edit in a burst" (this plan) and "fire N
   seconds after the *last* edit in a burst, resetting on every new edit" (a debounce). A
   reviewer who reads it the second way should compare against ADR 006's stated reasoning:
   an unbounded debounce can starve delivery entirely under continuous editing, which is a worse
   failure for a "rebuild my site" trigger than an occasional early, merged dispatch. If that
   tradeoff is judged wrong, it is a one-method change (`recordQualifyingEvent`'s `if` becomes
   an unconditional `pending_dispatch_at` bump) — the schema and the sweep do not change.
2. **The cron interval as a hidden floor under the UI's own options (Task 7 vs. Task 10).**
   ADR 006 names this explicitly as a "Watch": if `WebhooksPanel`'s coalescing-window `Select`
   offers an option shorter than the cron's actual interval, that option's real-world latency is
   the cron interval, not the selected number — a silent mismatch between what the UI states and
   what happens. Compare Task 10's `Select` options against whatever interval Task 7 actually
   ships with before considering this story done; if the platform can sustain a tighter cron
   than 5 minutes, tightening Task 7's schedule is cheaper than constraining Task 10's options
   list, and research left this specific fact (achievable Vercel cron frequency) unverified.

**Two further, smaller places this plan makes a call research flagged as open, worth a second
look:**
- **DNS-rebinding defense stops at "resolve immediately before `fetch()`," not "pin the
  resolved IP and force the connection to it" (Task 5).** A residual TOCTOU window remains
  between Task 5's `dns.lookup` and `fetch()`'s own internal resolution — vanishingly small in
  practice, but not zero. This plan takes the AC's literal wording ("resolve and re-check the
  address at delivery time") as the bar to clear; the fully-pinned version is real, additional
  work (a custom `fetch` dispatcher) that neither the AC nor the assignment asked for. If a
  security reviewer disagrees, that changes only Task 5's implementation, not its test's intent.
- **Webhook secrets stay plaintext-at-rest (Task 3), unlike the API-key `key_hash` shape this
  story was told to imitate.** The imitation is scoped to *behavior* — generate server-side,
  show once, never re-list — not to the one-way hash *mechanism*, because `deliverWebhook` must
  recover the plaintext secret to compute an HMAC signature at delivery time, and a hash cannot
  be reversed for that. This is not a gap this plan silently accepts: encrypting the secret at
  rest (rather than storing it plaintext, as the column already does today) would be a genuine
  hardening, but no encryption-at-rest utility exists anywhere in this codebase to reuse, and
  building one is materially outside a complexity-4 story whose AC only requires show-once
  display, not storage hardening. Flagged here so it reads as a decision, not an oversight.

## Files touched

- `supabase/migrations/20260816150000_webhook_dispatch_and_secrets.sql` — new.
- `src/types/index.ts` — `Webhook`/`WebhookDelivery` interfaces widened.
- `src/lib/security/webhook-url-safety.ts` — new, the SSRF module.
- `src/lib/webhooks/manager.ts` — secret handling, coalescing methods, retry-engine rewrite,
  delivery-time SSRF recheck.
- `src/lib/webhooks/access.ts` — new, the shared permission-check helper.
- `src/app/api/webhooks/route.ts` — auth conversion, config-time SSRF, PUT allowlist, rate
  limit.
- `src/app/api/webhooks/test/route.ts` — auth conversion, rate limit.
- `src/app/api/cron/webhook-dispatch/route.ts` — new.
- `vercel.json` — one new `crons` entry.
- `src/app/api/staging/publish/route.ts` — `recordQualifyingEvent` call inside `after()`.
- `src/components/ui/select.tsx` — new.
- `src/components/ui/dialog.tsx` — `showClose` prop addition.
- `src/components/dashboard/WebhooksPanel.tsx` — new.
- `src/components/dashboard/SiteDetailView.tsx` — wires in `WebhooksPanel`.
- `docs/decisions/010-webhook-dispatch-out-of-band.md` — already written, travels with this
  branch.
- New/rewritten tests: `src/__tests__/security/webhook-url-safety.test.ts`,
  `src/__tests__/webhooks/manager.test.ts` (rewritten retry section, extended elsewhere),
  `src/__tests__/api/webhooks/route.test.ts`, `src/__tests__/api/webhooks/test-route.test.ts`,
  `src/__tests__/api/cron/webhook-dispatch.test.ts`,
  `src/__tests__/api/staging/publish-webhook-hook.test.ts`,
  `src/components/ui/__tests__/select.test.tsx`, `src/components/ui/__tests__/dialog.test.tsx`,
  `src/__tests__/components/dashboard/WebhooksPanel.test.tsx`.

## Test strategy

- Task 2 (SSRF module) is pure-function unit testing with mocked `dns.promises.lookup` —
  table-driven over every address class the AC names plus the IPv4-mapped-IPv6 smuggling case.
  This is the one module a security reviewer should read end to end before anything else.
- Tasks 3–5 (`WebhookManager`) extend the existing Supabase query-builder mock in
  `src/__tests__/webhooks/manager.test.ts` (`makeBuilder`/`resultsByTable`, already present) —
  no new mocking pattern needed, only new table entries (`pending_dispatch_at` etc.) and new
  `describe` blocks for `recordQualifyingEvent`/`sweepDueDispatches`/`sweepDueRetries`.
- Task 6 (routes) follows the existing Next.js route-handler test pattern used across
  `src/__tests__/api/**` — construct a `NextRequest`, call the exported `GET`/`POST`/etc.
  directly, assert on the `NextResponse`.
- Task 7 (cron) follows the same route-handler pattern with a `Bearer` header, no existing
  `ab-test-lifecycle` test to model against (none exists) — this is the first cron route test in
  the repo; keep it to the same shape as the CRUD route tests rather than inventing a new
  harness.
- Task 8 (publish hook) mocks `webhookManager` and asserts the call happens without being
  awaited before the response — the same "response committed before the deferred work" property
  `request-code/route.ts`'s own design exists to guarantee, tested the same way.
- Tasks 9–10 (UI) are RTL + `userEvent`, querying by role/label per this repo's established
  React testing convention — no snapshot tests, no `container.querySelector`.
- No test is modified to accommodate this story's behavior change without saying so — Task 4's
  rewrite of the `setTimeout`-based assertions is the one place this applies, and it is named
  explicitly there and must be named explicitly in the PR description too.

## Definition of Done

- Single PR on `feature/s16-webhook-config`, structured description, readable diff, and the
  Task 4 test-rewrite called out explicitly in the description (not just visible in the diff).
- `npm run lint`, `npm run type-check`, `npm run format` (check mode), `npm run build`,
  `npm test` all green.
- All seven acceptance criteria demonstrated: AC1/AC7 via Task 10's UI tests plus Task 6's route
  tests; AC2 via Task 3's secret-handling tests plus Task 6's route-level show-once assertion;
  AC3 via Task 4's retry-engine tests; AC4 via Task 3's coalescing tests plus Task 7's cron test
  plus ADR 006's cron-interval caveat carried into Task 10's UI copy; AC5 via Task 2's SSRF-module
  tests plus Task 5's delivery-time recheck test plus Task 6's config-time-refusal test; AC6 via
  Task 8's non-blocking-call test.
- Every path listed under "Run interdicts" shows an empty diff against `main`, or — for
  `dialog.tsx` — a diff containing exactly the stated addition. Verified at task completion,
  re-verified at `/ks-review`.
- `docs/decisions/010-webhook-dispatch-out-of-band.md` is committed on this branch (already
  written; confirm it travels with the story commit per `AGENTS.md`'s data-lifecycle rule).
- No test modified to accommodate this story's behavior change without the PR description
  saying so, per `AGENTS.md`. Task 4's retry-mechanism rewrite is the one place this applies.
- Review passed (`/ks-review`), no open critical issue.
