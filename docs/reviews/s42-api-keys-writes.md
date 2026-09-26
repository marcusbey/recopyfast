# Review — s42-api-keys-writes

Reviewer: independent anti-hallucination pass, fresh context, 2026-09-25.
Diff judged: implementation commit `d57b249` (parent `fb28a8b`). `7749193` is a clean merge of
`origin/main` and changes none of the story files (`git diff d57b249 7749193` on them is empty).

## Commands run (CI placeholder env sourced)

| Command | Result |
|---|---|
| `npm run type-check` | exit 0 |
| `npx eslint src/app/api/api-keys src/__tests__/api/api-keys src/__tests__/db/column-privileges.test.ts` | exit 0 |
| `npx jest src/__tests__/api/api-keys src/__tests__/db/column-privileges.test.ts` | 4 suites, 50 passed, 1 skipped (the PostgREST-only case) |

The DB suite really ran. It was not gated: local Supabase `127.0.0.1:54322`, and the s42 case
passed inside a transaction that was rolled back. Not run: the full suite, `build`, `format:check`.

## Verified against the code

- The imports exist with the signatures used:
  - `createServiceRoleClient()` (`src/lib/supabase/service.ts:12`)
  - `enforceRateLimit`, `getClientIp`, `RateLimitFailureMode` (`src/lib/api/rate-limit.ts:36-151`)
  - the `IP_GENERAL` 200/min and `API_UPLOAD` 10/min presets (`src/lib/security/rate-limiter.ts:424,436`)
  - `createRateLimitConfig` accepts `identifierType: "user"`.
- **Order.** In every write verb the sequence is: IP guard (`route.ts:156,341,440`), then
  `getUser`, then the per-user limiter (`:170,355,454`), then the RLS-scoped ownership and admin
  reads. The service client is created last (`:215,407,503`). No refusal path (401/403/404/429)
  creates it.
- **Scoping.** The service update and the service delete both filter on `id` AND the session
  `user_id` (`:411-412`, `:507-508`). On insert, `user_id` comes from the session (`:220`). The
  body's `user_id`, `scopes` and `rate_limit_per_minute` are ignored, and the DB defaults apply.
- **Admin check.**
  - A key whose site the caller no longer admins gets 403 on PUT and DELETE (`:392,492`).
  - `site_permissions` INSERT/UPDATE under RLS require an existing admin, so a caller cannot
    grant themselves admin to pass the check (`20260731008000:110-123`).
- **Secret.**
  - `key_hash` and `key_prefix` are generated on the server (`:146-151`).
  - The returning projection is explicit, and `withoutKeyHash` is kept (`:228,242`).
  - The plaintext key appears only in the POST response.
- **Plan.**
  - Tasks 1–7 are all present.
  - Interdicts held: nothing changed in `supabase/`, `src/lib/`, `src/components/`, AGENTS.md
    or the ADRs.
  - Both existing test files only gained lines (+19 and +103, 0 deletions).

## Mutations (each one restored with `git checkout`; `git diff --exit-code` clean after each and at the end)

| Neutralized | Red |
|---|---|
| Removed the PUT service-update `user_id` filter | 2 |
| Removed the DELETE service-delete `user_id` filter | 1 |
| Skipped the POST admin check | 2 |
| Skipped the PUT admin check | 1 |
| Skipped the DELETE admin check | 1 |
| Created the service client before auth: POST / PUT / DELETE | 5 / 4 / 4 |
| POST takes `user_id` from the body | 1 |
| POST no longer strips `key_hash` | 2 |
| Removed the POST IP guard | 1 |
| GET fail mode switched from `allow` to `deny` | 1 |

All 12 killed.

## Findings

### Major

**M1 — A key outlives its creator's admin role, and no one can revoke it.**

- `validateAPIKey` checks only `key_hash` and `is_active` (`src/lib/api/rate-limiter.ts:351-352`).
  It never re-reads `site_permissions`, and the default scopes include `write`.
- When an admin is demoted or removed, their key keeps `content_write` on `/api/v1/content`.
- No one can revoke it:
  - they now get 403 on pause and delete (`route.ts:392,492`);
  - no other admin can list or delete it, because GET/PUT/DELETE filter on `user_id`.
- The route logic is correct. But creating a key never worked in production before this story,
  so s42 is what makes this reachable. The research does not record it.
- Fix before the public API launch, in a follow-up story. Either:
  - re-check the owner's admin row in `validateAPIKey`, or
  - revoke the member's keys when they are removed or demoted.

**M2 — ADR 002 §3 and §4 and AGENTS.md "Data access" are contradicted.**

- They reserve the service role for site-token and editor-grant callers, with an
  `authorize*` helper and a per-site limiter.
- This route has neither: it uses a session plus a `site_permissions` admin row, and a per-user
  limiter.
- Following the sibling routes is acceptable for this story. `regenerate-snippet/route.ts:51-76`
  uses the same shape, and option (b) would reverse ADR 034 and expose a credential table to
  direct PostgREST writes.
- But at least five routes now break the rule as written, so an ADR amendment is **required**
  (a follow-up, since this story forbids ADR edits). It should name "a signed-in site admin after
  an RLS-scoped admin check, plus a fail-closed per-user limiter" as a permitted principal, and
  AGENTS.md should be updated to match.

### Minor

- **m1 — PUT without a boolean `isActive` still writes.** It performs a service-role write of
  `updated_at` alone (`route.ts:401-402`).
- **m2 — A key deleted between the read and the update returns 500, not 404.** This comes from
  `.single()` (`:408-414`).
- **m3 — No cap on keys per site or on `name` length.** This predates the story; the research
  already records it.

## Could not verify

- **Production RLS and grants.** These come from the operator; I checked only the local replay.
  A human should run `\dp public.api_keys` and `pg_policies` on production.
- **The flow in a live deployment.** A human should create, pause (via `PUT`) and delete a key
  from `/dashboard/settings` after deploy.
- **The real limiter against Redis.** It was only ever mocked in these tests.
- **A deployed service-role key.** Nothing proved the service-role key is present where this
  runs; if it is missing, the route returns 500.

Max severity: major
Ship allowed: yes
