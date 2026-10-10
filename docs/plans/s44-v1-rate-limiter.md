---
validated: yes
validated_by: 'operator directive 2026-09-25 — "keep going, don''t ask for permission, until tested live in production and ready to launch"'
validated_at: 2026-09-25
---

# Plan — Story s44-v1-rate-limiter

Branch: `feature/s44-v1-rate-limiter`
Research: `docs/research/s44-v1-rate-limiter.md` — read it first; this plan does not repeat it.

## Target story

`/api/v1/content` answers a valid key instead of 429ing every request. Option (a): the route
meters through the shared `enforceRateLimit` (Redis in production) — a per-IP guard before
`validateAPIKey` and a per-key bucket behind it whose ceiling is the key's own
`rate_limit_per_minute` — and the Postgres `APIRateLimiter`, which queries columns no schema
ever had, is deleted. No migration. Acceptance criteria are in the research.

## Tasks (ordered)

1. [x] Schema-strict database double, test-first. New `src/__tests__/helpers/migration-columns.ts`
   derives each table's columns from `supabase/migrations/` in ledger order (first
   `CREATE TABLE`, then `ALTER TABLE … ADD/DROP/RENAME COLUMN`); new
   `src/__tests__/helpers/schema-strict-supabase.ts` is an in-memory PostgREST-shaped client
   (`from/select/insert/update/delete/eq/neq/gt/gte/lt/lte/is/limit/order/single/maybeSingle`,
   awaitable) that answers a query naming a column the table does not have with PostgREST's
   error (`42703`; `PGRST204` for a write payload) and an unknown table with `42P01`, and records
   every query. New `src/__tests__/helpers/schema-strict-supabase.test.ts`. Red (helpers
   absent): derived `rate_limits` equals production's nine columns; derived `api_keys` equals
   `COLUMN_ALLOWLISTS.api_keys` + `key_hash`; the double refuses each of the old limiter's
   queries (`api_keys.select("rate_limit, …")`, `rate_limits` count `.eq("key")/.gte("timestamp")`,
   insert `{ key, timestamp }`) and serves real-column reads/writes. Green: write the helpers.
2. [x] The route answers, test-first. New `src/__tests__/api/v1/content-route.test.ts`
   (`@jest-environment node`; `@supabase/ssr` → the double seeded with a site, an admin row,
   an active site-bound key at DB defaults, content; analytics mocked; the shipped
   `enforceRateLimit` over the memory store, `Date.now` pinned, store cleared per test). Red —
   the production symptom, 429: a fresh key's first GET → 200 with the site's content; POST
   with a write key → 201 and the row exists; PUT → 200 updated; a per-key store outage (store
   throws for `identifierType: "api_key"`) → 503 with `Retry-After` and no `content_elements`
   query. Green: per-key `enforceRateLimit` (`API_CONTENT`, endpoint `v1/content`, identifier =
   key id, `api_key`, `deny`, commented) right after `validateAPIKey` on GET/POST (PUT = POST);
   drop the Postgres-result success headers; delete `APIRateLimiter`, `createRateLimitMiddleware`,
   `getDefaultKey`, the module's `RATE_LIMIT_CONFIGS` and `rateLimiter`, leaving a tombstone;
   `validateAPIKey` selects an explicit column list and returns `rate_limit_per_minute` (no
   `rate_limit` read), admin re-check untouched; delete `rate-limiter-fail-closed.test.ts`
   (tests only the deleted class — declared).
