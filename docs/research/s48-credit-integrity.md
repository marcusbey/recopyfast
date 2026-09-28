# Research — Story s48-credit-integrity

Evidence base: the credit purchase verification `.omx/qa-20260927/REPORT.md` (defects 1–3), its
reproduction scripts (`credits-probes.ts`, `translate-refund-route.mjs`) and results
(`credits-probes-results.txt`, `credits-race-{2,3}-results.txt`, `translate-refund-evidence.json`,
`next-dev-refund.log`). Every file:line claim in the report was re-read against `main` `934253b`;
all of them still resolve (the report ran on `08d1f64`, and no later commit touches these files).
Line numbers below are current `main`.

## The five structuring facts

1. **The loss is a partial apply followed by a full restart.** `deductPurchasedCredits` applies
   one compare-and-swap per purchase row (`src/lib/credits/system.ts:392-409`). On a collision it
   restarts with the full amount (`:357`, `:371`) and never undoes the rows it already
   decremented. After 8 collisions it refuses (`:339`, `:416`), and that refusal keeps its partial
   decrements too. Only a spend that spans several rows can leak. Measured: 12 at once lost 2–9
   credits per round and refused 3–6 affordable requests; 2 at once lost nothing
   (`credits-probes-results.txt` P4, `credits-race-2-results.txt`).
2. **Nothing records where a charge came from.** The usage row stores `credits_used` only
   (`supabase/migrations/20260731003000_missing_tables_billing_credits.sql:137-145`).
   `consumeCredits` returns `{success, remainingCredits}` (`system.ts:445,493`). All three refund
   sites pass `(userId, fixed cost)`. So `refundCredits` can only mint a new never-expiring
   "purchased" row (`system.ts:572-578`).
3. **A minted row is an entitlement.** Any positive purchased balance resolves to `credits`
   (`src/lib/billing/effective-plan.ts:527-529`), and that passes the paywall
   (`src/middleware.ts:44,171`). Probe P3: a trial that lapsed without paying, with one refunded
   failure, resolved to `credits`. The control account resolved to `none`.
4. **Translation never reports failure.** Three reasons:
   - `translateText` swallows every error (`src/lib/ai/openai-service.ts:98-104`);
   - `batchTranslate` always returns `success: true` with only the rows that worked (`:192-202`);
   - so the route's refund (`src/app/api/ai/translate/route.ts:217-226`) is dead code, the
     catch (`:264-270`) never refunds, and no key check happens before the charge (`:190`),
     unlike suggest (`src/app/api/ai/suggest/route.ts:253-260`).
5. **The DB function must leave entitlement in TypeScript and keep both callers.**
   - ADR 035 rejected a SQL spend function because it would copy the plan and window rules into
     SQL, and the two would drift (`docs/decisions/035-widget-ai-charged-to-site-owner.md:59-62`).
     It relied on the compare-and-swap being safe, which P4 disproves.
   - Spenders run in two ways: as the service role (suggest) and as the user's JWT under RLS plus
     the "may only decrease" trigger (`20260731003000_…sql:89-124`).
   - The house rule forbids any `SECURITY DEFINER` function that `authenticated` can execute
     (`src/__tests__/db/function-grants.test.ts:1-12`, filter `prosecdef` at `:133`).
   - Therefore: a `SECURITY INVOKER` function that takes the allowance and window start computed
     in TypeScript as parameters.

## Target story

Every AI charge is exact under concurrency. A failed AI call costs nothing net. A refund goes
back to where the credits came from, so a refund can never create a paid-looking balance or
keep an account past the paywall. Out of scope: per-text translation pricing (defect 8) and the
credit-card display fixes (defects 5 and the display half of 7).

Acceptance criteria (`docs/stories.md`, "Story s48-credit-integrity"):

- A translation that translates nothing charges nothing net and reports failure. A partial batch
  returns the failed share. An error after the charge returns the charge. The key is checked
  before charging.
- A refund returns to its source: allowance to allowance, purchased to purchased. It never
  creates a purchased row. A lapsed trial that never paid resolves to `none` whether or not it
  had a refunded failure.
- N simultaneous charges debit exactly the sum of the successful ones. No request is refused
  while the balance covers it. The deduction is one DB function, proved on real Postgres by a
  concurrency test that CI runs (12 at once, repeated).
