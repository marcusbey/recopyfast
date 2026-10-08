# Research — Story s68a-edit-session-authority

Verified against `origin/main` at `659778e` on 2026-10-08. Every claim below was opened in the
code; the three database claims marked **[replay]** were also reproduced on a disposable
PostgreSQL 14 built from `scripts/db/bootstrap-supabase-fixtures.sql` + every file in
`supabase/migrations/` (the same replay `scripts/run-db-invariants.mjs` builds), with
role-switched SQL (`SET LOCAL ROLE authenticated` + `request.jwt.claims`). No production access
was used; production facts are the owner's read-only SQL of 2026-10-08, quoted as such.

## The five structuring facts

1. **H1 is real and has three halves, not one.** (a) Issuance: an `edit` member's own JWT inserts
   an `admin` edit session expiring in 2099 — **[replay]** accepted, policy
   `20250817000000_complete_database_setup.sql:483-492` (owner confirms it live in production).
   (b) Authority: `validateEditSessionAccess` returns the row's permissions and nothing else
   (`src/lib/auth/editor-access.ts:416-457`); `POST /api/staging/publish` gates on them
   (`src/app/api/staging/publish/route.ts:106-138`) when no session cookie is sent. (c) Survival:
   `DELETE /api/sites/[siteId]/share` deletes the grant (`route.ts:514-518`) and never touches
   `edit_sessions`; the 24 h ceiling lives only in `/api/edit-sessions/extend`. Closing (a) alone
   leaves (b)+(c): a legitimately issued admin session outlives a demotion or removal.
