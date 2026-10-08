# Research — Story s68b-api-abuse-bounds

Verified against `origin/main` at `659778e` on 2026-10-08. Each finding was re-opened in the code;
M2's timing was re-measured locally. No production access was used.

## The five structuring facts

1. **All seven premises hold; one holds for a different reason than reported.** M4's limiter
   bypass is real, but not because the routes skip authorization: they authorize first, and
   `authorizeSiteRequest` looks the site up with `.eq("id", siteId)` (`src/lib/security/site-auth.ts:173-177`,
   a `uuid` cast that accepts any case, braces or no hyphens) and then verifies the token against
   **the database's** `site.id` (`:217`), not against the route's spelling. So an upper-case
   spelling authorizes with the genuine token and lands in a fresh per-site bucket
   (`content/[siteId]/route.ts:565-572`, `ab-tests/bucket/[siteId]/route.ts:72-79`,
   `ab-tests/active/[siteId]/route.ts:76-83`, `ab-tests/track/route.ts:178-185`). The fix that
   needs no client change: key those limiters on the authorized `site.id`.
2. **M2 has no user to protect.** `useRegex` is sent by no component, no test and no document —
   only `src/types/index.ts:657` and the route. The guard `isDangerousRegex`
   (`src/app/api/bulk/update/route.ts:191-205`) misses `((a+))+$` and `((a|aa))+$`; measured
   locally: 25 chars → 490 ms, doubling per char (~16 s at 30). Literal replace already exists
   (`replaceLiteral`, `:211-221`). Dropping the mode is cheaper and stronger than any engine
   (ADR 048).
3. **The two outbound fetchers share the same omission.** Webhook delivery and the webhook test
   send (`src/lib/webhooks/manager.ts:447-455`, `:791-801`) and domain file verification
   (`src/lib/security/domain-verification.ts:310-316`) call `fetch` with the default
   `redirect: "follow"`. Their SSRF guards check only the first hop. The webhook path then stores
   the first 1000 bytes of whatever answered (`:457-462` → `response_body` at `:542`, `:627`) and
   `GET /api/webhooks/deliveries` returns `select("*")` of those rows (`manager.ts:720-735`) to the
   very member who configured the URL — a full-read SSRF by redirect. Domain verification echoes
   `HTTP <status>: <statusText>` (`:318-323`) — a status oracle — and `PUT /api/domains/verify`
   (`src/app/api/domains/verify/route.ts:292-387`) has no limiter at all (none in the file).
4. **M3 is two independent weaknesses, and only one needs the database.** (a) Bucket keys use the
   raw `siteId` (`src/lib/auth/editor-request.ts:108-117`, `:141-150`) while the code row is found
   by a `uuid` cast, so each spelling is a new 5-per-15-min budget. `requireUuid`
   (`src/lib/api/validation.ts:164-177`) already canonicalizes to lower case. (b) The per-code
   attempt counter is read-then-write (`src/lib/auth/editor-verification.ts:130-155`), so a burst
   of concurrent guesses all read `attempts = k` and are all compared. A compare-and-set through
   PostgREST (`.eq("attempts", k)` on the UPDATE, charged **before** comparing) bounds comparisons
   to `MAX_CODE_ATTEMPTS` per code with no migration.
5. **M5's route is live and must keep accepting the embed.** The A/B dashboard card is gone
   (`SiteDetailView.tsx:339-342`) but the embed still calls `/ab-tests/active`, `/bucket` and
   `/track` (`public/embed/recopyfast.src.js:3248-3290`, `:3504-3520`) and the PRD re-enabled A/B
   (`docs/prd.md:424-425`), so disabling the route is not the cheap fix. The route takes any array
   length (`track/route.ts:124-125`), stores `value`/`metadata` unvalidated (`:264-274`), dedupes
   only views, keyed on a caller-chosen `visitor_id` (`:220-255`), and every 50th view can run
   `checkTestCompletion` → `promoteWinner` (`src/lib/ab-testing/lifecycle.ts:127-150`), which writes
   **staging** copy, not published (`:180-195`). Conversions are counted as rows
   (`lifecycle.ts:56-64`); `value` is never read (`:74`).

## Target story

`docs/stories.md` → `s68b-api-abuse-bounds`: M1 (webhook redirects), M2 (regex mode), M3
(editor-code spelling + atomic attempts), M4 (canonical per-site buckets), M5 (A/B track bounds),
M6 (email label injection), M10 (domain verification redirects + limiter). No migration, no embed
change.

