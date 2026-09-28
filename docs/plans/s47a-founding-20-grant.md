---
validated: yes
---

# Plan — Story s47a-founding-20-grant

Branch: `feature/s47a-founding-20-grant`
Research: `docs/research/s47a-founding-20-grant.md` — read it first; this plan does not repeat it.
Its landing sections (Hero, Pricing, FinalCTA, the landing hook, `trial-claims`, `landing.spec`)
belong to s47b and are out of scope here.
Design: `docs/designs/s47a-founding-20-grant.md` — **not written yet** (owner, Claude Design).
Task 9 is blocked until it exists; Tasks 1–8 do not depend on it.

## Target story

For the first 20 accounts created after the offer opens, the first sign-in grants Pro for 90
days, metered at 100 AI credits a month, no card. Account 21 onward gets today's 14-day trial.
At day 90 the account lapses like a trial and sees offer-aware copy, then the plans.

Owner decisions, not reopened here:

- **Representation.** The grant is the account's one trial row: `source = 'trial'`,
  `plan_id = 'pro'`, `expires_at = claim + 90 days` (DB clock), no payment intent, marked by a
  new `plan_entitlements.offer_id = 'founding_20'`.
- **Claim.** One SECURITY DEFINER function takes its own advisory-lock key and writes the trial
  row and the claim row in one transaction.
- **Eligibility.** `auth.users.created_at >= the moment the offer opened` (recorded by the
  migration), and no `plan_entitlements`, `billing_subscriptions` or `credit_purchases` row ever.
- **Release** sets `revoked_at` only.
- **Order.** The migration is applied before the deploy.
- **Lapsed copy.** A lapsed offer account reads "Your founding offer has ended…", then the plans.
- **UI last.** UI tasks come last and stay at copy/props level.

Acceptance criteria → tasks (every AC has a named test):

| AC (docs/stories.md s47a) | Tasks |
|---|---|
| 1 Offer grant IS the one trial row; never a second, 14-day trial | T1, T5 |
| 2 Exactly 20 spots, one transaction, real-Postgres concurrency test run by CI | T1, T2 |
| 3 Eligibility; repeat sign-in never claims; any failure → 14-day trial, sign-in never fails | T1, T3, T5 |
| 4 Every Pro limit, 100/month in windows anchored on the grant, ADR 038 floor, packs on top | T4, T5 |
| 5 After 20 claims, first sign-in = 14-day trial, 500 credits, nothing else changes | T1, T5 |
| 6 Day 90 → lapsed state; "founding offer has ended" copy; plans offered; no card | T5, T6, T9 |
| 7 Badge and billing card: "Founding offer — N days left", "N of 100 AI credits used this month" | T6, T9 |
| 8 Public, uncached count endpoint; no user data; correct right after claim/release; no guess on error | T1, T7 |
| 9 Operator release, service-role only, runbook; `revoked_at` only; count goes back up | T1, T8 |
| 10 ADR 039 | T8 |
| 11 Gates in a worktree; one commit; migration-first operator order | T8, T10 |

## Resolved open questions

1. **Where 100, 20 and 90 live.** Each number lives in exactly one place:
   - **20** and **90** are constants in the SQL claim function, where the grant is written under
     the lock on the DB clock. Precedent: 50 in `reserve_founding_agency_spot`.
     `get_founding_offer_availability()` returns `spot_limit`, so TypeScript never restates 20.
   - **100** is `FOUNDING_OFFER_TERMS.founding_20.monthlyCredits` in
     `src/lib/billing/founding-offer.ts`, keyed by `offer_id` and read by the resolver.

   Why: it is a trial term like `TRIAL_DURATION_DAYS` (ADR 014), not a catalogue product.
   A `plans` row cannot carry it, because a second product granting `pro` makes
   `loadPlanCatalogue` throw. A per-grant `monthly_credits` column is the per-entitlement
   limits column ADR 038 rejected.
2. **"Brand-new"** is settled by the owner (see above). A NULL `auth.users.created_at` counts as
   ineligible (fail closed).
3. **Lapsed copy** is settled: offer-aware, from `endedOfferId` in the dashboard payload (T6),
   copy in T9.
4. The landing layout is s47b.
5. **Rate limit on the count route: yes.** `enforceRateLimit` with the `IP_GENERAL` preset,
   endpoint `offers/founding:ip`, `onStoreFailure: "allow"`. Why: the route is uncached by
   contract, so every hit is a service-role DB read, and a per-IP limiter is the only brake. A
   public read fails open (AGENTS.md "API routes"), and its own failure mode (no number) is
   already safe.
6. **Partial fourth allowance window: accept it, don't cap it.** It is pinned by a test.
   - When it happens: only for anchors from Jan 31 to Feb 28 of a non-leap year, where three
     months total 89 days.
   - What it gives: one extra 100-credit window lasting about a day before expiry. That is at
     most 100 credits per account and 2,000 across all 20 accounts.
   - Why not cap: a cap would add a second window rule to the credit system every trial uses,
     for about one day of exposure.

## Tasks (ordered)

0. **Setup (not a task, no test).** Create the story worktree with `/new-feature`
   (`feature/s47a-founding-20-grant` from `origin/main`; precedent path
   `.omx/worktrees/<id>`). Run `npm run setup` there.
   - Copy in the untracked `docs/research/s47a-founding-20-grant.md` and this plan. Copy the s47a
     design doc too, once it exists. The shared `s47-founding-20-offer-brief*` stays out.
   - **Never copy the root `.env`**: it sets a production `NEXT_PUBLIC_APP_URL` that breaks
     suites reading it.
   - Export the CI placeholder environment (the `env:` block of the `Lint, Test & Build` job,
     `.github/workflows/ci.yml:35-80`) for every command.
   - Bring the database up:
     ```bash
     npx supabase start
     npx supabase migration list --local
     npx supabase migration up --local
     ```
     `migration list` should show `20260926120000` pending. If `migration up` refuses on
     ordering, re-run it with `--include-all`. Confirm `20260926120000` is applied, then record
     the baseline full Jest counts.
