---
validated: yes
---

# Plan — Story s48-credit-integrity

Branch: `feature/s48-credit-integrity`
Research: `docs/research/s48-credit-integrity.md` — read it first; this plan does not repeat it.
Evidence: `.omx/qa-20260927/REPORT.md` (defects 1–3) and the scripts and results beside it. They
stay local and are never committed.

## Target story

Every AI charge is exact under concurrency. A failed AI call costs nothing net. A refund goes back
to where the credits came from, so it can never create a paid-looking balance or keep an account
past the paywall. Out of scope: per-text translation pricing (defect 8), the credit-card display
fixes (defect 5 and the display half of 7), and s49's buy button.

The design is the research's recommendations, adopted unchanged ("Traps & constraints"):

- **One spend function.** `spend_credits` is `SECURITY INVOKER`. It does the whole charge under
  `pg_advisory_xact_lock(hashtextextended('credits:' || user, 0))`. The allowance and window start
  are still computed in TypeScript and passed in.
- **Net usage.** `credit_usage.credits_used` becomes the net charge. Each row also records its
  purchased share and the purchase rows it debited.
- **Refund by receipt.** `refund_credit_usage` is executable by the service role only. It is keyed
  by the usage id that the charge returned in the same request. It gives purchased credits back
  first, into the recorded rows, then the allowance, by lowering `credits_used`.
- **No data migration.** Legacy `refund_` rows stay spendable. They stop counting as an
  entitlement and as "purchased".
- **ADR 040.** Migration `20260928110000`.

| AC (docs/stories.md s48) | Tasks |
|---|---|
| 1 Translation: nothing translated → nothing net, reports failure; partial → failed share back; error after charge → charge back; key checked before charging | T5, T6 |
| 2 Refund to source; never a new purchased row; lapsed never-paid trial → `none` with or without a refunded failure | T1, T4, T7 |
| 3 N simultaneous charges exact, none refused while covered; one DB function; real-Postgres test, 12 at once, repeated, run by CI | T1, T2, T3 |
| 4 "Total purchased" counts paid credits only | T7 |
| 5 Gates in a worktree; one commit; operator: migration first, then deploy | T8, T9 |

### Resolved open questions

1. **Partial-refund rounding: `Math.ceil(5 × failed / total)`.** It favours the customer by at most
   1 credit, and the database caps it at the charge. Pinned by T6 with a case where floor and ceil
   differ.
2. **Translate failure response: keep the 500 that echoes `result.error`.** This is minimal, and
   the existing test "should return 500 when AI service fails" stays valid. The caller is signed
   in (cookie session), not a public widget. `batchTranslate`'s zero case uses a fixed sentence we
   own, `"No text could be translated."`, and never provider text. `translateText` already logs
   each provider error (`openai-service.ts:98-104`).
3. **Legacy predicate on the entitlement read: yes.** The operator's count query (DoD) says
   whether it is live protection or dead code.
4. **Window seam: add `windowStart: string` to `CreditBalance`.** Only the interface
   (`system.ts:39-44`) and the return object (`:213-218`) change. The body at `:121-211` keeps
   every line for s47a. One pinned `toEqual` changes, which is declared (T3).
5. **Out of scope, unchanged:**
   - refunded requests still write `usage_tracking` (defect 5);
   - edit-session plan checks (REPORT defect 2 note).

**Decisions the research left to the plan:**

- **Return shapes.**
  - `spend_credits(p_user_id uuid, p_credits integer, p_included integer, p_window_start
    timestamptz, p_operation text, p_metadata jsonb)` returns
    `TABLE(outcome text, usage_id uuid, from_allowance integer, from_purchased integer,
    remaining integer)`. `outcome` is `charged` or `insufficient`. On `insufficient`,
    `usage_id` is NULL and `remaining` is what is available.
  - `refund_credit_usage(p_usage_id uuid, p_user_id uuid, p_credits integer)` returns
    `TABLE(refunded integer, to_purchased integer, to_allowance integer)`.
- **The debit record is immutable.**
  - `credits_from_purchased` and `purchase_debits` (stored in spend order, oldest row first) never
    change after the charge.
  - Purchased credits are always refunded first, so a later refund derives what is still out:
    `outstanding = GREATEST(0, credits_from_purchased − credits_refunded)`.
  - It restores that much by walking `purchase_debits` in reverse order, skipping what earlier
    refunds already returned. Each row is capped at `credits_purchased`.
  - This is the exact reverse of the spend, and two partial refunds equal one refund of their sum.
- **One CHECK replaces `credit_usage_positive`:** `credit_usage_amounts_valid`, with
  `credits_used >= 0 AND credits_refunded >= 0 AND credits_from_purchased >= 0 AND
  credits_from_purchased <= credits_used + credits_refunded AND jsonb_typeof(purchase_debits) =
  'array'`. Existing rows satisfy it through the defaults.
- **TypeScript receipt:** `CreditCharge { usageId: string; userId: string; credits: number }`.
  - The refund is `refundCharge(charge, credits = charge.credits)`. It never throws and returns
    `{ success, refunded }`.
  - It is the only refund entry point. `refundCredits` is deleted.
- **History.** `getCreditTransactions` omits usage rows whose net `credits_used` is 0. A fully
  refunded request previously showed as −1 and +1 "Credits granted"; without the filter it would
  now show a "0" consumption line. Labels are unchanged (display work, out of scope).

## Tasks (ordered)

