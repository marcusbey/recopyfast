# Research — Story s16-webhook-config

> **Warning carried forward from `docs/reviews/stories.md`.** That review ends `Max severity:
> major` and `Stories ready: no`. None of the six majors or the minors touch `s16` — it is not
> named in Part B, not in the ruling on `s08`, not in the byte budget, not in claim
> verification. `s16` has no declared dependencies and is independent in the graph
> (`stories.md:65`, `s16 (independent)`), so the outstanding majors (stale `prd.md` ids,
> `s12`/`s09` data-model mismatch, `s11` anti-flicker, `s13` scope, `s14`/`s08` socket
> revocation, `s07`/`s08` connection-model disagreement) cannot affect this story's scope.
> Operator confirmed proceeding despite `Stories ready: no`. This is a warning, not a block.

## The five structuring facts

- `webhookManager.triggerEvent` (`src/lib/webhooks/manager.ts:133`) is **never called anywhere
  in the app** — not by `src/app/api/staging/publish/route.ts`, not by
  `src/app/api/content/[siteId]/route.ts`, not by `src/app/api/bulk/import/route.ts`, not even
  by the webhook routes themselves. Grepping `src/app` for `webhookManager|triggerEvent` returns
  only `src/app/api/webhooks/route.ts` and `src/app/api/webhooks/test/route.ts` — both import it
  for CRUD/manual-test, neither calls `triggerEvent`. Automatic delivery-on-content-change is
  dead code today, not a hardening target.
- `POST /api/staging/publish` (`src/app/api/staging/publish/route.ts:33-113`) is the sole
  application-level "content changed" choke point for edits — `PUT /api/content/[siteId]`
  explicitly refuses with *"Live content updates must use /api/staging/content and publish
  explicitly"* (`route.ts:499-508`). But `src/app/api/bulk/import/route.ts:311` writes
  `published_content` **directly** to `content_elements`, bypassing this route and its
  `publish_staging_content_atomic` RPC entirely — so hooking only the publish route misses
  bulk-imported changes (`s05`, independent, no edge to `s16`).
