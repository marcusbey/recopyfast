# Research — Story s44-v1-rate-limiter

Date: 2026-09-25. Scope: repository at `origin/main` `8083996`, plus the live production
evidence supplied by the operator's orchestrator the same day (a freshly created, active API
key's first `GET https://www.recopyfa.st/api/v1/content?site_id=…` answered **429**; production
`rate_limits` columns are `id, identifier, identifier_type, requests_count, window_start,
window_size_minutes, limit_per_window, created_at, updated_at`; production `api_keys` has
`rate_limit_per_minute` and no `rate_limit`). No production access was used by this lane.

## The five structuring facts

1. The limiter refuses **before it ever counts**. `checkAPIKeyLimit` selects
   `"rate_limit, rate_limit_per_minute, is_active"` from `api_keys`
   (`src/lib/api/rate-limiter.ts:51-55`); `rate_limit` does not exist
   (`supabase/migrations/20250817000000_complete_database_setup.sql:81-94` — the column is
   `rate_limit_per_minute`, `:88`, and no later migration adds `rate_limit`), so PostgREST
   answers 42703, the `if (error || …)` at `:57-64` returns `allowed: false`, and the route
   answers 429 (`src/app/api/v1/content/route.ts:46-65`, `:188-207`). This is environment-
   independent: it refuses in development too.
2. Behind it is a second, latent failure: `checkLimit` deletes by `.lt("timestamp", …)`,
   counts by `.eq("key", …).gte("timestamp", …)` and inserts `{ key, timestamp }`
   (`rate-limiter.ts:131-156`), while `rate_limits` has neither column
   (`20250817000000_complete_database_setup.sql:97-108`; the loose `supabase/security-schema.sql:20-31`
   has neither either). The count error is thrown (`:143-145`) into the H-4 catch, which denies
   in production (`:165-200`). No schema in the repo ever had `key`/`timestamp`: this limiter
   has never worked anywhere. `/api/v1/content` GET/POST/PUT has never served a request.
3. An equivalent per-identifier limiter already exists and is the architecture's declared one:
   `enforceRateLimit` (`src/lib/api/rate-limit.ts:91-152`) over the Redis store
   (`src/lib/security/rate-limiter.ts:198-388`, memory store only in development/test,
   `:567-587`), supports `identifierType: "api_key"` (`rate-limit.ts:52`), and states its
   store-failure policy per call (`:36`, `:99`, `:114-133`; 503 on "deny").
   `docs/architecture.md:370` names it as *the* rate-limit layer. It is already used per
   principal behind authorization (`src/app/api/content/[siteId]/route.ts:550-557`, per site;
   `src/app/api/api-keys/route.ts:135-145`, per user) and per IP before it
   (`content/[siteId]/route.ts:288-296`, `api-keys/route.ts:113-123`). Option (a) needs no
   migration.
4. The route authenticates **before** it limits, on every verb (`v1/content/route.ts:35` then
   `:46`; `:169` then `:188`), and DELETE has no limiter at all (`:340-423`). AGENTS.md "API
   routes" (`AGENTS.md:133-135`) requires the limiter before authorization: `validateAPIKey`
   is an `api_keys` lookup, a `site_permissions` read (s42 M1, `rate-limiter.ts:378-394`) and a
   `last_used_at` update (`:397-400`) per call — three round trips an unauthenticated flood buys
   for free today.
5. The suite that should have caught it could not: `src/__tests__/lib/api/rate-limiter-fail-closed.test.ts:49-98`
   stubs every table with a chain whose `select`/`eq`/`gte`/`insert` accept any column, and its
   key row even carries `rate_limit: 1000` (`:40`), a column production does not have. Its
   "still serves /api/v1/content while the store answers" case (`:192-199`) passed against a
   schema that does not exist.

## Target story

"The public content API answers requests." A developer holding an active, site-bound API key
whose creator is still an admin of the site gets content from `GET /api/v1/content` and can
write with `POST`/`PUT` (write scope), metered per key. Acceptance criteria:

- A freshly created active key's first GET answers 200 with the site's content; POST with a
  write-scoped key creates/updates (201/200).
- The per-key ceiling is the key's own `rate_limit_per_minute` (what `/dashboard/settings`
  shows, `src/components/settings/ApiKeysPanel.tsx:230`), over one minute, shared by every verb;
  the request past it is 429 with `Retry-After` / `X-RateLimit-*`, and not before.
