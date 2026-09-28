---
validated: yes
---
# Plan — Story s56-rls-content-writes-need-plan

Branch: `feature/s56-rls-content-writes-need-plan`, from `main` at `bae700c` (s51, #51) or later.
Research: `docs/research/s56-rls-content-writes-need-plan.md`. Read it first; this plan does not
repeat it.

## Target story

A signed-in `edit`/`admin` member can write live copy (`content_elements`) and A/B data
(`ab_tests`, `ab_test_variants`) directly through PostgREST. That bypasses s51's owner-plan gate.
This story closes the hole at the database. **Option (b):**

- revoke every direct write by `anon`, `authenticated` or PUBLIC on the nine content, history and
  A/B tables;
- move the four application routes that wrote with the user's JWT onto the service client, behind
  authorization and `checkOwnerCanEdit`.

No plan rule is copied into SQL.

Acceptance criteria:

1. A direct PostgREST INSERT, UPDATE or DELETE on any of the nine tables, by a member of a lapsed
   owner's site, is refused and changes nothing.
   - *Pending PO confirmation (research, open question 2):* the same request by a member of a
     paying owner's site is refused too, because no product surface writes directly. The paying
     owner is proved "unaffected" on the path they actually use, the route.
2. Every application writer keeps working for paying owners:
   - bulk update and bulk import, which is the dashboard;
   - translate;
   - the A/B routes;
   - v1, discovery, staging, publish and restore. These last five are already service-role and
     are unchanged.
3. Public reads are untouched: no SELECT policy or grant changes, and no read route changes.
4. `ab-tests` POST, PUT and `generate` are gated on the owner's plan. `generate`'s capability check
   and its charge are keyed to the owner.
5. Proved against real Postgres through PostgREST with user JWTs, and through the real bulk
   handlers with a real session. The proof runs in CI by name.
6. ADR 041's "Watch" entries on direct DB writes and on `ab-tests/*` are closed, through ADR 042.
7. Deploy order.
   - *Pending PO confirmation (research, open question 1):* **merge (= deploy) first, then
     migrate**, the reverse of the story's text. The migration breaks the old code's four writes;
     the new code works on either schema.

## Tasks (ordered)

1. [x] **Red: the database proof.** Create `src/__tests__/db/content-write-privileges.test.ts`
   (`@jest-environment node`, `describeDb`), and add it to CI.

   **CI.** Add a step to `.github/workflows/ci.yml`'s **e2e** job, right after "Verify
   secret-column privileges…":
   - `RCF_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`
   - `RCF_REQUIRE_TEST_DB=1`
   - `RCF_TEST_POSTGREST_URL=http://127.0.0.1:54321`
   - `RCF_TEST_POSTGREST_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY"`
   - `RCF_TEST_POSTGREST_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"`
   - command: `npx jest --runInBand <file>`

   **Catalogue part.** Set `CONTENT_TABLES` = `content_elements`, `content_versions`,
   `content_history`, `staging_history`, `ab_tests`, `ab_test_variants`, `ab_test_results`,
   `visitor_buckets`, `conversion_events`. For every table:
   - `anon` and `authenticated` get `false` from `has_table_privilege` for
     INSERT/UPDATE/DELETE/TRUNCATE, and from `has_any_column_privilege` for INSERT/UPDATE (the
     ADR 033 column case);
   - PUBLIC holds no such table grant;
   - no permissive policy with `polcmd` in `a`/`w`/`d`/`*` targets `anon`, `authenticated` or
     PUBLIC, **whatever its predicate**.

   Guards, which hold before and after the fix:
   - the SELECT policies "Users can view content for authorized sites" and "Site members can view
     ab_tests" / "…ab_test_variants" exist;
   - `authenticated` keeps SELECT on those three tables;
   - `service_role` holds SELECT/INSERT/UPDATE/DELETE on all nine.

   **PostgREST part.**
   - The target URL is pinned to loopback and `readConfiguredApiPort()`, exactly as
     `column-privileges.test.ts:143-162`.
   - It is **required, not skipped**, when `RCF_REQUIRE_TEST_DB=1`: a missing env var fails.

   Fixtures:
   - two users from `/auth/v1/signup` with a known password;
   - **L** is `admin` on site A with no entitlement;
   - **P** is `admin` on site B with `plan_entitlements {user_id, plan_id:'pro', source:'e2e'}`,
     the e2e fixture shape;
   - per site, one `content_elements` row, one `ab_tests` row and one `ab_test_variants` row,
     seeded through `pg`.

   For L on A **and** P on B, each with their own JWT and the anon key, each of these is refused
   (HTTP 403 and code `42501`):
   - PATCH `content_elements` `published_content`;
   - POST `content_elements`;
   - DELETE `content_elements`;
   - PATCH `ab_tests` `status`;
   - POST `ab_test_variants`;
   - DELETE `ab_test_variants`.

   **Each refusal is also read back through `pg`**: unchanged, absent, or still present
   (research trap 8).

   Then:
   - L's GET on `content_elements` and `ab_tests` for site A answers 200 with the seeded rows;
   - a PATCH on `content_elements` with the **service key** answers 2xx, and the row changes;
   - `afterAll` deletes the users and the sites.

   **Verify:** on the s56 stack with today's migrations the suite is **red**. A PATCH by L answers
   200 and changes the row, which reproduces s51 review finding 1. The catalogue rows name the
   seven policies and the grants. Paste both into the execution log.

2. [x] **Green: the migration.** Create
   `supabase/migrations/20260928140000_content_writes_are_service_role_only.sql`.

   Statements, in this order:
   - `DROP POLICY IF EXISTS` for "Users can edit content for authorized sites" on
     `public.content_elements`;
   - the same for "Site editors can create/update/delete ab_tests" and
     "…ab_test_variants" (six policies);
   - `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON` the nine tables
     `FROM PUBLIC, anon, authenticated`;
   - `GRANT SELECT, INSERT, UPDATE, DELETE ON` the nine tables `TO service_role`. This is
     explicit, not inherited from image defaults (research trap 6).

   The header comment, in house style, covers:
   - the incident: s51 review finding 1, `PATCH` 200 on a planless owner;
   - why this is a revoke and not a predicate: ADR 040 `:79-81`;
   - why the grant goes as well as the policy: TRUNCATE ignores RLS, and future Data API surfaces;
   - the tables whose policies were already closed;
   - the deploy order.

   Also rewrite the DB half of `src/__tests__/api/bulk/update-history-policy.test.ts`:
   - its `test.failing` becomes a plain test: an `authenticated` UPDATE is refused with `42501`,
     and the row is unchanged;
   - its header (`:12-13`) and its "MEASURED" note are rewritten to say bulk update and translate
     write through the service role since s56;
   - the guard and the source assertions stay.

   **Verify:**
   - `npx supabase migration up --local --workdir .omx/stacks/s56` applies the migration;
   - Task 1 is green;
   - `rls-policies`, `function-grants`, `column-privileges` (PostgREST), `site-delete-cascade`,
     `sites-install-status`, `credit-spend`, `founding-offer-cap` and `founding-agency-cap` are
     green on the stack;
   - `update-history-policy` is green with `RCF_DB_TESTS=1` and
     `SUPABASE_TEST_DB_URL=…:57322/postgres`;
   - if a PostgreSQL 14 bin exists locally, `RCF_POSTGRES_BIN=… node scripts/run-db-invariants.mjs`
     is green. Otherwise say so; CI's Lint/Test job is then the PostgreSQL 14 parse check.

3. [x] **Red→green: bulk writes through the service client**, proved through the real handlers.

   **Test.** Add a `describe` to the Task 1 suite, in the same CI step:
   - The suite sets `process.env.NEXT_PUBLIC_SUPABASE_URL`, `…_ANON_KEY` and
     `SUPABASE_SERVICE_ROLE_KEY` from the `RCF_TEST_*` values, under the same loopback/port pin.
   - It then imports the handlers with `await import()`.
   - It mocks only `@/lib/api/rate-limit`, to admit; there is no Redis.
   - It builds each session cookie with `@supabase/ssr`'s own `createServerClient`: a cookie jar
     through `getAll`/`setAll`, then `signInWithPassword`. The cookie is never hand-formatted.

   Assertions:
   - **P** posts `bulk/update` with a `set` on site B's element. The answer is 200 with
     `successful: 1`, and the row's `published_content` is the new text.
   - **P** posts `bulk/import` (json, `overwrite_existing`). The answer is 200, the rows land, and
     exactly one `content_versions` row with `change_type = 'bulk_edit'` is written.
   - **L** makes both calls on site A. Each answers 402 with `reason: plan_ended`, the rows are
     unchanged, and L has no `bulk_operations` row.

   **Red** after Task 2: P's update answers 200 with `failed: 1` and the row unchanged, because
   the RLS write is now refused.

   **Green:**
   - Both routes create `createServiceRoleClient()` **after** `checkOwnerCanEdit` passes, and pass
     it as a separate `writer`:
     - `processBulkUpdates(…, supabase, writer)` writes
       `.update(…).eq("id", element.id).eq("site_id", siteId)`;
     - `applyImportRows(…, supabase, writer)` writes the upsert or insert.
   - The lookups and the `bulk_operations` rows stay on the RLS client.
   - `bulk/update` gains a fail-closed limiter before the body read and `getUser()`, with the
     same shape and comment standard as `bulk/import:29-43` (`endpoint: "bulk/update"`).

   **Unit tests:**
   - `bulk/import.test.ts`, `import-outcomes.test.ts` and `roundtrip.test.ts` now expect the writes
     on the service stub. Say so in the PR.
   - A new `src/__tests__/api/bulk/update-limiter.test.ts`: a refusal answers 429 before
     `getUser`, and `onStoreFailure` is `"deny"`.

   `owner-plan-gate.test.ts` stays green, unchanged.

4. [x] **`ai/translate`: `edit`/`admin` only; the write goes through the service client.**

   Tests first, in `src/__tests__/api/ai/translate/route.test.ts`:
   - a `view` member gets 403 `{ error: "Forbidden" }`. The per-IP limiter (`:104`) still runs
     first, but there is no per-site limiter hit, no gate read, no charge, no model call and no
     write;
   - an `edit` member of a paying owner's site gets an upsert recorded on the **service** client.
     Every row carries `site_id === siteId`, and nothing is written on the cookie client.

   Then the code:
   - `:201` becomes `!permission || !["edit","admin"].includes(permission.permission)`, with a
     comment naming s56: RLS used to be the only thing refusing a `view` write, after the charge.
   - The upsert (`:315-319`) goes through `createServiceRoleClient()`.
   - `owner-plan-gate.test.ts`'s translate row stays green.

5. [x] **`ab-tests` POST and PUT: limiter, owner gate, service client, PUT allowlist.**

   Tests first:
   - `owner-plan-gate.test.ts` gains write rows "ab-tests POST" and "ab-tests PUT", each with an
     owner caller and a collaborator caller.
     - Lapsed owner: 402 body, zero mutations, entitlement read keyed by `OWNER`.
     - Paying owner: 200, with mutations **only** on the `service` client.
     - The fake answers the PUT's `ab_tests` read with `{ site_id: SITE }`.
   - `src/__tests__/api/ab-tests/route.test.ts`: a PUT body carrying `site_id`, `created_by`,
     `id` and `created_at` writes none of them. The keys the parked UI sends
     (`useABTests.ts:57`, `useABTestCreation.ts:120-125`) still reach the update.

   Then the code:
   - A fail-closed `enforceRateLimit` runs before `getUser()` in POST and PUT.
   - `checkOwnerCanEdit(site)` runs after the `edit`/`admin` read. For PUT, that is the test's own
     `site_id`, read through the RLS client.
   - Writes use a service client created after the gate. The `site_id` comes from the check, and
     the variants' `test_id` is the test just inserted.
   - PUT writes only this allowlist; anything else is ignored: `name`, `description`, `status`,
     `traffic_split`, `success_metric`, `start_date`, `end_date`, `target_element_id`,
     `auto_complete`, `min_sample_size`, `confidence_threshold`. Add a comment: RLS `WITH CHECK`
     used to be the only thing stopping a `site_id` rewrite.
   - GET stays unchanged: it is a read.

6. [x] **`ab-tests/generate`: capability and charge keyed to the owner.**

   Tests first: `owner-plan-gate.test.ts` rows (owner and collaborator), then
   `generate-unentitled.test.ts` updated and declared in the PR.
   - A lapsed owner gets 402, with no model call, no charge and zero mutations.
   - On a paying owner's site, a collaborator caller who has no plan and no credits is
     **allowed**. `abTesting` is read from the **owner's** entitlement, and `consumeCredits` is
     called with `(OWNER, 3, "ab_test_generation", …, serviceClient)`.
   - An owner whose plan lacks `abTesting` gets the existing 403 "A/B testing requires a Pro plan".
   - A model failure, or a test or variant insert failure, calls `refundCharge(charge)`.

   Then the code, in the `ai/suggest` shape (ADR 035/040):
   1. a fail-closed limiter;
   2. the `edit`/`admin` read;
   3. `checkOwnerCanEdit`;
   4. `service = createServiceRoleClient()`;
   5. `resolveEntitlement(service, ownerId)`. If it is not `plan`, reuse
      `ownerCanEditRefusal({ ok: false, reason: "plan_ended" })`;
   6. the `abTesting` check;
   7. the charge, **before** the model;
   8. the model;
   9. the inserts, with refunds on failure.

   Also:
   - `hasEnoughCredits` is removed from this route: it reads through the cookie client, which
     hides the owner's wallet (research, "Verified APIs").
   - The false sentence at `:77` ("Your credits cover AI suggestions and translations") goes away
     with the caller-plan branch.

7. [x] **Docs.**
   - Create `docs/decisions/042-content-writes-are-service-role-only.md`.
     - Its `Amends:` header covers:
       - ADR 037: it adds `edit`/`admin` content writers, behind `checkOwnerCanEdit`;
       - ADR 041: it closes the "Watch" entries "Direct database writes bypass this gate" and
         "`ab-tests/*` is in neither list", and the `bulk/update` limiter half of the entry that
         starts "`bulk/update` still has no rate limiter". **ADR 041's body is not edited.**
     - Decision: no web principal writes a content table. Every content write is a route using
       the service client after authorization and the gate. It lists the conditions and the four
       moved routes.
     - Considered options:
       - (a), the SQL predicate;
       - dropping only the policy;
       - revoking only the grant.
     - Consequences:
       - `content_history.changed_by` is NULL on the moved paths;
       - a translate `view` member gets 403;
       - the deploy order.
     - "Watch":
       - direct credential issuance (`edit_sessions`, `staging_access`, `site_editors`), queued
         for s53;
       - `ai/translate` still bills the caller.
   - `AGENTS.md` "Data access": one sentence naming the content-writer principal and ADR 042.
   - `docs/architecture.md:363`: add ADR 042. "Rules": "No web principal holds DML on a content
     table".
   - `src/__tests__/db/README.md`: a row for the new suite.
   - New runbook `docs/operations/content-writes-service-role.md`:
     1. merge;
     2. confirm the Vercel production deploy is live;
     3. `supabase migration list --linked`;
     4. `supabase db push --linked --dry-run`, which must list only `20260928140000`;
     5. `supabase db push --linked`;
     6. the read-only catalogue check (Task 1's catalogue query, adapted);
     7. rollback: a forward migration re-creating the seven policies and grants, never an edit of
        this one.

8. [x] **Full gate and bite proofs.** Run everything in "Definition of Done" on the s56 stack.
   Then run each mutation below; it must go red, and the code is restored with
   `git diff --exit-code` after each:
   - **M1:** the migration re-creates the `content_elements` FOR ALL policy and re-grants UPDATE
     → Task 1 is red.
   - **M2:** `bulk/update` writes through the RLS client again → Task 3 is red.
   - **M3:** PUT spreads `...updates` again → Task 5's allowlist test is red.
   - **M4:** `generate` charges `user.id` → Task 6's collaborator row is red.
   - **M5:** `ai/translate` accepts `view` again → Task 4 is red.

   Record the results in the plan's execution log.

## Run interdicts

- `public/embed/`, `scripts/build-embed.mjs` and `server/` keep an empty diff. The embed costs
  0 bytes.
- These routes keep an empty diff:
  - the read routes: `content/[siteId]` (GET and discovery POST), `v1/content`, `bulk/export`,
    the validate routes;
  - the A/B visitor routes: `ab-tests/active`, `bucket`, `track`, `[testId]/results`;
  - `staging/*`, `edit-board/*`, `cron/*`.
- No SELECT policy or SELECT grant changes. No new SECURITY DEFINER function.
  `function-grants.test.ts`'s allowlist is unchanged, and no plan or entitlement rule is written
  in SQL.
- `src/lib/billing/owner-can-edit.ts` is unchanged: no new reason, and only 402 or 503. No plan
  refusal is ever a 401 or 403 on a widget route.
- Exactly one new migration, and no applied migration is edited. It never contains
  `REVOKE ALL PRIVILEGES`, because that takes SELECT, nor `MAINTAIN`, which does not exist before
  PostgreSQL 17.
- **Production is read-only for the implementer**:
  - no `db push --linked`, no `migration up --linked`, no MCP `apply_migration` or writing SQL;
  - the operator applies the migration after the merge, per the runbook.
- Only the `recopyfast-s56` stack on 57xxx ports is used. Never the default 54xxx stack, nor any
  other story's stack (55xxx, 56xxx).
- No `.only`, `.skip`, `xit` or new `test.failing`. No existing assertion is weakened, except the
  client-stub moves the PR lists.
- Out of scope, even though adjacent:
  - direct credential issuance;
  - `ai/translate`'s caller billing;
  - `bulk_operations`, `content_editing_sessions` and `site_languages` policies;
  - `v1` DELETE;
  - the handoff redeem route.
- `AGENTS.md` has uncommitted edits in the main checkout. Do not copy them into the branch.

## The point everything turns on

**No direct write to a content table is legitimate, so the service client is the only writer.**
Everything else follows from that: revoke instead of a predicate, four route moves, and one
enforcement point. Three places it could be wrong:

1. **An unlisted user-JWT writer.** Compare against
   `grep -rnE 'from\("(content_elements|content_versions|content_history|staging_history|ab_tests|ab_test_variants|ab_test_results|visitor_buckets|conversion_events)"\)' src server`.
   After s56, no hit may write (`insert`/`update`/`upsert`/`delete`) through a client built from
   the anon key, `@/lib/supabase/server` or `@/lib/supabase/client`. Also check
   `.rpc(` calls on those clients.
2. **A check that RLS supplied and the move drops.** Compare each moved write's scoping with the
   policy it replaces:
   - `site_id` from the permission read;
   - element ids read back by site;
   - the PUT allowlist, against `WITH CHECK` on `site_id`;
   - translate's `edit`/`admin`, against the policy's `edit`/`admin`;
   - variants tied to the test just inserted.
3. **The deploy order.** `docs/operations/founding-offer.md:20-22` needed migration-first. This
   migration is the inverse case. Old code on the new schema is the only broken pair, and it
   breaks bulk update, bulk import, translate and A/B POST/PUT. New code on the old schema works,
   and leaves the hole open.

## Files touched

- `supabase/migrations/20260928140000_content_writes_are_service_role_only.sql` (new)
- `src/app/api/bulk/update/route.ts`, `src/app/api/bulk/import/route.ts`,
  `src/app/api/ai/translate/route.ts`, `src/app/api/ab-tests/route.ts`,
  `src/app/api/ab-tests/generate/route.ts`
- `src/__tests__/db/content-write-privileges.test.ts` (new), `src/__tests__/db/README.md`
- `src/__tests__/api/owner-plan-gate.test.ts`, `src/__tests__/api/bulk/{import,import-outcomes,roundtrip}.test.ts`,
  `src/__tests__/api/bulk/update-limiter.test.ts` (new), `src/__tests__/api/bulk/update-history-policy.test.ts`,
  `src/__tests__/api/ai/translate/route.test.ts`, `src/__tests__/api/ab-tests/{route,generate-unentitled}.test.ts`
- `.github/workflows/ci.yml` (one e2e step)
- `docs/decisions/042-content-writes-are-service-role-only.md` (new),
  `docs/operations/content-writes-service-role.md` (new), `AGENTS.md`, `docs/architecture.md`
- `docs/research/s56-…md` and `docs/plans/s56-…md` (this story's docs, in the story commit)

## Test strategy

**Levels.**

- **Catalogue**, in real Postgres: privileges and policies, list-wide across the nine tables, so a
  new write policy or grant fails by default.
- **PostgREST with user JWTs**, lapsed and paying: every direct write is refused, and the row is
  read back.
- **Real handlers with a real GoTrue session**, for bulk: the paying owner succeeds and the lapsed
  owner gets 402. This proves the only live dashboard writer still works after the migration.
- **Unit, with the recording fake**, for translate and A/B: gate placement, which client writes,
  the allowlist, and owner-keyed charging.
- **CI e2e Playwright**, unchanged: the embed still renders published copy on a stack that has the
  migration. This is the public-read proof, together with Task 1's member GET.

**Environment**, inside the worktree `.omx/worktrees/s56-rls-content-writes-need-plan`:

1. Run `npm run setup`.
2. Copy `supabase/config.toml` to `.omx/stacks/s56/supabase/config.toml`, and edit the copy:
   - set `project_id = "recopyfast-s56"`;
   - change every `543xx` port to `573xx`: api 57321, db 57322, shadow 57320, pooler 57329,
     studio 57323, inbucket 57324, and analytics 57327 if the key is present.
3. Symlink `.omx/stacks/s56/supabase/migrations` to the worktree's `supabase/migrations`.
4. Run `npx supabase start --workdir .omx/stacks/s56`.
5. Run
   `source /private/tmp/claude-501/-Users-marcusbey-Desktop-02-CS-05-Startup-recopyfast/778b4678-01ef-4a37-bb35-2f2282f4350c/scratchpad/ci-env.sh`.
6. Export these:
   - `RCF_TEST_SUPABASE_CONFIG=$PWD/.omx/stacks/s56/supabase/config.toml`
   - `RCF_REQUIRE_TEST_DB=1`
   - `RCF_TEST_POSTGREST_URL=http://127.0.0.1:57321`
   - `RCF_TEST_POSTGREST_ANON_KEY` and `RCF_TEST_POSTGREST_SERVICE_ROLE_KEY`, read from
     `npx supabase status -o env --workdir .omx/stacks/s56`

Leave the stack running for the reviewer.

## Definition of Done

- `npm run lint` (0 errors), `type-check`, `type-check:build`, `format:check` and `build` pass, and
  full `npx jest` is green.
- `node scripts/build-embed.mjs --check` passes with byte counts unchanged.
- On the s56 stack, with `RCF_REQUIRE_TEST_DB=1`, these pass live:
  - the new suite;
  - `column-privileges` through PostgREST;
  - `rls-policies`, `function-grants`, `site-delete-cascade`, `sites-install-status`;
  - `credit-spend`, `founding-offer-cap`, `founding-agency-cap`.
- `update-history-policy` passes with `RCF_DB_TESTS=1`.
- The CI e2e step exists, and the migration parses on PostgreSQL 14.
- M1–M5 each went red and were restored, and all eight tasks are ticked.
- An execution log is appended here.
- PR body:
  - the deploy order and the runbook link;
  - every test changed to follow the client move;
  - ADR 042.
- The review passes with no critical finding.
- The operator runs the runbook: merge, deploy live, `db push`, then a read-only production check
  showing no `anon`/`authenticated` DML and no user write policy on the nine tables.

## Execution log

- **2026-09-28: PO decisions.** The product owner validated the plan with these answers to the
  two "Pending PO confirmation" items and the research's open questions:
  - option (b): no plan rule in SQL, and `checkOwnerCanEdit` stays the single gate;
  - deploy order is **code first, then the migration**;
  - a paying member's **direct** PostgREST write is refused too;
  - direct credential issuance goes on ADR 042's "Watch" and to s53;
  - the `bulk/update` limiter lands here, not in s53.
- **Base and environment.** Branch from `main` at `bae700c`. Own stack `recopyfast-s56` on 57xxx
  ports, and every DB suite ran with `RCF_REQUIRE_TEST_DB=1`. `main` gained s55, s54 and a docs
  commit while this ran. None of them touches a file this story changes, and none adds a
  migration.
- **Deviation: nine user write policies, not seven.** On a database replayed from the migration
  files, Task 1's catalogue names nine permissive write policies. Besides the seven listed here,
  there are two more:
  - `content_versions` "Site editors can insert content versions" (INSERT, PUBLIC), from
    `20260611020000:129`;
  - `content_history` "Site editors can append content history" (INSERT, `authenticated`), from
    `20260731008000:341`.

  Production has neither: both files aborted there (`20260818010000`'s header says so for
  content_versions). The list-wide assertion would stay red in CI's `supabase start` unless they
  go too, so the migration drops them with `DROP POLICY IF EXISTS`, a no-op in production. Both
  were already inert once the grants were revoked. The deviation was reported to the team lead
  before Task 2, who approved it. ADR 042 records the production versus local/CI divergence and
  says the migration converges both.
- **Task 1, red on today's migrations.** 15 failed and 5 passed.
  - The catalogue named INSERT/UPDATE/DELETE/TRUNCATE (table and column) for `anon` and
    `authenticated` on eight tables. `staging_history` was already clean.
  - It also named the nine policies.
  - L's `PATCH content_elements` answered **200**, and `published_content` read back as
    `injected by s56`. This reproduces s51 review finding 1. P's PATCH answered 200 the same way.
  - The guards and the service-key PATCH passed.
- **Task 2, green.**
  - `migration up` applied `20260928140000`.
  - The suite passed 20/20.
  - `update-history-policy` failed first (the UPDATE succeeded), then passed 5/5 with
    `RCF_DB_TESTS=1`.
  - PostgreSQL 14: `RCF_POSTGRES_BIN=/usr/local/opt/postgresql@14/bin node
    scripts/run-db-invariants.mjs` exited 0 with every migration applied.
- **Task 3, red then green.**
  - Red: P's bulk update answered 200 with `failed: 1`. P's import answered 200 with `failed: 2`
    and no rows.
  - Green: 23/23.
  - **Old-schema proof.** The pre-migration policies and grants were restored on the s56 stack by
    SQL. The NEW code's three bulk-handler tests passed while the direct-write probes were red (the
    hole was open). The migration was then re-applied: 23/23.
- **Tasks 4 to 6, red then green.**
  - translate: 3 red, then 26/26;
  - owner-plan-gate A/B rows: 8 red, then 12 green on POST/PUT, and 4 red, then green on
    generate;
  - `ab-tests/route`: 6 red, then 18/18;
  - `generate-unentitled`: 8 red, then 8/8.
- **Task 8, gate.**
  - `lint` has 0 errors. Its 38 warnings are pre-existing; the two in a changed file are the
    unused `ABTest`/`ABTestVariant` imports already on `main`.
  - `type-check`, `type-check:build`, `format:check` and `build` passed.
  - `build-embed --check` is unchanged: bundle 45883 B, widget 33122 B.
  - Full `npx jest --ci` with the DB live: 303 suites passed and 2 skipped; 3966 tests passed,
    38 skipped and 0 failed.
  - Live DB suites, 9/9 suites and 130/130 tests: `content-write-privileges` 23, `column-privileges`
    15 (through PostgREST), `rls-policies` 3, `function-grants` 3, `site-delete-cascade` 5,
    `sites-install-status` 7, `credit-spend` 27, `founding-offer-cap` 24, `founding-agency-cap`
    23.
  - `update-history-policy` passed 5/5 with `RCF_DB_TESTS=1`.
  - The runbook's catalogue queries return 0 rows, then `t`/`t`, on the s56 stack.
- **Mutations.** Each was restored from the staged tree, and `git diff --exit-code` passed after
  each one.
  - **M1** (policy and UPDATE grant re-created, applied by `psql`): 7 red, including both
    catalogue rows and the L and P PATCH and DELETE probes. The stack was restored by re-running
    the migration.
  - **M2** (`bulk/update` writes through the RLS client): 1 red, "a paying owner's bulk update
    answers 200 and changes the live copy".
  - **M3** (PUT spreads the body again): 1 red, the allowlist test.
  - **M4** (`generate` charges `user.id`): 1 red, the collaborator test.
  - **M5** (`translate` accepts `view`): 1 red, the `view` refusal.
- **E2E: skipped.** The default stack was free, but `127.0.0.1:3000` is held by another agent's
  Next server (the s47b worktree). The mutating specs hard-pin the app to port 3000
  (`e2e/support/local-targets.ts`). A first attempt reached that foreign server and was stopped.
  The default stack's database was returned to `main`'s schema (s56's policies and grants
  restored, its ledger row removed), then the stack and a temporary Redis were stopped.