3. [x] The key's own ceiling, test-first. New `src/__tests__/lib/api/enforce-rate-limit-override.test.ts`:
   `maxRequests: 2` → third call 429 with `X-RateLimit-Limit: 2`; `0`, `-1`, `1.5`, `NaN`,
   absent → the preset's ceiling. Route cases: a key with `rate_limit_per_minute = 2` gets
   200, 200, then 429 (`Retry-After`, `X-RateLimit-Limit: 2`) with no `content_elements` query on
   the 429; a second key on the same site is still answered; GET and POST share the bucket.
   Green: optional `maxRequests` on `EnforceRateLimitOptions` (positive integer overrides the
   preset's ceiling, keeps its window); route passes the key's `rate_limit_per_minute`.
4. [x] Rate limit before authorization, test-first. Route cases: with the IP bucket refusing,
   GET/POST/PUT/DELETE → 429 and the double saw no `api_keys` or `site_permissions` query; with
   the store down for every check, every verb → 503 before any `api_keys` query; DELETE is
   metered per key (limit 1: 403 then 429). Green: `shedIpFlood` (`IP_GENERAL`, endpoint
   `v1/content:ip`, `deny`, commented) first in every verb; DELETE gets the per-key limiter after
   `validateAPIKey`.
5. [x] Tombstones and gates. Route header comment and the `rate-limiter.ts` tombstone state
   what broke (s44) and the fail-mode rule applied. `npm run precommit`, `npm run format:check`,
   `npm run type-check:build`, `npm run build`. Tick `docs/stories.md` s44, fill the Execution
   log, one story commit.

## Run interdicts

- No migration; `git diff main -- supabase/` is empty. `rate_limits` is not dropped.
- `src/lib/security/rate-limiter.ts` diff empty (store, presets, store selection unchanged).
- `enforceRateLimit` behaves identically for every existing caller (the new field is optional
  and absent at every existing call site).
- `validateAPIKey`'s expiry, site/user binding and admin re-check (`rate-limiter.ts:359-394` at
  base) keep their logic; `src/lib/api/__tests__/validate-api-key.test.ts` diff empty and green.
- v1 content queries, sanitization and response bodies unchanged; only limiter placement and the
  success-path `X-RateLimit-*` headers change.
- No change to `site-auth.ts`, `ingest-auth.ts`, `src/lib/supabase/*`, the api-keys route, UI,
  ADRs, AGENTS.md or `docs/architecture.md`.
- The research's out-of-scope follow-ups (DELETE scope, v1 `metadata` filtering, `trackAPIUsage`
  error handling, `APIKey.rate_limit` type) are not fixed here.
- No push, PR, merge, deploy or production operation; never `--no-verify`.

## The point everything turns on

Replacing a limiter that refused everything with one that admits requests, on a service-role
route. Where it could be wrong:

- **Fail mode.** Both limiters deny on a store outage. Compare with AGENTS.md `:133-135` vs
  `:163-166` and ADR 002 §4; the research explains why v1 GET is not the widget's "public read".
  A reviewer who reads v1 GET as a public read would expect the per-key limiter to allow.
- **Keying.** Per API key, not per site (ADR 002 §4's wording). Compare with the dashboard's
  per-key figure (`ApiKeysPanel.tsx:230`) and the predecessor's per-key key; a site with several
  keys gets several budgets.
- **The double's fidelity.** It is only as honest as `migration-columns.ts`'s reading of the
  migrations; Task 1 anchors it to the production column lists supplied by the operator, and it
  must fail on the exact queries the old limiter made.

## Files touched

- `src/app/api/v1/content/route.ts`
- `src/lib/api/rate-limiter.ts` (Postgres limiter deleted; `validateAPIKey` select/return)
- `src/lib/api/rate-limit.ts` (optional `maxRequests`)
- `src/__tests__/helpers/migration-columns.ts`, `schema-strict-supabase.ts`,
  `schema-strict-supabase.test.ts` (new)
- `src/__tests__/api/v1/content-route.test.ts` (new)
- `src/__tests__/lib/api/enforce-rate-limit-override.test.ts` (new)
- `src/__tests__/lib/api/rate-limiter-fail-closed.test.ts` (deleted — declared)
- `docs/research/s44-v1-rate-limiter.md`, `docs/plans/s44-v1-rate-limiter.md`, `docs/stories.md`

## Test strategy

Route behaviour at the HTTP boundary against a database double that refuses unknown columns
the way PostgREST does, with the limiter's shipped code over its real in-memory store (only its
`checkLimit` is spied on to simulate an outage or an exhausted IP bucket). Assertions are on
status codes, headers, what the double was asked, and resulting rows — never on which internal
function ran. The double's column lists come from the migrations and are anchored to the live
production lists, so a future query on a non-existent column fails here instead of in production.

## Definition of Done

- All tasks ticked; red observed before each green; mutation checks recorded.
- `lint`, `type-check`, `format:check`, full `jest`, `type-check:build`, `build` green.
- One commit `fix: the public content API answers instead of rate-limiting every request`; no
  push/PR/production action. No migration to apply.
- Live check after deploy (operator): a fresh key's first GET answers 200; the request past the
  key's per-minute figure answers 429.

## Execution log

2026-09-25/26, worktree `.omx/worktrees/s44-v1-rate-limiter`, base `origin/main` `8083996`.
Every command ran with the CI placeholder environment; nothing touched production.

