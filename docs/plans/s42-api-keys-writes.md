---
validated: yes
validated_by: 'operator directive 2026-09-25: "keep going, don''t ask for permission, until tested live in production and ready to launch"'
validated_at: 2026-09-25
---

# Plan — Story s42-api-keys-writes

Branch: `feature/s42-api-keys-writes`
Research: `docs/research/s42-api-keys-writes.md` — read it first; this plan does not repeat it.

## Target story

A signed-in site admin can create, pause/resume and delete an API key from
`/dashboard/settings` against production's SELECT-only RLS and the s38 grants. Option (a):
the three write statements run through `createServiceRoleClient()` after the route's existing
session + `site_permissions` admin check, scoped by `id` AND `user_id`; no migration. Rate
limiting precedes authorization on every verb. Acceptance criteria are in the research.

## Tasks (ordered)

1. [x] Rate limiting, test-first. New `src/__tests__/api/api-keys/writes.test.ts` (user-scoped
   client, service client and `@/lib/api/rate-limit` mocked). Red: POST/PUT/DELETE return the
   limiter's 429 before `getUser` runs (IP guard `IP_GENERAL`, endpoint `api-keys:ip`, `deny`);
   a per-user limit (`API_UPLOAD`, endpoint `api-keys:write`, identifier = user id,
   `identifierType: "user"`, `deny`) stops the request after authentication and before any
   `site_permissions` query; GET's IP guard uses `allow`. Green: add the limiters with comments
   justifying each fail mode.
2. [x] POST through the service role, test-first. Red: with the user-scoped client rejecting
   any `api_keys` write the way production does (42501), an admin's POST returns 200 with the
   one-time `rcp_` key; the insert went through the service client with `user_id` = session
   user, the checked `site_id`, a server-generated `key_hash`/`key_prefix`, `is_active: true`,
   and the explicit non-secret returning projection. Non-admin → 403, unauthenticated → 401,
   service insert error → 500 generic; none of those touch the service client's write. Green:
   move the insert to `createServiceRoleClient()`, created only after authorization.
3. [x] PUT through the service role, test-first. Red: the owner/admin pauses a key → 200, the
   update ran on the service client with only `is_active` + `updated_at`, filtered by `id` AND
   `user_id`, returning the explicit projection. Unknown/not-owned key → 404, non-admin → 403,
   no service write. Green: move the update.
4. [x] DELETE through the service role, test-first. Red: the owner/admin deletes → 200 via the
   service client filtered by `id` AND `user_id`; not-owned → 404, non-admin → 403, no service
   write; service error → 500 generic. Green: move the delete.
5. [x] Keep `secret-projection.test.ts` pinning the secret boundary: extend its mocks with the
   service client and the limiter so POST/PUT projections are recorded from whichever client
   runs the statement; keep every existing assertion. Declared test change.
6. [x] Real-DB case, additive, in `src/__tests__/db/column-privileges.test.ts`: in one rolled-back
   transaction, an authenticated site admin's INSERT into `api_keys` is denied (42501 — the
   production failure); service_role inserts, pauses and deletes the key with the route's
   `id` + `user_id` scoping and non-secret RETURNING list; the authenticated owner lists it with
   GET's projection; a mismatched `user_id` updates nothing. Run with
   `node scripts/run-db-invariants.mjs` (disposable PostgreSQL 14).
7. [x] Gates: `npm run precommit`, `npm run format:check`, `npm run type-check:build`,
   `npm run build`. Tick `docs/stories.md` s42, fill the Execution log, one story commit.

## Run interdicts

- No migration file; `supabase/migrations/` diff stays empty.
- No existing assertion in `secret-projection.test.ts` or `column-privileges.test.ts` is removed
  or weakened; both diffs are additive (mocks/new case only).
- `API_KEY_RESPONSE_COLUMNS`, `API_KEY_LIST_COLUMNS` and `withoutKeyHash` are not relaxed;
  no `.select()` without an explicit column list on `api_keys`.
- No new auth helper and no change to `src/lib/security/site-auth.ts`, `ingest-auth.ts` or
  `src/lib/supabase/*`.
- Authentication and authorization reads stay on the user-scoped client.
- No UI change (`ApiKeysPanel.tsx` diff empty); no ADR, AGENTS.md or architecture edit.
- No push, PR, merge, deploy or production database operation; never `--no-verify`.

## The point everything turns on

Moving writes onto the RLS-bypassing client makes the route's own checks the only boundary.
Where it could be wrong:

- **Scoping of the service write.** PUT/DELETE must filter the service statement by `id` AND
  the session `user_id`, not by `id` alone; POST must take `user_id` from the session, never
  from the body. Compare against the ownership read above each write.
- **Order.** The service client must not be created, nor any write issued, before the admin
  check passes; the per-user limiter must run before the `site_permissions` lookup. Compare with
  `sites/[siteId]/regenerate-snippet/route.ts`.
- **ADR 002 §3.** Its literal list of service-role principals excludes a signed-in admin; the
  research records why this follows the `sites`/`webhooks` practice instead of (b). A reviewer
  who reads §3 as binding should weigh it against ADR 034 and the pinned invariant.

