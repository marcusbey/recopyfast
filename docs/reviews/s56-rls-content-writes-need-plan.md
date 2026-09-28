# Review — Story s56-rls-content-writes-need-plan

> Fresh-context review. Each issue is classified critical / major / minor.
> Diff reviewed: `git diff main...feature/s56-rls-content-writes-need-plan`, one commit on
> `0fdb6e0`.
> **The commit moved during the review**, from `b86a888` to `c51171f`. The amend is docs only:
> ADR 042's paragraph on the seven production policies versus nine replayed ones, and one
> execution-log sentence in the plan (`git diff b86a888 c51171f --stat`: 2 docs files, +16/−4).
> The code is byte-identical. This verdict covers `c51171f`.
> Judged against: `docs/plans/s56-…md` (validated), `docs/research/s56-…md`, `AGENTS.md`,
> ADR 002, 033, 035, 037, 040, 041 and 042.

## Summary

The hole is closed on a real database, and I found no remaining direct-write path to any content,
history, staging or A/B table:

- On a freshly replayed s56 stack (`supabase db reset`, all 68 migrations), `anon` and
  `authenticated` hold no INSERT, UPDATE, DELETE or TRUNCATE on the nine tables, at table or
  column level. PUBLIC holds none either, and no user write policy is left.
- Every function whose body writes one of the nine tables is SECURITY DEFINER, and none is
  executable by `anon` or `authenticated`. Only the two DEFINER audit triggers fire on them.
  `public` has no views.
- Real GoTrue JWTs sent through real PostgREST get 403 with code `42501`, for both lapsed and
  paying members, and every refusal is read back through `pg`.

The four moved routes and `generate` each re-check tenancy themselves. The code works on the old
schema, the migration is idempotent and parses on PostgreSQL 14, and public reads are untouched.
Five minor findings, no critical, no major.

## Plan compliance