1. [x] **The migration and its DB suite, test-first.** Test file:
   `src/__tests__/db/founding-offer-cap.test.ts`, on `describeDb` / `resolveDbTarget`. Mirror the
   shape of `founding-agency-cap.test.ts`.
   - **`beforeAll` fails closed** (precedent `:27-63`) when either table or any of the three
     functions is missing. It also fails closed when the ledger holds claims the suite did not
     create; the message says so, and the suite never deletes rows it did not create.
   - **Test helper.** `createUser` inserts `created_at` explicitly. Real Supabase `auth.users`
     has no default; check `\d auth.users` locally. The plain-Postgres bootstrap fixture does
     default it, so do not rely on that.
   - **Red** (migration absent). Named tests:
     - "a first claim writes one Pro trial row for 90 days marked founding_20, and one claim
       row linked to it". Asserts:
       - `plan_id 'pro'`, `source 'trial'`, `stripe_payment_intent_id` NULL;
       - `offer_id 'founding_20'`;
       - `expires_at - granted_at = 90 days`;
       - claim `entitlement_id` = that row, status `claimed`.
     - "a repeat claim by the same account is ineligible and writes nothing".
     - "an account created before the offer opened, or with NULL created_at, is ineligible".
     - "any prior plan_entitlements row makes the account ineligible". Table over: live trial,
       expired trial, revoked grant, lifetime purchase.
     - "any billing_subscriptions row, whatever its status, makes the account ineligible".
     - "any credit_purchases row makes the account ineligible".
     - "an unknown user id is ineligible".
     - "at 20 claimed, the next eligible account is sold_out and gets no trial row".
     - "availability reports spot_limit 20, remaining 20 − claimed, sold_out at 0, and does not
       count released claims".
     - "release sets revoked_at only". Asserts:
       - `source` stays `'trial'` and `offer_id` stays set;
       - remaining goes back up;
       - the released account's next claim is `ineligible`;
       - inserting a 14-day trial row for it fails 23505.
     - "release of an unclaimed account returns not_claimed; a second release returns
       already_released".
     - "the table refuses rewriting an offer row's source". The house revocation shape
       `SET source = 'revoked:…'` fails with 23514.
     - "deleting a claimed account keeps its spot consumed".
     - "only service_role executes the three functions". Precedent `:1016`.
     - "both new tables have RLS, a service-role-only policy and no PUBLIC/anon/authenticated
       table privilege".
   - **Green:** `supabase/migrations/20260928120000_founding_offer.sql`. It must sort after
     `20260926120000`, and it is idempotent: `IF NOT EXISTS`, `CREATE OR REPLACE`,
     `ON CONFLICT DO NOTHING`, constraints via drop-if-exists/add. It contains:
     - **`founding_offers`** (`id TEXT PK`, `opened_at TIMESTAMPTZ NOT NULL`), seeded with
       `('founding_20', NOW()) ON CONFLICT DO NOTHING`, so a re-run never moves `opened_at`.
     - **`plan_entitlements.offer_id`**: a nullable `TEXT` referencing `founding_offers(id)`,
       plus CHECK `offer_id IS NULL OR (source = 'trial' AND plan_id = 'pro' AND
       stripe_payment_intent_id IS NULL)`. This CHECK is what makes the database refuse a
       `source` rewrite.
     - **`founding_offer_claims`**:
       - columns `id`, `offer_id` (FK), `user_id` (→ `auth.users` ON DELETE SET NULL),
         `entitlement_id` (→ `plan_entitlements` ON DELETE SET NULL), `status`
         (`claimed|released`), `claimed_at`, `released_at`, `release_reason`;
       - a coherence CHECK between `status` and `released_at`;
       - a unique index on `(offer_id, user_id) WHERE user_id IS NOT NULL`, whatever the status.
     - **Both tables:** RLS on, a service_role `FOR ALL` policy, and
       `REVOKE ALL ON TABLE … FROM PUBLIC, anon, authenticated`. Precedent:
       `20260924020000_checkout_pending_intents.sql:25`.
     - **`claim_founding_offer_spot(p_user_id UUID) RETURNS TABLE(outcome TEXT, entitlement_id
       UUID, expires_at TIMESTAMPTZ)`**, outcomes `claimed | sold_out | ineligible`:
       1. Run the unlocked eligibility and sold-out checks first. After sell-out, sign-ins never
          queue on the lock.
       2. Take `pg_advisory_xact_lock(hashtextextended('founding_offer_capacity', 0))`. This is
          a different key from `founding_agency_capacity`.
       3. Re-check both.
       4. Insert the trial row **first**, then the claim row (`RETURNING id`).
       5. Never catch 23505. A parallel fallback trial that lands first must roll the whole
          claim back.
     - **`get_founding_offer_availability()`** returns `spot_limit, claimed, remaining,
       sold_out`. It is `STABLE` and **takes no lock**: a count is exact at its snapshot, and
       locking would queue landing views behind sign-ins.
     - **`release_founding_offer_spot(p_user_id UUID, p_reason TEXT) RETURNS TEXT`**, outcomes
       `released | not_claimed | already_released`:
       - takes the offer lock and requires a non-blank reason;
       - sets the claim to `released`, and sets `revoked_at` on the linked row only.
     - **Function grants:** `REVOKE ALL … FROM PUBLIC, anon, authenticated`, then
       `GRANT EXECUTE … TO service_role`.
     - **Header:** states the design, the migration-first order, the constants (20, 90) and
       why release must not rewrite `source`.
   - **Applying it locally:** `npx supabase migration up --local`, never `--linked`.
   - **Revising it after it is applied locally:** drop only this migration's own objects, then
     re-apply. Do not `db reset` without asking, because it wipes local data.
   - **Guards stay green:** `function-grants.test.ts`, `rls-policies.test.ts`,
     `column-privileges.test.ts`, `founding-agency-cap.test.ts`.
