# Research — Story s125-credit-and-style-grants

Code read: `origin/main` `534e7926`, worktree `.omx/worktrees/s125-credit-and-style-grants`.
Source finding: `docs/reviews/security-audit-2026-10.md` H1 and M1.

> **Gate warning.** `docs/reviews/stories.md` ends `Stories ready: no`. That verdict is about
> the original backlog breakdown, and every story since s120 has proceeded past it. This story is
> an owner-requested security fix from the audit, outside the PRD breakdown. The owner asked for
> it explicitly in chat on 2026-10-27, so research continued.

## The five structuring facts

1. **H1's premise holds.** `authenticated` has table-wide UPDATE on `credit_purchases`.
   - The only policy is `FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())`
     (`20260731003000_missing_tables_billing_credits.sql:101-107`).
   - The only guard is the `credits_remaining`-may-only-decrease trigger (`:109-124`).
   - No later migration narrows it: none of the eight migrations that touch `credit_purchases`
     contains a `GRANT` or `REVOKE` on it.
2. **Clawback keys on the very column a user can rewrite.** `readGrantForPayment` does
   `.eq("stripe_payment_intent_id", …)` (`src/lib/credits/system.ts:582-585`).
   `revokePurchasedCredits` returns `{ revoked: 0 }` when no row matches (`:625-628`). Analytics
   attribution keys on the same column (`src/app/api/webhooks/stripe/route.ts:3589`,
   `20261013000356_analytics_payment_delivery.sql:205`).
3. **The only web-role writer is `spend_credits`, and it needs exactly one column.**
   - It is `SECURITY INVOKER` and is called with the user's JWT for translate and ab-tests
     (`20260928110000:32-46`, `src/lib/credits/system.ts:412-417`).
   - It runs `SELECT … FOR UPDATE` (`:161-172`) and `UPDATE … SET credits_remaining = credits_remaining - v_take` (`:196-198`).
   - PostgreSQL accepts `FOR UPDATE` with UPDATE on any one column, so `GRANT UPDATE (credits_remaining)` is sufficient.
   - Every other write uses the service role: refund, revoke, grant, webhook.
4. **M1's premise holds, and the hole is INSERT only.**
   - `"Site admins can create styles" FOR INSERT WITH CHECK (site_id IS NOT NULL AND EXISTS(… admin))`
     never constrains `is_preset` (`20251230100000_edit_board.sql:180-189`).
   - The UPDATE policy has no `WITH CHECK`, so its `USING (site_id IS NOT NULL AND is_preset = false AND …admin)`
     also applies to the new row (`:191-199`). That already blocks flipping an existing row to a
     preset, and blocks moving a row to a site the caller does not administer.
   - The grant is `GRANT INSERT, UPDATE, DELETE ON copy_styles TO authenticated` (`:513`).
5. **No application code writes `copy_styles` as a web role.**
   - All three references use the service role: GET presets, GET custom, and POST insert with a
     hard-coded `is_preset: false` (`src/app/api/edit-board/styles/route.ts:107-124,216-226`).
   - `styles/apply` reads it, also with the service role (`apply/route.ts:157-162`).
   - So revoking web-role writes is free. The two route reads need the scope fix, because the
     service role sees the planted row whatever RLS says.

## Target story

As the operator, I know two things:

- A signed-in customer holding the public Supabase key can change nothing on their own
  `credit_purchases` row except spending credits down, so refunds and chargebacks always find and
  claw back the purchase.
- A customer cannot create or edit a copy style that other tenants see as a preset or can apply.

Acceptance (from `docs/stories.md`):

- Web roles can UPDATE only `credit_purchases.credits_remaining`, and have no INSERT or DELETE.
- The trigger refuses any other column change by a non-service role.
- The spend path and the refund/dispute clawback still work.
- `copy_styles` web roles can never set `is_preset = true` or move a style across sites.
- A constraint pins `is_preset` to `site_id IS NULL`.
- Web-role writes are revoked.
- `GET /api/edit-board/styles` lists presets only where `site_id IS NULL`.
- `styles/apply` refuses a style that is neither a preset nor owned by the target site.
- Existing production rows are reported, not deleted.
- The DB suite proves both boundaries, including the s38 restore-the-dangerous-grant negative
  control.

## Current state of the code