- [x] **The code does what the plan specifies, nothing more.** Task by task:
  - **T1.** `src/__tests__/db/content-write-privileges.test.ts`: the catalogue part (list-wide,
    table and column grants, PUBLIC, policies "whatever its predicate") and the guards. The
    PostgREST part is pinned to loopback and `readConfiguredApiPort()`, and it **throws** at load
    when `RCF_REQUIRE_TEST_DB=1` and the PostgREST env is missing (`:99-103`). The L and P
    fixtures follow the e2e plan-entitlement shape. Six probes per actor, each read back through
    `pg`. The CI step sits in the e2e job right after "Verify secret-column privileges…"
    (`ci.yml:259-272`), and the e2e job runs on every PR (`ci.yml:163`).
  - **T2.** One migration: 9 × `DROP POLICY IF EXISTS`; an enumerated REVOKE from PUBLIC, `anon`
    and `authenticated`; an explicit GRANT to `service_role`. No `ALL PRIVILEGES` and no
    `MAINTAIN` (both appear only in comments). The DB half of `update-history-policy.test.ts` is
    rewritten from `test.failing` to a plain refusal test.
  - **T3.** `writer` is passed separately to `processBulkUpdates` and `applyImportRows`, created
    after the gate. `bulk/update` gains a fail-closed limiter before the body read (`:24-29`), and
    `update-limiter.test.ts` covers it. The three import suites follow the client move.
  - **T4.** `ai/translate` accepts `edit`/`admin` only (`:208`), refused before the site limiter,
    the gate and the charge. The upsert goes through the service client (`:332`).
  - **T5.** `ab-tests` POST/PUT: fail-closed limiter → `getUser` → `edit`/`admin` →
    `checkOwnerCanEdit` → service client. PUT reads the test's `site_id` through RLS, writes the
    11-field allowlist, and scopes the update by `id` and `site_id`. GET is unchanged.
  - **T6.** `generate` runs in the plan's order: limiter → `edit`/`admin` → gate → service →
    `resolveEntitlement(service, ownerId)` → `abTesting` → `consumeCredits(ownerId, 3, …,
    service)` **before** the model → refund on model, test or variant failure.
    `hasEnoughCredits` and the false "Your credits cover…" sentence are gone.
  - **T7.** ADR 042 with the planned `Amends:` header (ADR 041's body is not edited), the
    AGENTS.md "Data access" paragraph, `architecture.md` (the rule and the ADR link), the DB
    README row, and the runbook.
  - **T8.** Recorded in the execution log. Re-proved here; see Tests.
  - **Declared deviation, approved:** nine policies dropped, not seven. I verified both extra
    policies exist on a replayed database (`20260611020000:129`, `20260731008000:341`) and are
    gone after the migration.
  - **ADR 042 wording (the `c51171f` delta), checked against the cited migrations. Accurate.**
    - `20260611020000` aborted in production and is in the ledger:
      `20260818010000:23-29`. The same header says production `content_versions` was
      "verified already tight … no permissive INSERT" (`:33-35`).
    - `20260731008000` aborted too: `20260818000000:92` ("that file aborted too") and `:311`.
    - No later migration re-creates either policy (grep across `supabase/migrations`), so
      "seven in production, nine on a replay, converged by the `IF EXISTS` drops" is consistent.
    - Two nits, not findings:
      - `:129` and `:341` point at the `DROP POLICY IF EXISTS` line; the `CREATE POLICY` is on
        `:130` and `:342`.
      - The `content_history` half would be easier to follow if it cited
        `20260818000000:92,311` directly, instead of only "the class it documents".
    - The seven-in-production count itself stays unverified here (no production access).
  - **No drift beyond the plan.** The changed files match the plan's "Files touched" list
    exactly.
- [x] **Run interdicts respected**, each one checked:
  - `public/embed/`, `scripts/build-embed.mjs` and `server/` have an empty diff. The embed is
    unchanged: `--check` gives bundle 45880 B and widget 33120 B.
  - The read routes, the A/B visitor routes, `staging/*`, `edit-board/*` and `cron/*` have an
    empty diff.
  - No SELECT policy or grant changed. On the stack, all SELECT policies are present, `anon` and
    `authenticated` still hold SELECT, and there is no new SECURITY DEFINER function.
    `function-grants.test.ts` is unchanged.
  - `owner-can-edit.ts` is unchanged.
  - Exactly one new migration, and no applied migration was edited.
  - No `.only`, `.skip`, `xit` or new `test.failing`. The 24 removed `expect` lines are all
    client-stub moves or intended behaviour changes: `generate` answers 402 `plan_ended` instead
    of 403, and the `test.failing` became a refusal test.
  - The AGENTS.md diff is the one ADR 042 paragraph. None of the main checkout's uncommitted
    edits leaked in.

## Anti-hallucination

- [x] **No invented API, function or import.** Each one was opened:
  - `checkOwnerCanEdit(siteId): Promise<OwnerCanEdit>`, where `OwnerCanEdit` carries `ownerId`,
    and `ownerCanEditRefusal(Extract<OwnerCanEdit,{ok:false}>)` (`owner-can-edit.ts:44-60,111`).
  - `resolveEntitlement(supabase, userId)` (`effective-plan.ts:620`).
  - `consumeCredits(userId, credits, operation, metadata?, client?)` → `{ …, charge? }`
    (`credits/system.ts:400`), `refundCharge(charge, credits?)` (`:527`),
    `CreditCharge` (`:51`), and `CREDIT_COSTS.AB_TEST_GENERATION = 3` (`:35`).
  - `createServiceRoleClient` (`supabase/service.ts:12`).
  - `enforceRateLimit(req, { limit, endpoint, onStoreFailure })`; the default identifier is IP
    (`api/rate-limit.ts:98-110`).
  - `describeDb`, `createSite` and `readConfiguredApiPort` (`db-harness.ts:135,234,272`).
  - All 11 allowlisted PUT fields exist as `ab_tests` columns on the live DB.
  - `type-check` and `type-check:build` are green.
- [x] **No plausible-but-wrong value or logic.**
  - Status codes: 402/503 come from the helper, and 403 is kept for the `abTesting` capability.
  - The PUT allowlist covers every key the parked UI sends (`useABTests.ts:57`,
    `useABTestCreation.ts:120-125`).
  - The import upsert's conflict key includes `site_id`, so a service write cannot land on
    another tenant's row.
- [x] **The code matches what it claims.** Every comment claim I checked holds against the code,
  the live catalogue and the tests.

## Rules compliance

- [x] **Repo conventions (AGENTS.md).**
  - Every moved route rate-limits before authorization, with `onStoreFailure: "deny"` and a
    justifying comment.
  - Errors use `NextResponse.json({ error }, { status })`.
  - Service role is used only after authorization, and each write is scoped by the ids those
    checks established.
  - Ownership comes from the `admin` row (via `resolveSiteOwnerId`).
  - House-style tombstone comments.
  - Lint has 0 errors. The two warnings in a changed file (unused `ABTest`/`ABTestVariant`) are
    already on `main`.
- [x] **No accepted ADR contradicted.**
  - ADR 040: no plan rule in SQL.
  - ADR 033: the migration revokes at table level, which also clears column grants. The catalogue
    asserts `has_any_column_privilege`, and the live query returned 0 rows.
  - ADR 035: the owner is charged through the service client only after the editor is authorised
    and the owner is resolved from `site_permissions`.
  - ADR 037: amended by 042 for `edit`/`admin` content writers.
  - ADR 041: its body is not edited, and its Watch items are closed through 042's header.
  - Traceability nit on ADR 002: see minor m5.
- [n/a] **Design system.** No UI in this story.

## Tests

- [x] **Suite run by the reviewer, passing.**
  - **Full `npx jest --ci`** (CI env, no DB): **305 suites passed, 2 skipped; 3939 tests
    passed, 38 skipped, 0 failed.**
  - **Every DB suite live** on the s56 stack (57xxx), freshly replayed from all 68 migrations,
    with `RCF_REQUIRE_TEST_DB=1` and the PostgREST env set: **13 suites passed, 1 skipped;
    156 tests passed, 2 skipped.** The skipped suite is `editor-activation-concurrency`, gated on
    `RCF_S29_DB_URL`, as before this story. `content-write-privileges` passed **23/23**, with no
    `[gated]` test (checked by name through `--json`):
    - 6 catalogue and guard tests;
    - 12 PostgREST JWT probes (L and P);
    - the member GET;
    - the service-key PATCH;
    - 3 real-handler tests with an `@supabase/ssr` session.

    Also green: `column-privileges` 15 (through PostgREST), `rls-policies` 3, `function-grants` 3,
    `site-delete-cascade` 5, `sites-install-status` 7, `credit-spend` 27, `founding-offer-cap`
    24, `founding-agency-cap` 23, `content-attributes-lifecycle` 18, and `restore-reports-rows`,
    `content-version-i18n` and `content-version-concurrency`.
  - **`update-history-policy`**, with `RCF_DB_TESTS=1` against 57322: 5/5.
  - **Old schema, the code-first proof.** I restored the pre-s56 write surface on the stack by
    SQL: the `anon`/`authenticated` DML grants and the 7 member write policies. The suite went
    **15 red, 8 green**. The red ones are the catalogue and every direct-write probe, as expected.
    The green ones include all 3 real-handler bulk tests and the service-key write, so **the new
    code works on the old schema.** Local `pg_default_acl` also grants `service_role`
    `arwdDxt` on new public tables, so a pre-migration replay already has service DML.
  - **Idempotency.** The migration was applied a third and fourth time by `psql`: NOTICEs only,
    and the catalogue is unchanged.
  - **PostgreSQL 14.17.** `RCF_POSTGRES_BIN=/usr/local/opt/postgresql@14/bin node
    scripts/run-db-invariants.mjs` exits 0. It applies every migration with `ON_ERROR_STOP=1`.
  - **Static gates.** `lint` (0 errors, 35 warnings), `type-check`, `type-check:build`,
    `format:check`, `build-embed --check` and `npm run build` all exit 0.
- [x] **The assertions pin the acceptance criteria.**
  - AC1 is covered by the probes plus the `pg` read-back, for lapsed and paying members.
  - AC2: bulk is proved for real. Translate and A/B are proved on the unit fake, with writes
    asserted on the service client only.
  - AC3: the member GET is 200 with rows, the SELECT guards hold, and no read route diff exists.
  - AC4: `owner-plan-gate` rows for ab-tests POST, PUT and generate, owner and collaborator.
  - AC5: runs in CI by name.
  - Exception: `update-history-policy`'s read-back assertions are vacuous (minor m2).
- [x] **Bite proven by neutralization.** Every mutation was restored with `git checkout`,
  `git diff --exit-code` was clean after each, and the DB was restored by re-applying the
  migration (`authenticated` UPDATE = `f`, 0 member write policies).

  | # | Neutralized | Red |
  |---|---|---|
  | M1 | Migration: appended `GRANT UPDATE ON public.content_elements TO authenticated`, then applied | **3**: the catalogue grant row, and the L and P PATCH probes |
  | M2 | Migration: re-created the member UPDATE policy on `ab_tests`, grants still revoked | **1**: the catalogue policy row |
  | M3 | `ab-tests` PUT: dropped `.eq("site_id", test.site_id)` on the service write | **1** |
  | M3b | `ab-tests` PUT: dropped the `edit`/`admin` check | **1** |
  | M4 | `bulk/update` writes through the RLS client again | **1**: live DB handler test only (no unit test catches it) |
  | M4b | `bulk/update`: dropped `.eq("site_id", siteId)` on the service write | **0**: see minor m1 |
  | M5 | PUT spreads the body again (`...updates`) | **1**: the allowlist test |
  | M6 | `translate` accepts `view` | **1** |
  | M6b | `translate` upserts through the cookie client | **2** |
  | M7 | `generate` charges `user.id` | **1** |
  | M7b | `generate` reads the caller's `abTesting` | **2** |
  | M8 | `ab-tests` POST: dropped the owner gate | **3** |
  | M8b | `bulk/update` limiter set to `onStoreFailure: "allow"` | **1** |
  | M9 | `bulk/import` upsert through the RLS client | **22** |

## Regressions

- [x] **No impact on existing code paths.**
  - **Every writer of the nine tables, enumerated.** Sources: `.from("<table>")` literals and
    dynamic references across `src/`, `server/`, `e2e/` and `scripts/`, every `.rpc(` call site,
    every public function body, and every trigger.
  - **Only four routes wrote with a user session**, and all four moved. Every other writer uses
    the service role or a DEFINER function the web roles cannot execute: staging save and
    publish, restore, `styles/apply`, history, v1, discovery, bucket, track, the cron,
    `lifecycle.ts` and `tracker.ts`.
  - `server/` holds tombstones only. No browser `supabase/client` importer writes these tables,
    and the e2e fixtures write with the service key.
  - **Public reads** (`content/[siteId]`, `ab-tests/active`, `v1`) use the service client and did
    not change. Members keep SELECT.
  - **FK cascades** run as the table owner. `site-delete-cascade` passed live.
  - **Tables outside the nine that members can still write:**
    - `site_themes.content_overrides`, `copy_styles` and `site_languages.translations`. No public
      reader serves them (checked: content GET, v1, `ab-tests/active`, the embed source). See
      minor m4.
    - `edit_sessions`, `staging_access` and `site_editors`: ADR 042 "Watch", per the PO.
    - `blog_posts` is gated on `app_metadata.role = 'admin'`.
    - `credit_purchases` UPDATE is backed by a "may only decrease" trigger. Out of scope, checked
      only to rule out a mint.

## Findings

- **minor — `src/app/api/bulk/update/route.ts:361-362`.** The `.eq("site_id", siteId)` that
  scopes the service-role UPDATE is untested: neutralized, 0 tests go red (M4b). It is
  defense-in-depth, since `element.id` comes from an RLS read filtered by that site (`:250-255`),
  so there is no live exposure. But it is the one scoping line in the moved routes that nothing
  pins. Relatedly, a revert of the writer to the RLS client (M4) is caught only by the live DB
  suite in the CI e2e job, never by `npm test`.
- **minor — `src/__tests__/api/bulk/update-history-policy.test.ts:267-280`.** The read-back runs
  after `ROLLBACK TO SAVEPOINT`, which undoes any UPDATE anyway, so "row unchanged" and "no
  history row" can never fail. The `42501` assertion is the only thing that bites. This is the
  vacuous-assertion class the DB README warns about, though the suite is gated on
  `RCF_DB_TESTS=1` and does not run in CI.
- **minor — `docs/operations/content-writes-service-role.md` (§1, §4).** Two gaps:
  - The runbook never warns that once the migration is applied, a Vercel rollback or redeploy
    of a pre-s56 build recreates the one broken pair (old code on the new schema). That breaks
    bulk import and update, translate, and A/B POST/PUT for every customer. The rollback section
    covers only rolling the migration back.
  - There is no read-only pre-merge check that production `service_role` holds DML on the nine
    tables, which is the premise of "code first". Indirect evidence says it does: discovery and
    `generate` already write as the service role in production, and the default ACL grants it.
- **minor — `docs/decisions/042-content-writes-are-service-role-only.md:148` ("Watch").** Two
  gaps:
  - The Watch entry does not name the member-writable tables that carry content-shaped data:
    `site_themes` (`content_overrides`/`style_overrides`), `copy_styles` and
    `site_languages.translations`. All three have PUBLIC write policies for site admins and full
    grants. They are inert today because no public reader serves them. The day one does, s56's
    bypass reopens there.
  - The invariant is a list of nine named tables. A future content table inherits Supabase's
    default `arwdDxt` for `anon`/`authenticated` (`pg_default_acl`) and would not be caught.
- **minor — `docs/decisions/042-content-writes-are-service-role-only.md:6` (`Amends:`).** ADR 042
  moves four signed-in-user routes off RLS, which is ADR 002 §2's literal rule ("Route handlers
  acting on behalf of a signed-in user use `supabase/server.ts`. RLS stays on"). ADR 042 amends
  ADR 037, but ADR 037 amended only ADR 002 §3/§4, and ADR 042 never names ADR 002. It also
  leaves ADR 002's "Watch: the count" of service-role routes unmentioned. The chain is
  traceable, so this is a documentation nit, not a contradiction of intent.

## Not verified

- **Production.** I have no production access and read nothing there. Taken from the research as
  given, unverified:
  - the seven-versus-nine policy divergence;
  - `service_role` holding DML in production;
  - the absence of `pg_graphql`.

  Human gestures:
  - before merging, run the runbook §3 `has_table_privilege('service_role', …)` query against
    all nine tables, read-only;
  - after `db push`, run the full §3 catalogue query and expect 0 rows;
  - then run one dashboard bulk update on a paying test site.
- **Playwright e2e specs** were not run: `share-edit-publish`, `realtime-parity`,
  `realtime-additive` and `dashboard`. Another agent holds port 3000. PR CI runs them. They are
  the proof that the embed still renders published copy on a migrated stack. None of them
  exercises the four moved routes.
- **`ai/translate` and `ab-tests` POST/PUT/generate were never run against a real database or
  session.** Only the recording fake covers them, and the real-handler proof covers bulk only.
  Gestures:
  - on a paying test site, POST `/api/ai/translate` with an `edit` session and confirm the
    `language=<to>` rows land;
  - with a `view` session, confirm 403 and no charge;
  - PUT `/api/ab-tests` with a body carrying `site_id` of another site, and confirm the row's
    `site_id` is unchanged.

  The A/B UI is parked (`src/app/dashboard/_ab-tests`), so there is no screen to click.
- **No browser session.** The dashboard's Bulk operations screen (`SiteDetailView` →
  `BulkOperations`) was never rendered or clicked.