## Files touched

- `src/app/api/api-keys/route.ts`
- `src/__tests__/api/api-keys/writes.test.ts` (new)
- `src/__tests__/api/api-keys/secret-projection.test.ts` (mocks only)
- `src/__tests__/db/column-privileges.test.ts` (one additive case)
- `docs/research/s42-api-keys-writes.md`, `docs/plans/s42-api-keys-writes.md`, `docs/stories.md`

## Test strategy

Route behaviour at the HTTP boundary with both Supabase clients and the limiter mocked: status
codes, which client performed the write, the filters applied, and that no write happens on the
refusal paths. The user-scoped mock rejects writes on `api_keys` like production does, so the
red tests fail for the real reason. Database truth — that service_role can do the writes under
the s38 grants and `authenticated` cannot — is proven on a disposable PostgreSQL with every
migration applied, not by mocks.

## Definition of Done

- All tasks ticked; new and extended suites green; red observed before each green.
- `lint`, `type-check`, `format:check`, full `jest`, `type-check:build` and `build` green.
- DB invariants runner green on disposable PostgreSQL 14, including the new case.
- One commit `fix: API keys can be created, paused and deleted`; no push/PR/production action.
- Deployment and the live check are the operator's, after review; no migration to apply.

## Execution log

2026-09-25, worktree `.omx/worktrees/s42-api-keys-writes`, base `origin/main` `fb28a8b`.
Every command ran with the CI placeholder environment; nothing touched production.

- **Task 1** — red: 10/10 new limiter cases failed (no limiter existed: 429 expected, the
  route authenticated and queried). Green: `shedIpFlood` on every verb (GET `allow`,
  writes `deny`) and `limitKeyWrites` after `getUser()`, before any data access. 10/10.
- **Task 2** — red: the two create cases returned 500, the user-scoped insert refused with
  42501 as in production. Green after moving the insert to `createServiceRoleClient()`
  (created after the admin check). The refusal (edit/view/none → 403) and generic-500 cases
  passed before the change — they pin existing behaviour on the new path — so they were
  proven by mutation instead (below).
- **Task 5** — executed immediately after Task 2 (plan order: after Task 4). Task 2's change
  made `secret-projection.test.ts` POST fail (500: unmocked service client), so the suite was
  red between tasks. Mocks for the service client and the limiter added, 0 lines removed,
  every assertion kept; its POST and, after Task 3, PUT projections now run through the
  service mock and still pass.
- **Task 3** — red: pause and resume returned 500 (user-scoped update refused). Green after
  the service-role update filtered by `id` + `user_id`.
- **Task 4** — red: delete returned 500; the failed-delete case saw no service write. Green
  after the service-role delete filtered by `id` + `user_id`. api-keys folder: 3 suites /
  36 tests.
- **Mutation checks** (each applied alone to the green route, `writes.test.ts` rerun, route
  restored byte-identical): service client created before POST's admin check → 3 failed;
  update without `user_id` filter → 2 failed; delete without `user_id` filter → 1 failed;
  insert error message returned to caller → 1 failed; delete error message returned → 1
  failed; service client created before PUT's ownership read → 2 failed; PUT admin check
  disabled → 1 failed. All killed.
- **Task 6** — disposable PostgreSQL 14.17 on loopback port 55442 (Unix socket disabled: the
  scratch path exceeds the 103-byte socket limit), then
  `RCF_TEST_DB_URL=postgresql://postgres@127.0.0.1:55442/postgres node scripts/run-db-invariants.mjs`:
  bootstrap + every migration + the s38 migration re-applied, suite 14 passed / 1 skipped
  (the PostgREST-only case, which CI's Supabase job runs). The s42 case passed first run by
  design — it asserts the database contract the fix relies on, and no database change was
  made. Negative controls on the same database: an option-(b)-shaped authenticated INSERT
  column grant + policy failed the s42 case and the pinned mutation invariant; revoking
  DELETE from service_role failed the s42 case; restored state green. Cluster destroyed.
- **Task 7** — `npm run precommit`: lint 0 errors / 38 inherited warnings (none in touched
  files), `tsc --noEmit` clean, Jest 249 suites passed / 2 skipped, 3,332 tests passed / 39
  skipped. `npm run format:check`, `npm run type-check:build` clean. `npm run build`: compiled,
  102 pages generated, `/api/api-keys` dynamic; the `fetch failed` catalogue lines are the
  placeholder environment (same as s37). No tracked file changed by the build.
- **Diff scope** — `supabase/`, `src/lib/`, `src/components/` empty; the two existing test
  files are additive only (19 and 103 insertions, 0 deletions).
- **Delivery** — one story commit on `feature/s42-api-keys-writes`. Not pushed, no PR. **No
  migration to apply**: production already has the service_role policy and grants this relies
  on. Live check after deploy (operator): create, pause, resume and delete a key from
  `/dashboard/settings` (pause/resume via `PUT /api/api-keys` — the panel has no toggle).