2. [x] **Concurrency proof and the CI step, test-first.**
   - **In `founding-offer-cap.test.ts`**, barrier pattern `founding-agency-cap.test.ts:157-251`
     with the offer's lock key:
     - "30 barrier-synchronised first sign-ins claim exactly 20". Asserts:
       - 20 `claimed` and 10 `sold_out`;
       - 20 claim rows and 20 `offer_id` trial rows;
       - no trial row for any sold-out account;
       - remaining 0.
     - "claims racing a fallback 14-day trial insert for the same account never leave a claim
       without its row". Run 10 accounts, each with a claim racing a direct trial insert.
       Afterwards each account has exactly one trial row, and a claim row exists if and only
       if that row carries `offer_id`.
   - **In `src/__tests__/e2e/playwright-ci-contract.test.ts`**, the red test "runs the founding
     offer capacity suite against the disposable database". It asserts that `ci.yml` has a step
     running `src/__tests__/db/founding-offer-cap.test.ts` with
     `RCF_TEST_DB_URL` and `RCF_REQUIRE_TEST_DB: "1"`, before "Build production app".
   - **Green:** add that step after "Test Founding Agency capacity…" in `.github/workflows/ci.yml`.
   - **Mutation (local only, not committed):**
     1. Replace the claim function with a lock-free copy.
     2. Run the 30-racer test and expect it to fail.
     3. Restore by re-running the migration's function definition. Record the result.

     Precedent: `scripts/test-founding-agency-lock-mutation.mjs`. If the mutation survives,
     declare it in the execution log; never weaken the assertion.
3. [x] **Wrappers and the offer-first sign-in path, test-first.**
   - **New `src/__tests__/lib/billing/founding-offer.test.ts`:**
     - `claimFoundingOfferSpot` sends only `p_user_id` and maps each outcome;
     - it throws on an RPC error, on no row, and on an unknown outcome;
     - `getFoundingOfferAvailability` maps a valid row;
     - it throws on an error or on a row outside `0 ≤ remaining ≤ spot_limit`, or not an integer.
   - **`src/__tests__/lib/billing/trial.test.ts`:** mock `claimFoundingOfferSpot` explicitly,
     default `sold_out`, so existing cases run the real "not claimed" path and not an error
     path. New tests:
     - "claimed → no 14-day insert";
     - "sold_out / ineligible → today's 14-day insert";
     - "claim RPC error or throw → 14-day insert";
     - "claim and insert both fail → resolves, logs, never throws";
     - "an entitled account (plan or credits) calls neither".
   - **Guards:** `src/__tests__/app/auth/{callback,confirm}.test.ts` stay green unchanged.
   - **Green, new `src/lib/billing/founding-offer.ts`:** `FOUNDING_OFFER_ID`,
     `FOUNDING_OFFER_TERMS`, `isFoundingOfferId`, `claimFoundingOfferSpot`,
     `getFoundingOfferAvailability`. The `FoundingOfferId` type lives in `src/types/billing.ts`
     so client components never import this server module.
   - **Green, `ensureTrialStarted`:** on `kind === "none"`, try the claim, and call
     `grantTrialEntitlement` for any other outcome or error. Leave a tombstone saying why the
     fallback follows every non-`claimed` outcome.
4. [x] **The allowance, test-first.** New `src/__tests__/lib/billing/founding-offer-allowance.test.ts`.
   - **Harness:** the real `plans.ts`, `effective-plan.ts` and `credits/system.ts` over
     in-memory clients with production-shaped rows. Template:
     `lifetime-agency-allowance.test.ts:330-441`.
   - **Red** (receives 500):
     - "offer only → `pro`, every Pro limit (websites 5, collaborators 5, AI, translations −1,
       A/B), 100 a month";
     - "offer + Starter subscription → `pro`, 100";
     - "a higher allowance held elsewhere is never lowered". Uses a hypothetical catalogue where
       Starter includes 300, plus a Starter subscription, and expects 300.
     - "offer + packs → included 100, purchased on top".
   - **Guards** that pass before the change:
     - offer + Pro subscription → 500;
     - offer + Lifetime Pro → 500;
     - offer + Agency subscription → `agency`, 1,000;
     - offer + Founding Agency purchase → `agency`, 250 (the offer does not lift the floor);
     - a plain 14-day trial → 500;
     - an expired offer → `none`;
     - "an offer account's `readGrantedPlanIds` is empty (it can still buy Lifetime Pro)".
   - **Green:**
     - `LiveGrant` and the select at `effective-plan.ts:346` gain `offer_id`.
     - `EffectivePlanBasis` gains `offerId`. It is set only when the plan in force is `pro`,
       every live `pro` grant carries an `offer_id`, and no live subscription bills `pro`.
     - `resolveEntitlement` then sets `monthlyCredits` from `FOUNDING_OFFER_TERMS` and applies
       `withAllowanceFloor` over `otherHeldPlans`.
     - An `offer_id` without terms (unreachable: FK) resolves as a plain trial and logs.
     - `readGrantedPlanIds` and `otherHeldPlans` have empty diffs: their trial exclusion does
       the work.
   - **Mutations:** each must fail at least one test.
     - Subscription ignored.
     - Any `pro` trial treated as an offer.
     - Floor removed.
     - Offer-only replaced by "any offer row".