| Piece | File | Today |
|---|---|---|
| `credit_purchases` table, SELECT/UPDATE policies, trigger, service policy | `supabase/migrations/20260731003000_missing_tables_billing_credits.sql:63-133` | table-wide grants from Supabase defaults; trigger checks one column |
| `spend_credits` / `refund_credit_usage` | `supabase/migrations/20260928110000_atomic_credit_spend_and_refund.sql` | spend is INVOKER (JWT or service); refund is INVOKER, service-only EXECUTE |
| Spend call (JWT) | `src/lib/credits/system.ts:412-417` | `supabase.rpc("spend_credits", …)` with `createClient()` (RLS client) |
| Grant / clawback | `src/lib/credits/system.ts:480-640` | service role; looks up by `stripe_payment_intent_id` |
| Revocation bookkeeping | `src/lib/billing/credit-revocations.ts` | service role |
| GA payment reads | `src/lib/analytics/google-analytics/payment-reads.ts:106-117` | reads `price_cents`, `credits_purchased` (service role) |
| `copy_styles` table, presets seed, 4 policies, grants | `supabase/migrations/20251230100000_edit_board.sql:12-43,158-209,512-513` | INSERT policy lacks `is_preset = false`; `is_preset` is a nullable boolean |
| Styles list/create | `src/app/api/edit-board/styles/route.ts` | GET presets `.eq("is_preset", true)` with no `site_id IS NULL`; POST inserts `is_preset: false` |
| Style apply | `src/app/api/edit-board/styles/apply/route.ts:157-168` | `.eq("id", styleId)`, not scoped to site or preset |

## Anchor points

- **New migration** `supabase/migrations/2026102712xxxx_credit_purchase_and_copy_style_grants.sql`.
  It must sort after the latest one, `20261024120000_site_install_emails.sql`.
- **The trigger function** `enforce_credit_purchase_monotonicity()`: `CREATE OR REPLACE` in the
  new migration. The trigger itself stays bound.
- **Route edits:** `styles/route.ts` (the GET preset query) and `styles/apply/route.ts` (the style
  lookup).
- **DB tests:**
  - extend `src/__tests__/db/credit-spend.test.ts` (it already has `asRole("authenticated", …)`
    and a "may only decrease" assertion at `:585-600`), or
  - add a sibling suite. The `column-privileges.test.ts` `effectiveColumns(query, role, table, "UPDATE")`
    helper (`:175`, used at `:403-439`) is the pattern for the ACL assertions and the
    restore-the-grant negative control (`:765-780`).
- **Route tests:** `src/__tests__/api/edit-board/` has no styles-specific suite yet. The existing
  suites there (`canonical-site-id`, `staging-token-device`, `service-role-rate-limit`) show how
  the Supabase service client and the staging validator are mocked.

## Verified APIs / functions

- `spend_credits(uuid, integer, integer, timestamptz, text, jsonb)`
  - `SECURITY INVOKER`.
  - EXECUTE granted to `authenticated, service_role` (`20260928110000:342-347`).
  - Writes only `credit_purchases.credits_remaining` and inserts into `credit_usage`.
- `refund_credit_usage(uuid, uuid, integer)`
  - `SECURITY INVOKER`.
  - EXECUTE granted to `service_role` only (`:352-355`).
  - Raises `credits_remaining`; the trigger exempts it because `current_user = 'service_role'`.
- `enforce_credit_purchase_monotonicity()`
  - plpgsql, not DEFINER, so `function-grants.test.ts` does not constrain it.
  - Exempt set: `('service_role', 'postgres', 'supabase_admin')`.
- `readGrantForPayment(supabase, stripePaymentIntentId)` (`src/lib/credits/system.ts:577-593`):
  service-role `.maybeSingle()` keyed on `stripe_payment_intent_id`.
- DB suite plumbing:
  - `describeDb`, `resolveDbTarget` (`src/__tests__/db/db-harness.ts`).
  - Collection-time gate.
  - `RCF_REQUIRE_TEST_DB=1` makes a missing database red.

## Traps & constraints

- **`FOR UPDATE` needs UPDATE privilege on at least one column.** With
  `GRANT UPDATE (credits_remaining)` the INVOKER spend keeps working. Revoking UPDATE entirely
  would break every JWT-side spend (translate, ab-tests). The existing concurrency test
  (`credit-spend.test.ts:938-975`, `SET ROLE authenticated` racers) proves this on real Postgres,
  so it must stay green.