- "Total purchased" counts paid credits only.
- Local gates pass in a worktree. One story commit. Operator: migration first, then deploy.

## Current state of the code

**Spend path, end to end.** A route calls
`consumeFeatureUsage(userId, feature, metadata, client?)` (`src/lib/feature-gating/permissions.ts:485`).

- It takes the cost from `CREDIT_COSTS`: 1 for a suggestion, 5 for a translation
  (`permissions.ts:494-498`, `system.ts:32-37`).
- It gates the call:
  - `canUseAIFeatures` (`permissions.ts:384-430`) checks entitlement through
    `resolvePayerEntitlement` (`:90`), then `balance.total ≥ cost`.
  - `canUseTranslation` (`:432-474`) lets a plan with a translation allowance through without
    checking the balance. The pay-per-use branch checks `total ≥ 1`, not 5 (`:452-458`).
- It then calls `consumeCredits` (`system.ts:439-494`), which:
  1. reads the whole balance (`:447`): entitlement, subscription, purchases, trial and usage, so
     five reads;
  2. pre-checks the total (`:449-454`);
  3. splits the charge (`:456-461`): purchased part = cost − max(0, included − used). A negative
     purchased part is a no-op at `:353`;
  4. runs `deductPurchasedCredits` (`:463-470`);
  5. **then**, in a second round trip, inserts the usage row with `credits_used = cost`
     (`:472-477`);
  6. if that insert fails, mints a refund for the purchased part (`:479-488`), which is a third
     minting site;
  7. reads the balance again for `remainingCredits` (`:491`), which ab-tests returns to the
     client (`src/app/api/ab-tests/generate/route.ts:222`).
- Finally it inserts `usage_tracking`, unchecked (`permissions.ts:522-530`).

**Callers of the spend.**

| Route | Payer and client | Charge | Refund |
|---|---|---|---|
| `/api/ai/suggest` | Site owner, service role (ADR 035) | `suggest/route.ts:274-295` | `:318-319`, catch `:337-338` |
| `/api/ai/translate` | Caller, cookie/JWT client | `translate/route.ts:190-207` | `:220-224` |
| `/api/ab-tests/generate` | Caller, cookie/JWT client | `consumeCredits` after generating, `generate/route.ts:97,129-138` | None needed |

**How allowance and purchased credits are split.**

- The allowance is not stored. It is computed: `included` comes from
  `entitlement.plan.limits.monthlyCredits` (`system.ts:139-143`). This covers s45's lifetime 250
  and the ADR 038 floor.
- `usedThisMonth` is the sum of `credit_usage.credits_used` since the window start
  (`:202-211`). The window start is:
  - the live subscription's period start, subdivided for annual plans (`:193-199`);
  - else the active trial's `granted_at` (`:200`);
  - else the calendar month (`:231-236`).
- Purchased = the sum of `credits_remaining` over spendable rows (`credits_remaining > 0`,
  `expires_at` NULL or in the future) (`src/lib/credits/spendable.ts:18-53`).
- `usedThisMonth` also counts purchased-funded usage. That is consistent only because the
  allowance is always drawn first: total = max(0, included − used) + purchased (`system.ts:216`).

**Guards on the credit tables** (`20260731003000_…sql`).

- `credit_purchases` (`:66-77`) has these checks and policies:
  - CHECK `credits_purchased > 0 AND credits_remaining >= 0`;
  - authenticated users can SELECT their own rows (`:89-93`) and UPDATE their own rows
    (`:102-107`), and have no INSERT policy;
  - the trigger `enforce_credit_purchase_monotonicity` rejects any increase unless
    `current_user` is `service_role`, `postgres` or `supabase_admin` (`:109-124`);
  - `service_role` has ALL (`:127-133`).
- `credit_usage` (`:137-145`) has CHECK `credits_used > 0` (`:144`). Authenticated users can
  SELECT and INSERT their own rows (`:153-167`). They have no UPDATE or DELETE.
- No later migration changes grants on either table. The column-privilege suite does not cover
  them (`column-privileges.test.ts:366`).

**Refund path.**

- `refundCredits(userId, credits, reason)` (`system.ts:558-586`) always inserts a row with
  `price_cents: 0`, never expiring, keyed by a made-up id `refund_${reason}_${userId}_…`
  (`:577`). This is the only writer of the `refund_` prefix.