5. [x] **Monthly window and the offer lifecycle, test-first.**
   - **`src/__tests__/lib/credits/trial-period.test.ts`:**
     - "an offer row's 100 resets on each monthly anniversary of the grant". Usage in window 1
       no longer counts on day 31.
     - "the partial fourth window is accepted". Anchor `2027-02-01T12:00Z` at
       `2027-05-01T13:00Z` gives a fresh 100 until the `2027-05-02T12:00Z` expiry (decision 6).
     - The existing 14-day cases (`:141-237`) stay green unchanged.
   - **Green:** at `credits/system.ts:200`, `trial.grantedAt` becomes
     `startOfCurrentAllowanceWindow(trial.grantedAt)`. Update the comment above it, which says
     "granted once, for the whole trial", to state that a 14-day trial never reaches a second
     anniversary.
   - **`src/__tests__/integration/trial-lifecycle.test.ts`:** the fake gains
     `claim_founding_offer_spot` with a `spotsRemaining` state. **It defaults to 0**, so every
     existing lifecycle test keeps the 14-day path. New tests:
     - "first sign-in while spots remain: `pro` for 90 days, 100 credits, no card; a new
       allowance on day 31; `none` on day 91; the next sign-in writes no second trial
       (duplicate)";
     - "spots gone: first sign-in gets the 14-day trial with 500, exactly as before";
     - "the offer RPC erroring still gives the 14-day trial".
6. [x] **Offer-aware payloads, test-first.**
   - **Tests:**
     - `src/__tests__/api/billing/entitlement.test.ts`: an offer account's `trial` carries
       `offerId: 'founding_20'` and the 90-day countdown. A plain trial's payload is
       byte-identical to today (no `offerId` key).
     - New `src/__tests__/api/billing/dashboard-founding-offer.test.ts`, on the harness of
       `dashboard-unentitled.test.ts`: the running offer's `trial` has `offerId` and
       `creditsLimit: 100`.
     - The same file: a lapsed or released offer account (`effectivePlanId: null`) gets
       `everTrialed: true` and `endedOfferId: 'founding_20'`. A lapsed plain trial gets no
       `endedOfferId`.
   - **Green:**
     - `readTrialGrant` selects `offer_id` and returns `offerId`.
     - `TrialSummary.offerId?` and `BillingDashboardData.endedOfferId?` are added in
       `src/types/billing.ts`, spread only when set.
     - Both routes fill them.
7. [x] **Public count route, test-first.** New `src/__tests__/api/offers/founding.test.ts`:
   - "200 with exactly `{limit, remaining, soldOut}`", with no other keys;
   - "`Cache-Control: no-store`, `dynamic = 'force-dynamic'`";
   - "two consecutive GETs read the RPC twice (no in-process cache)";
   - "RPC error, or remaining out of range / non-integer / null → 503 `{error}` with no
     `remaining` key";
   - "rate-limited → 429 and the RPC is not called";
   - "limiter store failure → served".

   Green: `src/app/api/offers/founding/route.ts`, which rate-limits before the RPC and logs
   detail with `console.error` only. Mutation: adding a module-level cache must fail the
   "twice" test.