- The webhook secret is **not** shown-once. `GET /api/webhooks` → `webhookManager.getWebhooks`
  (`manager.ts:115-128`) runs `.select("*")` on the `webhooks` table and returns it verbatim
  (`route.ts:55-56`), so the plaintext `secret` column is re-exposed on every list call, and
  `POST` (`route.ts:132-138`, `manager.ts:50`) accepts a caller-supplied `secret` in the body
  instead of always generating one. This directly contradicts AC 2 ("verifiable with a secret
  shown once at creation") and diverges from `src/app/api/api-keys/route.ts:16-21,99-105,187-190`'s
  hash-and-prefix pattern, which the story's own agentic notes do not mention but which is the
  right model to copy.
- `ipaddr.js@^2.2.0` is a declared dependency (`package.json:68`) but is **imported by zero
  files** in `src/`. The only URL check today is `new URL(url)`
  (`route.ts:92-96`, `:224-228`) — syntax only. `http://169.254.169.254/`, `http://localhost`,
  `http://10.0.0.5` all pass. No SSRF check exists at configuration time, and none at delivery
  time either.
- The retry mechanism as written cannot survive on Vercel.
  `handleWebhookFailure` (`manager.ts:256-285`) calls `setTimeout(() => this.retryWebhook(...),
  delay)` with delays up to 5 minutes (`calculateRetryDelay`, `manager.ts:360-363`,
  `2^attempt * 1000ms` capped at 300000ms). A Vercel serverless invocation does not persist for
  5 minutes after its response is sent — this is not a hardening gap, it is a correctness bug:
  today, in production, a failed delivery's retry silently never fires. `after()` from
  `"next/server"` is already used once in this repo
  (`src/app/api/editor/request-code/route.ts:115`) to defer work past the response, which is the
  right primitive for "does not delay the edit that triggered it" (AC 6) but does **not** solve
  multi-minute backoff or cross-request coalescing — those need persisted state plus a cron,
  the shape `src/app/api/cron/ab-test-lifecycle` already has (existing, declared in code,
  unscheduled in `vercel.json`, per `docs/architecture.md`).

## Target story

**s16-webhook-config** — *"As a developer running a static site, I want RecopyFast to call my
endpoint when content changes, so that my site rebuilds without me watching for it."*
Complexity in `stories.md`: **3** — "outbound integration with delivery guarantees." No
dependencies; the graph marks it `(independent)`.

### Acceptance criteria (verbatim from `docs/stories.md:786-793`)

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

## Current state of the code

| Piece | File | State |
|---|---|---|
| Config CRUD (GET/POST/PUT/DELETE) | `src/app/api/webhooks/route.ts` (312 lines) | **Works**, but hand-rolled auth (see Traps) and secret re-exposed on every GET |
| Manual test delivery | `src/app/api/webhooks/test/route.ts` (74 lines) | **Works** — synchronous fetch with a 10s timeout, logs to `webhook_deliveries` |
| Signing + delivery + retry engine | `src/lib/webhooks/manager.ts` (503 lines) | **Half-stub**: `deliverWebhook`/`generateSignature`/`verifySignature`/`testWebhook` are real and correct in isolation; `triggerEvent` (the automatic-dispatch entry point) is fully implemented but has **zero callers**; `retryWebhook`'s scheduling (`setTimeout`) is broken on serverless by construction |
| Coalescing / debounce window | — | **Does not exist anywhere.** No code, no column, no config. AC 4 is greenfield. |
| SSRF validation | — | **Does not exist anywhere**, despite the dependency being installed. AC 5 is greenfield on top of an installed-but-unused library. |
| DB tables | `webhooks`, `webhook_deliveries` | Exist (`supabase/migrations/20260731004000_missing_tables_integrations.sql`), RLS on, no columns for a debounce window, a "next retry at" timestamp, or a coalescing key |
| UI | — | **No dashboard surface at all.** Nothing renders `/api/webhooks`; AC 1 and AC 7 need a new panel, most likely in site settings alongside `ApiKeysPanel` (`src/app/dashboard/settings/page.tsx:16,374`). Confirmed by grep: no component imports `webhooks` or `webhookManager` outside the three files above and their tests. |
| Tests | `src/__tests__/webhooks/manager.test.ts` (14,416 bytes) | Exists — covers CRUD/sign/verify/testWebhook against the current `manager.ts`; will need new cases for `triggerEvent` wiring, SSRF, coalescing, and cron-based retry |

### Stripe entanglement check (explicitly asked for)

`src/app/api/webhooks/stripe/route.ts` (42,877 bytes) is a completely separate file handling
**inbound** Stripe events (`checkout.session.completed`, subscription lifecycle, credit
grants/revocations — see `docs/architecture.md` Integration points table). It imports
`stripe/config`, `stripe/plans`, `billing/entitlements`, `billing/credit-revocations`,
`supabase/service` — none of which the outbound webhook code touches, and vice versa: nothing
in `manager.ts` or `webhooks/route.ts` imports anything Stripe-related. **The premise holds —
they are genuinely unentangled today.** The only shared thing is the parent directory name
(`src/app/api/webhooks/`), which is exactly the confusion risk the assignment named; a careless
grep for "webhooks" without a path filter pulls in both. Confirmed no accidental cross-import
exists as of this read.

## Anchor points

- **Delivery trigger — the real design decision, currently unresolved by any story.** Two
  candidate anchor points, not equivalent:
  1. **Application-level, in `POST /api/staging/publish`** (`route.ts:108-115`, right after the
     `publish_staging_content_atomic` RPC succeeds). Simplest, matches "the publish path" the
     assignment pointed at, and the response/elements list (`publishedRows`) is already the
     right payload shape. **Misses bulk-imported changes** (`src/app/api/bulk/import/route.ts`
     writes `published_content` directly, never calling this route).
  2. **Database-level, a trigger on `content_elements` when `published_content` changes.**
     Precedented — `CREATE TRIGGER` already exists against content-adjacent tables in
     `supabase/migrations/20260809130000_content_history_definer_and_delete_split.sql`,
     `20251230000000_staging_workflow.sql`, `20251230100000_edit_board.sql`. Catches every write
     path uniformly (staging publish, bulk import, and any future path) but means the webhook
     dispatch decision moves into SQL, which is a bigger design commitment for a complexity-3(→4)
     story to make unilaterally. Not resolved here — flagged for `/ks-plan`.
- **Deferred/out-of-band dispatch** — `after()` from `"next/server"`, precedented at
  `src/app/api/editor/request-code/route.ts:115` (its header comment at lines 11-19 explains
  exactly this "no response left to shape, so defer the network call" reasoning — read it before
  writing the new call site).
- **Retry scheduling** — needs to move off `setTimeout` (`manager.ts:281-283`) onto a persisted
  "next attempt due" state plus a cron sweep, structurally identical to
  `src/app/api/cron/ab-test-lifecycle/route.ts` (exists, unscheduled in `vercel.json`, which
  today carries only `/api/cron/generate-blog-post`).
- **Manual test button** — `src/app/api/webhooks/test/route.ts` already does exactly what AC 7
  asks; this criterion is close to done, modulo whatever auth/SSRF changes land on the shared
  code path.
- **UI panel** — likely sibling to `ApiKeysPanel`, in `src/app/dashboard/settings/page.tsx` or
  on the per-site detail view (`SiteDetailView.tsx`, which already hosts
  `DomainVerification`/`VersionHistoryPanel`).

## Verified APIs / functions

- `webhookManager.createWebhook({ siteId, url, events, secret?, createdBy })` →
  `Promise<Webhook>` — `manager.ts:43-72`. Accepts an optional caller-supplied `secret`; falls
  back to `generateSecret()` (`manager.ts:386-388`, `crypto.randomBytes(32).toString("hex")`)
  only when absent.
- `webhookManager.updateWebhook(webhookId, updates: Partial<Webhook>)` → `Promise<Webhook>` —
  `manager.ts:77-96`. No field allowlist — whatever is in `updates` is spread into the SQL
  update, so a route-level allowlist (as `PUT /api/webhooks` partially does, but does not
  restrict `secret` from being overwritten) is the only guard.
- `webhookManager.triggerEvent({ siteId, eventType, payload, metadata? })` → `Promise<void>` —
  `manager.ts:133-171`. Looks up active webhooks via `.contains("events", [eventType])`
  (needs the `idx_webhooks_events` GIN index, present), fans out with
  `Promise.allSettled`. Fully implemented, zero callers.
- `webhookManager.verifySignature(payload: string, signature: string, secret: string): boolean`
  — `manager.ts:375-381`. Uses `crypto.timingSafeEqual`, correct against timing attacks. No
  route or module in `src/` currently calls this (it exists for the *receiving* side, which is
  the customer's — nothing here needs to call it, but it is exported and correct if a
  self-test path wants to prove round-trip signing).
- `WEBHOOK_EVENTS` (`manager.ts:486-496`) — nine event constants including
  `TEAM_MEMBER_ADDED` (graveyard-adjacent — `s04` removes the last live team surface; this event
  type is dead weight, not a functioning trigger, since nothing fires it either) and
  `BULK_OPERATION_COMPLETED` (relevant if bulk import is chosen as an anchor).
- `Webhook` / `WebhookDelivery` types — `src/types/index.ts:513-540` — match the migration's
  columns exactly; no drift found.
- `src/lib/api/validation.ts` exports: `readJsonObject`, `requireString`, `optionalString`,
  `requireUuid`, `requireEnum`, `optionalEnum`, `requireFiniteNumber`, `optionalMetadata`. **No
  URL or IP validator exists yet** — a new one must be added here per ADR 003, not inlined in
  the route and not pulled from zod.

## Traps & constraints

- **Auth pattern drift.** `webhooks/route.ts` and `webhooks/test/route.ts` hand-roll
  `createServerClient(...)` with the old `get/set/remove` cookie interface
  (`route.ts:21-31` etc.) instead of using `src/lib/supabase/server.ts`'s `createClient()`
  (`getAll`/`setAll`, the convention `AGENTS.md` and every other first-party route follows).
  Functionally it still authenticates, but it is inconsistent with the rest of the codebase and
  worth fixing while the file is open rather than perpetuating a second cookie-handling idiom.
- **Permission check duplicated four times** in `webhooks/route.ts` (once per verb) and again in
  `webhooks/test/route.ts` — same `site_permissions` lookup, same `["edit", "admin"]` check,
  copy-pasted five times total across two files. Not a blocker, but a DRY violation the story
  will touch anyway.
- **`updateWebhook` has no field allowlist at the manager layer.** `PUT /api/webhooks` in the
  route does destructure `{ webhook_id, ...updates }` and pass the rest through unchecked beyond
  `events`/`url` validation — a caller could set `is_active`, `failure_count`, or `secret`
  directly. Scope this down when the secret-exposure fix lands, or the fix is incomplete.
- **`jest.setup.js:177-182`** mocks `IntersectionObserver`, irrelevant here — s16 has no widget
  surface at all (no byte-budget dependency on `s06`, unlike `s09`/`s11`). Confirmed: no
  `public/embed/` references to webhooks anywhere.
- **Existing test file** `src/__tests__/webhooks/manager.test.ts` presumably asserts against the
  current `setTimeout`-based retry and the current unrestricted `secret` acceptance — expect to
  rewrite parts of it, not just add to it. Per `AGENTS.md`: "Do not modify a test to accommodate
  a change in behaviour... change the test *and say so*" — this applies directly here since the
  retry mechanism is being architecturally replaced, not merely extended.
- **`site_permissions` — do not filter on `sites.user_id`.** Same trap named in `s13`'s notes
  (`permissions.ts:79,150`) applies to any new webhook-config authorization code.
- **Rate limiting is unaddressed.** Neither `webhooks/route.ts` nor `webhooks/test/route.ts`
  calls `src/lib/api/rate-limit.ts`. A manual "test delivery" button with no rate limit is a
  free SSRF probe / DoS-the-customer's-endpoint vector once the URL check is added — worth
  scoping in even though the story's ACs don't name it explicitly.
- **DNS rebinding re-check needs an actual TCP-connect-time hook, not just a pre-fetch DNS
  resolve.** Resolving the hostname immediately before `fetch()` narrows the race window but
  does not close it (`fetch()` itself re-resolves). A fully rebinding-proof implementation
  typically needs to pin the resolved IP and connect to it directly (e.g., a custom `dispatcher`/
  `agent` with SNI override), which is materially more work than "resolve twice." Flag for
  planning — the AC's "at delivery time" wording is satisfiable at the "narrow the window"
  level; whether the story owes the fully-pinned version is a real scope question.

## Open questions

1. **Anchor point: app-level publish hook, or DB trigger?** Affects whether bulk-imported
   content changes (`s05`) fire webhooks. Not resolvable from the story text — `s16` has no
   dependency on `s05` and neither story's ACs settle it.
2. **How rigorous must the DNS-rebinding defense be?** "Resolve and re-check before dispatch"
   vs. "pin the resolved address and connect to it directly, bypassing a second DNS lookup." The
   former is a contained change; the latter touches how `fetch()` is invoked and may need a
   custom dispatcher (undici). The story's language ("resolve and re-check the address at
   delivery time") reads as the former, but a security reviewer may push for the latter.
3. **Coalescing storage shape.** A per-webhook "pending dispatch at" timestamp updated on each
   qualifying event, swept by a cron? Or an in-memory debounce that only works within one warm
   Vercel instance (unreliable, contradicts the reliability the story wants)? The story does not
   specify, and no existing pattern in the repo does exactly this (closest is
   `ab-test-lifecycle`, which is time-boxed by test end date, not by "N seconds since the last
   event").
4. **Does `updateWebhook`'s secret-overwrite path need a dedicated "rotate secret" action**, or
   is disallowing `secret` in the general `PUT` update sufficient, with rotation deferred? AC 2
   only requires shown-once-at-creation; it does not require rotation.
5. **Cron budget.** `vercel.json` has exactly one cron today. Adding a webhook-retry/coalescing
   sweep is a second. Whether the two can share a schedule or need independent ones (and what
   Vercel plan/frequency constraints apply) was not something this pass could verify — no shell
   access to Vercel's dashboard/plan tier from here, and it isn't recorded in the docs read.

## Real complexity

**Verdict: 4, up from the 3 in `stories.md`.**

`stories.md` scored this "3 — outbound integration with delivery guarantees" on the premise that
the delivery/signing engine, the config CRUD, and the DB tables already existed and the story
was substantially wiring plus a security pass — the same shape as `s02`'s "business logic across
several states, no new integrations." That premise is only half true. What actually exists and
works: CRUD, manual test delivery, HMAC signing, signature verification. What does not exist and
is not a matter of wiring: automatic dispatch has zero callers (dead code, not a stub to
connect), SSRF validation is fully greenfield despite the dependency being present, coalescing
has no design or storage anywhere in the codebase, and the retry mechanism as written is
architecturally incompatible with the deploy target (Vercel serverless) and must be replaced
with cron-backed state, not merely have its timings adjusted. That is: one new scheduled job
(retry + coalescing sweep, structurally new — `s16` would be the *first* story to actually
schedule a second cron, since `ab-test-lifecycle` exists but is unscheduled), one new security
module (URL/IP validation reused nowhere else, with a genuine DNS-rebinding hazard), and one
correctness bug in inherited code to fix as a precondition of the story succeeding at all
(`setTimeout` retries). That combination — new scheduled infrastructure + a security-critical
validation surface + fixing a production bug in code the story didn't expect to touch — matches
the shape of the codebase's other 4s (`s06`, `s07`, `s09`, `s11`) better than its 3s (`s02`,
`s03`, `s10`, `s17`, `s18`), none of which carry a scheduling-infrastructure requirement.

It does not reach 5: unlike `s07` (new deployed service) or `s13` (billing + a second external
system), this is one coherent vertical slice — config, delivery, retry and test for one feature,
touching no other subsystem's correctness except the one write path it hooks into. No split is
proposed.

## Split proposal

Not applicable — verdict is 4, not 5.