- Callers:
  - suggest `refundOwner` (`suggest/route.ts:144-158`), after a provider failure and in the
    catch;
  - translate (`translate/route.ts:220-224`), unreachable (fact 4);
  - `consumeCredits` after a failed usage insert (`system.ts:482-486`).
- None of them knows the source of the charge. P2 measured the result: an allowance-funded
  suggestion, once refunded, still counts in `usedThisMonth` **and** adds one purchased credit
  (`credits-probes-results.txt` P2.2).

**Other writers of `credit_purchases`.**

- `addPurchasedCredits` is called only from `payment_intent.succeeded` for a credit pack
  (`webhooks/stripe/route.ts:1041-1046`). The credit-pack checkout has no promotion codes
  (`src/lib/stripe/checkout.ts:303-337`; `allow_promotion_codes` appears only for subscription
  and lifetime checkouts, `:277,397`), so the price is always positive.
- `revokePurchasedCredits` sets a row to 0 (`system.ts:643-646`).
- `restorePurchasedCredits` raises a row in place, capped at `credits_purchased`
  (`:691-703`).
- Tickets carried over in `20260802020000_…sql:119-130` are paid wallets, recorded with price 0
  and the id prefix `migrated_wallet_`.
- No admin or comp path writes credits. A grep of `src/`, `scripts/` and `server/` finds none;
  comps are `plan_entitlements` rows.

**Totals.** `getCreditWallet.totalPurchased` sums `credits_purchased` over every row, refund
rows included (`system.ts:740-741`). `getCreditTransactions` labels any row with price 0 as a
refund, "Credits granted" (`:780-786`), and that includes migrated wallets. Changing the label
is display work, out of scope.

**Translation.**

- `batchTranslate` (`openai-service.ts:164-211`) runs every element through `Promise.all`
  (`:173-190`). Each `translateText` failure comes back as `success: false` (`:98-104`) and is
  never thrown.
- It then returns `success: true, data: successful rows only` (`:192-202`). The number of
  failures can be derived as `elements.length − data.length`.
- The route charges a flat 5 for up to 100 elements (`translate/route.ts:24,190`). It passes
  `result.error` through to the dashboard (`:225`), which displays it
  (`src/components/dashboard/TranslationDashboard.tsx:102-110`).
- Proof: with the key missing the route answered 200 with "Successfully translated 0 elements"
  and took 5 credits (`translate-refund-evidence.json`, `next-dev-refund.log:20-48`).

## Anchor points

- **New migration** `supabase/migrations/20260928110000_atomic_credit_spend_and_refund.sql`. The
  latest migration is `20260926120000_lifetime_agency_monthly_credits.sql`; see the s47a
  timestamp note under Traps. It contains:
  - `credit_usage` columns recording the source of each charge (shape under Traps);
  - `spend_credits(...)` (`SECURITY INVOKER`, executable by `authenticated` and `service_role`);
  - `refund_credit_usage(...)` (`SECURITY INVOKER`, executable by `service_role` only).
  - Precedent: `activate_site_editor` (`20260924000000_atomic_editor_activation.sql:11-89`),
    which uses INVOKER, `pg_advisory_xact_lock`, `SET search_path = public, pg_temp`, and
    REVOKE/GRANT.
- **`src/lib/credits/system.ts`**:
  - `consumeCredits` (`:439-494`) becomes a call to the balance function (to get
    `included` and the window start) followed by `.rpc("spend_credits")` through the same
    client. It returns a charge receipt (usage id plus split).
  - Delete `deductPurchasedCredits` and `MAX_DEDUCT_ATTEMPTS` (`:339-417`).
  - Replace `refundCredits` (`:550-586`) with a receipt-keyed refund that calls the refund
    function through the service role.
  - `getCreditWallet` totals (`:740-743`).
  - `getUserCreditBalance` must expose the window start it already computes (`:192-200`).
- **`src/lib/feature-gating/permissions.ts:485-532`**: `consumeFeatureUsage` passes the receipt
  through. Its argument lists must not change, because the suites pin them (see Traps).
- **`src/lib/credits/spendable.ts`**: one predicate for "legacy refund row"
  (`stripe_payment_intent_id` prefix `refund_`), used by the entitlement read and by the totals.