- **Third parties.** OpenAI was never called (mocked). The Redis limiters were mocked:
  fail-closed behaviour is proved on the stub only, and a real 429 was never produced.
- **The PR body does not exist yet.** The plan's DoD requires it to list the deploy order, the
  runbook, every test changed by the client move, and ADR 042. `/ks-ship` should check it.

## Verdict

## Product owner disposition (orchestrator, 2026-09-28)

- **m3 checked in production before merge (read-only, `has_table_privilege`):** `service_role` holds
  INSERT/UPDATE/DELETE on every content and A/B table, so the code-first deploy is safe; `anon` and
  `authenticated` still hold UPDATE there until this migration runs after the deploy. Rollback
  warning (never roll the app back to a pre-s56 build after the migration) recorded in the PR body;
  runbook wording → s53.
- **m1, m2** (bulk/update site-scope test; update-history-policy read-back after rollback) → s53
  hardening. **m4** (site_themes, copy_styles, site_languages member-writable, not served to
  visitors; default-grant inheritance for future content tables) → s53, with ADR 042 Watch updated
  there. **m5** (ADR 042 Amends header should name ADR 002 §2) → s53 docs.
- **Production policy count verified (read-only, `pg_policies`, 2026-09-28):** exactly 7 member write
  policies on these tables — 6 on `ab_tests`/`ab_test_variants` and "Users can edit content for
  authorized sites" (ALL) on `content_elements` — matching ADR 042's "seven in production".

Max severity: minor
Ship allowed: yes