- A per-IP limiter runs before `validateAPIKey` on every verb.
- A rate-limit store outage refuses (503) before any content is read or written.
- `api_keys.rate_limit` is read nowhere; `validateAPIKey`'s admin re-check (s42 M1) is intact.
- A test double of the database that errors on a non-existent column drives the route, so
  this class of code/schema mismatch fails in CI.

## Current state of the code

- `src/lib/api/rate-limiter.ts` — `APIRateLimiter` (Postgres, `:18-263`) with
  `checkAPIKeyLimit`/`checkIPLimit`/`checkUserLimit`/`checkLimit`/`resetLimit`/`getStatus`;
  `createRateLimitMiddleware` + `getDefaultKey` (`:268-302`); `validateAPIKey` (`:307-421`);
  its own `RATE_LIMIT_CONFIGS` (`:424-460`); the `rateLimiter` singleton (`:462`). Only the
  v1 route imports the module (`src/app/api/v1/content/route.ts:3-7`); only
  `rate-limiter-fail-closed.test.ts` imports `APIRateLimiter`; `createRateLimitMiddleware`,
  `checkIPLimit`, `checkUserLimit`, `resetLimit`, `getStatus` have no caller at all.
- `checkAPIKeyLimit`'s ceiling is `config?.maxRequests || apiKey.rate_limit_per_minute || …`
  (`:66-71`) and the route always passes a config (5000/h read, 1000/h write), so the key's own
  `rate_limit_per_minute` never governed anything, contrary to the dashboard's label.
- `validateAPIKey` selects `*` (`:348-353`), checks expiry, requires `site_id`/`user_id`, re-reads
  the creator's `admin` row (`:364-394`), bumps `last_used_at`, and returns
  `rate_limit: apiKey.rate_limit_per_minute || apiKey.rate_limit || 1000` (`:413`) — the
  `rate_limit` read the story removes. Its `rate_limit` field has no consumer.
- `src/app/api/v1/content/route.ts` — GET (`:32-164`), POST (`:166-333`), PUT = POST
  (`:335-338`), DELETE (`:340-423`), all service-role via `createServerClient` +
  `SUPABASE_SERVICE_ROLE_KEY` (header comment `:11-30`). Success responses carry
  `X-RateLimit-*` built from the Postgres limiter's result (`:147-155`, `:315-324`).

## Anchor points

- `src/lib/api/rate-limit.ts` — `EnforceRateLimitOptions` / `enforceRateLimit`: the per-key
  ceiling is data (`rate_limit_per_minute`), and today the helper only takes a preset name
  (`limit`, `:40`; `createRateLimitConfig` spreads the preset, `security/rate-limiter.ts:449-462`).
  One optional field, `maxRequests`, overriding the preset's ceiling and keeping its window, is
  the smallest extension. Existing callers are unaffected (field absent → preset).
- `src/app/api/v1/content/route.ts` — each verb: IP guard → `validateAPIKey` → per-key limit →
  existing scope/site checks → service-role client.
- `src/lib/api/rate-limiter.ts` — `validateAPIKey` stays (the api-keys route comment points at
  it, `api-keys/route.ts:38-39`; `docs/architecture.md:108` lists the file); the Postgres
  limiter goes.

## Verified APIs / functions

- `enforceRateLimit(request: NextRequest, options: EnforceRateLimitOptions): Promise<NextResponse | null>`
  — `src/lib/api/rate-limit.ts:91`. Options: `limit` (preset key), `endpoint`, `identifier?`,
  `identifierType?: "user" | "ip" | "api_key"`, `onStoreFailure?: "allow" | "deny"` (default
  deny), `message?`. 429 carries `Retry-After`, `X-RateLimit-Limit/Remaining/Reset`
  (`:69-85`); store failure → logged, then `null` (allow) or 503 `Retry-After: 30` (deny).
- `getClientIp(request)` — `rate-limit.ts:60`.
- Presets, `src/lib/security/rate-limiter.ts:419-444`: `IP_GENERAL` 200/60 s (`:436`),
  `API_CONTENT` 100/60 s (`:423`), `API_KEY_DEFAULT` 1000/60 s (`:441`).
- `rateLimiter` (`security/rate-limiter.ts:587`) is `MemoryRateLimiter` under Jest
  (`NODE_ENV=test`, `:42-46`, `:567-570`): fixed windows anchored on `Date.now()` (`:98`), a
  module singleton with `clearAll()` (`:133`). Redis key shape
  `rate_limit:<type>:<identifier>:<endpoint>:<window>` (`:299`).