- **`src/lib/billing/effective-plan.ts:527`**: the entitlement wallet read counts paid rows only.
- **`src/app/api/ai/suggest/route.ts:144-166,295,318-319,337-338`**: refund by receipt instead of
  by owner id.
- **`src/app/api/ai/translate/route.ts:176-270`**:
  - check the key before the charge (copy `suggest/route.ts:253-260`);
  - keep the receipt from the charge;
  - zero translations: full refund and a failure response;
  - partial batch: refund the failed share;
  - catch: refund if a charge was made.
- **`src/lib/ai/openai-service.ts:192-202`**: return `success: false` when nothing was
  translated.
- **`.github/workflows/ci.yml:259-289`**: add a step that runs the new DB suite by name.
- **ADR 040** (s47a takes 039). Correct `docs/architecture.md:365`, which says "credit spend is
  compare-and-swap".

## Verified APIs / functions

- `consumeCredits(userId: string, credits: number, operation: string, metadata?: Record<string, unknown>, client?: SupabaseClient): Promise<{ success: boolean; error?: string; remainingCredits?: number }>`: `system.ts:439-445`.
- `consumeFeatureUsage(userId, feature: "ai_suggestion" | "translation" | "collaboration", metadata?, client?): Promise<{ success: boolean; error?: string }>`: `permissions.ts:485-490`.
- `canUseAIFeatures(userId, creditsRequired = 1, client?)`: `permissions.ts:384`.
  `canUseTranslation(userId, client?)`: `:432`.
- `getUserCreditBalance(userId, client?): Promise<CreditBalance>`: `system.ts:121`.
  `CreditBalance = { included, purchased, total, usedThisMonth }` (`:39-44`).
- `refundCredits(userId, credits, reason): Promise<{ success; error? }>`: `system.ts:558`.
- `revokePurchasedCredits(pi)` (`:633`), `restorePurchasedCredits(pi, credits)` (`:676`),
  `addPurchasedCredits(userId, credits, pi, priceCents?)` (`:512`).
- `readPurchasedCreditBalance(supabase, userId): Promise<number>` and `spendableFilter()`:
  `spendable.ts:21,32`.
- `resolveEntitlement(supabase, userId): Promise<Entitlement>`: `effective-plan.ts:508`.
  `hasAnyEntitlement` (`:177`). `readTrialGrant` (`:92`).
- `startOfCurrentAllowanceWindow(periodStart, now?)`: `system.ts:273` (s47a reuses it).
- `aiService.batchTranslate(elements, from, to, context?): Promise<AIResponse<{id, originalText, translatedText}[]>>`: `openai-service.ts:164`.
- Supabase clients are untyped (`createClient` without a `Database` generic,
  `src/lib/supabase/service.ts`). `.rpc("name", args)` needs no type regeneration (precedent
  `src/lib/billing/founding-agency.ts:174`).
- The PG14 bootstrap provides `auth.uid()` and `auth.jwt()` from `request.jwt.claims`
  (`scripts/db/bootstrap-supabase-fixtures.sql:40-68`), and `service_role` has `BYPASSRLS`
  (`:16`).

## Traps & constraints

- **Design choice (answers point 1).** Pass `(p_user_id, p_credits, p_included,
  p_window_start, p_operation, p_metadata)` to a `SECURITY INVOKER` function.
  - Under `pg_advisory_xact_lock(hashtextextended('credits:' || p_user_id, 0))` it:
    1. sums `credits_used` since `p_window_start`;
    2. takes `from_allowance = LEAST(p_credits, GREATEST(0, p_included − used))`;
    3. locks spendable purchase rows oldest first (`ORDER BY created_at, id FOR UPDATE`, matching
       `system.ts:364`);
    4. returns "insufficient" without writing anything if those rows do not cover the rest;
    5. otherwise decrements them *relatively* and inserts the usage row;
    6. all in one transaction.
  - This keeps:
    - **both callers**: INVOKER means the JWT caller is still limited by RLS, and the service
      role still bypasses it. Add
      `IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN RAISE`, so a mismatch fails
      loudly instead of looking like "insufficient".
    - **the trigger, unchanged**: a spend only ever decreases.
    - **the spend order**: allowance first.
    - **ADR 035's objection**: no plan or window rule enters SQL.
  - Direct RPC calls are harmless. A JWT caller who inflates `p_included` only writes usage rows
    for itself and debits less of its own wallet. No AI output is produced, and it can already
    INSERT its own usage rows (`:162-167`).
  - Do **not** make it `SECURITY DEFINER`. `function-grants.test.ts` would fail, since
    `authenticated` may execute only the three RLS predicates.