8. [x] **ADR 039, the runbook, tombstones, backend checkpoint.**
   - **`docs/decisions/039-founding-offer-is-the-one-trial.md`** (template
     `~/.claude/killer-saas/templates/adr.md`) covers:
     - representation (A) and the rejected options (new `source`, plan row, synthetic payment
       intent);
     - the marker column and CHECK;
     - claims and the lock, and the eligibility rule;
     - where 100/20/90 live;
     - the held-by-offer-only allowance and its floor;
     - monthly windows for every trial (**amends ADR 014's single window**) and the accepted
       fourth window;
     - release keeps `source`;
     - migration-first order.
   - **New `docs/operations/founding-offer.md`, plus a row in `docs/README.md` "operations/":**
     1. **Deploy order.** First `supabase migration list --linked` and
        `db push --linked --dry-run`, which must list only reviewed migrations, including
        `20260926120000` if still pending. Then push, verify the functions exist and
        availability reads 20, then deploy right away. Accounts created in the gap get the
        14-day trial.
     2. **Live proof.** A new QA account claims, remaining reads 19, and the dashboard shows the
        offer.
     3. **Release.** Run
        ```bash
        PGSERVICE=recopyfast-production psql -X -v ON_ERROR_STOP=1 -v user_id="$USER_ID" -v reason="qa" <<'SQL'
        SELECT public.release_founding_offer_spot(:'user_id'::uuid, :'reason');
        SQL
        ```
        then remaining reads 20 again and the account resolves to no plan.
     4. **Inspection queries.**
     5. **Rollback.** Code rollback is the kill switch: old code reads offer rows as plain
        trials, 500 credits and "Trial — N days left", which over-delivers but causes no outage.
        Never roll back the schema while claims exist. Deploying code before the migration
        breaks every entitlement read.
   - **Tombstones:** the claim insert order, the CHECK, the resolver's offer branch, the credit
     window, the route's no-cache.
   - **Checkpoint:** run the full gate (below). If `docs/designs/s47a-founding-20-grant.md`
     does not exist, **stop here**. Report "backend complete, blocked on design", and do not
     commit.
9. [x] **Offer copy on the three surfaces, test-first — blocked until the design doc exists.**
   Copy comes verbatim from the design doc. The story fixes three strings and the tests assert
   them: "Founding offer — N days left", "N of 100 AI credits used this month" (the 100 is
   `creditsLimit`, never a literal), and "Your founding offer has ended".
   - **Tests:**
     - `TrialStatusBadge.test.tsx`: label and tooltip for `offerId`, with no "Trial —" and no
       14-day wording.
     - `TrialStatusCard.test.tsx`: countdown and credits line, never "trial AI credits".
     - `BillingDashboard.trial.test.tsx`:
       - the offer card;
       - the lapsed offer (`endedOfferId`): heading and body, never "Your 14-day Pro trial has
         ended", and the plans button still opens the upgrade dialog.
     - Existing plain-trial assertions (`TrialStatusBadge.test.tsx:55,75,87`,
       `BillingDashboard.trial.test.tsx:107,165,168`) stay unchanged.
   - **Green:** props-level changes in `TrialStatusBadge.tsx`, `TrialStatusCard.tsx` and
     `BillingDashboard.tsx:157-178`, composed from existing components (`StatusBadge`, `Card`,
     `IconTile`). No new primitive, no layout change.
10. [x] **Gates and delivery.**
    - Run the full gate.
    - Tick the s47a ACs in `docs/stories.md`.
    - Add an Execution log to this plan, in the s45 format:
      - red and green counts per task;
      - mutations;
      - declared deviations;
      - diff scope.
    - Make one commit, `feat: the first 20 accounts get Pro free for 90 days`. It carries the
      research, the plan, the s47a design doc, ADR 039 and the runbook.

**Gate (run in the worktree with the CI placeholder env, never at the repo root):**

```bash
npx supabase start && npx supabase migration up --local   # new migration + 20260926120000 applied
RCF_REQUIRE_TEST_DB=1 npx jest --runInBand src/__tests__/db  # DB suites run for real, never "[gated]"
npm run precommit        # lint + type-check + full jest
npm run format:check
npm run type-check:build
npm run build
```

**Task count: 10.** It fits. If one task has to move, it is Task 9: it becomes a follow-up UI
story on the payload fields from Task 6. Nothing else can move without leaving an AC untested.

## Run interdicts

- **Migrations.** No applied migration is edited, and exactly one new migration is added:
  `git diff main -- supabase/` shows only `20260928120000_founding_offer.sql`.
- **No Stripe change.** These diffs are empty: `src/lib/stripe/**`, `src/app/api/billing/checkout`,
  `src/app/api/webhooks/stripe`, `scripts/sync-stripe-catalogue.mjs`, every `plans` row and
  `PRICE_ID_ENV_VARS`. No `check:stripe` run, and no network call to Stripe.
- **Existing trial and revocation code.** These keep empty diffs:
  - the `grantTrialEntitlement` insert, `TRIAL_DURATION_DAYS` and `TRIAL_SOURCE`;
  - `readGrantedPlanIds` and `otherHeldPlans`;
  - `src/lib/billing/entitlements.ts`.

  Release never goes through `revokeEntitlementForPayment`.
- **Landing.** Untouched (s47b): `src/components/sections/**`, `src/app/page.tsx`,
  `src/app/try/**`, `e2e/**`, `playwright.config.ts`, the 44-test contract and
  `trial-claims.test.tsx`.
- **Other paths with empty diffs.** `/api/pricing`, `src/middleware.ts` and
  `src/lib/feature-gating/permissions.ts`; the count is not added to `/api/pricing`.
- **Docs.** `AGENTS.md` and `docs/architecture.md` are untouched. The root checkout's
  uncommitted `AGENTS.md` edit is not part of this story.
- **Commands.** Never run `supabase db push`, any `--linked` command, a remote `db reset` or
  anything against production. Local `db reset` only with the lead's approval.
- **Suites and tests.** Never delete rows a DB suite did not create. No `test.skip`/`.only`.
  Never `--no-verify`.
- **Order.** Task 9 does not start before the design doc exists. No push, PR or merge.

## The point everything turns on

**The claim function is the only thing that writes an offer row, and it must be exact:**
eligible, under the lock, trial row and claim row together or neither. Every other part of the
story reads what it wrote. A bug here either gives away unlimited free Pro or pushes sign-ins
onto a path that then has to fall back.

- **Eligibility under the lock.** "Ever" means any row in the three tables, revoked or expired
  included. NULL `created_at` fails closed. Compare with `reserve_founding_agency_spot`'s
  lock-then-recheck (`20260924065000_…sql:128-210`), and check the unlocked pre-check only ever
  refuses: it never claims.
- **Atomicity.** Trial row first, claim row second, 23505 not caught. Compare with the research
  trap "the fallback cannot double-grant". The T2 race test is the proof, and the lock mutation
  is the proof that the test can fail.
- **Held-by-offer-only in the resolver.** `pro` in force, every live `pro` grant an offer row,
  and no `pro` subscription, compared with `isPurchaseOnly`. The T4 precedence table is the
  contract; a reviewer should try "offer + Lifetime Pro" and "offer + Pro subscription" first.
- **Release.** `revoked_at` only, and the CHECK is what holds even if someone later uses the house
  revocation.

## Files touched

- `supabase/migrations/20260928120000_founding_offer.sql` (new)
- `.github/workflows/ci.yml`
- `src/lib/billing/founding-offer.ts` (new), `src/lib/billing/trial.ts`,
  `src/lib/billing/effective-plan.ts`, `src/lib/credits/system.ts`
- `src/types/billing.ts`, `src/app/api/billing/entitlement/route.ts`,
  `src/app/api/billing/dashboard/route.ts`, `src/app/api/offers/founding/route.ts` (new)
- Task 9: `src/components/dashboard/TrialStatusBadge.tsx`,
  `src/components/billing/TrialStatusCard.tsx`, `src/components/billing/BillingDashboard.tsx`
- Tests:
  - new: `src/__tests__/db/founding-offer-cap.test.ts`,
    `src/__tests__/lib/billing/founding-offer.test.ts`,
    `src/__tests__/lib/billing/founding-offer-allowance.test.ts`,
    `src/__tests__/api/billing/dashboard-founding-offer.test.ts`,
    `src/__tests__/api/offers/founding.test.ts`;
  - extended: `src/__tests__/e2e/playwright-ci-contract.test.ts`,
    `src/__tests__/lib/billing/trial.test.ts`, `src/__tests__/lib/credits/trial-period.test.ts`,
    `src/__tests__/integration/trial-lifecycle.test.ts`,
    `src/__tests__/api/billing/entitlement.test.ts`, and (Task 9) `TrialStatusBadge.test.tsx`,
    `TrialStatusCard.test.tsx`, `BillingDashboard.trial.test.tsx`.
- Docs: `docs/decisions/039-founding-offer-is-the-one-trial.md` (new),
  `docs/operations/founding-offer.md` (new), `docs/README.md` (one operations row),
  `docs/stories.md`, `docs/research/s47a-founding-20-grant.md`, this plan,
  `docs/designs/s47a-founding-20-grant.md`.

## Test strategy

- **Capacity and eligibility are database properties**, so they are proved against real
  Postgres: the three functions, the CHECK, RLS, grants, and two barrier races. CI runs the
  suite by name, and a contract test pins that CI step.
- **What an account gets** (limits, allowance, windows, lifecycle) runs through the real
  resolver, the real catalogue parser and the real credit arithmetic over in-memory clients.
- **The sign-in path** is unit-tested for every outcome, including double failure.
- **The route and payloads** are tested at the HTTP boundary, and the copy through the
  rendered component.

Assertions are on rows, limits, credits, status codes and visible text, never on which internal
function ran. Mutations named in T2, T4 and T7 prove the key tests can fail.

## Definition of Done

- **Tasks.** All ticked, with red observed before each green. Guards are declared and proven by
  mutation where named.
- **Gates.** The gate above is green in the worktree: DB suites run for real, and `lint`,
  `type-check`, `format:check`, full `jest`, `type-check:build` and `build` pass.
- **Delivery.** One story commit. No push, PR, merge or production action.
- **Operator, before merge** (runbook; merging to `main` is the production deploy):
  1. apply and verify `20260928120000_founding_offer.sql` **first**;
  2. merge the PR (deploys);
  3. run the live proof on a QA account;
  4. release its spot.

## Execution log

2026-09-28, worktree `.omx/worktrees/s47a-founding-20-grant`, base `main` `934253b`. Every
command ran with the CI placeholder environment (`ci.yml` "Lint, Test & Build" `env:`). Nothing
touched production, a linked project or Stripe.

- **Setup.** `npm run setup` in the worktree (no symlinked `node_modules`, no root `.env`).
  `supabase start` first failed: the colima data disk was full (30G, 100%). The owner approved
  removing the unused old Supabase images. By the time colima was back up, the 15 listed tags had
  already gone (images 24.12GB → 12.82GB, about 11.3GB freed, VM disk 18G used / 11G free), so no
  `docker rmi` was run. Only CLI 2.118.0's pinned tags remain, and every other project's image
  is present. `migration up --local` refused on ordering (`20260925115000` was pending locally),
  and `--include-all` applied `20260925115000` then `20260926120000`. No baseline full-Jest count
  was recorded: the database was down at setup (declared).
- **Task 1**: red, 22/22 failed closed (both tables and all three functions absent). Green:
  21/22, then 22/22 after fixing a test defect: `ARRAY(...)` of role names came back as an
  unparsed `name[]` string and needed a `::text[]` cast. Idempotency: the migration re-run on
  the same database only printed "already exists, skipping" notices, and `opened_at` was
  unchanged. Guards: every DB suite green (below). `column-privileges` also passed through
  PostgREST with the local anon key, as CI runs it (15/15).
- **Task 2**: the CI contract test was red (step not found), then green. `src/__tests__/e2e`
  37/37. The two race tests pass (suite 24/24). Lock mutation (local only, not committed): a
  lock-free `claim_founding_offer_spot` made 12 claims resolve while the barrier held the key,
  with 0 waiters, and the test failed. Restored by re-running the migration; `prosrc` was
  checked, and the suite is back to 24/24.
- **Task 3**: `founding-offer.test.ts` red (module absent), then 23/23. `trial.test.ts` red: 4
  failed (claimed, rejects, throws, double failure). The `sold_out`/`ineligible` and
  entitled-account cases passed before the change, as guards. Green: 70/70 across the trial,
  wrapper, auth callback/confirm and lifecycle suites.
- **Task 4**: red, 5 failed, each receiving 500: offer only, offer + Starter, the hypothetical
  Starter 300 floor, packs, plus the no-terms log. The 7 guards passed before the change. Green:
  196/196 across billing, credits and lifecycle. Mutations, each applied alone and restored
  (`diff -q`):
  - subscription ignored → 1 failed;
  - any `pro` trial treated as an offer → 2 failed;
  - floor removed → 1 failed;
  - "every" replaced by "any offer row" → 1 failed.

  All killed.
- **Task 5**: `trial-period.test.ts` red, 2 failed (anniversary: 110 used, not 10; fourth
  window: 100 used, not 0). The in-window cap passed, as a guard. The lifecycle test was red on
  the day-31 window (100 used); its claim and 100-credit halves already passed from Tasks 3–4.
  Green: 202/202.
- **Task 6**: red, 8 failed. Green: 440/440. Type-check then showed a required
  `TrialGrant.offerId` breaking four existing mocks, so it became optional and set only when
  present (deviation 3). 440/440, `tsc` clean.
- **Task 7**: red (route absent), then 12/12. Mutation: a module-level cache failed 8 tests,
  including "reads the RPC on every request". Restored.
- **Task 8**: ADR 039, `docs/operations/founding-offer.md`, and a `docs/README.md` operations
  row. Tombstones:
  - migration: header, claim insert order, never catching 23505, the CHECK, release;
  - resolver: `offerOnly`, `withHeldAllowance`, and the `offer_id` select (migration first);
  - `system.ts`: the credit window comment;
  - the count route: its no-cache header;
  - `trial.ts`: `claimedFoundingOffer` (why every non-`claimed` outcome falls back).
- **Gate** (local Supabase up, all migrations applied):
  - `RCF_REQUIRE_TEST_DB=1 npx jest --runInBand src/__tests__/db`: 11 suites passed, 1 skipped;
    88 tests passed, 3 skipped. The skipped suite is `editor-activation-concurrency`, whose own
    loopback-URL gate skips it under the placeholder env (inherited).
  - `npm run precommit`: lint 0 errors / 38 inherited warnings. `type-check` clean. Full Jest
    280 suites passed / 2 skipped, **3,669 tests passed** / 39 skipped.
  - `format:check` clean. `type-check:build` clean.
  - `npm run build`: compiled, with `/api/offers/founding` dynamic. The 5 `fetch failed` lines
    are the placeholder env's catalogue reads, and the build changed no tracked file.
- **Diff scope** (vs `main`):
  - `supabase/` is only `20260928120000_founding_offer.sql`.
  - Empty diffs: `src/lib/stripe`, `api/billing/checkout`, `api/webhooks/stripe`, `scripts`,
    `entitlements.ts`, `middleware.ts`, `permissions.ts`, `api/pricing`, `src/components`,
    `src/app/page.tsx`, `src/app/try`, `e2e`, `playwright.config.ts`, `server`, `public`,
    AGENTS.md and `docs/architecture.md`.
  - The `grantTrialEntitlement` insert, `TRIAL_DURATION_DAYS`, `TRIAL_SOURCE`,
    `readGrantedPlanIds` and `otherHeldPlans` are unchanged.
  - The five existing test files touched have additions only (0 removed lines).
- **Declared deviations**:
  1. Order: Tasks 3–7, Task 8's docs and Task 2's CI half ran before Tasks 1–2, because local
     Supabase could not start (full VM disk). Each task still went red before green.
  2. The backend was committed before the design doc existed, on the lead's instruction. The
     plan said to stop at the Task 8 checkpoint uncommitted. Task 9 then landed by amending that
     same commit, so the story is still one commit.
  3. `TrialGrant.offerId` is optional and set only when present, not always present, so four
     existing `entitlement.test.ts` mocks need no edit.
  4. Tests beyond the named list:
     - `readTrialGrant` reports the offer (4 cases);
     - an offer id with no terms logs and resolves as a plain trial;
     - the in-window cap guard;
     - the sold-out route case;
     - the running plain-trial dashboard guard;
     - `isFoundingOfferId`;
     - the release's blank-reason refusal.
  5. The number 20 is written in two SQL functions (claim and availability), because
     availability must return `spot_limit`. The migration header says to change both.
  6. The "byte-identical" entitlement test compares the serialised JSON body, because the test
     `NextResponse` has no `.text()`.
  7. `readEffectivePlanBasis`'s granted-plan branch is now early returns: same-plan subscription
     → full, purchase only → purchased, offer only → offer, else full. The s45 path is
     unchanged, and `lifetime-agency-allowance.test.ts` is green.
- **Behaviour changes**:
  - A "no plan" sign-in first calls `claim_founding_offer_spot`, then falls back to the 14-day
    insert.
  - An offer-only `pro` account resolves to 100 monthly credits, floored by other held plans.
  - Every active trial's credit window steps on monthly anniversaries of `granted_at`. A 14-day
    trial is unchanged.
  - The entitlement and dashboard payloads carry `trial.offerId` and `endedOfferId`, only when
    set.
  - New public `GET /api/offers/founding`.
- **Task 9** (2026-09-28, after `docs/designs/s47a-founding-20-grant.md` landed; UI only, local
  Supabase not started because s48's implementer was using it):
  - Badge: red, 5 of 5 new tests failed. Green: 12/12.
  - Card: red, 9 of 13 new tests failed. The 4 that passed are guards: zero and calm, running
    low, separate tones, and the plain 14-day card unchanged. Green: 23/23.
  - Billing page: red, 3 of 5 new tests failed. "Upgrade to Pro" opening the plans and credits
    outranking an ended offer passed, as guards. Green: 16 suites, 247 tests across
    `src/components/{billing,dashboard}`.
  - Along the way, one test expectation of mine was corrected. The card's "Choose a plan" opens
    the same `UpgradeDialog` the header's "Change plan" opens, titled "Change your plan", as
    the design specifies, not "Choose your plan".
  - Existing plain-trial assertions are unchanged: the diffs of the three existing suites
    remove only an import line, to add `within`.
  - No test pins how many actions the lapsed panel has, because s49 adds one.
- **Task 9 gate** (s48's local Supabase held port 54322, so every DB suite was pointed at an
  unreachable scratch config and ran `[gated]`, 11 gated placeholders; nothing touched s48's
  database):
  - lint 0 errors / 38 inherited warnings; `type-check` and `type-check:build` clean;
    `format:check` clean.
  - Full Jest: 280 suites passed / 2 skipped, 3,620 tests passed / 38 skipped. One earlier run
    timed out once in `websocket/server.integration.test.ts` (rate limiting, untouched by this
    story); that suite passed 45/45 alone and in the rerun.
  - `npm run build` compiled, with the 5 placeholder `fetch failed` lines, and changed no
    tracked file.
- **Task 9 deviations**:
  1. The design doc's third "actions" row on the offer card (divider, paragraph, "Choose a
     plan" and "Buy more AI credits") is a layout addition. The plan said "props-level, no
     layout change"; the lead ruled that the design doc wins.
  2. `TrialStatusCard` owns the purchase dialog's open state, as `CreditBalanceCard` already
     does. `BillingDashboard` only passes `creditPack` and `onChoosePlan`, and swaps the lapsed
     heading and body through two constants. Its `Button` line and everything else in the
     unentitled branch are untouched, so the merge with s49 stays mechanical.
  3. The offer badge carries `tabular` through `StatusBadge`'s existing `className` prop. No
     primitive changed.
  4. "all 3 months" and "90 days" are design copy literals, because the payload carries no
     offer duration. Every number the design says comes from data does: the allowance from
     `creditsLimit`, dates from `endsAt`, the pack from `catalogue.creditPack`.
- **Rebase onto `origin/main` `4ec7799`** (s48 squash `4f324c7` plus a stories commit). Only
  the story commit was replayed (`git rebase --onto origin/main 934253b`):
  - `.github/workflows/ci.yml` conflicted, because both stories add a DB step before "Build
    production app". Resolution: both kept, s48's credit-spend step first, then founding offer
    capacity. The workflow YAML parses, and both contract tests pass.
  - `src/lib/credits/system.ts` auto-merged. s48's `windowStart` and `spend_credits` path are
    kept, and the monthly window now feeds `windowStart`, which becomes `p_window_start`. The
    offer's 100 reaches `p_included` through the same balance, so the database meters the offer
    per month too.
  - `effective-plan.ts` (s48's `readPaidCreditBalance`), `trial.ts` (s48's comment), the two
    test files, and `docs/stories.md` (main's text, plus the 11 s47a ticks) auto-merged.
  - One test followed a merged behaviour. s48 added `windowStart` to the balance, so two strict
    `toEqual` checks in `founding-offer-allowance.test.ts` now assert it. They check the exact
    value, the offer's `granted_at`, rather than s48's `expect.any(String)`.
  - ADR numbers don't collide: s48 took 040.
- **Rebased gate**, on a private stack `recopyfast-s47a` (ports 553xx, config in
  `.omx/stacks/s47a`, never committed) with every migration applied from scratch, including
  `20260928110000` and `20260928120000`:
  - DB suites live: 12 suites / 115 tests passed. Among them `founding-offer-cap` 24/24,
    `credit-spend` 27/27 and `founding-agency-cap` 23/23. `column-privileges` also passed
    through PostgREST, 15/15. Skipped by their own switches: `editor-activation-concurrency`
    (the placeholder URL is not loopback) and `content-attributes-lifecycle` (needs an
    explicit scratch `RCF_TEST_DB_URL`).
  - lint 0 errors / 38 inherited warnings; `type-check`, `type-check:build` and
    `format:check` clean.
  - Full Jest: 284 suites passed / 2 skipped, 3,740 tests passed / 39 skipped.
  - `npm run build` compiled, with 5 placeholder `fetch failed` lines and no tracked-file
    change.
- **Fix run, PR #49 review** (test-first, story commit amended, the review commit kept on top):
  1. **Critical: a trial or founding offer account could not subscribe.** `UpgradeDialog`
     inferred "has a subscription" from the plan in force (`currentPlan !== null`). A trial or
     offer account holds `pro` with no Stripe subscription, so Pro showed as "Current" and every
     other plan went to `PUT /api/billing/subscription`, which answered "No active subscription
     found". This was already broken on `main` for 14-day trials.
     - Fix: the dialog takes a required `hasSubscription` (the payload's live `subscription`).
       `BillingDashboard` passes `currentPlan: null` while `trial` is set, because a trial
       confers the plan without owning it.
     - New suite `BillingDashboard.plan-change.test.tsx`, asserted on the wire: an offer account
       (card and header) and a 14-day trial account start Checkout for Pro and for Agency, and
       Pro is not shown as "Current"; a subscriber still gets the in-place PUT and Pro stays
       "Current". Red: 6 failed; the 2 subscriber cases passed as guards. Green: 8/8.
     - Declared test changes: my Task 9 test had pinned the defect ("Change your plan" for an
       offer account) and now expects "Choose your plan". `UpgradeDialog.agency.test.tsx`'s 3
       renders gain `hasSubscription={false}`, because the prop is now required.
  2. **Major: a lifetime buyer kept the offer card.** `/api/billing/dashboard` published a
     running trial beside a permanent non-trial grant.
     - Fix: the entitlement badge's rule (`readGrantedPlanIds`) now also gates `trial` there.
       The ended-offer history (`endedOfferId`) is kept.
     - Tests: offer plus Lifetime Pro, and offer plus Founding Agency, give no card (red, 2
       failed, then green); a lapsed offer plus a lifetime grant keeps `endedOfferId` (guard);
       the badge's countdown hides for offer plus lifetime (guard).
     - `dashboard-unentitled.test.ts`'s route mock gains `readGrantedPlanIds` (default `[]`),
       because the route now calls it.
  - Scope: the claim function, the migration and every other path are unchanged.
- **Delivery**: one story commit on `feature/s47a-founding-20-grant`, amended with Task 9 and
  rebased onto `origin/main` `4ec7799`. Not pushed, no PR. Operator, after merge (runbook): apply
  `20260928120000` first, deploy, run the live proof on a QA account, release its spot.
