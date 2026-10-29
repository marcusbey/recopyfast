---
validated: yes
story: s125-credit-and-style-grants
---
# Plan — Story s125-credit-and-style-grants

Validation source: owner in chat, 2026-10-27 ("Validate" at the /ks-plan checkpoint).

Branch: `feature/s125-credit-and-style-grants`
Research: `docs/research/s125-credit-and-style-grants.md`. Read it first; this plan does not repeat it.
Source: `docs/reviews/security-audit-2026-10.md` H1 + M1 (committed on this branch).

## Target story

The story has two halves:

- **`credit_purchases`:** a signed-in customer can change only `credits_remaining`, and only
  downwards. Refund and dispute clawback, which look the row up by `stripe_payment_intent_id`,
  can always find it.
- **`copy_styles`:** no customer can create or edit a style that other tenants see as a preset
  or can apply.

Both ship in one migration plus two route filters (acceptance criteria in `docs/stories.md`).

## Tasks (ordered)

1. [x] **RED — `credit_purchases` boundary on real Postgres.** Add
   `src/__tests__/db/credit-purchase-privileges.test.ts`. Use `describeDb` and copy the
   `asRole` / `effectiveColumns` shapes from `credit-spend.test.ts` and `column-privileges.test.ts`.
   Assert:
   - (a) `authenticated`'s effective UPDATE columns are exactly `["credits_remaining"]`, and
     `anon` has none.
   - (b) `anon` and `authenticated` have no INSERT or DELETE on the table.
   - (c) As the row's owner (`SET ROLE authenticated` + JWT claims), `UPDATE … SET stripe_payment_intent_id = 'x'`
     is refused. Repeat for `price_cents`, `credits_purchased`, `created_at`, `expires_at`,
     `user_id`.
   - (d) **Negative control:** inside a transaction, `GRANT UPDATE (stripe_payment_intent_id) TO authenticated`.
     The same update must still be refused, now by the trigger (message names `credits_remaining`).
     Then roll back.
   - (e) `spend_credits` called as `authenticated` still decrements its row (this covers the
     `FOR UPDATE` privilege).
   - (f) `service_role` can still zero `credits_remaining` and update other columns (the
     clawback and restore paths).

   Run the suite against a fresh replay; (a)–(d) fail today.
2. [x] **RED — `copy_styles` boundary on real Postgres.** In the same suite (one `describe`
   each), or in `copy-style-privileges.test.ts`, assert:
   - (a) A site admin acting as `authenticated` cannot INSERT `{site_id: own, is_preset: true}`.
   - (b) That admin cannot INSERT or UPDATE any row; web-role writes are gone.
   - (c) `service_role` inserting `(site_id, is_preset = true)` or `(NULL, false)` violates the
     new constraint.
   - (d) The 6 seeded presets `(NULL, true)` and route-shaped rows `(site, false)` are accepted.
   - (e) **Negative control:** re-`GRANT INSERT ON copy_styles TO authenticated` in a
     transaction. The planted preset must still fail, because no member write policy exists any
     more. Then roll back.

   (a), (b) and (c) fail today.
3. [x] **GREEN — the migration.** Add
   `supabase/migrations/20261027120000_credit_purchase_and_copy_style_grants.sql`. It is
   idempotent and safe to replay, with a header comment citing the audit and ADRs 033/042/075.
   1. `credit_purchases`:
      - `REVOKE INSERT, UPDATE, DELETE ON public.credit_purchases FROM PUBLIC, anon, authenticated;`
      - `GRANT UPDATE (credits_remaining) ON public.credit_purchases TO authenticated;`
      - The table-level REVOKE comes first (ADR 033).
   2. `CREATE OR REPLACE FUNCTION enforce_credit_purchase_monotonicity()`: keep the existing
      exemption set and the "may only decrease" check, and add one refusal:
      `to_jsonb(NEW) - 'credits_remaining' IS DISTINCT FROM to_jsonb(OLD) - 'credits_remaining'`
      raises `credit_purchases: only credits_remaining may change (non-service role)`. The
      trigger binding is unchanged; `search_path` stays unpinned only if it already was. Check
      `function-grants.test.ts` rules for non-DEFINER functions.
   3. `copy_styles`:
      - `DROP POLICY IF EXISTS` the three member write policies (create/update/delete). Keep both
        SELECT policies.
      - `REVOKE INSERT, UPDATE, DELETE ON public.copy_styles FROM PUBLIC, anon, authenticated;`
      - `ADD CONSTRAINT copy_styles_preset_is_global CHECK (is_preset IS NOT DISTINCT FROM (site_id IS NULL)) NOT VALID;`
        guarded by `IF NOT EXISTS` on `pg_constraint`.
      - Then a `DO` block: if no row violates it, `VALIDATE CONSTRAINT`. Otherwise
        `RAISE WARNING` with the count and leave it NOT VALID. Never delete; the story says
        report, not delete.

   Tasks 1–2 go green, and `node scripts/run-db-invariants.mjs` is green on PG17.