- **The lock key must be namespaced.** Checkout already locks on the bare
  `hashtextextended(p_user_id::text, 0)` (`20260924020000_…sql:36`,
  `20260924050000_…sql:49`, `20260925100000_…sql`). Reusing that key would make every AI
  charge queue behind that user's checkout claims. Webhook revoke and restore take row locks
  only, and spend always takes the advisory lock before any row lock, so there is no deadlock
  cycle.
- **The allowance race is real but unmeasured.** P4 used accounts with no allowance
  (included = 0). By reading `system.ts:447-461`: two concurrent charges both see the same
  remaining allowance and both draw it, so the customer is under-charged. The lock fixes this
  too. The DB test must include a case where the charges straddle the end of the allowance.
- **Return to source: recommended data shape.** On `credit_usage`, add:
  - `credits_from_purchased INT NOT NULL DEFAULT 0`;
  - `purchase_debits JSONB NOT NULL DEFAULT '[]'` (`[{purchase_id, credits}]`);
  - `credits_refunded INT NOT NULL DEFAULT 0`.

  Relax `credit_usage_positive` to `credits_used >= 0` and let `credits_used` hold the **net**
  amount. A refund lowers `credits_used` and raises `credits_refunded`. Consequences:
  - Every existing reader keeps working unchanged: the TypeScript window sum (`system.ts:202-211`),
    the in-lock SQL sum, and `totalConsumed` (`:727-743`). The allowance comes back
    automatically. No reader can drift.
  - The window lines s47a edits stay untouched.
  - A refund returns purchased credits **first**, into the recorded rows, in place, capped at
    `credits_purchased`, under the service role (the trigger allows it, as
    `restorePurchasedCredits` already relies on). Then it returns allowance. This is the exact
    reverse of the spend order: the wallet ends as if only the kept share had been charged.
    Verified algebraically for full and partial refunds.
  - The refund amount is capped at the usage row's net `credits_used`, so running a refund
    twice (provider failure plus catch) can never over-refund.
- **The refund function is service-role only.** It must never take a usage id from a request
  body. Routes pass the receipt they got back from the charge in the same request. Even a usage
  row forged by a user (JWT INSERT) is then never refunded.
- **Remaining race.** A dispute could revoke a pack between the charge and the refund, a gap of
  seconds. The refund would then put up to 5 credits back into a pack that was clawed back.
  Accept this and note it in the ADR.
- **Data migration (answers point 2): none. Use a forward rule plus one read-side predicate.**
  - New code never inserts a refund row.
  - Legacy `refund_` rows (their only writer is `system.ts:577`) stay spendable. We cannot tell
    which of them made up for purchased credits, because the source was never recorded, and
    zeroing them could take away value someone paid for.
  - They stop counting in two places: "Total purchased", which AC 4 requires for existing rows
    too, and the entitlement read at `effective-plan.ts:527`. A lapsed account holding only
    free refund credits therefore falls to `none`, with no data rewritten.
  - Key the predicate on the `refund_` prefix, **not** on `price_cents = 0`: migrated
    `migrated_wallet_` rows are paid and also have price 0.
  - Operator, before planning (not run here: no production access in this story):
    `SELECT count(*), count(DISTINCT user_id), coalesce(sum(credits_remaining),0) FROM credit_purchases WHERE stripe_payment_intent_id LIKE 'refund\_%';`
- **Free purchased credits after the fix (answers point 3): none from any live path.**
  - Credit packs are always paid (`checkout.ts:303-337`).
  - Restore is in place and capped (`system.ts:691-694`). Revoke only lowers (`:643-646`).
  - s45's 250 is an allowance limit, not rows (`system.ts:142-143`).
  - Comps grant plans only.
  - s47a's 100/month is also a limit and reaches the function as `p_included`.
  - What remains is legacy rows only, handled by the predicate above.
