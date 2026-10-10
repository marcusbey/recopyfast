# Research — Story s42-api-keys-writes

Date: 2026-09-25. Scope: repository at `origin/main` `fb28a8b` plus the production RLS/grant
state supplied by the operator (queried live today by the operator, not by this lane). No
production access was used.

## The five structuring facts

1. Every write in `/api/api-keys` runs on the user-scoped client — insert
   `src/app/api/api-keys/route.ts:124-137`, update `:298-304`, delete `:384-388` — while the
   only `authenticated` policy on `api_keys` is `FOR SELECT`
   (`supabase/migrations/20260804130000_restore_missing_rls_policies.sql:176-179`). Production
   confirms it: no INSERT/UPDATE/DELETE policy for `authenticated`. Creating, pausing and
   deleting a key fail in production today.
2. s38 then removed every web-role write privilege on `api_keys`
   (`20260925120000_sites_api_key_column_grants.sql:79-107`) and its own comment names this
   route as the "separate, pre-existing route defect" it did not repair (`:82-85`). The real-DB
   invariant `web principals retain only the reviewed mutation columns`
   (`src/__tests__/db/column-privileges.test.ts:365-390`) pins zero INSERT/UPDATE columns and
   no DELETE for `authenticated` on `api_keys`.
3. The table was designed service-write: 20260804130000's header states the shape
   "SELECT → TO authenticated … writes → TO service_role" (`:37-39`) and grants
   `"Service role can manage API keys" FOR ALL TO service_role` (`:181-184`). Sibling dashboard
   routes on service-write tables do exactly that after a session + `site_permissions` check:
   `sites/register/route.ts:63-148`, `sites/[siteId]/regenerate-snippet/route.ts:51-88`,
   webhooks (`webhooks/route.ts` checks, `lib/webhooks/manager.ts:114-134` writes with the
   service key).
4. A key is a live credential: `validateAPIKey` (`src/lib/api/rate-limiter.ts:307-389`)
   authorises `/api/v1/content` by `key_hash`, only while `is_active = true`, derives
   `content_write` from `scopes` and the rate from `rate_limit_per_minute`. Pausing therefore
   revokes access immediately, and key material, scopes and limit must stay server-controlled.
5. The route has no rate limiter on any verb (whole file). AGENTS.md "API routes" requires a
   limiter before authorization; ADR 002 §4 requires a fail-closed limiter on a service-role
   path.

## Target story

"Creating, toggling and deleting an API key works." A signed-in site admin, from
`/dashboard/settings` → API tab (`src/app/dashboard/settings/page.tsx:374` renders
`ApiKeysPanel`), can create a key for one site (plaintext shown once), pause/resume it
(`PUT` `isActive`), and delete it. Acceptance criteria:

- POST/PUT/DELETE succeed for the key's owner who is `admin` on the key's site, against the
  production RLS and s38 grants.
- Non-admins get 403, non-owners 404, unauthenticated callers 401 — no write happens.
- Every write is scoped by `id` AND `user_id` (PUT/DELETE) or binds `user_id` to the session
  (POST); `key_hash` never appears in a response.
- GET keeps working under the s38 column grants.
- Rate limiting precedes authorization; the write path fails closed.

## Current state of the code

- `src/app/api/api-keys/route.ts` — GET/POST/PUT/DELETE. All four authenticate with
  `createClient()` (`supabase/server.ts`), check `site_permissions` (GET: any row; writes:
  `admin`), then query `api_keys` with the same user-scoped client. Response projections are
  already explicit and exclude `key_hash` (`:26-54`, s38 work).
- `src/components/settings/ApiKeysPanel.tsx` — lists (GET `:73`), creates (POST `:97`),
  deletes (DELETE `:123`). It has **no toggle control**; `PUT` is reachable only through the
  API. The Active/Inactive badge is display-only (`:216-223`).
- Tests: `src/__tests__/api/api-keys/route.test.ts` asserts constants only (never imports the
  route). `secret-projection.test.ts` imports the route with the user-scoped client mocked and
  pins the non-secret projections for GET/POST/PUT.

## Anchor points

- `route.ts` POST insert, PUT update, DELETE delete — the three statements move to the
  service-role client; their authentication and authorization reads stay user-scoped.
- `route.ts` top of each verb — pre-authentication IP limiter; writes also get a per-user
  limiter between authentication and the `site_permissions` lookup.
- `src/__tests__/db/column-privileges.test.ts` — additive real-DB case for the chosen path.

## Verified APIs / functions