- `api_keys` columns from the migrations: `id, user_id, name, key_hash, key_prefix, scopes,
  rate_limit_per_minute (DEFAULT 100), is_active, last_used_at, expires_at, created_at,
  updated_at` (`20250817000000:81-94`) + `site_id` (`20260611030000_api_keys_site_scoping.sql:14-15`,
  repaired by `20260925115000:21-22`). Matches `COLUMN_ALLOWLISTS.api_keys` + `key_hash` in
  `src/__tests__/db/column-privileges.test.ts:64-77`.

## Traps & constraints

- **Window straddling.** The memory store's windows are wall-clock minutes; a test making N+1
  calls can straddle a boundary and see the counter reset. Pin `Date.now` in limit tests.
- **Store singleton.** The memory store survives between tests in a file; clear it per test.
- **`validate-api-key.test.ts`** stubs `select` ignoring its argument; an explicit column list
  in `validateAPIKey` does not affect it. Keep all four of its cases green unchanged.
- **Outage status changes 429 → 503.** The old limiter could only say "refused"
  (`rate-limiter.ts:182-185`); `enforceRateLimit` says 503 + `Retry-After` on deny. Better for a
  retrying integration; declared.
- **Success headers.** `enforceRateLimit` returns `null` on success, so the route no longer has
  a count to put in `X-RateLimit-*` on 200/201. The API has never answered a request, so no
  client depends on them; widening `enforceRateLimit`'s return for 25+ callers is not worth it.
  The 429 keeps all of them. Declared.
- **Replacing a test file.** `rate-limiter-fail-closed.test.ts` tests only the class being
  deleted. Its intent (H-4: an outage keeps `/api/v1/content` off `content_elements` in
  production; the route serves while the store answers) moves into the new route suite; the
  deletion is declared (AGENTS.md "Tests").
- **Fail mode, which rule applies.** AGENTS.md `:133-135` pairs "public reads fail open" with
  "service-role writes fail closed"; `:163-166` and ADR 002 §4 require a fail-closed limiter on
  any service-role route. The "public read" that fails open in this codebase is the widget read
  (`content/[siteId]` GET) because a denial there un-publishes every customer's copy at once
  (`src/__tests__/api/content/rate-limit.test.ts:23-27`). `/api/v1/content` GET is not that: it
  is a service-role read of a tenant's `content_elements` behind a secret credential, with no
  visitor behind it and a caller that can honour `Retry-After`. The service-role rule governs:
  per-key limiter **deny** on every verb. The IP guard in front also **denies** on outage:
  valid keys are refused by the per-key limiter anyway, so failing open there would only let
  unauthenticated traffic reach `validateAPIKey`'s three round trips while nothing is metered
  (same call as `api-keys` POST, `api-keys/route.ts:155-156`).
- **Keyed on the key, not the site.** ADR 002 §4 says "keyed on the site"; its reason is to
  bound what a copied credential can do. Here the credential is the key (a site may hold
  several), the dashboard promises a per-key figure, and the H-4-reviewed predecessor was per
  key. Per key it stays.
- Pre-existing, out of scope, left for follow-ups: DELETE always 403s because
  `validateAPIKey` never grants `content_delete` (`rate-limiter.ts:409-412`, route `:354`);
  v1 GET returns `metadata` unfiltered while `content/[siteId]` GET strips
  `staging_attributes` (key holders are the site's admins — a divergence, not a cross-tenant
  read); `analytics.trackAPIUsage` ignores the insert's returned error
  (`src/lib/analytics/tracker.ts:416-430`); `responseTime` is computed from an
  `x-start-time` header nothing sets; `src/types/index.ts:485-498` `APIKey.rate_limit` describes
  the non-existent column and has no importer. The `rate_limits` table becomes unused by code;
  it is not dropped (no migration).

## Open questions

None blocking. Settled here: option (a); per-key bucket shared by all verbs with the key's
`rate_limit_per_minute` as ceiling (fallback: `API_CONTENT`'s 100 = the column default, when the
value is not a positive integer); IP guard + per-key limiter both fail closed; `validateAPIKey`
selects an explicit column list so the schema-strict double can see every column it reads.

## Real complexity

No score was given before research (operator-prevalidated). Verdict: **2**. One route, one
optional field on a shared helper, one deletion, and a test double; no migration, no UI, no
auth change. The only part with weight is the schema-strict double, which must derive its
columns from the migrations rather than from a hand-kept list, or it would drift exactly the way
the old stub did.