## Current state of the code

- **M1** — `deliverWebhook` re-checks the URL right before `fetch` (`manager.ts:437-445`, good,
  DNS-rebinding window acknowledged in `webhook-url-safety.ts:19-26`) and then follows redirects.
  `testWebhook` (`:760-801`) the same; it stores status but not body (`:806-817`) and returns
  `statusCode` to the caller.
- **M2** — operations array unbounded; per-IP fail-closed `API_UPLOAD` limiter (10/min, `:24-29`)
  before auth; regex branch `:276-300`.
- **M3** — `POST /api/editor/request-code` (`siteId` via `readString`, `:52`) and
  `POST /api/editor/submit-code` (`:63`) pass the raw value to `limitCodeRequests`/
  `limitCodeAttempts` and to the code lookup (`.filter("site_id", "eq", siteId)`,
  `editor-verification.ts:104-112`). Budgets: `API_AUTH` 5 / 15 min per address+site, `IP_AUTH`
  10 / 15 min per IP (`src/lib/security/rate-limiter.ts:422,437`); `MAX_CODE_ATTEMPTS = 5`
  (`editor-verification.ts:30`); 10-minute codes; a fresh code supersedes older ones (`:58-73`).
- **M4** — four routes authorize, then meter by raw `siteId` (fact 1). Precedent for canonical
  ids: `analytics/track`, `upload/image`, `analytics/performance`, `ai/suggest` already meter on
  `requireUuid(...).value`.
- **M5** — see fact 5. Embed batches: one event per active test (`recopyfast.src.js:3455-3476`),
  clicks one at a time (`:3437-3448`), conversions carry `value || 1` and
  `metadata: { event_name }` (`:3484-3495`). `visitor_id` is `crypto.randomUUID()` or
  `rcf-<ms>-<9 chars>` (`:3238-3241`). Delivered by `sendBeacon` (64 KB browser cap).
- **M6** — `sendStagingVerificationEmail` and `sendEditorAccessCode` interpolate `siteLabel` raw
  into HTML (`src/lib/email/resend.ts:183,193` and `:213,224`) although `escapeHtml` exists (`:85-92`)
  and the invitation email uses it (`:163-166`). The label is the free-text `label` of
  `POST /api/staging/access` (`route.ts:47-63`, no type/length check), set by any site admin, sent
  to an address the admin chooses. `request-code` never sets `siteLabel` today (`:93-106`) — latent.
- **M10** — fact 3; `assertNoInternalResolution` is a hand-written denylist
  (`domain-verification.ts:41-115`) beside the webhook guard's `ipaddr.js` allowlist
  (`webhook-url-safety.ts:42-54`).

## Anchor points

- `manager.ts` both `fetch` calls → `redirect: "manual"`; a `3xx` is a failed attempt with a fixed
  message and no stored body.
- `domain-verification.ts` `verifyDomainFile` → `redirect: "manual"`; reuse `assertSafeWebhookUrl`
  on the built URL instead of the denylist; `domains/verify/route.ts` PUT → per-user fail-closed
  limiter after `getUser` (ADR 037 order).
- `bulk/update/route.ts` regex branch → refusal + tombstone (ADR 048).
- `editor/request-code` + `editor/submit-code` → `requireUuid` before the limiters;
  `consumeVerificationCode` → compare-and-set charge.
- The four M4 routes → `identifier: site.id` from `authorizeSiteRequest`'s return value.
- `ab-tests/track/route.ts` → body cap, batch cap, field validation (extend
  `src/lib/api/validation.ts`, no zod — ADR 003), conversion dedupe.
- `resend.ts` → `escapeHtml(siteLabel)` in both functions; `staging/access/route.ts` → label rule.

## Verified APIs / functions

- `requireUuid(body, field): ValidationResult<string>` — trims, lowercases (`validation.ts:164-177`).
- `readJsonObject` with prototype-key rejection and size caps (`validation.ts`, AGENTS.md
  "Validation").
- `enforceRateLimit(request, { limit, endpoint, identifier, identifierType, onStoreFailure, message })`
  (`src/lib/api/rate-limit.ts:98-147`); identifier defaults to the client IP.
- `authorizeSiteRequest(...)` resolves to `{ site, allowedOrigin }` (`site-auth.ts:164-262`).
- `assertSafeWebhookUrl(url): Promise<ValidationResult<string>>` (`webhook-url-safety.ts:129+`).
- Node 24 `fetch` (undici) with `redirect: "manual"` returns the real 3xx response (status and
  `location`), unlike a browser's opaque redirect — the handler can see and refuse it.