- **Task 1** — red: the suite could not load (`./migration-columns` absent). Green: 13/13. The
  reader's output was also dumped for `sites` and `webhooks` and matches
  `COLUMN_ALLOWLISTS` plus each table's secret column.
- **Task 2** — red, the production symptom: GET, POST and PUT all answered **429**; the per-key
  outage case answered 429 instead of 503; the api_keys lookup selected `*`. The "no query
  errored" assertion was not itself red here: the old limiter's module singleton cached the
  first test's client, so its 42703s were recorded on an earlier double. The 429s carry the red.
  Green: per-key `enforceRateLimit` after `validateAPIKey`, Postgres limiter deleted,
  `validateAPIKey` on a named column list returning `rate_limit_per_minute`,
  `rate-limiter-fail-closed.test.ts` deleted (declared below). 23 tests across 3 suites.
- **Task 3** — red: the override case let 3 through (preset ceiling), and the three route cases
  answered 200 where 429 was due. The five fallback cases (absent, 0, -1, 1.5, NaN) passed
  before the change by construction, since the option did not exist yet. They were proven by
  mutation instead: a naive `maxRequests ?? preset` override failed 4 of them. Green: 15/15 in
  the two suites.
- **Task 4** — red: after a 200-request flood of made-up keys from one IP the four verbs answered
  `[200, 400, 400, 403]`; with the store down DELETE answered 403 and every verb had already
  queried `api_keys`; DELETE with a 1/min key answered 403 twice. Green: `shedIpFlood` first in
  every verb, per-key limiter on DELETE. 35 tests across 4 suites.
- **Mutation checks**: each applied alone to the green code and restored byte-identical (sha256
  verified); route and `validateAPIKey` suites rerun. Results: per-key limiter `allow` → 1 failed;
  IP guard `allow` → 1 failed; no IP guard on DELETE → 2 failed; key ceiling not passed → 4
  failed; GET per-key limit moved after the content read → 2 failed; `validateAPIKey` back to
  `select("*")` → 1 failed. All six killed.
- **Task 5** — route header and `rate-limiter.ts` tombstones written. `npm run lint`: 0 errors,
  38 inherited warnings, none in touched paths. `tsc --noEmit` clean. `format:check` clean.
  `type-check:build` clean. Full Jest: 264 suites passed / 2 skipped, 3,424 tests passed / 39
  skipped. `npm run build`: compiled, 103 pages, `/api/v1/content` dynamic; the `fetch failed`
  catalogue lines come from the placeholder environment (same as s37/s42). No tracked file
  changed by the build.
- **Diff scope** (vs base `8083996`): `supabase/`, `src/lib/security/`, `src/lib/api/__tests__/`,
  `src/components/`, `src/lib/supabase/`, the api-keys route, AGENTS.md, architecture and
  ADRs all empty.
- **Declared deviations**:
  1. Task 4's IP case exhausts the real `IP_GENERAL` bucket with 200 made-up keys instead of
     spying the store into refusing. This is more behavioural: the store is spied on only to
     simulate outages.
  2. Task 2's schema-error assertion was not red before the fix (see Task 2).
  3. Task 3's fallback cases passed pre-change and were proven by mutation.
  4. Added to Task 1's double beyond the plan's list: `seed()` throws on a column the table
     does not have. The deleted suite's fixture carried `rate_limit`, and fixtures must not be
     able to smuggle in columns.
  5. `rate-limiter-fail-closed.test.ts` deleted. It tested only the deleted class. Its H-4
     intent is kept by the new route suite: an outage keeps the route off `content_elements`,
     and the route serves while the store answers. The outage answer is now 503 + `Retry-After`,
     not 429.
- **Behaviour changes**: store outage 429 → 503; 200/201 responses no longer carry
  `X-RateLimit-*` (the 429 still does, with `Retry-After`); DELETE and the IP guard are new
  meters; the per-key ceiling is now the key's `rate_limit_per_minute` per minute (default 100).
  Before, it was an unreachable 5000/h read and 1000/h write.
- **Delivery** — one story commit on `feature/s44-v1-rate-limiter`. Not pushed, no PR. **No
  migration**: `rate_limits` becomes unused by code and stays. `origin/main` has since gained
  s40/s41 (#40, #41); none touch these files, but `docs/stories.md` may conflict at its tail
  on rebase. Live check after deploy (operator): a fresh key's first
  `GET /api/v1/content?site_id=…` answers 200; request 101 within a minute answers 429.