- `createServiceRoleClient()` — `src/lib/supabase/service.ts:12-24`; throws when env is absent
  (caught by each verb's `try` → 500).
- `enforceRateLimit(request, { limit, endpoint, identifier?, identifierType?, onStoreFailure?,
  message? }): Promise<NextResponse | null>` and `getClientIp(request)` —
  `src/lib/api/rate-limit.ts:38-151`.
- Presets (`src/lib/security/rate-limiter.ts:419-443`): `IP_GENERAL` 200/min,
  `API_UPLOAD` 10/min, `USER_GENERAL` 100/min, `USER_DOMAIN_VERIFY` 3/5 min.
- s38 authenticated SELECT grant on `api_keys` (`20260925120000:105-107`): `id, user_id, name,
  key_prefix, scopes, rate_limit_per_minute, is_active, last_used_at, expires_at, created_at,
  updated_at, site_id`. GET's `API_KEY_LIST_COLUMNS` (`route.ts:42-54`), its filters
  (`site_id`, `user_id`) and order (`created_at`), and PUT/DELETE's ownership read
  (`id, site_id` filtered by `id`, `user_id`) all use granted columns only → **GET and the
  ownership reads work under s38; no change needed.** `site_permissions` grants are untouched
  by s38.
- s38 also `GRANT ALL PRIVILEGES ON public.api_keys TO service_role` (`:175-181`) on top of
  the `FOR ALL TO service_role` policy.

## Decision: option (a) — service-role writes after the existing checks

Chosen: keep authentication (`getUser`) and authorization (`site_permissions` admin, key
ownership read) on the user-scoped client under RLS, and perform only the write statement
with `createServiceRoleClient()`, scoped by `id` AND `user_id`. No migration.

Why, against option (b) (RLS write policies + column grants in a new migration):

- **(b) reverses accepted decisions.** ADR 034 "Retain INSERT/UPDATE/DELETE only where an
  existing RLS policy requires that operation" was applied to `api_keys` deliberately, and the
  pinned real-DB invariant (fact 2) would have to be rewritten. That needs a superseding ADR,
  not a story fix.
- **(b) widens a credential table to direct PostgREST writes.** Any browser session could
  insert rows with a caller-chosen `key_hash` (a low-entropy or known key), bypass the route's
  generator (`rcp_` + 32 random bytes) and its limiter, and — unless every column list and
  `WITH CHECK` is exactly right — set `scopes` or `rate_limit_per_minute`, which directly
  govern `/api/v1/content` (fact 4).
- **(a) is how this codebase already writes service-only tables from the dashboard** (fact 3),
  and is the shape 20260804130000 designed for this table. It adds no auth path: it reuses the
  route's existing session + `admin` check.

Tension recorded for review: ADR 002 §3 names site-token/editor-grant principals as the
permitted service-role callers, and §2 says signed-in-user routes stay on `server.ts`. Read
literally, (a) is outside §3's list. It is nevertheless the settled practice for service-write
tables (`sites`, `webhooks`), and `docs/architecture.md:120-121` makes what the code always
does the same way the law. The mitigation ADR 002 asks for is kept: authorization before any
write, reads stay under RLS, and a fail-closed limiter on the service-role path.

## Rate limiting (decision)

- **All verbs:** a pre-authentication IP flood guard (`IP_GENERAL`, endpoint `api-keys:ip`),
  before `getUser()` so an unauthenticated flood never reaches Supabase Auth or
  `site_permissions`. Loose on purpose — agencies share office NAT addresses.
- **GET:** `onStoreFailure: "allow"`. It is a user-scoped RLS read of the caller's own rows;
  the panel re-fetches it on every site switch and after every write, and a Redis blip must not
  turn "your keys" into an error.
- **POST/PUT/DELETE:** the IP guard with `"deny"`, plus a per-user bucket (`API_UPLOAD`
  10/min, endpoint `api-keys:write`, `identifierType: "user"`, `"deny"`) placed after
  authentication and before the `site_permissions` lookup. Fail closed: the write runs with
  RLS bypassed and mints or revokes a credential for the public API (ADR 002 §4). Ten key
  writes a minute is far above human use.

## Traps & constraints

- `secret-projection.test.ts` mocks only `@/lib/supabase/server`. Once POST/PUT write through
  the service client, its unmocked `createServiceRoleClient` would reach a placeholder URL.
  Its mocks must be extended (service client + limiter) while every projection assertion is
  kept — a declared test change (AGENTS.md "Tests").
- The service client can read `key_hash`. The explicit returning projection
  (`API_KEY_RESPONSE_COLUMNS`) and `withoutKeyHash` now carry the whole secret boundary for
  POST/PUT responses; neither may be relaxed to `.select()`.
- Keys whose `site_id` is NULL (legacy, pre-`site_id`) fail the admin check (`eq site_id` on
  NULL) → 403 on PUT/DELETE, and GET never lists them. Unchanged behaviour, out of scope.
- The panel has no pause/resume control. Toggling works through `PUT`; adding a UI control is
  design work (`/ks-design`) and out of this story's scope — recommended follow-up.
- No cap on key count per site or on `name` length — pre-existing, out of scope.
- `route.test.ts` is vacuous but harmless; left untouched.

## Open questions

None blocking. Whether ADR 002 §3 should be superseded to name "signed-in site admin after a
`site_permissions` check" as a permitted service-role principal is a framing question for the
operator; this story follows existing practice and does not write that ADR.

## Real complexity

Scored 2 in `docs/stories.md`. Verdict after reading: 2. One route file, one existing test to
extend, one new unit suite, one additive DB case. No migration, no UI.