## Traps & constraints

- **Existing tests to extend**: `src/__tests__/webhooks/manager.test.ts`,
  `src/__tests__/api/webhooks/{test-route,deliveries-route,route}.test.ts`,
  `src/__tests__/api/cron/webhook-dispatch.test.ts`; `src/__tests__/security/domain-verification.test.ts`,
  `src/__tests__/api/domains/verify-reuse.test.ts`; `src/__tests__/api/bulk/update-limiter.test.ts`,
  `update-history-policy.test.ts`, `src/__tests__/db/content-write-privileges.test.ts:674-760`
  (real bulk handler); `src/__tests__/api/editor/{request-code,submit-code}/route.test.ts`,
  `submit-code/plan-gate.test.ts`; `src/__tests__/api/ab-tests/{track-cross-tenant,bucket-distribution,bucket-query-errors}.test.ts`;
  `src/__tests__/api/content/rate-limit.test.ts`, `discovery-fidelity.test.ts`;
  `src/lib/email/__tests__/resend-editor-invitation.test.ts`; `src/__tests__/api/staging/access.test.ts`,
  `verify-resend-rate-limit.test.ts`.
- **Webhook ordering (ADR 010)**: a 3xx is a normal failed attempt (retry/backoff as today), not a
  configuration error; a permanently redirecting endpoint ends `failed` after
  `MAX_DELIVERY_ATTEMPTS`, which is visible to the owner.
- **M3 response shape**: `request-code` answers the same neutral body whether or not the address
  is an editor (timing-leak fix, `:108-115`). A malformed `siteId` may 400 — it reveals nothing
  about editors — but every well-formed id must keep the neutral path.
- **M3 compare-and-set**: charging before comparing changes the success path — a correct code now
  costs one attempt, then the conditional consume (`:157-181`) still serializes winners. A lost
  CAS race must be answered exactly like a wrong code (one message for every failure,
  `submit-code/route.ts:46-57`).
- **M4**: do not refuse non-canonical spellings on these routes; installed snippets are permanent
  (non-negotiable 2) and the widget degrades, never breaks (non-negotiable 4). Keying on `site.id`
  costs nothing and catches every spelling Postgres accepts.
- **M5 must accept what the embed sends today**, including `geo_country: null`, `value: 1`,
  `metadata: { event_name }`, `rcf-…` visitor ids, and arrays from 1 to a handful of events. Add
  an embed-shaped fixture test before tightening. The route currently 500s on a non-uuid test id
  (`track/route.ts:93-100`); validation should turn that into a 400 before the database.
- **M5 semantics**: deduping conversions per (visitor, test) changes how results are counted
  (rows → unique converters) — open question 2. Promotion writes staging only; the owner still
  publishes, which bounds the damage of forged telemetry to "a misleading result and a staged
  suggestion".
- **M6**: escape is the fix; the label is still attacker-chosen *text* in our sender's mail
  (phishing wording survives escaping). Cap and control-character refusal bound it; removing the
  label from the email is the stronger option (open question 4).
- **Other per-site limiters on raw ids** exist on authenticated editor routes
  (`staging/publish:153`, `staging/content:280`, `ai/translate:218`, five `edit-board/*`) — not
  public-token surfaces; listed for s69, not fixed here.
- **`bulk/update` operations array is unbounded** — linear cost once regex is gone; s69.
- No new dependency (`package.json` diff empty) — ADR 048 rejects RE2 for that reason.

## Open questions

1. None blocking for M1/M3/M4/M10.
2. **M5**: count one conversion per (visitor, test), and only for a visitor with a recorded view of
   that test? Recommended yes — it matches PRD decision 5 ("a click … within the same page view as
   an impression") better than raw rows, and caps forged conversions at one per forged visitor.
3. **M2**: confirm dropping regex mode (ADR 048) rather than adopting RE2.
4. **M6**: keep the admin-chosen label in verification emails (escaped, ≤ 80 chars), or drop it and
   name the site's registered domain instead? Recommended: keep, escaped and capped — the invite
   email already names the site by `siteName`/domain.

## Real complexity

Not scored at story time (new). 3: seven independent, small, well-precedented changes; no
migration, no UI, no embed bytes. The breadth is the risk (seven route families, ~15 suites
touched), not depth.

## Split proposal

None required. If the plan runs long, M5 is the natural cut (it is the only item with a product
semantic question) — it can ship as `s68b2` without blocking the other six.