- **Translation (answers point 4). The smallest change:**
  - `batchTranslate` returns `success: false` when `data.length === 0` (`openai-service.ts:198`).
  - The route:
    - checks the key before `consumeFeatureUsage` and answers 503;
    - keeps the receipt;
    - on `!success`, refunds the whole charge (the existing 500 branch, `:217-226`);
    - on a partial batch, refunds `failed/total` of 5;
    - in the catch, refunds when a charge was made (the `chargedOwnerId` pattern from
      `suggest/route.ts:160-165`).
  - Existing contracts that stay valid: "should return 500 when AI service fails" (with its
    echoed error) and the partial-failure test in `openai-service.test.ts` (`batchTranslate` →
    "should handle partial failures", which asserts `success: true` with 1 row).
- **Tests that change.**
  - `src/__tests__/lib/credits/concurrency.test.ts`: fake-client CAS tests at `:268` and the
    same-millisecond refund test at `:329`. Replace them with the RPC contract; the DB suite
    becomes the concurrency proof.
  - `explicit-payer-client.test.ts:255`: pins the full `CreditBalance` with `toEqual`, so adding
    `windowStart` breaks it. `:349` asserts the compare-and-swap through the client.
  - `non-expiring-grant.test.ts:120`: "refunds survive the same schema gap", which becomes moot.
  - `api/ai/suggest/route.test.ts:731,760`: assert `refundCredits(owner, 1, "ai_suggestion_failed")`.
  - `api/ai/translate/route.test.ts` does **not** mock `@/lib/credits/system` (`:1-19`). Its
    failure test calls the real `refundCredits` against a placeholder service client, and that
    fails silently. New refund assertions need the mock.
  - `permissions.test.ts:306-340,463-470` compare `consumeCredits` argument lists (s40's promise
    that the cookie path does not move). Keep the signature; only the return value grows.
  - `jest.setup.js:161` sets `OPENAI_API_KEY`, so the new key check passes by default.
- **DB test infrastructure (answers point 5).**
  - `describeDb` registers the real tests only when a ReCopyFast database answers the probe.
    `RCF_REQUIRE_TEST_DB=1` makes a missing database fatal (`src/__tests__/db/db-harness.ts:272-290`).
  - Copy `founding-agency-cap.test.ts`:
    - it fails closed when its migration is absent (`:27-63`);
    - it runs a barrier test (`:157-251`): hold the function's own advisory key, wait until N
      backends are waiting, release, then assert.
  - For the JWT path, use `SET LOCAL ROLE authenticated` with `request.jwt.claims`
    (`column-privileges.test.ts:438-443`).
  - Cover:
    - 12 at once over multi-row wallets, repeated, with conservation (wallet taken = recorded
      usage) and zero refusals;
    - the allowance-straddle case;
    - both roles;
    - full and partial refund to source;
    - the trigger still refusing a self-refill;
    - EXECUTE: `anon` gets neither function, `authenticated` cannot run the refund.
  - Apply the migration twice (precedent: editor-activation suite).
  - **CI runs DB suites only by name.** The e2e job runs `founding-agency-cap.test.ts`
    (`ci.yml:259-289`). `scripts/run-db-invariants.mjs` applies every migration on bare
    PostgreSQL 14 but runs only `column-privileges.test.ts` (`:175-177`), so the migration must
    parse on PG14 (no PG15-only syntax) and on the local stack's PG15 (`supabase/config.toml:28`).
    The editor-activation suite is keyed on `RCF_S29_DB_URL` and does not run in CI; do not copy
    it.
- **Local gates.**
  - Run `npm run precommit`, `format:check`, `type-check:build`, `build`, then
    `npx jest src/__tests__/db` against the local Supabase.
  - Local Supabase has not had s45's `20260926120000` applied, so apply the pending migrations
    first.
  - Run the gates **in a worktree**: `next/jest` loads the repo-root `.env`, whose production
    `NEXT_PUBLIC_APP_URL` breaks the origin suites.
  - `next dev` appends a block to `AGENTS.md` (`REPORT.md:118`). Revert it before committing.
  - Re-run `credits-probes.ts` P2–P4 locally as the before/after proof. It refuses any
    non-local target.
- **Deploy order.** Migration first, as the story says:
  - Old code keeps working on the new schema: it ignores the new columns, and relaxing the
    CHECK breaks nothing.
  - New code before the migration would fail every AI charge, because the function would be
    missing.
  - Rolling back the code is safe.