2. **H2 is FALSE as a replay risk and TRUE as an unenforced guard.** On a fresh replay
   `20260809120000_lock_down_definer_functions.sql:89-145` revokes every listed function, the only
   later re-grant (`20260818001000:92`, `update_translation_coverage`) is re-revoked by
   `20260925120000:166-169`, and `src/__tests__/db/function-grants.test.ts` +
   `rls-policies.test.ts` pass against the replay (**[replay]** 6/6, 2026-10-08). Production also
   matches (owner SQL: only the three allowlisted predicates). What is missing: **no CI step runs
   either suite against a real database** — `.github/workflows/ci.yml:145-148` and `:256-288` name
   other suites; the plain Jest run turns them into a passing "[gated]" placeholder
   (`src/__tests__/db/db-harness.ts:280-290`). `docs/quality/qa-register.md:73-81` ("still
   blocked") is stale against the owner's production SQL.
3. **M9 is real on a replay, and one of its three policies is also live in production.**
   **[replay]** a stranger inserts themselves as `owner` of any team
   (`20260731008000_rls_policies_for_locked_tables.sql:201-210`); an invitee rewrites their
   invitation to `role='manager'` on another team (`20260801200000_missing_base_tables.sql:956-968`);
   a collaborator `admin` runs an unscoped `UPDATE site_permissions SET granted_by = <self>` and
   stamps the creator's row (`20260731008000:117-123`), defeating the creator marker
   `20260813140000` relies on. In production `20260731008000` aborted, so only the invitation
   policy (from the applied `20260801200000`) exists — and it is inert there, because production's
   `team_members` has no `authenticated` INSERT policy (`20260804130000:214-222`), so a rewritten
   invitation cannot be accepted. Teams are PRD graveyard (`docs/prd.md:139-140`).
4. **The fix breaks two e2e seeds unless they change.** `e2e/share-edit-publish.spec.ts:431-437`
   and `e2e/realtime-parity.spec.ts:432` insert edit sessions with **no `user_id`**. Under a
   live-grant intersection those sessions are refused. Both specs already create an owner with an
   `admin` row (`:377-381`, `:456-460`), so the seed only has to name it.
5. **Rollout has a precedent and an unknown.** The s56 runbook
   (`docs/operations/content-writes-service-role.md`) is the model: application first, then
   `supabase migration list --linked`, `supabase db push --linked --dry-run` (must list only the new
   files), verify with a catalogue query through the read-only path. The unknown is the production
   ledger: qa-register says `20260809120000` never applied, its top banner says "46 of 46". If it
   is pending, the dry run will list it and the operator must stop and decide (open question 1).

## Target story

`docs/stories.md` → `s68a-edit-session-authority`. An edit session grants at most its holder's
live grant, is refused past 24 h from issue, dies with the member's removal, and is written only
by the service role; replay-only self-escalation policies are dropped; the definer-function and
RLS invariants are enforced by CI against real replays and asserted at apply time in production.

## Current state of the code

- **Issuance** — `POST /api/edit-sessions/create` (`src/app/api/edit-sessions/create/route.ts`):
  `getUser` → per-user fail-closed limiter → body → `authorizeFirstPartyEditorAccess` →
  `checkOwnerCanEdit` → `EditSessionManager.createEditSession`
  (`src/lib/auth/edit-sessions.ts:59-130`), which reads the caller's `site_permissions` row and
  inserts the session **with the user's RLS client** (`:63`, `:96-108`). That insert is the only
  application write that needs the INSERT policy. Token: 48 random bytes (`:305-307`). Duration
  capped at 24 h for one grant (`:89-92`).
- **Other writers** — revoke (`:198-233`) and extend (`extend/route.ts:79-147`) already use the
  service client. `cleanupExpiredSessions` (`:281-300`) uses the user client and has no caller —
  a silent no-op (no UPDATE policy).
- **Readers** — `getActiveSessionsForUser` (`:238-276`) reads under the user's client via the
  own-rows SELECT policy (`20250817000000:480-481`); `GET /api/edit-sessions/active` uses it.
- **Validation** — `validateEditSessionAccess` (`editor-access.ts:416-457`), service client,
  `token` + `site_id` + `is_active` + `expires_at >= now`; trusts `permissions`. Reached by
  `validateEditorTokenFromRequest` (`:459-497`) from: `staging/publish` (POST `:107`, GET `:281`),
  `staging/content/[siteId]`, `staging/validate`, `edit-board/history` (+ `[versionId]`),
  `ai/suggest`, `edit-sessions/extend`, `edit-sessions/validate`.
- **Realtime** — `server/auth.js:219-241` repeats the trust (s68c).
- **First-party access** — `authorizeFirstPartyEditorAccess` (`editor-access.ts:138-184`) reads the
  direct `(site_id, user_id)` row under the user's client. Team grants are not consulted anywhere
  on the editor path. `site_permissions.permission` is `CHECK IN ('view','edit','admin')`
  (`20250817000000:56`) — there is no `publish` level.
- **Removal** — `share/route.ts:384-571` (DELETE): `getUser` → `checkSitePermission(manager|owner)`
  → service-role pre-read scoped by site → creator / last-admin guards → delete (`:514-518`) →
  notifications. No edit-session revocation; no rate limiter (out of scope here).
- **Table grants** — owner's production SQL: `anon` and `authenticated` hold
  DELETE, INSERT, SELECT, TRIGGER, TRUNCATE, UPDATE on `edit_sessions`. **[replay]** same
  (Supabase default privileges, mirrored by the bootstrap at `:76-81`).

## Anchor points

- `src/lib/auth/editor-access.ts` `validateEditSessionAccess` — intersection + lifetime check.
- `src/lib/auth/edit-sessions.ts` `createEditSession` — service client for the insert;
  `MAX_SESSION_LIFETIME_HOURS` (`:50`) is the constant to reuse.
- `src/app/api/sites/[siteId]/share/route.ts` DELETE — deactivate the removed user's sessions
  after the delete succeeds.
- New migrations after `20261005000000` (latest on main and on the s66/s67 branches):
  `20261008100000_edit_sessions_service_role_writes.sql`,
  `20261008110000_converge_replay_privileges.sql`.
- Template migration: `20260928140000_content_writes_are_service_role_only.sql` (drop policies,
  revoke `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` from `PUBLIC, anon,
  authenticated`, explicit service-role grant). Schema-wide postcondition precedent:
  `20260818002000_pin_definer_search_path.sql:63-81`.
- DB tests: template `src/__tests__/db/content-write-privileges.test.ts` (catalogue checks
  `:220-298` + PostgREST probes with GoTrue JWTs `:348-560`); role-switch precedent
  `src/__tests__/db/column-privileges.test.ts:459-462`.
- CI: `scripts/run-db-invariants.mjs:181-197` (bare PG14 replay, fixed jest file list) and
  `.github/workflows/ci.yml:256-288` (Supabase CLI replay + PostgREST step).

## Verified APIs / functions

- `normalizePermissions(raw)` (`editor-access.ts:75-102`) — widens admin ⊃ publish ⊃ edit ⊃ view;
  `requireEditorPermission(access, p)` (`:104-109`).
- `EditorAccess` carries `userId`, `editSessionId` (`:40-51`).
- `MAX_SESSION_LIFETIME_HOURS = 24` (`edit-sessions.ts:50`).
- `describeDb(name, ({ query, withClient, createSite }) => …)` (`db-harness.ts:272-346`);
  `RCF_REQUIRE_TEST_DB=1` turns an unreachable DB into a failure (`:280-283`).
- Function-grant invariant SQL to reuse in the postcondition: `EXECUTE_GRANTS_SQL` +
  `IDENTITY_SQL` (`function-grants.test.ts:117-141`), allowlist of three identities (`:81-85`).

## Traps & constraints

- **Unit tests that mock the edit-session path** and will need a `site_permissions` read added to
  their fakes (behaviour change, to be declared in the PR): `src/lib/auth/__tests__/editor-access.test.ts`,
  `editor-token-site-binding.test.ts`, `editor-grants-ttl.test.ts`,
  `src/__tests__/api/edit-sessions/{create-plan-gate,create-token-leak,extend}.test.ts`,
  `src/__tests__/api/owner-plan-gate.test.ts`, `src/__tests__/api/ai/suggest/{route,editor-credentials}.test.ts`,
  `src/__tests__/api/staging/service-role-rate-limit.test.ts`. The create tests currently expect
  the insert on the user client.
- **e2e seeds** (fact 4); Playwright total must stay 45 (`e2e/support/strict-run-contract.ts`).
- **Order of checks in validation**: the existing message "Invalid or expired edit session"
  must be the only refusal text for every new reason (no oracle for "member removed" vs "token
  wrong").
- **`createEditSession` reads the grant with `.single()`** (`:66-71`); keep the user-client read
  (it is what proves the caller), move only the insert.
- **The migration's data step** must not deactivate legitimate sessions: legitimate rows have a
  non-NULL `user_id`, `expires_at ≤ created_at + 24 h`, and permissions within the holder's grant
  at issue time. A legitimate admin later demoted would be deactivated — correct under ADR 047.
- **REVOKE on a replay vs production**: the INSERT policy exists on both; `DROP POLICY IF EXISTS`
  converges. Column-level grants: none known on `edit_sessions`, but the postcondition must use
  `has_any_column_privilege` as `content-writes-service-role.md` does (non-negotiable 9's lesson).
- **M9 policies**: on production only "Invitees and managers can update invitations" exists; the
  rest are replay-only. `DROP POLICY IF EXISTS` for all, then recreate the invitation UPDATE policy
  for managers/owners only. Keep `20260813140000`'s per-row DELETE policy (live in production,
  not an escalation path). The teams accept route (`src/app/api/teams/invitations/accept/route.ts:104,120`)
  writes under the user client and is already non-functional in production; it stays frozen.
- **H2 postcondition on production**: if production holds a definer function executable by
  `anon`/PUBLIC or by `authenticated` outside the allowlist, the migration aborts (transaction) —
  the intended outcome. The pre-apply read-only query predicts it.
- **Bare PG14 caveat** (from `20260809120000:192-214`): `ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE … FROM PUBLIC` cannot remove the global PUBLIC default for functions; every new definer
  function must revoke explicitly. Wiring `function-grants.test.ts` into CI is what catches the
  next one.
- **The stories review gate** (`docs/reviews/stories.md:263`) says `Stories ready: no`. The owner's
  2026-10-08 decision is the authority for s68; recorded, not blocking.
- **Do not touch** `public/embed/` (s67 is rewriting embed startup), `server/` (s68c), or any
  applied migration.

## Open questions

1. **Production ledger.** Is `20260809120000` (and `20260731008000`) recorded in
   `supabase_migrations.schema_migrations` in production? Read-only:
   `SELECT version FROM supabase_migrations.schema_migrations WHERE version >= '20260809120000' ORDER BY 1;`
   plus `supabase migration list --linked`. If `20260809120000` is pending, `db push` will try it
   first; it is idempotent (REVOKE/GRANT) and should now apply — but it is the owner's call.
2. Should `staging_access`'s admin INSERT/UPDATE policies get the same treatment (ADR 047
   "Watch")? Not an escalation today; left out of s68a.
3. `cleanupExpiredSessions` is dead and silently non-functional; delete it or route it through the
   service role? Planner chose: delete with a tombstone (no caller).

## Real complexity

Scored 4. Confirmed 4: two migrations with a data step and postconditions, an auth-path change
touching ten mocked suites, two e2e seeds, two new real-database suites wired into both CI
targets, an ADR and a runbook. No UI. Not a 5: every piece has a precedent in s38/s56.

## Split proposal

None. H2's remainder is CI wiring plus a postcondition, which belongs with the migrations that
already change privileges; M9 is one migration. Splitting would ship two privilege migrations in
two deploy windows for no gain.
