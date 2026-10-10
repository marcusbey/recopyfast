# Research — Story s56-rls-content-writes-need-plan

Researched 2026-09-28. s51 merged to `main` as `bae700c` (#51) during this research, and every
code citation below is verified on `main` `bae700c`. Production was read **read-only**
(project `uexwowziiigweobgpmtk`, role `supabase_read_only_user`): `pg_policies`, `pg_class.relacl`,
`has_table_privilege`, `pg_attribute.attacl`, `pg_trigger`, `pg_proc`. Ledger head
`20260928130000`, PostgreSQL 17.4, no `pg_graphql`.

## The five structuring facts

1. **The hole is a policy plus a grant, and both are live in production.**
   - `content_elements` has policy "Users can edit content for authorized sites", `FOR ALL` to
     PUBLIC for any `edit`/`admin` row (`20250817000000_complete_database_setup.sql:461-469`).
   - `ab_tests` and `ab_test_variants` each have INSERT, UPDATE and DELETE policies for
     `edit`/`admin`. The live definitions are `20260801200000_missing_base_tables.sql:786,800,824`
     and `:866,882,908`.
   - `anon` and `authenticated` hold `arwdDxtm` on all three tables. These are Supabase default
     privileges: no migration grants them. None of the three tables has a column ACL.
2. **Only four application routes write those tables with a user JWT:** `bulk/update`,
   `bulk/import`, `ai/translate`, and `ab-tests` POST/PUT. Every other writer is already the
   service role:
   - the staging save, publish and restore paths go through SECURITY DEFINER RPCs, and in
     production `authenticated` cannot execute them;
   - so do v1, discovery, edit-board, the A/B visitor paths and the cron.

   No browser code and nothing in `server/` writes any of these tables.
3. **So option (b) is available and is the recommendation.** It revokes every direct write, and
   the four routes move their writes to the service client behind s51's `checkOwnerCanEdit`.
   Option (a) would copy `resolveEntitlement`'s `plan` rule into SQL. ADR 040 rejects that
   (`040-…:42-44`, `:79-81`, citing ADR 035), and the SQL copy could refuse a paying owner the
   TypeScript gate had admitted.
4. **Moving a write to the service role removes RLS as a second check, and two routes lean on it.**
   - `ab-tests` PUT spreads `...updates` into the UPDATE (`ab-tests/route.ts:267-271`). RLS
     `WITH CHECK` is the only thing that stops a caller moving a test to another `site_id`.
   - `ai/translate` accepts **any** permission row, `view` included (`:194-203`). Today RLS
     refuses a `view` member's upsert, after that member has been charged, and the error is
     swallowed (`:321-324`).
   - `bulk/update` has no rate limiter at all. AGENTS.md requires one on any service-role write
     path.
5. **The deploy order is the reverse of the story's "Migration first, then deploy".**
   - The migration breaks the **old** code's four RLS writes. Bulk import and update are live in
     the dashboard (`SiteDetailView` → `BulkOperations.tsx:204,318`).
   - The **new** code works on either schema, because `service_role` holds DML in production.
   - Merging to `main` is the production deploy (`docs/operations/founding-offer.md:20-22`), so
     the order is: merge, confirm the deploy is live, then run `supabase db push --linked`.
   - CI runs DB suites **only by name**, in the e2e job (`ci.yml:250-305`). The new suite must be
     added there. Every migration is also applied to a bare PostgreSQL 14
     (`scripts/run-db-invariants.mjs`, `ci.yml:145-148`).

## Target story

`docs/stories.md` "Story s56-rls-content-writes-need-plan" (P0, complexity 3), from the s51 review
major (`docs/reviews/s51-edit-needs-a-plan.md` finding 1) and ADR 041 "Watch".

Acceptance criteria:

- A direct PostgREST INSERT, UPDATE or DELETE on `content_elements`, or on any other table holding
  publishable content or A/B data, is refused and changes nothing when it comes from a member of
  a site whose owner has no `plan`. The same member of a paying owner's site is unaffected
  wherever direct writes are legitimately used.
- Every application path that writes those tables keeps working for paying owners: dashboard,
  widget, bulk, v1 and the publish RPCs.
- Public reads are untouched: the visitor's content GET and the embed.
- `ab-tests/*` routes are gated on the owner's plan (ADR 041 "Watch").
- It is proved against real Postgres through PostgREST with a user JWT, run by CI. ADR 041's
  "Watch" entry is closed. Migration first, then deploy (see fact 5 and open question 1).

**How AC1 reads under option (b).** No direct write stays legitimate: no product surface issues
one (fact 2). So a paying owner's direct PATCH is refused as well, and "unaffected" is proved on
the path the paying owner actually uses, which is the route writing through the service role.

## Current state of the code

### Direct write surface: live production policies and grants

Grants below are `relacl` in production. `authenticated=arwdDxtm` means SELECT, INSERT, UPDATE,
DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN. "User write policy" means a write policy for
`anon`, `authenticated` or PUBLIC.

| Table | What it holds | User write policy | `anon` / `authenticated` grant | Direct write open? |
|---|---|---|---|---|
| `content_elements` | `published_content`, `staging_content`, `current_content`, `original_content`, `metadata` (attributes), `page_path` | **FOR ALL** "Users can edit content for authorized sites" (`20250817000000:461`) | `arwdDxtm` / `arwdDxtm` | **Yes**, for `edit`/`admin` |
| `ab_tests` | `status`, `target_element_id`, the served test | **INSERT/UPDATE/DELETE** "Site editors can …" (`20260801200000:786,800,824`) | `arwdDxtm` / `arwdDxtm` | **Yes** |
| `ab_test_variants` | `variant_content`/`content`, served to visitors by `/ab-tests/active` | **INSERT/UPDATE/DELETE** (`20260801200000:866,882,908`) | `arwdDxtm` / `arwdDxtm` | **Yes** |
| `content_versions` | version snapshots | none (service_role ALL + SELECT) | `arwdDxtm` / `arwdDxtm` | No: RLS denies |
| `content_history` | audit rows (DEFINER trigger) | none | same | No |
| `staging_history` | staging audit | none (service INSERT) | `xtm` / `rxtm` (`20260818010000:72-74`) | No |
| `ab_test_results`, `visitor_buckets`, `conversion_events` | visitor telemetry | service_role only | `arwdDxtm` / `arwdDxtm` | No |

Notes on the table:

- The `anon` half of the `content_elements` FOR ALL policy is inert, because `auth.uid()` is NULL
  for `anon`.
- TRUNCATE ignores RLS entirely. PostgREST exposes no TRUNCATE, so it is not reachable today, but
  it is one more reason to revoke grants rather than only drop policies.
- The SELECT policies survive in every option: "Users can view content for authorized sites"
  (`20250817000000:452`) and "Site members can view ab_tests/ab_test_variants"
  (`20260801200000:774,852`).

Credential tables are **not** content, and they are out of scope (see "Open questions"):

- `edit_sessions` INSERT for PUBLIC;
- `staging_access` INSERT and UPDATE for PUBLIC;
- `site_editors` INSERT and UPDATE for `authenticated`.

### Write-path inventory (every application writer of those tables)

| Path | Table and operation | Client | s51 owner gate | Under option (b) |
|---|---|---|---|---|
| `staging/content/[siteId]` PUT | `content_elements` via `save_staging_content_atomic` (`:301`, rpc `:306`) | service | yes | unchanged |
| `staging/publish` POST | `content_elements` via `publish_staging_content_with_attributes_atomic` (`:171`, `:178`) | service | yes | unchanged |
| `edit-board/history/[versionId]` POST | `content_elements` via `restore_content_version` (`:192`, `:304`) | service | yes | unchanged |
| `edit-board/styles/apply` POST | `content_elements` update (`:228`), `create_content_version` (`:218`) | service (`:138`) | yes | unchanged |
| `edit-board/history` POST | `content_versions` via `create_content_version` (`:242`, `:245`) | service | no (snapshot) | unchanged |
| `edit-board/languages` | `site_languages` only; `content_elements` read (`:412`) | service | no (s51, deliberate) | unchanged |
| `v1/content` POST/PUT | `content_elements` update/insert (`:295`, `:313`) | service key via `createServerClient` (`:265-275`) | yes | unchanged. DELETE (`:428`) is dead (ADR 041 "Watch") |
| `content/[siteId]` POST (discovery) | `content_elements` upsert with `ignoreDuplicates` (`:623-627`): new rows only, DOM text | service (`:477`), site token | never (ADR 041) | **unchanged, keeps working for lapsed owners**; see "Discovery" below |
| **`bulk/update` POST** | `content_elements` UPDATE of `published_content` + `current_content` (`:322-330`) | **user JWT** (anon key, `:24-34`) | yes (`:58-64`) | **moves to the service client; gains a limiter** |
| **`bulk/import` POST** | `content_elements` INSERT/UPSERT (`:731-735`) | **user JWT** (`:79-89`); snapshot RPC is service (`:801`) | yes (`:113-121`) | **moves to the service client** |
| **`ai/translate` POST** | `content_elements` UPSERT (`:315-319`) | **user JWT** (`createClient`, `:171`) | yes (`:221-224`) | **moves to the service client; requires `edit`/`admin`** |
| **`ab-tests` POST** | `ab_tests` INSERT (`:161-175`), `ab_test_variants` INSERT (`:190-192`), rollback DELETE (`:196`) | **user JWT** (`:114-124`) | **no** | **gate + service client** |
| **`ab-tests` PUT** | `ab_tests` UPDATE `{...updates, status}` (`:265-274`) | **user JWT** (`:219-229`) | **no** | **gate + field allowlist + service client** |
| **`ab-tests/generate` POST** | `ab_tests`, `ab_test_variants` INSERT (`:144`, `:199`), DELETE (`:205`) | service (`:141`), after a **caller**-plan check (`:70-94`) | **no** | **owner gate; capability and charge keyed to the owner** |
| `ab-tests/track` POST | `ab_test_results` INSERT (`:276`) | service (`:188`), site token | never (visitor) | unchanged |
| `ab-tests/bucket/[siteId]` GET | `visitor_buckets` UPSERT (`:203`) | service (`:87`) | never | unchanged |
| `cron/ab-test-lifecycle`, `lib/ab-testing/lifecycle.ts` | `ab_tests` (`:141`), `content_elements.staging_content` (`:189`), `content_history` (`:211`) | service (`:18`, `:164`) | system | unchanged |
| `lib/analytics/tracker.ts` | `conversion_events` INSERT (`:156`) | service key (`:36`) | none | unchanged |
| trigger `log_content_change()` | `content_history` | DEFINER, `search_path` pinned (`20260809130000`) | none | unchanged; see trap 9 |
| browser (`src/components`, `src/hooks`) | none: no `supabase/client` importer calls insert/update/upsert/delete | — | — | — |
| `server/` (WebSocket) | none (`index.js` Map deletes, `auth.js` HMAC) | — | — | — |

The A/B UI reaches these routes only from `src/app/dashboard/_ab-tests/page.tsx`, a parked,
unrouted folder. `ABTestManager`, `ABTestCreateFlow` and `ABTestResults` have no other consumer.
`TranslationDashboard.tsx:87`, the only caller of `ai/translate`, is rendered by nothing.

### Discovery (the embed's content POST)

It stays as it is, and s56 does not touch it. The reasons:

- It runs as the service role behind `authorizeSiteRequest` and a fail-closed per-site limiter.
- It inserts only rows the server does not already hold (`ignoreDuplicates: true`), with
  `original`/`current`/`published` all set to the customer's own DOM text
  (`buildDiscoveryRows :172-174`). It never overwrites a published edit (`:615-616`).
- ADR 041 lists it as public delivery, never gated. A lapsed owner's page keeps being discovered,
  which puts nothing new live: the text was already on the page.

## Anchor points

- New migration `supabase/migrations/20260928140000_content_writes_are_service_role_only.sql`.
  No migration later than `20260928130000` exists on any local branch or worktree.
- `src/app/api/bulk/update/route.ts`. `processBulkUpdates(operations, siteId, userId, supabase)`
  (`:193`) writes at `:322-330`. Add a writer client. Add a limiter before `getUser()`, the same
  shape as `bulk/import:38-43`.
- `src/app/api/bulk/import/route.ts`. `applyImportRows(rows, siteId, options, supabase)` (`:641`):
  the lookups (`:654-661`) stay on the RLS client, and the write (`:731-735`) moves.
- `src/app/api/ai/translate/route.ts`: the permission read (`:194-203`) and the upsert
  (`:315-319`).
- `src/app/api/ab-tests/route.ts`: POST (`:84-208`) and PUT (`:210-288`).
  `src/app/api/ab-tests/generate/route.ts`: `:54-140`.
- `src/lib/billing/owner-can-edit.ts` is used as is.
- Tests:
  - `src/__tests__/db/` gets a new suite, and its `README.md` table gets a row;
  - `src/__tests__/api/owner-plan-gate.test.ts` gets the A/B rows;
  - `.github/workflows/ci.yml` gets an e2e-job step after `:250-257`.
- Docs: `docs/decisions/042-…md`, `AGENTS.md` "Data access", `docs/architecture.md` "Data access".

## Verified APIs / functions

- `checkOwnerCanEdit(siteId): Promise<{ ok: true; ownerId } | { ok: false; reason: "plan_ended" | "no_owner" | "unavailable" }>`
  (`owner-can-edit.ts:44-60`). `ownerCanEditRefusal(result)` answers 402, or 503 when the reason
  is `unavailable` (`:111-135`).
- `resolveEntitlement(supabase, userId)` (`effective-plan.ts:620`) returns `{ kind: "plan", planId, plan }`,
  `credits` or `none`.
- `consumeCredits(userId, credits, operation, metadata?, client?)` returns
  `{ success, error?, remainingCredits?, charge? }` (`credits/system.ts:400-411`). With a
  service-role `client`, `userId` alone decides whose wallet is spent (header `:383-397`).
- `refundCharge(charge, credits?)` (`:527`). `CREDIT_COSTS.AB_TEST_GENERATION = 3` (`:35`).
- `hasEnoughCredits(userId, n)` (`:349`) has **no** client parameter, so it reads through the
  cookie client. RLS hides the owner's wallet from a collaborator: do not use it for the owner.
- `enforceRateLimit(request, { limit, endpoint, identifier?, identifierType?, onStoreFailure, message? })`
  (`api/rate-limit.ts:98`).
- `createServiceRoleClient()` (`src/lib/supabase/service.ts`).
- DB harness (`src/__tests__/db/db-harness.ts`):
  - `describeDb(name, ({ query, withClient, createSite }) => …)` (`:272`);
  - `RCF_REQUIRE_TEST_DB=1` turns an unreachable database into a failure (`:280`);
  - `readConfiguredApiPort()` (`:135`) follows `RCF_TEST_SUPABASE_CONFIG`.
- The PostgREST pattern to copy is `column-privileges.test.ts:143-165` (a loopback- and
  port-pinned `RCF_TEST_POSTGREST_URL`) and `:585-660`: `/auth/v1/signup` returns
  `access_token`; a refused request is HTTP 403 with body code `42501`.
- Content-writing DB functions. All are SECURITY DEFINER, and in production none is executable by
  `authenticated` or `anon`: `create_content_version`, `publish_staging_content`,
  `publish_staging_content_with_attributes_atomic`, `restore_content_version`,
  `revert_staging_content`, `save_staging_content_atomic`, `update_translation_coverage`.

## Options

**(a) `owner_has_plan(site_id)` as a SECURITY DEFINER predicate in the write policies.**
Rejected.

- It must restate `resolveEntitlement`'s `plan` rule in SQL:
  - `plan_entitlements`: revocation, `expires_at`, trial and offer sources (s47a), lifetime
    purchases (s45);
  - live `billing_subscriptions` statuses;
  - retired plan ids, which are a TypeScript constant;
  - the catalogue's active flag.
- ADR 040 already refused exactly that ("the plan, trial and window rules would exist twice and
  drift"). s52 and s53 will both change those rules.
- It needs a fourth identity on `function-grants.test.ts`'s `RLS_PREDICATE_ALLOWLIST`.
- It keeps four RLS-dependent writers and a policy-evaluated plan read on every write.
- Its failure mode is the worst one available. The TypeScript gate says `plan`, the SQL says no,
  and a paying owner's bulk rows fail one by one.

**(b) Revoke the direct write surface; the four routes write through the service client after
authorization and the s51 gate.** Recommended.

- No plan rule is duplicated, and `checkOwnerCanEdit` stays the only enforcement point.
- It also closes GraphQL and any future Data API surface, because it removes the grant, not only
  the policy.
- Its cost:
  - four route edits;
  - two explicit checks that RLS used to supply (fact 4);
  - a limiter on `bulk/update`;
  - an ADR that extends ADR 037 to `edit`/`admin` content writers behind the gate.

**(c) A mix.** Not needed. The inventory shows no legitimate direct writer that would force a
predicate on any one table.

## Traps & constraints

1. **`function-grants.test.ts`** (`:81-85`, `:192-210`). No SECURITY DEFINER function may grant
   EXECUTE to `anon` or PUBLIC. Only the three allowlisted RLS predicates may grant it to
   `authenticated`. Option (b) adds no function.
2. **`rls-policies.test.ts`** (`:57-105`). Three rules:
   - no permissive unconditional write policy to `anon`/`authenticated`/PUBLIC;
   - RLS on everywhere;
   - no table with RLS and zero policies.

   After the drops, `content_elements` keeps its SELECT policy, and `ab_tests`/`ab_test_variants`
   keep SELECT plus service ALL. The suite stays green.
3. **`column-privileges.test.ts`** covers `sites`, `webhooks`, `api_keys`, `editor_device_grants`
   and `staging_access` only, so nothing here moves it. Its `testWithPostgrest` **skips** when the
   PostgREST env is missing (`:164-165`). The new suite must **fail** instead when
   `RCF_REQUIRE_TEST_DB=1`, or a CI env typo turns the proof into a skip.
4. **CI.**
   - The Lint/Test job gates every DB suite out (`npm test`), then runs only
     `column-privileges.test.ts`, on PostgreSQL 14 with **every** migration applied
     (`run-db-invariants.mjs:142-157`). So the migration must parse on 14: name privileges
     explicitly, and never write `MAINTAIN`, which only exists from PostgreSQL 17.
   - The e2e job runs `supabase start` (all migrations) and four DB suites by name (`:250-305`).
   - `rls-policies` and `function-grants` run in **no** CI job. Run them in the gate by hand.
5. **Enumerate the privileges; never `REVOKE ALL PRIVILEGES`.** That would also take SELECT, which
   the SELECT policies and every dashboard read need. Production is 17.4, so `authenticated`
   keeps `m` (MAINTAIN). It is harmless: PostgREST cannot issue VACUUM, ANALYZE or REINDEX.
6. **Image-default variance.** `update-history-policy.test.ts:198-234` measured a local image where
   `anon`, `authenticated` **and** `service_role` held only `Dxt` on `content_elements`. The s51
   review's live PATCH 200 shows today's stack grants DML. The moved routes make `service_role`
   DML load-bearing, so grant it explicitly. That is idempotent in production.
7. **`update-history-policy.test.ts`'s DB half.**
   - Its `test.failing` expects an `authenticated` UPDATE of `content_elements` to **succeed**
     (`:235`). It is gated by `RCF_DB_TESTS=1` and never runs in CI.
   - Its header names `bulk/update` and `ai/translate` as user-client writers (`:12-13`).
   - After s56 its body throws for the intended reason, so it "passes" while claiming a defect.
     That is exactly the trap `src/__tests__/db/README.md` warns about. Rewrite it.
8. **Assert the row, not the status.** With the grant removed, PostgREST answers 403 + `42501`.
   With only the policy removed, PATCH and DELETE answer **200 with an empty body** (RLS filters
   silently) and only INSERT errors. Every refusal must read the row back through `pg`.
9. **`content_history.changed_by` becomes NULL** for bulk and translate writes, because the
   trigger records `auth.uid()`. It is already NULL for every other writer (all service role). The
   only reference is `src/types/index.ts`. Say so in ADR 042.
10. **Unit suites follow the client move.** `bulk/import.test.ts`, `import-outcomes.test.ts`,
    `roundtrip.test.ts`, `ai/translate/route.test.ts` and `ab-tests/route.test.ts` assert writes on
    the RLS stub. AGENTS.md "Tests": change them, and say so in the PR.
    `owner-plan-gate.test.ts` records mutations across all three client factories (`:97`, `:132`,
    mocks `:138-146`), so its zero-mutation rows stay honest.
11. **Moving to the service role removes RLS's second check.** Each moved write must be scoped by
    ids the route established, never taken from the body:
    - `site_id`, from the permission read;
    - the element id, read back by site;
    - the test's own `site_id` for PUT.

    That is ADR 037 step 5. Two cases need care:
    - PUT's `...updates` spread must become an allowlist;
    - translate must require `edit`/`admin` before anyone is charged. Today a `view` member is
      charged, then refused silently by RLS.
12. **ADR immutability.** ADR 041's body is not edited. ADR 042's `Amends:` header closes its two
    "Watch" entries, the same way ADR 041 amended ADR 035 without touching it (s51 changed no
    other ADR file).
13. **The `20260818010000` lesson.** A `DROP POLICY IF EXISTS` on a **missing relation** aborts the
    whole migration file, and the ledger still records it as applied. Every target relation
    exists in production (verified). After applying, verify with a catalogue query, not the
    ledger.
14. **`AGENTS.md` has uncommitted local edits on `main`'s working tree** (+57 lines, in no
    commit). A worktree from `main` will not see them, and the "Data access" edit may conflict
    when they land.
15. **The embed costs 0 bytes.** No widget change is needed, because the 402 path already exists
    (s51).

## Open questions

1. **Deploy order.** Should the story's "Migration first, then deploy" become "deploy (merge)
   first, then migrate"? Recommended: yes (fact 5). The hole stays open for the minutes in
   between, as it has for months. Migration first breaks dashboard bulk import and update for
   paying owners until the deploy lands.
2. **AC1's reading.** Is a paying member's direct PATCH also refused? Recommended: yes. No
   product surface writes directly, and a policy-level plan check is option (a).
3. **REVOKE scope.** Recommended: all nine content, history and A/B tables, for one list-wide
   invariant. It changes nothing functional on the six tables whose policies already deny.
   `site_languages` (config, never served) and `bulk_operations` (the operation log) are left out.
4. **`bulk/update` limiter.** It is queued with s53 (ADR 041 "Watch"), and s56 must add it to earn
   the service role. If it does, remove it from s53.
5. **`ai/translate` `view` members** will get 403 before any charge. Before, they were charged and
   their write was silently refused. This is a behaviour change, and it is a fix.
6. **Direct credential issuance** (`edit_sessions`, `staging_access`, `site_editors`) is still open
   to a lapsed owner's `edit`/`admin` member. It is **not** a content bypass: every write those
   credentials make is route-gated. But it breaks ADR 041's literal "every credential issuance".
   Recommended: record it in ADR 042 "Watch" and queue it with s53.
7. **Dependency: settled.** s51 merged as `bae700c`, so `owner-can-edit.ts` and
   `owner-plan-gate.test.ts` are on `main`. Branch s56 from `main` at `bae700c` or later.
8. **Claims that s56 makes true.** `src/middleware.ts:32-36` and `docs/architecture.md:363` say
   every content write asks `checkOwnerCanEdit`. After s56 that also holds for the Data API.
   `architecture.md:363` should name ADR 042; the middleware comment needs no change.

## Real complexity

Scored 3 before research. My verdict is **4**. The migration itself is small. What adds up:

- four route moves, two of them with an added check;
- a limiter;
- `generate` re-keyed to the owner (plan capability and charge);
- a DB suite that drives real handlers with a real GoTrue session through PostgREST, plus its CI
  wiring;
- rewriting a stale `test.failing`;
- ADR 042.

It is one cohesive change and does not need a split.

## Split proposal

Not required. If the plan runs long, the cut is `ab-tests/generate`'s owner-keyed charge, which
can move to s53. The A/B gate on POST/PUT, the A/B policies and the migration stay in s56, because
the A/B tables share the direct-write hole.