- **Interaction with s47a (answers point 6).**
  - Overlap is small:
    - s47a changes one expression, `trial.grantedAt` → `startOfCurrentAllowanceWindow(...)` at
      `system.ts:200` (`docs/research/s47a-founding-20-grant.md:158`);
    - s47a adds an offer branch inside `resolveEntitlement`; s48 edits the wallet read at `:527`
      of the same function;
    - s47a's 100/month and monthly windows reach `spend_credits` as parameters, so s47a needs
      **no SQL change** from s48's design.
  - s48 must not move lines `:139-200`. It only exposes the computed window start (add
    `windowStart` to the return value, or use an internal variant).
  - **Migration order.** The s47a plan now uses `20260928120000_founding_offer.sql`
    (`docs/plans/s47a-founding-20-grant.md:140,438`). Two files with the same version would
    collide in the migration history, so s48 takes **`20260928110000`**, which sorts before
    s47a's.
    - s48 ships first (recommended): nothing is renamed.
    - s47a ships first: s48's file would sort before an applied migration. `supabase db push`
      refuses that without `--include-all`, so s48 would have to re-stamp after `20260928120000`.
    - Rule: the story that ships second must carry the later stamp.
- **ADR 040.** "Credits are spent and refunded by database functions; a refund returns to its
  source." It covers:
  - INVOKER rather than DEFINER, and why;
  - the allowance terms passed in from TypeScript;
  - the namespaced lock;
  - the net `credits_used` plus the debit record;
  - refunds going purchased first, in place, service-role only;
  - legacy refund rows not counting as entitlement or as purchases;
  - migration-first deploy.

  It supersedes ADR 035's rejected alternative, whose premise that "the compare-and-swap
  already makes the spend safe" (`035:59-62`) P4 disproves. It is a superseding ADR, not an
  errata entry, because the conclusion changes.

## Open questions

1. **Partial-refund rounding** at a flat 5 credits per request. Recommendation:
   `ceil(5 × failed / total)`, which favours the customer and costs at most 1 credit of rounding.
   Defect 8 (per-text pricing, out of scope) will remove the question later.
2. **The translate failure message.** Keep the 500 with the error echoed (minimal change, tests
   unchanged), or adopt suggest's 502 "You were not charged" and log the provider error (s40
   precedent, changes two tests). Recommendation: keep the echo in this story.
3. **Legacy predicate on entitlement.** Recommended yes. The operator's count query decides
   whether it is dead code (0 rows) or live protection.
4. **The window-start seam.** Add `windowStart` to `CreditBalance` (updates
   `explicit-payer-client.test.ts:255`), or add an internal reader. Either way, `:192-200` stays
   in place for s47a.
5. Out of scope, noted: refunded requests still write `usage_tracking`, which feeds UsageCard
   (defect 5). No edit-session route checks for a plan (REPORT defect 2, "raise to high if…").
   That was not tested here.

## Real complexity

The story scores it 4. **I agree: 4, at the top of the band.** It has:

- one migration with two functions whose subtlety is in the locking and RLS;
- one data-shape decision (net usage plus debit record);
- four TypeScript seams: spend, refund, entitlement/totals and translation;
- six unit suites to update;
- one new DB suite and a CI step;
- ADR 040.

It avoids scoring 5 only because the design keeps all entitlement and window logic in
TypeScript. Moving any of it into SQL would be a 5.

Estimate: **9–10 tasks**.

1. migration;
2. DB suite and CI step;
3. spend RPC wiring and receipt, with the unit suites;
4. receipt refund, with the suites;
5. suggest route;
6. `batchTranslate`;
7. translate route;
8. legacy predicate: entitlement and totals;
9. ADR 040 and architecture correction;
10. gates plus the probe re-run in a worktree.

## Split proposal

Not required at 4 with at most 10 tasks. If the plan goes over ten, cut at the receipt API:

- **s48a (3).** Atomic spend, refund to source, legacy predicate, DB suite and CI step,
  ADR 040. Closes defects 2 and 3.
- **s48b (2).** Translation failure and partial refunds, plus the key check. Closes defect 1.
  It depends on s48a's receipt; shipped before it, every translation refund would mint another
  free row.

**Ship order: s48 before s47a.** s48 is the money-path fix that s47a's lapsed offer accounts
depend on, per both stories. s47a then rebases two things: its one-line window change (clean)
and an adjacent hunk in `resolveEntitlement`. Its migration `20260928120000` already sorts after
s48's `20260928110000`.