0. **Setup (not a task, no test).**
   - **Worktree.** Run
     `git worktree add .omx/worktrees/s48-credit-integrity -b feature/s48-credit-integrity main`
     from the repo root. It branches from local `main` (`934253b`), not `origin/main`
     (`08d1f64`): only local `main` carries the s48 story in `docs/stories.md`. s47a branched from
     the same commit. Then run `npm run setup` in the worktree.
   - **What to copy in.** Copy the untracked `docs/research/s48-credit-integrity.md` and this plan.
     Leave out:
     - the root `.env`: it sets a production `NEXT_PUBLIC_APP_URL` that breaks the origin suites;
     - the root's uncommitted `AGENTS.md` edit;
     - every `s47*` doc.
   - **Environment.** Export the CI placeholder environment for every command. It is the `env:`
     block of the `Lint, Test & Build` job, `.github/workflows/ci.yml:35-80`.
   - **Database.** Run `colima start`, then `npx supabase start` from the worktree, then
     `npx supabase migration list --local`.
     - **The local database is shared with the s47a worktree.** If the history shows a version
       this worktree lacks (s47a's `20260928120000`), do not repair, revert or reset anything. Apply
       pending files with
       `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <file>`
       (they are idempotent) and note it in the Execution log. Otherwise use
       `npx supabase migration up --local`.
     - Confirm s45's `20260926120000` is applied.
   - **Baseline.** Record the full Jest counts and the `RCF_REQUIRE_TEST_DB=1 npx jest --runInBand
     src/__tests__/db` counts.
1. [x] **The migration and its behaviour suite, test-first.**
   - **Test file:** new `src/__tests__/db/credit-spend.test.ts`, on `describeDb` /
     `resolveDbTarget`, shaped like `founding-agency-cap.test.ts`.
     - Each test creates its own `auth.users` rows with a `dbtest-credits-` email prefix, and
       `afterEach` deletes only those. The cascade removes their credit rows.
     - **`beforeAll` fails closed** (precedent `:27-63`) unless all of these exist:
       `to_regprocedure('public.spend_credits(uuid,integer,integer,timestamp with time zone,text,jsonb)')`,
       `to_regprocedure('public.refund_credit_usage(uuid,uuid,integer)')`, and the three new
       `credit_usage` columns.
   - **Red (migration absent).** Named tests:
     - "the migration re-applies twice inside one transaction". Read the file, then run `BEGIN`,
       the file, the file, `ROLLBACK`.
     - "a charge the allowance covers debits no purchase row and records from_purchased 0".
     - "a charge past the allowance debits purchase rows oldest first and records each debit in
       spend order". Uses explicit `created_at` values and asserts final `credits_remaining`,
       `credits_from_purchased` and `purchase_debits`.
     - "expired rows are neither spent nor counted; a legacy refund_ row is spent like any other".
       This is parity with `spendable.ts:18-53`.
     - "an unaffordable charge returns insufficient with the available amount and writes nothing",
       and "a charge that exactly empties the wallet succeeds".
     - "invalid input raises 22023": `p_credits ≤ 0`, `p_included < 0`, NULL window.
     - "an AI charge does not wait on the same user's checkout lock". Another transaction holds
       `hashtextextended(user::text, 0)`, and the spend completes under
       `SET statement_timeout = '2s'`.
     - "as authenticated, a caller charges its own wallet through RLS and the trigger". Pattern:
       `SET LOCAL ROLE authenticated` plus `request.jwt.claims`
       (`column-privileges.test.ts:438-443`).
     - "as authenticated, naming another user's id is refused with the function's own message".
       Assert the message text, not only 42501: without the check, the RLS insert check would
       still refuse, but with a misleading message.
     - "the monotonicity trigger still refuses an authenticated self-refill".
     - "EXECUTE: anon holds neither function, authenticated holds spend_credits only, service_role
       holds both" (`has_function_privilege`). Also "neither function is SECURITY DEFINER".
     - "a full refund of an allowance-funded charge restores the allowance and writes no
       credit_purchases row". This is probe P2.
     - "a full refund of a charge that straddled the allowance returns the purchased share to the
       exact rows it came from, then the allowance".
     - "a partial refund leaves wallet and usage exactly as a single charge of the kept amount".
       Compare against a **control user** charged only the kept amount from the same start state.
       Two cases: refund ≥ purchased share, and refund < purchased share. Also: "two partial
       refunds equal one refund of their sum".
     - "a refund is capped at the charge's net credits: a second full refund returns 0".
     - "a refund never raises a row above credits_purchased".
     - "a refund naming the wrong user raises and changes nothing".
     - **P3 (data):** "a trial's allowance-funded charge, refunded, then the trial lapses: no live
       plan row and zero spendable purchased credits remain". Uses `p_included 500` and
       `p_window_start` = the trial row's `granted_at`, as `system.ts:200` passes it. The
       resolver half of P3 is T7.
   - **Green:** `supabase/migrations/20260928110000_atomic_credit_spend_and_refund.sql`.
     - **Idempotent:** `ADD COLUMN IF NOT EXISTS`, constraints via drop-if-exists/add,
       `CREATE OR REPLACE`.
     - **Columns and CHECK:** the three columns (`credits_from_purchased INTEGER NOT NULL DEFAULT 0`,
       `purchase_debits JSONB NOT NULL DEFAULT '[]'`, `credits_refunded INTEGER NOT NULL DEFAULT
       0`) and the CHECK above.
     - **Both functions:** plpgsql, `SECURITY INVOKER`, `SET search_path = public, pg_temp`.
       Precedent: `20260924000000_atomic_editor_activation.sql:11-89`.
     - **`spend_credits`**, in order:
       1. validate the input;
       2. `IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN RAISE` (42501, own
          message);
       3. take the `'credits:'` lock;
       4. sum `credits_used` where `created_at >= p_window_start`;
       5. draw from the allowance first;
       6. lock spendable rows `ORDER BY created_at, id FOR UPDATE`;
       7. if they cannot cover the rest, return `insufficient` with no write;
       8. otherwise decrement relatively, insert the usage row with its split and debits, and
          return `remaining = GREATEST(0, p_included − used_after) + purchased_after`.
     - **`refund_credit_usage`**, in order:
       1. validate the input;
       2. take the same lock on `p_user_id`;
       3. read the usage row `FOR UPDATE`;
       4. raise if the row is missing or belongs to another user;
       5. cap at net `credits_used`;
       6. return purchased credits first, in reverse debit order and in place, capped per row, to
          rows of that user only;
       7. lower `credits_used` and raise `credits_refunded` by the refunded amount.
     - **Grants:**
       - `spend_credits`: `REVOKE ALL … FROM PUBLIC, anon`, then `GRANT EXECUTE … TO
         authenticated, service_role`.
       - `refund_credit_usage`: `REVOKE ALL … FROM PUBLIC, anon, authenticated`, then
         `GRANT EXECUTE … TO service_role`.
     - **Nothing else.** No `UPDATE` or `DELETE` of existing rows, and no RLS, policy or trigger
       change.
     - **Header** states:
       - the design and why INVOKER;
       - the lock namespace;
       - net `credits_used`;
       - migration before code;
       - never roll the schema back once a refund has written a net-0 row, because the old CHECK
         refuses it.
   - **PostgreSQL 14 syntax only.** `scripts/run-db-invariants.mjs` applies every migration on a
     bare PG14 (T9 runs it).
   - **Guards stay green, unchanged:** `function-grants.test.ts`, `rls-policies.test.ts`,
     `column-privileges.test.ts`, `founding-agency-cap.test.ts`.
2. [x] **Concurrency proof and the CI step, test-first.**
   - **In `credit-spend.test.ts`**, use the barrier pattern of
     `founding-agency-cap.test.ts:157-251`. The barrier holds
     `hashtextextended('credits:' || user, 0)`, waits until all racers wait on `Lock`, then
     releases. Racers run `SET ROLE service_role` unless the test says otherwise. Named tests:
     - "12 barrier-synchronised charges over a multi-row wallet, 5 rounds: 12 charged, 0 refused,
       wallet taken equals recorded purchased usage".
       - Setup: a fresh user per round, wallet 8×3 + 100 (P4's shape), cost 5, included 0.
       - Each round asserts `{waiters: 12, resolvedWhileHeld: 0}`, Σ`credits_used` = 60, and each
         row's drop = the sum of its recorded debits.
     - "the same race as authenticated, one round". Each racer sets its own JWT claims at session
       level.
     - "12 charges straddling the end of the allowance draw it exactly once". Included 12, window
       start one hour ago, same wallet. Σ`from_allowance` = 12, and the wallet is down 48. This is
       the double-draw race the research found.
     - "12 charges against a wallet of exactly 60: all charged, a 13th is insufficient and writes
       nothing".
     - "12 unsynchronised charges, 10 rounds: conservation holds and nothing is refused". No
       barrier, which is closest to P4.
   - **Contract test.** In `src/__tests__/e2e/playwright-ci-contract.test.ts`, the red test
     "runs the credit spend suite against the disposable database". It asserts that
     `.github/workflows/ci.yml` has a step running `src/__tests__/db/credit-spend.test.ts` with
     `RCF_TEST_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres"` and
     `RCF_REQUIRE_TEST_DB: "1"`, before "Build production app".
   - **Green:** add the step "Test AI credit spend and refund against disposable Postgres"
     (`npx jest --runInBand src/__tests__/db/credit-spend.test.ts`) right after "Test Founding
     Agency capacity against disposable Postgres" (`ci.yml:259-289`). Existing steps are
     unchanged.
   - **Mutation M1 (local only, never committed).**
     1. `CREATE OR REPLACE` a copy of `spend_credits` without the advisory lock.
     2. Run the barrier and straddle tests; both must fail.
     3. Restore by re-running the migration file, then record the result.

     If a mutation survives, declare it; never weaken the assertion.
3. [x] **Spend through the function, test-first.**
   - **Tests.**
     - `src/__tests__/lib/credits/explicit-payer-client.test.ts`:
       - The pinned balance at `:255` gains `windowStart` (declared).
       - `:313` and `:349` become "charges through spend_credits on the payer client with the
         allowance and window it computed". It asserts:
         - the RPC name and exact arguments: `p_user_id` OWNER, `p_credits` 1, `p_included` 500,
           `p_window_start` = the subscription's `current_period_start`, `p_operation`
           `"ai_suggestion"`, `p_metadata` `{siteId}`;
         - no `credit_purchases` update and no `credit_usage` insert through the client;
         - `usage_tracking` is still recorded;
         - `createClient` and `getEffectivePlan` are never called;
         - the result is `{ success: true, charge: { usageId, userId: OWNER, credits: 1 } }`.
       - New: "passes a live trial's granted_at, and the calendar month for a credits-only wallet,
         as the window".
     - `src/__tests__/lib/credits/concurrency.test.ts` is rewritten as the RPC contract. It keeps
       the A-18 header, now pointing at the DB suite as the concurrency proof. Tests:
       - "maps charged to success with the receipt and remaining credits";
       - "maps insufficient to the existing sentence with the available amount and no receipt";
       - "an RPC error, no row or an unknown outcome is a failure that charged nothing, logged,
         never thrown";
       - "never writes credit_purchases or credit_usage itself".

       The fake compare-and-swap tests (`:251-346`) are deleted (declared).
     - `src/__tests__/lib/feature-gating/permissions.test.ts`: "consumeFeatureUsage passes the
       charge receipt through" and "collaboration returns no receipt". The existing
       `consumeCredits` argument-list assertions (`:306-340`, `:463-470`) are unchanged.
   - **Green.**
     - **`system.ts`:** add `windowStart` to `CreditBalance` and its return object only; export
       `CreditCharge`.
     - **`consumeCredits`** keeps its signature. It reads `getUserCreditBalance(userId, client)`
       for `included` and `windowStart`, then calls `.rpc("spend_credits")` through the same
       client. It returns `{ success, error?, remainingCredits?, charge? }`. The
       insufficient-funds sentence stays "Insufficient credits. You need X credits but only have
       Y.", with Y taken from the function's result.
     - **Delete** `deductPurchasedCredits`, `MAX_DEDUCT_ATTEMPTS` and the usage-insert refund
       branch (`:339-417`, `:472-489`).
     - **`consumeFeatureUsage`** returns `charge` for the two credit features; its argument lists
       are unchanged.
     - `ab-tests/generate` stays unchanged: `remainingCredits` is still returned.
4. [x] **Refund by receipt, and the suggest route, test-first.**
   - **Tests.**
     - New `src/__tests__/lib/credits/refund-charge.test.ts`:
       - "refundCharge calls refund_credit_usage through the service role with the receipt's usage
         id, user id and credits";
       - "a partial amount is sent as given";
       - "0, negative, fractional or more than the charge is refused without calling the
         database";
       - "an RPC error resolves { success: false, refunded: 0 }, logged, never thrown";
       - "never inserts a credit_purchases row".
     - `src/__tests__/lib/credits/non-expiring-grant.test.ts`: delete "refunds survive the same
       schema gap" (`:120`, declared). Refunds no longer insert rows.
     - `src/__tests__/api/ai/suggest/route.test.ts`: `:731` and `:760` assert
       `refundCharge(RECEIPT)`. RECEIPT is what the mocked `consumeFeatureUsage` returned, never the
       owner id (declared). "refunds nothing when the gate itself throws" stays unchanged.
   - **Green.**
     - **`refundCharge`** goes in `system.ts`, and `refundCredits` is deleted (`:550-586`). Remove
       any import left unused.
     - **Suggest route:** `chargedOwnerId` becomes `charge: CreditCharge | null`, and
       `refundOwner(ownerId)` becomes `refundOwner(charge)`. Rewrite the tombstones at `:137-143`
       and `:160-165`. They say a refund "is a fresh non-expiring grant", which is now false. The
       catch still refunds only a charge that landed.
     - Fix the comment-only references to `refundCredits` at `src/lib/billing/trial.ts:70` and
       `src/__tests__/lib/billing/trial.test.ts:112`.
5. [x] **`batchTranslate` reports total failure, test-first.**
   - **Tests** in `src/lib/__tests__/openai-service.test.ts`:
     - "reports failure when no element is translated". Every element's model call throws, as with
       a missing key. Expect `success: false`, `error: "No text could be translated."`, no `data`,
       and `tokensUsed` summed.
     - "should handle partial failures in batch translation" stays unchanged: `success: true`, one
       row.
   - **Green:** at `openai-service.ts:192-202`, return that failure when
     `successfulTranslations.length === 0`.
6. [x] **The translate route, test-first.**
   - **Tests** in `src/__tests__/api/ai/translate/route.test.ts`. The file now mocks
     `@/lib/credits/system` as `{ CREDIT_COSTS: { AI_TRANSLATION: 5 }, refundCharge: jest.fn() }`,
     following the suggest precedent. `consumeFeatureUsage` resolves
     `{ success: true, charge: RECEIPT }`. New tests:
     - "AI key missing: 503, nothing charged, the model never called". `consumeFeatureUsage` and
       `batchTranslate` are not called, and the log names `OPENAI_API_KEY`. `jest.setup.js:161`
       sets the key, so the test blanks it and restores it afterwards (suggest test precedent).
     - "nothing translated: failure and the whole charge refunded". Cover both
       `{ success: false }` and `{ success: true, data: [] }`. Expect a 500, a body without
       "Successfully translated", and `refundCharge(RECEIPT)` with the full 5.
     - "partial batch: the failed share is refunded, rounded up". 2 of 5 failed refunds 2; 1 of 3
       failed refunds 2, where floor would give 1. Expect a 200 with only the translated rows.
     - "every element translated: nothing refunded".
     - "an error after the charge refunds it in the catch". `batchTranslate` rejects; expect a 500
       and `refundCharge(RECEIPT)`.
     - "an error before the charge refunds nothing". `consumeFeatureUsage` rejects.
     - "a quota refusal refunds nothing". The existing 403 test gains this assertion.
   - **Existing tests.** "should return 500 when AI service fails" keeps its echo assertion.
     "should handle AI service exception" gains the refund assertion (declared).
   - **Green.**
     - **Key check.** Before `consumeFeatureUsage`, copy the suggest check
       (`suggest/route.ts:253-260`, own log line, 503
       `"AI translation is not available right now."`).
     - **Receipt.** `let charge: CreditCharge | null` is declared before the `try`.
     - **Nothing translated** (`!result.success` or no rows): refund the whole charge, clear
       `charge`, and keep the 500 echo.
     - **Partial batch:** refund `Math.ceil(CREDIT_COSTS.AI_TRANSLATION × failed / total)`
       through a module-private helper.
     - **Catch:** refund `charge` if set. The database cap makes refunding after a partial
       refund safe.
     - **Tombstones** name defect 1 (the key check, the zero case, the catch).
7. [x] **Legacy refund rows stop counting as paid, test-first.**
   - **Tests.**
     - New `src/__tests__/lib/billing/lapsed-trial-refund.test.ts`: the real `effective-plan.ts`
       and `spendable.ts` over an in-memory client with production-shaped rows. The harness
       template is `lifetime-agency-allowance.test.ts:330-441`.
       - **Red:** "P3 legacy: a lapsed trial holding only a legacy refund_ credit resolves to
         none". Today it receives `credits`.
       - **Guard** (passes before, declared): "P3: a lapsed trial whose failed charge was refunded
         to its allowance resolves to none". The rows are what T1's P3 test leaves: an expired
         trial, one usage row at net 0, no purchase row.
       - **Guards:**
         - a paid pack still resolves to `credits`;
         - a `migrated_wallet_` row with price 0 still resolves to `credits`;
         - a row with a NULL payment intent still resolves to `credits`;
         - a paid pack plus a legacy refund row resolves to `credits`.
     - New `src/__tests__/lib/credits/paid-totals.test.ts`:
       - **Red:** "totalPurchased counts packs and migrated wallets, not legacy refund_ rows".
       - **Red:** "transaction history omits fully refunded usage rows and shows partial ones at
         their net".
       - **Guard:** "the spendable balance still includes legacy refund_ rows"
         (`getUserCreditBalance().purchased`).
   - **Green.**
     - **In `spendable.ts`:** `LEGACY_REFUND_PAYMENT_PREFIX = "refund_"`,
       `isLegacyRefundGrant(paymentIntentId: string | null)` (`startsWith`; NULL is paid), and
       `readPaidCreditBalance(supabase, userId)`. The latter selects `credits_remaining,
       stripe_payment_intent_id` with the same spendable filter and excludes legacy rows in
       TypeScript, not with a PostgREST `LIKE` (where `_` is a wildcard and NULL drops out).
     - **Entitlement read:** `effective-plan.ts:527` uses `readPaidCreditBalance`; nothing else
       in that file changes.
     - **Totals:** `getCreditWallet` excludes legacy rows from `totalPurchased`.
       `getCreditTransactions` adds `.gt("credits_used", 0)` to its usage read.
     - **Tombstone** at the predicate: prefix, not `price_cents = 0`, because `migrated_wallet_`
       rows are paid at price 0 (`20260802020000_…sql:119-130`).
8. [x] **ADR 040, the architecture correction, tombstones.**
   - **ADR.** Write `docs/decisions/040-credits-spent-and-refunded-in-the-database.md` from
     `~/.claude/killer-saas/templates/adr.md`. Its content is the research's ADR 040 list:
     - INVOKER rather than DEFINER, and why;
     - the allowance terms passed in from TypeScript;
     - the `credits:` lock and why it is namespaced;
     - net `credits_used` plus the immutable debit record;
     - refunds purchased first, in place, service role only, receipt-keyed;
     - the accepted revoke-then-refund race;
     - legacy rows not counting as an entitlement or as purchases, and no data migration;
     - migration-first deploy, and why the schema must not be rolled back.

     It says it supersedes ADR 035's rejected alternative, "A SECURITY DEFINER spend function"
     (`035:59-62`), because P4 disproves the premise. ADR 035 itself stays untouched.
   - **Architecture.** In `docs/architecture.md:365`, "credit spend is compare-and-swap" becomes
     "credits are spent and refunded by database functions under a per-user lock
     ([ADR 040](./decisions/040-credits-spent-and-refunded-in-the-database.md))".
   - **Tombstones.**
     - The `consumeCredits` docstring (`system.ts:419-438`) drops "compare-and-swap". It keeps the
       s40 payer-client warning and names the P4 loss.
     - `refundCharge` says why a refund is receipt-keyed and never mints a row (P2, P3).
     - The migration header (T1).
   - **Checkpoint:** run the full gate below; it must be green before T9.
9. [x] **Gates, before/after evidence, delivery.**
   - **Gate.** Run the full gate below in the worktree.
   - **Probe re-run.**
     1. Copy `.omx/qa-20260927/credits-probes.ts` to
        `.omx/qa-20260927/credits-probes-s48.ts`.
     2. Retarget its imports from `../worktrees/verify-credits/` to
        `../worktrees/s48-credit-integrity/`.
     3. Replace its two `refundCredits(X, 1, "ai_suggestion_failed")` calls with
        `refundCharge(<the charge consumeFeatureUsage returned>)`. Change nothing else.
     4. Run it on the local stack with `P4_SPENDERS=12 P4_ROUNDS=5` and save
        `credits-probes-s48-results.txt`.

     Expected results:
     - `P2_permanentCreditMinted: false` and `P2_allowanceUsageStillCounted: false`;
     - `P3_entitlementAfterLapse: "none"`;
     - every P4 round `overCharged: 0` and `failed: []`.

     These files stay out of the commit. If `next dev` was started, revert the block it appends
     to `AGENTS.md`.
   - **Delivery.**
     - Tick the five s48 ACs in `docs/stories.md`.
     - Add an Execution log to this plan in the s45 format:
       - red and green counts per task;
       - mutations M1–M7 (below);
       - the probe results;
       - declared deviations and test changes;
       - diff scope;
       - the Operator section.
     - One commit, `fix: AI credits are charged once and refunded to their source`. It carries the
       research, this plan and ADR 040.

**Gate (in the worktree, CI placeholder env exported, never at the repo root):**

```bash
colima start && npx supabase start          # then apply pending migrations as in Task 0
RCF_REQUIRE_TEST_DB=1 npx jest --runInBand src/__tests__/db   # real DB suites, never "[gated]"
env -u RCF_TEST_DB_URL node scripts/run-db-invariants.mjs      # every migration on disposable PG14
npm run precommit        # lint + type-check + full jest
npm run format:check
npm run type-check:build
npm run build
```

**Mutations** (each applied alone and restored; TypeScript files are restored with
`/bin/cp -f` and a sha256 check, per s45). Each must fail at least one named test:

- M1: the lock is removed (T2).
- M2: a refund returns the allowance before purchased credits (T1, control-user test).
- M3: a refund is not capped at net `credits_used` (T1, second refund).
- M4: the legacy predicate is keyed on `price_cents = 0` (T7, `migrated_wallet_` guard).
- M5: the translate catch without a refund (T6).
- M6: floor instead of ceil (T6, 1 of 3).
- M7: the key check moved after the charge (T6).

**Task count: 9, plus setup.** It fits. If a task has to move, T5 and T6 become s48b, as in the
research's split proposal. s48b must ship after the receipt, or every translation refund would
mint a row.

## Run interdicts

- **Migrations.** No applied migration is edited, and exactly one new migration is added:
  `git diff main -- supabase/` shows only `20260928110000_atomic_credit_spend_and_refund.sql`.
  It contains no `UPDATE`, `DELETE` or `INSERT` of existing rows, and no RLS, policy or trigger
  change.
- **No SECURITY DEFINER function.** `function-grants.test.ts`, `rls-policies.test.ts` and
  `column-privileges.test.ts` have empty diffs and stay green.
- **s47a's lines in `src/lib/credits/system.ts`.** No changed line falls within `main`'s lines
  121–211 (the body of `getUserCreditBalance`; s47a edits `:200`).
- **`src/lib/billing/effective-plan.ts`.** Only the wallet read at `:527` changes.
- **Unchanged code.** These keep empty diffs:
  - `addPurchasedCredits`, `insertNonExpiringGrant`, `revokePurchasedCredits`,
    `restorePurchasedCredits` and `CREDIT_COSTS`;
  - `canUseAIFeatures` and `canUseTranslation`;
  - the `usage_tracking` insert.
- **Receipts only.** The refund is only ever called with a receipt returned by the charge in the
  same request: `grep -rn "refundCharge(" src/app` shows no argument built from the request body.
  No `refundCredits` symbol remains.
- **Out of scope, with empty diffs:**
  - `src/components/**` (defects 5 and 7, s49);
  - `src/app/api/billing/**`;
  - `src/app/api/webhooks/stripe/**`;
  - `src/lib/stripe/**`;
  - `src/app/api/ab-tests/**`;
  - `src/middleware.ts`.

  No per-text translation pricing, and no change to transaction labels.
- **CI.** `.github/workflows/ci.yml` only gains the one step; its diff shows no removed line.
- **Docs.** `AGENTS.md` has an empty diff (the root's uncommitted edit and any `next dev` block
  stay out). `docs/decisions/035-*` is untouched.
- **Commands.** Never run `supabase db push`, any `--linked` command, or anything against
  production. A local `db reset` needs the lead's approval. Never touch s47a's migration or
  worktree.
- **Suites.** Never delete rows a DB suite did not create. No `test.skip` or `.only`. Never
  `--no-verify`. No push, PR or merge.

## The point everything turns on

**Two numbers must agree: what `spend_credits` draws from the allowance under the lock, and what
TypeScript shows as the allowance.** Both come from one sum, `credit_usage.credits_used` since the
window start. That is why `credits_used` becomes the net charge instead of refunds getting their
own ledger. If that sum is right, a refund restores the allowance with no extra rule, and no
reader can drift. It could be wrong in four places:

- **Window parity.** TypeScript computes the window (`system.ts:192-200`), and SQL sums with
  `>=`. Compare with `system.ts:202-207` (`gte`).
  - T3's contract test pins the exact value passed.
  - T2's straddle race proves the in-lock sum.
  - A reviewer should check the SQL uses the parameter, not `now()` or its own month.
- **Refund algebra.** "The allowance comes back by itself" holds only because the allowance is
  always drawn first and `usedThisMonth` counts purchased-funded usage too (`system.ts:211,216`).
  T1's control-user comparison is the proof; check that both partial cases exist (refund ≥
  purchased share, and refund < purchased share). The derived `outstanding` (Resolved decisions)
  is what makes a second refund correct, and M3 is what shows the cap matters.
- **The JWT path.** Under RLS, `FOR UPDATE` depends on the UPDATE policy
  (`20260731003000_…sql:102-107`), the trigger must only ever see decreases, and a foreign
  `p_user_id` must fail with the function's own message. The authenticated DB tests are the
  contract.
- **The legacy predicate.** It is keyed on the `refund_` prefix, never on price 0, and a NULL
  payment intent counts as paid. T7's guards and M4 are the proof. The reviewer should run the
  operator's count query text against the predicate's definition.

## Files touched

- `supabase/migrations/20260928110000_atomic_credit_spend_and_refund.sql` (new)
- `.github/workflows/ci.yml` (one step)
- `src/lib/credits/system.ts`, `src/lib/credits/spendable.ts`,
  `src/lib/feature-gating/permissions.ts`, `src/lib/billing/effective-plan.ts` (`:527`),
  `src/lib/ai/openai-service.ts`
- `src/app/api/ai/translate/route.ts`, `src/app/api/ai/suggest/route.ts`
- `src/lib/billing/trial.ts` (comment only)
- Tests:
  - new: `src/__tests__/db/credit-spend.test.ts`,
    `src/__tests__/lib/credits/refund-charge.test.ts`,
    `src/__tests__/lib/credits/paid-totals.test.ts`,
    `src/__tests__/lib/billing/lapsed-trial-refund.test.ts`;
  - rewritten: `src/__tests__/lib/credits/concurrency.test.ts`;
  - changed: `src/__tests__/lib/credits/explicit-payer-client.test.ts`,
    `src/__tests__/lib/credits/non-expiring-grant.test.ts`,
    `src/__tests__/lib/feature-gating/permissions.test.ts`,
    `src/__tests__/api/ai/suggest/route.test.ts`,
    `src/__tests__/api/ai/translate/route.test.ts`,
    `src/lib/__tests__/openai-service.test.ts`,
    `src/__tests__/e2e/playwright-ci-contract.test.ts`,
    `src/__tests__/lib/billing/trial.test.ts` (comment only).
- Docs: `docs/decisions/040-credits-spent-and-refunded-in-the-database.md` (new),
  `docs/architecture.md` (`:365`), `docs/stories.md`, `docs/research/s48-credit-integrity.md`,
  this plan.

## Test strategy

- **Money arithmetic and exclusion are database properties**, so they are proved on real
  Postgres:
  - the split, the debit record, refunds to source, the cap, RLS, EXECUTE grants, the trigger
    and the lock namespace;
  - three barrier races and an unsynchronised stress, all asserting conservation (wallet taken =
    recorded purchased usage) and zero refusals while the balance covers them.

  CI runs the suite by name, and a contract test pins that step.
- **The TypeScript side is tested as a contract with the function.** The tests check exact RPC
  arguments, which client is used (payer vs service role), and receipt mapping. No test fakes the
  SQL arithmetic.
- **Entitlement and totals** run through the real resolver and `spendable.ts` over
  production-shaped rows.
- **The routes** are tested at the HTTP boundary for every charge/refund branch.
- **The P3 probe** is proved in three parts:
  - the DB suite shows what a refunded trial leaves behind;
  - the resolver test shows those rows resolve to `none`;
  - the local probe re-run (T9) shows the whole path end to end.

Assertions are on rows, balances, status codes and receipts. Mutations M1–M7 prove the key tests
can fail.

## Definition of Done

- **Tasks.** All ticked, with red observed before each green. Guards are declared, and M1–M7 are
  recorded.
- **Gates.** The gate above is green in the worktree: the DB suites run for real, PG14 applies
  every migration, and lint, type-check, format:check, full jest, `type-check:build` and build all
  pass.
- **Evidence.** The probe re-run matches the expected results.
- **Delivery.** One story commit. No push, PR, merge or production action.

### Operator, after merge (goes in the PR description)

1. **Read-only, before pushing.** Run this on production and record the numbers in the PR:
   ```sql
   SELECT count(*), count(DISTINCT user_id), coalesce(sum(credits_remaining), 0)
   FROM credit_purchases WHERE stripe_payment_intent_id LIKE 'refund\_%';
   ```
   A non-zero count means the T7 predicate is live protection. Zero means it is inert.
2. **Migration first.** Run `npx supabase migration list --linked`, then
   `npx supabase db push --linked --dry-run`. The dry run must list only reviewed migrations:
   `20260928110000`, plus `20260926120000` if s45's is still pending. Then push. Verify with
   `SELECT to_regprocedure('public.spend_credits(uuid,integer,integer,timestamp with time zone,text,jsonb)'),
   to_regprocedure('public.refund_credit_usage(uuid,uuid,integer)');` (both non-NULL).
3. **Then deploy.** Old code keeps working on the new schema. New code without the migration
   fails every AI charge (AI down, nobody overcharged).
4. **Rollback.** Rolling back the code is safe. Rolling back the schema is not, once any refund
   has written a net-0 usage row.

### Ship order with s47a

s48 merges first, and s47a (`feature/s47a-founding-20-grant`, in progress) rebases onto it:

- `system.ts:200`: s47a's one-line window change applies cleanly, because s48 changes no line in
  `:121-211`.
- `effective-plan.ts`: s47a's `resolveEntitlement` offer branch sits beside s48's `:527` wallet
  read. Resolve by keeping both.
- `ci.yml` and `playwright-ci-contract.test.ts`: both stories add a DB step after "Test Founding
  Agency capacity…" and a contract test at the end. s47a's step goes after s48's.
- `CreditBalance` gains `windowStart`: any s47a test that `toEqual`s a whole balance adds it.
- Migrations: s47a's `20260928120000` already sorts after `20260928110000`, so nothing is
  renamed. If s47a ships first instead, s48 re-stamps its migration after `20260928120000` and
  updates the file path T1's re-apply test reads.

## Execution log

2026-09-28, worktree `.omx/worktrees/s48-credit-integrity`, branch `feature/s48-credit-integrity`
from local `main` `f4cef65` (the lead's base; the plan's Task 0 named `934253b`, and `f4cef65`
only adds s50 story docs on top of it). Every command ran with the CI placeholder environment
(`ci.yml:35-80`). Nothing touched production, Stripe or a remote Supabase.

- **Database.** `npx supabase start` from the worktree (colima). `migration list --local` showed
  s45's `20260926120000` applied and s47a's `20260928120000` in the history only (applied from the
  s47a worktree). Per Task 0, nothing was repaired, reverted or reset: `20260928110000` was
  applied with `psql … -v ON_ERROR_STOP=1 -f`, and re-applied the same way after each DB mutation.
  s47a's objects were not touched.
- **Baseline.** Full Jest: 275 suites passed / 2 skipped, 3,572 tests passed / 39 skipped. DB
  suites (`RCF_REQUIRE_TEST_DB=1`): 10 passed / 1 skipped, 64 passed / 3 skipped (the skipped
  suite is the editor-activation one, keyed on `RCF_S29_DB_URL`).
- **Task 1**: red, 22 of 22 failed at the fail-closed `beforeAll` (`spend_rpc` null, 0 columns).
  Green: 22/22. DB suites: 11 passed / 1 skipped, 86 passed / 3 skipped;
  `function-grants`, `rls-policies`, `column-privileges` and `founding-agency-cap` green with
  empty diffs.
- **Task 2**: the race tests went in after T1's green, so their red is mutation M1 (below): 4 of 27
  failed, which were the four barrier tests. Contract test: red 1 of 7, green 7/7. Suite green
  27/27 (about 2.5 s).
- **Task 3**: red, 8 failed:
  - the 4 rewritten `concurrency.test.ts` contract tests;
  - "consumeFeatureUsage passes the charge receipt through";
  - in `explicit-payer-client.test.ts`: the pinned balance, the `spend_credits` contract and the
    window test.

  The guard "collaboration returns no receipt" passed before, as declared. Green: 43/43. The full
  run then failed 2 pinned balances in `lifetime-agency-allowance.test.ts` (deviation 2). After
  that fix: 19/19.
- **Task 4**: red, 7 failed: the 5 `refund-charge.test.ts` tests and the 2 suggest refund
  assertions. Green: 50/50 (refund-charge plus `src/__tests__/api/ai/suggest`).
- **Task 5**: red, 1 failed. Green: 16/16. The partial-failure test is unchanged.
- **Task 6**: red, 9 failed:
  - the 6 new cases;
  - "should handle AI service exception";
  - "should return 500 when AI service fails" and "should handle unsupported language codes".
    These two failed only because the new mock has no `refundCredits`, which the old route called.
    They are green again with their echo assertions unchanged.

  Guards that passed before: "an error before the charge refunds nothing", "every element
  translated: nothing refunded", and the quota-refusal assertion. Green: 24/24.
- **Task 7**: red, 3 failed: "P3 legacy …" (it received `credits`), `totalPurchased` (it received
  1,071 where 1,070 was due), and the history test (it showed the net-0 row). The 6 guards passed
  before. Green: 9/9. `effective-plan.ts` changes on two lines only: the import and `:527`.
- **Task 8**: ADR 040 written. `docs/architecture.md:365` corrected. Tombstones are in the
  `consumeCredits` docstring (P4, no compare-and-swap), in `refundCharge` (P2, P3), in the
  migration header, in the translate route (key check, zero case, partial share, catch) and at
  the legacy predicate.
- **Mutations** (each applied alone and restored; DB ones by re-running the migration file,
  TypeScript ones with `/bin/cp -f` and a sha256 match):
  - M1, the lock removed from `spend_credits` → 4 failed: all three barrier tests (5-round, JWT,
    straddle) and the exact-60 barrier test. The unsynchronised stress survives M1, as expected:
    the row locks alone keep each row conserved, and it has no allowance. It is the P4-shaped
    regression net, not M1's killer. Measured separately under M1: 12 concurrent 5-credit charges
    with a 12-credit allowance drew **60** from it and 0 from the wallet, in 5 of 5 rounds. That
    is the allowance double-draw the research inferred, now measured.
  - M2, a refund returning the allowance before purchased credits → 3 failed: both control-user
    partial refunds, and "two partial refunds equal one refund of their sum".
  - M3, the refund not capped at net `credits_used` → 1 failed: the second full refund (CHECK
    violation).
  - M4, the legacy predicate keyed on `price_cents = 0` → 2 failed: the `migrated_wallet_`
    guard, and the NULL-intent guard, whose fixture is also priced at 0.
  - M5, the translate catch without a refund → 2 failed: "an error after the charge …" and
    "should handle AI service exception".
  - M6, floor instead of ceil → 1 failed (1 of 3).
  - M7, the key check moved after the charge → 1 failed ("AI key missing …").

  All killed. The final re-run is 27/27 and the translate suite is green.
- **Probes** (`.omx/qa-20260927/`, local stack only, `P4_SPENDERS=12 P4_ROUNDS=5`, not committed).
  "Before" is the unmodified `credits-probes.ts` on the 08d1f64 code (`verify-credits` worktree),
  against the same database with this migration applied. It is saved as
  `credits-probes-before-s48-results.txt`. "After" is `credits-probes-s48-results.txt`.

  | | Before (08d1f64) | After (s48) |
  |---|---|---|
  | P2 permanent credit minted | true | **false** |
  | P2 allowance usage still counted | true | **false** |
  | P3 lapsed trial with a refunded failure | `credits` | **`none`** (control `none`) |
  | P4 charged / 12, per round | 11, 7, 7, 6, 8 (21 refused) | **12, 12, 12, 12, 12** (0 refused) |
  | P4 credits lost (taken − recorded), per round | 2, 0, 1, 0, 1 | **0, 0, 0, 0, 0** |

  The s48 copy differs from the original only in its import paths and its two refund calls, which
  became `refundCharge(<the charge consumeFeatureUsage returned>)`. It keeps the original
  `P2.2 after refundCredits(1)` label string, per "change nothing else". Probe user B's two legacy
  `refund_` rows, minted by the before-runs, stayed spendable (purchased 996 = 994 + 1 + 1), as T7
  decides.
- **Gate** (worktree, CI placeholder env; checkpoint after T8 and final run after the last edit,
  same results):
  - `RCF_REQUIRE_TEST_DB=1 npx jest --runInBand src/__tests__/db`: 11 suites passed / 1 skipped,
    **91 tests passed** / 3 skipped (+27, all real, none "[gated]").
  - `env -u RCF_TEST_DB_URL node scripts/run-db-invariants.mjs`: exit 0. PostgreSQL 14.17
    applied every migration, `20260928110000` included, and `column-privileges` passed 14 / 1
    skipped.
  - `npm run precommit`: lint 0 errors (38 inherited warnings, none in touched files),
    type-check clean. Full Jest: 279 suites passed / 2 skipped, **3,620 tests passed** / 39
    skipped (+48 on the baseline).
  - `format:check` and `type-check:build`: clean.
  - `npm run build`: exit 0. The 5 `fetch failed` lines are the placeholder environment's
    catalogue reads, as in s45, and the build changed no tracked file.
- **Diff scope** (vs `main`):
  - `supabase/` = the one new migration;
  - empty diffs for `src/components`, `src/app/api/billing`, `src/app/api/webhooks/stripe`,
    `src/lib/stripe`, `src/app/api/ab-tests`, `src/middleware.ts`, `AGENTS.md`, ADR 035 and the
    three guard DB suites;
  - `ci.yml`: +6 lines, 0 removed.

  In `system.ts`, no changed line falls in `main`'s 121–211. `CREDIT_COSTS`,
  `insertNonExpiringGrant`, `addPurchasedCredits`, `revokePurchasedCredits`,
  `restorePurchasedCredits`, `canUseAIFeatures`, `canUseTranslation` and the `usage_tracking`
  insert are byte-identical to `main` (checked by script). `grep refundCharge( src/app` shows only
  receipts from the same request's charge. No `refundCredits` identifier remains in `src`,
  `supabase`, `scripts` or `.github`.
- **Declared deviations and test changes**:
  1. **`refundCredits` deletion moved from T4 to T6**, together with the non-expiring-grant test
     "refunds survive the same schema gap". The translate route still imported it until T6
     rewrote that route, so deleting it in T4 would have broken the build between tasks. The end
     state is the plan's.
  2. **Two more pinned `CreditBalance` `toEqual`s.** The plan counted one (`explicit-payer-client`
     `:255`). `lifetime-agency-allowance.test.ts:348,365` pin it too, and each gains
     `windowStart: expect.any(String)`. The window is not what those tests are about.
  3. **Existing test changes** (AGENTS.md "Tests"):
     - `explicit-payer-client.test.ts`: `:313` and `:349` were replaced by the one
       `spend_credits` contract test, as planned, and the recording client gained `rpc`.
     - `concurrency.test.ts` was rewritten. Its fake compare-and-swap tests were deleted, as
       planned.
     - The suggest refund assertions now expect `refundCharge(RECEIPT)`. The mocked charge now
       returns `RECEIPT`, and the stale "a refund is a fresh non-expiring grant" comment in the
       gate-throws test was reworded.
     - The translate test's quota-refusal and exception tests gained refund assertions. Its
       credits mock is new.
  4. **Translate zero case, `{ success: true, data: [] }`.** The 500 echoes `result.error`, which
     is undefined there, so the route answers `result.error ?? "No text could be translated."`.
     A failed batch still echoes its own error, so "should return 500 when AI service fails" is
     unchanged.
  5. **The refund's `to_purchased`** reports the purchased share of the refund. If a row cap
     absorbs part of it (a row already back at `credits_purchased`), the row stays capped, and
     the pinned test only asserts the row.
  6. **`consumeCredits` has no TypeScript pre-check any more.** The function decides, and
     `remainingCredits` is the function's `remaining` instead of a second balance read. An RPC
     error, a missing row or an unknown outcome answers "Failed to charge credits".
  7. **`refundCharge` also refuses an amount above the receipt's credits**, and `NaN`, in the same
     "without calling the database" test. The plan listed 0, negative, fractional and "more than
     the charge"; `NaN` is extra.
  8. **Code comments name "the old owner-keyed refund"** instead of the removed identifier, so
     that the interdict grep finds nothing. ADR 040 and the research keep the historical name.
- **Operator**: see "Operator, after merge" above, unchanged. Run the read-only `refund_` count
  first. Then apply `20260928110000` before deploying, and never roll the schema back once a
  refund has written a net-0 row.