4. [x] **RED → GREEN — routes.** Add `src/__tests__/api/edit-board/styles-scope.test.ts`,
   mocking the service client as the sibling suites do. Cover:
   - (a) `GET /api/edit-board/styles` queries presets with `site_id IS NULL`, so a planted
     `(otherSite, true)` row returned by a loose query never appears.
   - (b) `POST /api/edit-board/styles/apply` with a `styleId` whose `site_id` is another site
     returns 404 "Style not found" and calls no AI.
   - (c) A preset id and an own-site id still apply.

   Fix:
   - `styles/route.ts` GET: add `.is("site_id", null)` to the preset query.
   - `styles/apply/route.ts`: select `site_id, is_preset` too, and refuse unless
     `style.site_id === siteId || style.site_id === null`, with the same 404 so the response is
     not an oracle.
5. [x] **Register the suites.**
   - Add each new DB suite to `REPLAY_SUITES` in `scripts/run-db-invariants.mjs`, so
     `verifyReplayReport` requires at least one pass.
   - Add any named-CI-step or inventory entry the s110 test-inventory gate demands.
   - Proof: the inventory check and `node scripts/run-node-tests.mjs` pass.
6. [x] **Docs.**
   - Write `docs/decisions/075-billing-rows-are-column-scoped-for-web-roles.md` (see below).
   - Add a one-line pointer in `docs/architecture.md` under "Data access".
   - Extend ADR 042's scope note to name `copy_styles` (errata line in `docs/decisions/errata.md`,
     or "applies also to").
   - Link the plan and review in the story.
   - Tick the audit's H1/M1 lines with "fixed in s125 (PR #…)".
7. [x] **Gates.**
   - `npm ci`, then `lint`, `type-check`, `format:check`, the full `test`,
     `node scripts/run-db-invariants.mjs` and `build`, all green.
   - Record the counts in the PR.
   - Draft the PR body's "Owner, run before merge (read-only)" block with the two production
     queries from research Open questions §1.

## Run interdicts

- No edit to any existing migration file; the fix is one new migration.
- No change to `spend_credits`, `refund_credit_usage` or any `src/lib/credits/*` behaviour.
  `git diff main -- src/lib/credits src/lib/billing` must be empty.
- No DELETE or UPDATE of existing `copy_styles` or `credit_purchases` data in the migration.
- No `SECURITY DEFINER` added anywhere; `function-grants.test.ts` must stay green unmodified.
- Do not weaken or rewrite existing assertions in `credit-spend.test.ts`,
  `column-privileges.test.ts`, `rls-policies.test.ts` or `function-grants.test.ts`. Adding
  `copy_styles` to an expectation list is allowed only if that suite enumerates policies, and
  the diff must say why.
- No other audit finding in this PR (H2–H4, M2–M9, lows), even where adjacent.
- No connection to production, and no `supabase db push`; deployment is manual after merge.
- No `.env*` reads.

## The point everything turns on

**`GRANT UPDATE (credits_remaining)` alone is enough for the INVOKER `spend_credits`, and
nothing else in the web role's path writes this table.** If either is wrong, AI spend for
translate and ab-tests breaks in production, silently from the user's side: "insufficient"
appears, or a 500. Three places to check:

1. **`SELECT … FOR UPDATE`.** PostgreSQL requires UPDATE on *at least one* column of the locked
   table. Check against the real PG17 run of the `credit-spend.test.ts` `SET ROLE authenticated`
   racers (`:938-975`), not against the docs.
2. **Other writers.** `grep -rn "credit_purchases" src server` must still show every write going
   through `createServiceRoleClient()`. The research found `system.ts:412` (rpc via the JWT
   client) to be the only JWT path. A missed `createClient()` update would start failing with
   "permission denied".
3. **The trigger's jsonb diff.** `to_jsonb(NEW)` includes generated or defaulted columns. A
   `BEFORE UPDATE` trigger sees `NEW` before defaults on UPDATE (there are none), so the diff
   is exact. Confirm `updated_at`-style auto-columns are absent: `credit_purchases` has no
   `updated_at` trigger. If one is added later, this check refuses the spend, and test 1(e)
   would catch that.

On `copy_styles` the risk is lower. Compare the "no web writer" claim against
`grep -rn copy_styles src server scripts` (3 refs, all service-role).

## ADR 075 (to write in task 6)

- **Decision:** a web role's write to a billing row is column-scoped and trigger-pinned. The
  table-level write is revoked; only the column a user-side RPC needs is granted back; a
  `BEFORE UPDATE` trigger refuses any other column change by a non-service role.
- **Considered:**
  - Make `spend_credits` `SECURITY DEFINER` and revoke all web writes. Rejected:
    `function-grants.test.ts` forbids DEFINER functions `authenticated` can execute (ADR 040),
    and DEFINER needs its own tenant checks.
  - Grant only, no trigger. Rejected: a later blanket grant (Supabase defaults, a hand-run SQL
    edit) silently reopens the hole, and the trigger is the second wall the negative control
    proves.
  - Route all spend through the service role. Rejected: a larger behavioural change to
    ADR 035/040's payer model, outside this story.

## Files touched

- `supabase/migrations/20261027120000_credit_purchase_and_copy_style_grants.sql` (new)
- `src/__tests__/db/credit-purchase-privileges.test.ts` (new; maybe `copy-style-privileges.test.ts`)
- `src/__tests__/api/edit-board/styles-scope.test.ts` (new)
- `src/app/api/edit-board/styles/route.ts`, `src/app/api/edit-board/styles/apply/route.ts`
- `scripts/run-db-invariants.mjs` (`REPLAY_SUITES`), plus whatever inventory file s110 requires
- `docs/decisions/075-…md` (new), `docs/decisions/errata.md` or ADR 042, `docs/architecture.md`,
  `docs/stories.md`, `docs/reviews/security-audit-2026-10.md` (new on this branch; H1/M1
  status lines)

## Test strategy

- **Database:** real PostgreSQL 17 through `scripts/run-db-invariants.mjs`, with
  `RCF_REQUIRE_TEST_DB=1`. This covers ACLs, role impersonation with JWT claims, the trigger,
  the constraint, and negative controls that restore the dangerous grant to prove the second
  wall. It is the only level that can prove a privilege.
- **Route:** Jest with the service client mocked, for query scoping and the 404 on a foreign
  style. These are unit-level, matching the sibling `edit-board` suites.
- **Regression:** the full Jest suite, plus `credit-spend.test.ts` (the spend and refund money
  paths), `column-privileges.test.ts`, `function-grants.test.ts` and `rls-policies.test.ts`
  unchanged and green.
- **Not covered automatically:** production row state (whether a planted preset already
  exists). The owner runs the read-only query before merge.

## Definition of Done

- One PR from `feature/s125-credit-and-style-grants`, with a structured description that lists
  the two production read-only queries and their results (owner-run).
- `lint`, `type-check`, `format:check`, `build` and `test` green; the PG17 replay green with the
  new suites registered and passing (not skipped).
- Every acceptance box in `docs/stories.md` s125 is ticked with a test name next to it.
- `/ks-review` passed, no open critical.
- Merge and deployment are manual. After deploy, the owner confirms
  `has_column_privilege('authenticated','public.credit_purchases','stripe_payment_intent_id','UPDATE') = false`
  on production.