- **ADR 033: column grants do not subtract table grants.** The migration must
  `REVOKE UPDATE ON public.credit_purchases FROM PUBLIC, anon, authenticated` first, then grant
  the column. Otherwise the table-level privilege survives.
- **INSERT and DELETE.** Supabase defaults give anon and authenticated ALL. There is no INSERT
  or DELETE policy, so RLS denies them today. The story asks to revoke them anyway (defence in
  depth; audit L13). `system.ts:454` already documents "no INSERT policy".
- **Hardening the trigger.** Comparing "every column except `credits_remaining`" by name rots
  when a column is added. Comparing
  `to_jsonb(NEW) - 'credits_remaining' IS DISTINCT FROM to_jsonb(OLD) - 'credits_remaining'`
  covers future columns with no maintenance. The service-role and owner exemption must stay,
  because webhook clawback, restore and refund write through it.
- **`is_preset` is nullable.**
  - A plain `CHECK (is_preset = (site_id IS NULL))` lets `NULL` pass. Use
    `is_preset IS NOT DISTINCT FROM (site_id IS NULL)`, or set `NOT NULL` first with a backfill.
  - Seeded presets are `(NULL, …, true)`; route-created rows are `(siteId, …, false)`.
  - `site_id` is `ON DELETE CASCADE`, so no orphan `(NULL, false)` rows should exist.
- **`NOT VALID` vs `VALIDATE`.** If production already holds a planted `(site_id, true)` row,
  `VALIDATE CONSTRAINT` fails the deploy. Decide with the production read in Open questions.
- **Leave the UPDATE policy alone.** Its `USING` already blocks the flip. Once writes are
  revoked from web roles, the policies become inert: keep them (harmless, and documents intent),
  or drop them in the same migration as ADR 042 did for content tables. Either way the
  `rls-policies.test.ts` expectations may list them, so check that suite.
- **Replay convergence.** `scripts/run-db-invariants.mjs` replays every migration on PG17 and
  `verifyReplayReport` refuses a suite that registered nothing. A new suite file must go into
  `REPLAY_SUITES`, or into the named CI step that already runs `credit-spend.test.ts`
  (`ci.yml:422-426`). The s110 test-inventory gate refuses an unregistered test file.
- **The service role bypasses RLS in routes.** Fixing the policy alone does not hide a planted
  row from `GET /styles`, because that route uses the service role. The route filter is required.
- **No `src/types/supabase.ts` impact.** Column types are unchanged.
- **Local environment.** The worktree has no `node_modules` (`npm ci` needed). PG 17.11 is
  installed through Homebrew, which `run-db-invariants.mjs` requires.

## Open questions

1. **Production data, read-only:**
   - `SELECT id, site_id, name, created_by, created_at FROM copy_styles WHERE is_preset IS DISTINCT FROM (site_id IS NULL);`
     If it returns rows, someone may already have planted a preset. This decides `VALIDATE` and
     whether an incident note is needed.
   - `SELECT count(*) FROM credit_purchases;` and `SELECT has_column_privilege('authenticated','public.credit_purchases','stripe_payment_intent_id','UPDATE');`
     These confirm production matches the replay. With 0 paying users, any `credit_purchases`
     rows are trials or migrations, so the H1 window has had nothing to exploit.

   I could not run these: the Supabase MCP is not authorised in this session and no production
   DB URL is available to me. The owner runs them, or authorises `/mcp` for supabase.
2. **Drop or keep the four `copy_styles` member policies once writes are revoked?** ADR 042
   dropped them for content tables. Consistency says drop; minimal diff says keep.
3. **ADR or not?** This extends ADR 033/034 (column boundary) to a billing table, and ADR 042
   (writes are service-role only) to `copy_styles`. That probably needs a short ADR, or an
   errata line, rather than silence. The plan decides.

## Real complexity

The story is scored 2 in `docs/stories.md`. After reading the code: **2**.

- One additive migration: two `REVOKE`/`GRANT` blocks, a `CREATE OR REPLACE` of a trigger
  function, and one constraint.
- Two one-line route filters.
- Tests that extend existing harnesses.

The only real risk is the spend path's `FOR UPDATE` privilege, and an existing real-Postgres
racer test already covers it.

## Split proposal

None needed. The two halves are independent but small. One migration and one PR, as the owner
asked.
