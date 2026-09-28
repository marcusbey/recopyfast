# Review — Story s47a-founding-20-grant

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff main...feature/s47a-founding-20-grant`. One commit, `fe4aa02`, on
> `main` `4ec7799` (s48 already merged). 34 files, +5,715 / −48.
> Judged against `docs/plans/s47a-founding-20-grant.md`, `docs/research/s47a-founding-20-grant.md`,
> AGENTS.md, ADRs 014, 038, 039 and 040, `docs/design-system.md` and
> `docs/designs/s47a-founding-20-grant.md`.
> Environment: worktree `.omx/worktrees/s47a-founding-20-grant`, the CI placeholder env, and a
> private Supabase stack (`recopyfast-s47a`, ports 553xx) started from scratch, so every
> migration including `20260928110000` and `20260928120000` was applied fresh.

## Plan compliance

- [x] The code does what the plan specifies, nothing more. All ten tasks are present:
  - T1: migration and DB suite. 24 named tests, matching the plan's list.
  - T2: two barrier races and the CI step, pinned by a contract test.
  - T3: wrappers and the offer-first `ensureTrialStarted`.
  - T4: the resolver's offer-only branch plus floor.
  - T5: the monthly window, and the lifecycle fake with `spotsRemaining` defaulting to 0.
  - T6: `offerId` / `endedOfferId`, spread only when set.
  - T7: the public count route.
  - T8: ADR 039, the runbook, the `docs/README.md` row and the tombstones.
  - T9: copy on the badge, the card and the lapsed panel.
  - T10: the gates, the ticks and one commit.

  The deviations the plan declares are real and justified:
  - The T9 action row follows the design doc, on the lead's ruling.
  - `TrialGrant.offerId` is optional.
  - 20 is written twice in SQL, and the header says so.

  Nothing in the diff goes beyond the plan. The mockup `.html` is committed, as every earlier
  story has done.
- [x] Run interdicts respected. Each one was checked by diff:
  - `supabase/` contains only `20260928120000_founding_offer.sql`.
  - Empty diffs:
    - `src/lib/stripe`, `api/billing/checkout`, `api/webhooks` and `scripts`;
    - `entitlements.ts`, `middleware.ts`, `feature-gating` and `api/pricing`;
    - `components/sections`, `app/page.tsx`, `app/try`, `e2e` and `playwright.config.ts`;
    - `server`, `public`, AGENTS.md and `docs/architecture.md`.
  - `grantTrialEntitlement`'s insert, `TRIAL_DURATION_DAYS`, `TRIAL_SOURCE`,
    `readGrantedPlanIds` and `otherHeldPlans` are byte-unchanged.
  - Existing test files have additions only. The two UI suites swap one import line to add
    `within`.
  - No `.skip`, `.only`, TODO or `console.log` was added.

## Anti-hallucination

- [x] No invented API, function or import. Each one was opened and verified:
  - **Imports and client APIs:** `createServiceRoleClient` (`@/lib/supabase/service`) and
    `enforceRateLimit(request, {limit, endpoint, onStoreFailure})` (`src/lib/api/rate-limit.ts:98`),
    with the `IP_GENERAL` preset (`rate-limiter.ts:436`).
  - **Credits and billing helpers:** `startOfCurrentAllowanceWindow` (`credits/system.ts`,
    exported), `withAllowanceFloor`, `otherHeldPlans` and `findHeldPlan` (`effective-plan.ts`).
  - **UI and catalogue:** `StatusBadge` accepts `className` (`status-badge.tsx:297-314`).
    `PurchaseCreditsDialog({open, onOpenChange, creditPack})` exists, and
    `CreditPackConfig.pricePerPack` is in dollars (`checkout.ts:317` multiplies by 100).
    `PlanCatalogue.creditPack` is on the dashboard payload.
  - **Database functions:** `hashtextextended` and `pg_advisory_xact_lock` are in `pg_catalog`.
    `spend_credits(p_included, p_window_start)` (s48) sums `credit_usage.created_at >=
    p_window_start`, so the offer's monthly window reaches the database unchanged.
  - **The "no `trial_end`" claim** in the card's copy ("A plan is billed from the day you choose
    it") is true: `checkout.ts:287-293` sets no trial period.
- [x] No plausible-but-wrong value or logic found in the capacity boundary. I checked the wire
  shapes against local PostgREST, not only against mocks:
  - `claim_founding_offer_spot` returns `[{"outcome":"claimed","entitlement_id":…,"expires_at":"2026-12-27T…+00:00"}]`,
    and a repeat call returns `ineligible`.
  - Availability returns `[{"spot_limit":20,"claimed":1,"remaining":19,"sold_out":false}]`, then
    `remaining 20` after release. These are exactly the shapes the TS wrappers parse.
  - anon calling either RPC gets `42501 permission denied`.
- [x] The code does what it claims. Each focus point from the brief:
  - **SECURITY DEFINER safety.** All three functions: `prosecdef = t`,
    `proconfig = {search_path=public, pg_temp}` (pg_temp last), owner `postgres`, and
    `proacl = {postgres=X, service_role=X}`, with no PUBLIC, anon or authenticated. All tables
    are schema-qualified, including `auth.users`.
  - **Lock key.** `founding_offer_capacity` is distinct from every key in `supabase/migrations`:
    `founding_agency_capacity`, the per-user checkout `hashtextextended(user_id)`, and
    `credits:<uid>`. The function takes no per-user lock, so it cannot deadlock against those.
  - **Eligibility.** The claim requires:
    - `created_at IS NOT NULL AND created_at >= opened_at`;
    - no `plan_entitlements` row of any status;
    - no `billing_subscriptions` row of any status;
    - no `credit_purchases` row.

    The unlocked pass can only refuse. The locked pass re-checks under READ COMMITTED, with a
    fresh snapshot per statement.
  - **Exactly 20, atomically.** The trial row is inserted first and the claim row second. 23505
    is never caught. The 30-racer barrier test gives 20 claimed and 10 sold_out, with no row for
    any sold-out account.
  - **Fallback.** `claimedFoundingOffer` turns any throw into `false`, which leads to
    `grantTrialEntitlement`. `ensureTrialStarted` still swallows everything, so sign-in never
    fails on an error.
  - **One trial ever.** The offer row is `source='trial'`, inside
    `plan_entitlements_one_trial_per_user`. A lapsed or released account is `ineligible`, and
    its 14-day insert fails with 23505. The lifecycle test covers day 91 and re-sign-in.
    Release sets `revoked_at` only: the DB test compares every other column. The CHECK refuses
    `source` rewrites with 23514.
  - **The 100-credit allowance.** Offer-only `pro` with no `pro` subscription gives 100,
    floored by `otherHeldPlans`. The precedence table was read and run:
    - offer + Pro subscription → 500;
    - offer + Lifetime Pro → 500;
    - offer + Starter → 100;
    - offer + Agency subscription → 1,000;
    - offer + Founding Agency → 250;
    - plain trial → 500;
    - hypothetical Starter 300 → 300.

    The TS window becomes `startOfCurrentAllowanceWindow(grantedAt)`, which is passed as
    `p_window_start`. A 14-day trial never reaches an anniversary: the minimum gap is 28 days.
  - **Count route.**
    - It is `force-dynamic` with `Cache-Control: no-store`, has no module memo, and rate-limits
      before the RPC.
    - It returns exactly `{limit, remaining, soldOut}`.
    - On any failure it returns 503 `{error}` with no number, and the detail is only logged.
    - The build lists it as `ƒ /api/offers/founding`.
    - Middleware does not gate `/api/*`.
  - **Migration.** It is idempotent: a re-apply on the live database exits 0, and `opened_at` and
    the function bodies are unchanged. `authenticated` keeps table-level SELECT on
    `plan_entitlements`, and the owner-only SELECT policy is the only authenticated policy, so
    the cookie client can read `offer_id` and cannot write it.
  - **Release SQL (runbook §3).** I ran it verbatim, with `PGSERVICE` replaced by the local URL:
    - it returns `released`, then `already_released`;
    - an empty `$USER_ID` stops on `invalid input syntax for type uuid` (exit 3);
    - a reason containing `'); DROP TABLE …` is bound as a literal by `:'reason'`, and nothing
      is dropped.

    The quoted heredoc stops shell expansion, and `ON_ERROR_STOP` is set.

## Rules compliance

- [x] Repo conventions followed (AGENTS.md):
  - RLS and a policy are in the same migration as each new table (non-negotiable 6).
  - The migration is forward-only (5).
  - The API route rate-limits first, chooses `onStoreFailure: "allow"` with a justifying comment
    for a public read, and returns `{error}` without an exception message.
  - Multi-step writes go through one Postgres function.
  - The code carries long "why" tombstones.
  - A public service-role aggregate read has a precedent in `/api/pricing` →
    `get_founding_agency_availability`.
- [ ] No accepted ADR contradicted. ADR 014 is amended explicitly, by a new ADR, and ADR 014
  itself is not edited. ADR 040's rule "no plan/trial/window rule in SQL" holds. However,
  **ADR 038 says "A support comp or a trial (no payment intent) confers the full plan"**, and
  ADR 039 now makes an offer trial confer Pro at 100 credits. ADR 039's header lists only ADR 014
  under "Amends" (finding m1).
- [x] Design system respected. The badge, card and lapsed panel use only `StatusBadge`,
  `Card variant="outline"`, `IconTile`, `Button` (`default`/`outline`, default size), `Skeleton`
  and the existing dialogs. The type classes are `.text-title`, `.text-metric`, `.tabular` and
  `text-sm text-muted-foreground`. `border-t` resolves to `--line` (`globals.css:216`). No new
  token, colour or primitive, and no `transition-all` added: the inherited one is logged as
  design gap 2.
- [x] The screens match the intent of the design doc:
  - Badge: "Founding offer — N days left", the offer tooltip, and `.tabular`.
  - Card: the offer title and end line, including the last-days variant, and "of
    {creditsLimit} AI credits used this month". The allowance note is replaced by the used-up
    line.
  - Action row: divider, a paragraph built from `catalogue.creditPack`, and buttons whose
    variants swap once credits are used up, in the same order.
  - Lapsed panel: the offer heading and body when `endedOfferId` is set; credits still outrank it.

## Tests

- [x] Test suite run by the reviewer, passing:
  - DB suites live (`RCF_REQUIRE_TEST_DB=1 npx jest --runInBand src/__tests__/db`, against the
    s47a stack): 12 suites passed, 1 skipped (`editor-activation-concurrency`, by its own
    loopback gate). 115 tests passed, 3 skipped. Run twice: before the mutations and after all
    of them were restored.
  - `founding-offer-cap` passed 24/24 and `credit-spend` 27/27.
  - Full Jest: 284 suites passed / 2 skipped, 3,740 tests passed / 39 skipped.
  - lint: 0 errors, 38 inherited warnings.
  - `type-check`, `type-check:build` and `format:check` are clean.
  - `npm run build` exits 0. `/api/offers/founding` is dynamic, the output has only the
    placeholder `fetch failed` lines, and no tracked file changed.
- [x] Assertions pin the acceptance criteria:
  - rows, the 90-day span, claim links, 23505/23514, grants and RLS;
  - exact `included` numbers per precedence case;
  - status codes, headers and key sets;
  - visible copy and the absence of the 14-day wording.

  No test is free of assertions.
- [x] Bite proven by neutralization. Each mutation was applied alone, then restored. The DB
  mutations were restored by re-applying the migration's own definition and checked by the
  `md5(prosrc)` of all three functions and by `pg_get_constraintdef`. The TS mutations were
  restored with `git checkout`, then `git diff --exit-code` was clean. The final `git status` is
  empty.

  | # | Neutralized | Red |
  |---|---|---|
  | D1 | `pg_advisory_xact_lock` removed from the claim | 1 (30 racers) |
  | D2 | `created_at >= opened_at` removed | 1 (before-offer / NULL) |
  | D3 | `credit_purchases` clause removed | 1 |
  | D4 | lock kept, locked re-check skipped (`EXIT` after the lock) | 1 (30 racers) |
  | D5 | availability counts released claims | 2 |
  | D6 | CHECK `plan_entitlements_offer_is_a_trial` dropped | 1 |
  | D7 | 23505 on the trial insert caught, and the claim written anyway | 1, but **only in 6 of 8 runs** (finding m3) |
  | T1 | offer branch returns the plan unchanged (500) | 5 |
  | T2 | offer's 100 not floored | 1 |
  | T3 | trial window reverted to one window from `grantedAt` | 3 |
  | T4 | claim error rethrown (no fallback) | 3 |
  | T5 | fallback skipped for `sold_out` | 8 |
  | T6 | `endedOfferId` set while the offer still runs | 1 |
  | T7 | card label hardcodes `100` | 1 |
  | T8 | route rate-limit result ignored | 1 |

## Regressions

- [x] No impact found on existing code paths, with two notes:
  - `readTrialGrant` and `readEffectivePlanBasis` now select `offer_id`. These back every gate,
    both billing routes and every AI charge, through `getUserCreditBalance`. They are safe only
    once the migration is applied (finding M1).
  - `getUserCreditBalance`'s window change applies to every active trial, and the unchanged
    14-day cases stay green.

  The branch rewrite in `readEffectivePlanBasis` (same-plan subscription, then purchase-only,
  then offer-only, then full) matches the old `isPurchaseOnly && sub !== granted` expression for
  every non-offer input. `lifetime-agency-allowance` is green. Every "no plan" sign-in now makes
  one more service-role RPC: ineligible and sold-out accounts get their answer from the unlocked
  pass.

## Findings

- **major M1** — `docs/operations/founding-offer.md` §1, `docs/plans/s47a-founding-20-grant.md`
  (DoD "Operator, after merge", Execution log "Delivery") and ADR 039: the deploy order is
  written as "after merge: apply the migration first, then deploy".
  - **Why that is unsafe here.** In this repo a merge to `main` is the production deploy. s48's
  PR #48 had to say "Apply the migration to production **before** this merges". Vercel's Git
  integration is in use (`NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`, s46).
  - **What breaks.** Followed literally, the code that selects `plan_entitlements.offer_id`
    reaches production before the column exists. PostgREST then answers
    `42703 column … does not exist`, reproduced locally. `readEffectivePlanBasis` and
    `readTrialGrant` throw. Every entitlement gate, `/api/billing/*` and every AI charge fail
    for every account until the migration lands.
  - **What the runbook lacks.** It never says "before merging the PR".
  - **Fix.** State "apply and verify the migration, then merge (the merge deploys)" in the
    runbook §1 and in the PR body. Alternatively, make the resolver tolerate a missing column.
- **minor m1** — `docs/decisions/039-founding-offer-is-the-one-trial.md`: its header "Amends:
  ADR 014 only". ADR 038's decision says a trial "confers the full plan". An offer trial now
  confers Pro at 100 credits. ADR 039 should name ADR 038 as amended at that point.
- **minor m2** — `20260928120000_founding_offer.sql`, `claim_founding_offer_spot`: the blocking
  `pg_advisory_xact_lock` on the sign-in path has no `lock_timeout`.
  - **The risk.** Any session that holds `founding_offer_capacity` inside an open transaction
    stalls every eligible first sign-in while spots remain. An example is an operator running
    the release inside a `BEGIN` they leave open. The TS fallback runs only on an error, not on
    a hang, so the auth callback can hit the platform timeout. That contradicts "never fails
    sign-in".
  - **Fix.** A `SET LOCAL lock_timeout` of a few seconds turns a stall into an error, and the
    error falls back to the 14-day trial. The try-lock objection does not apply at that bound.
- **minor m3** — `src/__tests__/db/founding-offer-cap.test.ts`, "claims racing a fallback 14-day
  trial insert…".
  - **The gap.** Its bite depends on the scheduler. The mutation "catch 23505 on the trial
    insert and write the claim anyway" (D7) went red in 6 of 8 runs and survived 2. The
    property it guards is the one the plan names as the point everything turns on.
  - **Fix.** Make the race deterministic, as the 30-racer test does with its barrier: open a
    transaction that inserts the fallback row, start the claim, confirm it waits, then commit.
- **minor m4** — `src/app/api/billing/dashboard/route.ts:144-147` with `BillingDashboard.tsx:31-35`:
  a *released* offer account also gets `endedOfferId`, as the plan specifies. It is then told
  "Your 90 days of free Pro are over", which is false for a release before day 90. This affects
  only operator-released QA accounts today.

## Not verified

- **No browser.** No screen was rendered in a real browser, at any width or colour scheme. The
  badge, offer card, action row, both dialogs and the lapsed panel were checked only through
  Testing Library.
  - **Gesture:** on a claimed QA account, open `/dashboard` and `/dashboard/billing` at 1440 and
    390 wide, in light and dark. Check the badge and "Add site" stay on one line, and the two
    buttons wrap without stretching.
- **No real sign-in.** No sign-in ran end to end: no OTP email, no `/auth/callback` or
  `/auth/confirm` against a live Supabase.
  - The claim was proven at the SQL level (DB suite), at the PostgREST wire level (my script,
    service role versus anon) and through mocked unit and lifecycle tests. Never through the
    real callback.
  - **Gesture:** sign up a fresh QA account after deploy. Confirm one `plan_entitlements` row
    with `offer_id = 'founding_20'` and a 90-day `expires_at`, and a linked claim row.
- **No real spend.** No AI charge ran for an offer account through `consumeCredits` →
  `spend_credits`. The TS half (`included` 100, the window start) and s48's DB arithmetic were
  each proven separately.
  - **Gesture:** run one AI suggestion on the QA account, and check that the billing card reads
    "1 of 100 AI credits used this month" (or the operation's cost).
- **Deploy behaviour unconfirmed.** Whether merging `main` auto-deploys production (M1) was
  inferred from PR #48's body and the Vercel Git env var. The Vercel project settings were not
  read.
  - **Gesture:** confirm it in Vercel, and apply `20260928120000` before merging.
- **CDN caching unconfirmed.** Production behaviour of `Cache-Control: no-store` was not checked.
  - **Gesture:** `curl -sI $APP_URL/api/offers/founding` should show `cache-control: no-store`
    and no `x-vercel-cache: HIT`. `remaining` should drop to 19 right after the QA claim and
    return to 20 right after the runbook release.
- **Stripe untouched.** "Choose a plan" and "Buy more AI credits" were tested only to the point
  of opening their dialogs. No checkout ran.
- **CI step not run on GitHub Actions.** The new CI step was not run there. The same command ran
  locally against a fresh stack.
- **Real day 31 and day 91 not observed.** They were simulated by moving `granted_at` in the
  in-memory lifecycle fake.
- **Open risk, not a code defect: nothing limits one person taking many spots.** Anyone can take
  several spots with several email addresses, and the count is public. This is an owner decision
  on eligibility. Release is the operator's remedy.

## Verdict

1 major (M1), 4 minors (m1–m4), no critical. The capacity boundary proved exact under concurrency
and under mutation. The authorization boundary proved exact at the database and over PostgREST.
Ship is allowed on condition that M1's order is honoured: the migration is applied and verified
before the PR merges.


## Product owner disposition (orchestrator, 2026-09-28)

- **M1 fixed in the story commit (docs):** runbook §1, ADR 039 and the plan now state that merging
  to `main` is the production deploy, so the migration is applied and verified BEFORE the PR
  merges; the s47a story's operator note says the same. The ship follows that order.
- **m1 fixed:** ADR 039 now also lists ADR 038 under "Amends" (an offer trial confers every Pro
  limit except the 100-credit monthly allowance).
- **m2 accepted, follow-up:** a `lock_timeout` on the claim function so a stuck lock holder falls
  back to the 14-day trial instead of stalling sign-in — queued with s53 hardening. The lock is
  held only for one short claim transaction.
- **m3 accepted, follow-up:** make the claim-vs-fallback race test deterministic (s53 hardening).
- **m4 accepted:** the "Your 90 days of free Pro are over" copy only reaches internal QA accounts
  whose spot was released.

---

# Re-review after the fix run (PR #49 bot findings), 2026-09-28

# Re-review addendum: s47a-founding-20-grant, fix run (PR #49 bot findings)

Scope: the fix delta only, `3d5f7c9` → `1d975f8`. The delta was separated from rebase noise with
`git range-diff origin/main~2..3d5f7c9 origin/main..1d975f8`. Only one story file, `docs/stories.md`,
is also touched by `origin/main`. The fix changes these files and nothing else:

- `src/app/api/billing/dashboard/route.ts`
- `src/components/billing/BillingDashboard.tsx`
- `src/components/billing/UpgradeDialog.tsx`
- a new suite, `src/components/billing/__tests__/BillingDashboard.plan-change.test.tsx`
- test updates in `dashboard-founding-offer`, `dashboard-unentitled`, `entitlement`,
  `BillingDashboard.trial` and `UpgradeDialog.agency`
- the plan's execution log

The range-diff confirms these are unchanged by the fix: the migration, `src/lib/**`,
`/api/offers/founding`, `/api/billing/entitlement`, `TrialStatusCard` and `TrialStatusBadge`.

## Gate (run by me, in the worktree, at 1d975f8)

I sourced `ci-env.sh` first, then ran the DB suites on the implementer's stack, `recopyfast-s47a`
(ports 553xx), with `RCF_TEST_SUPABASE_CONFIG` pointing at it.

| Step | Result |
|---|---|
| Full Jest | 291 suites passed, 2 skipped (of 293). 3,788 tests passed, 39 skipped (of 3,827). |
| DB suites (live) | 12 passed, 1 skipped (`editor-activation-concurrency`, 2 pending). `founding-offer-cap` passed 24/24. |
| `npm run lint` | exit 0. 0 errors, 38 warnings, none in the touched dirs (eslint on `src/components/billing`, `src/app/api/billing`, `src/__tests__/api/billing`: no output). |
| `npm run type-check` / `type-check:build` | exit 0 / exit 0 |
| `npm run format:check` | exit 0 |
| `npm run build` | exit 0, "Compiled successfully". 5 `fetch failed` lines from the placeholder env, as in the first review. The tree did not change. |
| Stack | Stopped (`supabase stop --workdir …/stacks/s47a`). The default 54xxx stack, the 56xxx stack and `recopyfast-s51` were not touched. |

## Imports and APIs used by the fix

I opened each target and checked it exists as the fix uses it.

- `readGrantedPlanIds(supabase, userId): Promise<string[]>` exists at `src/lib/billing/effective-plan.ts:243`.
  - It excludes revoked rows and `source = 'trial'` rows.
  - `plan_entitlements.source` is `NOT NULL DEFAULT 'lifetime_purchase'`
    (`20260802000000_plans_catalog.sql:226`). So `.neq` cannot silently drop NULL-source
    purchase rows.
  - The offer row is written with `source 'trial'` (`20260928120000_founding_offer.sql:219`). So
    the offer never counts as its own permanent grant.
- `getUserSubscription` (`src/lib/stripe/subscription.ts:533`) reads `billing_subscriptions` with
  `LIVE_SUBSCRIPTION_STATUSES` (active, trialing, past_due; `subscription.ts:17`) and throws on a
  read error.
- `Subscription` and `BillingDashboardData` come from `@/types/billing`, and tsc passes.
- `UpgradeDialog` has exactly two callers, both in `BillingDashboard.tsx` (211, 319). Both pass
  the now-required `hasSubscription`.

## Questions asked by the lead

### 1. Is the subscription state computed from the live row, server-side? Yes.

`hasLiveSubscription = Boolean(dashboardData.subscription)`. On the server, that field is
`getUserSubscription(user.id)`: a `billing_subscriptions` row in a live status, never the
effective plan. Three places use the same three statuses:

- this read;
- the PUT path (`updateSubscription`, `subscription.ts:319-330`);
- the checkout guard (`checkout/route.ts:186-242`, `effective-plan.ts:24`, ADR 028).

So at load time, the client's "has a subscription" means exactly that PUT will find a row and
that Checkout would answer 409.

| Account | `trial` (server) | dialog `currentPlan` | `hasSubscription` | Pro | Other plans | Pinned? |
|---|---|---|---|---|---|---|
| Subscriber (any live status, incl. past_due) | null | effective plan | true | Current | PUT in place | yes (M4: 2 red) |
| 14-day trial | set | null | false | selectable, Checkout | Checkout | yes (M2/M3) |
| Founding offer | set | null | false | selectable, Checkout | Checkout | yes (M2/M3) |
| Offer + Lifetime Pro / Founding Agency | null (suppressed) | effective plan | false | by grant | Checkout | card suppression yes (M5); dialog no (r2) |
| Lifetime / comp holder, no sub | null | effective plan | false | by grant | Checkout (probe B) | **no** (M1: 0 red, r2) |
| Offer or trial + **Starter subscription** | null | effective `pro` | true | **Current, disabled** | PUT | **defect R1** |
| Credits-only / none / lapsed | n/a (unentitled branch) | null | false | Checkout | Checkout | unchanged from main |
| Live sub on a deactivated plan (unentitled branch) | n/a | null | **now true** → PUT | selectable | PUT | no (M8: 0 red) |

### 2. Can a real subscriber still change plan in place, and can anything open a second subscription? In place: yes, with one exception (R1). Second subscription: no.

- A Pro subscriber still gets `PUT /api/billing/subscription` with `{planId, billingPeriod}`, and
  Pro stays "Current". This is pinned: mutation M4 (`hasSubscription={false}` in the entitled
  branch) turned both subscriber tests red.
- **The dangerous direction is closed on both sides.**
  - **Client:** no dialog path sends a holder of a live row to Checkout, because the flag comes
    from the row, not from the plan.
  - **Server** (independent of the client, unchanged by the fix):
    - `existingSubscription` answers 409, "You already have a subscription…";
    - a re-read inside `withUserLock` (`liveRow`, line 229-242) catches a webhook that landed
      after the page loaded;
    - the claim RPC raises `ExistingSubscriptionBlocksCheckoutError`;
    - incomplete, unpaid and paused rows are routed to their recovery, not to a new checkout
      (ADRs 028 and 031).
  - A stale page is therefore refused server-side.
- **One side effect runs the other way, and it is benign.** The unentitled branch now passes
  `hasLiveSubscription` instead of an implicit `false`. A live subscription whose plan row was
  deactivated now gets an in-place PUT instead of Checkout's 409. That is the flow the 409 message
  itself points to. No `free` subscriptions can exist: the CHECK constraint was tightened in
  `20260803000000`.

### 3. Does the lifetime suppression reuse `readGrantedPlanIds` correctly and keep the ended-offer history? Yes.

- `isTrialling = trialGrant?.isActive && !subscription && readGrantedPlanIds(...).length === 0`.
  The last term short-circuits, so the extra read happens only when it can matter.
- This is the same rule the badge route uses (`entitlement/route.ts:69-76`).
- `endedOfferId` is computed independently of `isTrialling`, so an ended offer stays visible.
- Pinned: M5 gave 2 red, M6 gave 1 red, and M7 (badge side) gave 2 red.

### 4. Do the tests pin behaviour? Mostly, and on the wire.

The new suite asserts the request bodies sent to `/api/billing/checkout` and
`/api/billing/subscription`, and the absence of the other call, not just the copy on screen.

**The one hole:** the mutation the lead named, reverting `hasSubscription` to
`currentPlan !== null`, turns **zero** tests red (see r2).

## Mutation runs

Scope: `src/components/billing/__tests__`, `src/__tests__/api/billing` and
`src/components/dashboard/__tests__` (32 suites, 493 tests green at baseline). I restored each
mutation with `git checkout -- <file>` and confirmed `git diff --exit-code` before the next one.
The final tree is clean.

| # | Neutralization | Red |
|---|---|---|
| M1 | `UpgradeDialog` ignores the prop and re-infers `hasSubscription = currentPlan !== null` (the lead's mutation) | **0** |
| M2 | `BillingDashboard` passes the effective plan as `currentPlan` during a trial | 4 (Pro × 3 entries, "not presented as Current") |
| M3 | M1 + M2 (the pre-fix client) | 7 (6 in plan-change, 1 in `BillingDashboard.trial`). Matches the plan's "6 failed". |
| M4 | Entitled branch `hasSubscription={false}` (subscriber sent to Checkout) | 2 (both subscriber cases) |
| M5 | Dashboard route drops the `readGrantedPlanIds` clause | 2 (Lifetime Pro, Founding Agency) |
| M6 | Dashboard route also hides `endedOfferId` behind a permanent grant | 1 (lapsed offer + lifetime keeps history) |
| M7 | Badge route's `grantedPlanIds.length > 0` neutralised | 2 (plain trial, founding offer) |
| M8 | Unentitled branch `hasSubscription={false}` | **0** |

**Probes.** I ran a temporary test file, then deleted it; the tree was verified clean afterwards.
Each probe fed `BillingDashboard` a hand-built payload:

- **A:** `subscription(starter)`, `trial: null`, `effectivePlanId: "pro"`. "Current" shows on Pro,
  and "Switch to Pro" is disabled.
- **B:** lifetime Pro, no subscription, choosing Agency. The dialog POSTs
  `/api/billing/checkout {"intent":"subscription","planId":"agency",…}`. Correct.
- **C:** lifetime Agency, no subscription, choosing Starter. The button reads "Continue to payment
  — $9" and is enabled.

## Plan compliance (fix-run section of the plan)

Every claim matches the diff:

- The required `hasSubscription` prop.
- `currentPlan: null` while `trial` is set.
- An 8-test suite (3 + 2 + 1 + 2).
- Task 9's heading assertion changed from "Change your plan" to "Choose your plan". This test
  change is declared, as AGENTS.md "Tests" requires.
- Three `UpgradeDialog.agency` renders gain the new prop.
- The route gate, with `endedOfferId` kept.
- The `dashboard-unentitled` mock default `[]`.
- "Scope: the claim function, the migration and every other path are unchanged": verified.

The diff contains nothing the plan does not describe. No accepted ADR is contradicted: the client
now mirrors ADR 028's live-status contract exactly.

The fix also changes one thing the plan never claims (see r2): it repairs **lifetime owners'**
upgrade. On `main` they hit the failing PUT; after the fix they reach Checkout. I confirmed on
`origin/main` that `UpgradeDialog.tsx:80` infers the flag and `BillingDashboard.tsx:299` passes
the effective plan. So the "also broken on main" claim is true.

## Findings (fix delta)

### major R1: offer or trial + a Starter subscription shows Pro as "Current" and blocks the in-place upgrade to Pro

- **Where.**
  - `src/components/billing/BillingDashboard.tsx:326`,
    `currentPlan={dashboardData.trial ? null : currentPlan}`.
  - It uses `trial` as the proxy for "this plan is held only by a trial".
  - Once any subscription is live, the route sets `trial: null` (`route.ts:152-155`).
  - But `readEffectivePlanBasis` still lets the trial or offer grant outrank a lower subscription
    (`effective-plan.ts`, grant-first precedence; ADR 039: "offer + Starter subscription → `pro`").
- **What happens.**
  - `currentPlan` is `pro`, a plan held only by the offer.
  - The dialog opens with Pro pre-selected, marked "Current", and the submit button disabled
    (probe A).
  - Choosing Starter again fails in Stripe with "You are already on this plan". Agency works.
  - During the offer, the customer cannot pay for Pro. They stay on max(100, Starter's 0) = 100
    credits instead of 500, until the offer lapses and they drop to Starter.
- **Why it belongs to this fix.**
  - The fix's own contract says `currentPlan` is "never a plan held only by a trial or the
    founding offer" (`UpgradeDialog.tsx:30-35`). The caller breaks that contract in this case.
  - The fix also newly makes the state reachable from the billing page. Before it, an offer
    holder choosing Starter hit the failing PUT; now they reach Checkout.
  - The same shape exists on `main` for a 14-day trial plus Starter (at most 14 days). The offer
    stretches it to 90.
- **Severity.** No money is taken wrongly, and the account keeps Pro access through the offer
  meanwhile. It is a scoped behavioural defect, so **major**, not critical.
- **Fix direction.** The route knows which plan the account holds outright. Publish it:
  - the subscription's plan, or a permanent grant's plan, whichever is higher;
  - never the plan a trial or offer confers.

  Feed that to the dialog. Pin it with
  `subscription(starter)` + `effectivePlanId: "pro"` → Pro selectable → `PUT {planId: "pro"}`.

### minor r2: the `hasSubscription` prop is not pinned (the lead's named mutation survives)

- **The gap.**
  - M1 turns 0 tests red: re-inferring `hasSubscription = currentPlan !== null` inside the dialog
    is exactly the original defect.
  - M8 turns 0 tests red.
  - The new suite's trial and offer cases pass under M1, because the call site already nulls
    `currentPlan`. The prop alone decides the outcome only for an account with a plan but no
    subscription outside a trial: a lifetime, Founding Agency or comp holder. No test covers that
    account.
  - The behaviour itself is correct today (probe B).
  - A future "simplification" back to inference would send lifetime owners back to
    `PUT → "No active subscription found"` with the suite green.
- **Fix.** Add a lifetime-holder case to `BillingDashboard.plan-change.test.tsx`:
  `effectivePlanId: "pro"`, no subscription, no trial → Agency POSTs `/api/billing/checkout`,
  with no PUT.
- **Severity.** Minor: a test gap on behaviour I verified correct, rated like m3 in the first
  review.

### minor r3: lifetime owners can now buy a subscription below the plan they own for life

- **What happens.**
  - Probe C: a Founding Agency owner with no subscription sees Starter as "Continue to payment —
    $9", enabled. A Lifetime Pro owner sees the same for Starter.
  - Starter confers no limit or credit they don't already have: 1 site, 0 credits, and the
    ADR 038 floor stays at the grant's.
  - Before the fix, this click failed on the PUT.
  - The checkout route guards a subscription intent only against a live or recoverable
    subscription (`checkout/route.ts:186-242`). There is no guard against a permanent grant.
- **Limits.** It is not a duplicate subscription, it is user-chosen and priced on the button, and
  it can be cancelled.
  - A Founding Agency owner buying **Pro** does gain something: ADR 038's floor lifts their
    credits from 250 to 500.
- **Owner call.** Either the dialog disables tiers at or below a permanently held plan (the
  server already has `readGrantedPlanIds` / `getGrantedPlanIds`), or accept this.

## Whole story after the fix

- The first review's M1 (deploy order) and m1 are fixed in docs, per the disposition. m2, m3 and m4
  remain accepted follow-ups.
- The two PR-bot defects are fixed:
  - **Critical:** on the trial and offer path it is fixed and pinned (M2/M3/M4).
  - **Major:** fixed and pinned (M5/M6/M7).
- No critical remains open. The max open severity is R1 (major).

## Not verified, and what a human should do instead

- **No browser.** The dialog, the offer card and the header were rendered only through Testing
  Library.
  - **Gesture:** on a claimed QA offer account, go to `/dashboard/billing` → "Choose a plan".
    Pro must not show "Current", and "Continue to payment" must reach Stripe Checkout in test
    mode. Repeat from the header's "Change plan".
- **Stripe never ran.** In the suite, Checkout and PUT stop at a mocked 400.
  - **Gesture:** on a Pro test subscriber, "Change plan" → Agency must produce a prorated invoice
    (or the hosted-invoice link), with no new Checkout.
  - **Gesture:** on a QA offer account, complete a Pro Checkout. After the webhook, the offer card
    and the badge countdown must disappear, and credits must read 500.
- **Lifetime paths never ran through the real route.** Lifetime owners' upgrade (probe B) and
  purchase below the grant (probe C), and the offer-plus-Starter state (R1), were observed only
  with hand-built payloads.
  - **Gesture:** on a QA account holding Lifetime Pro, "Change plan" → Agency must open Checkout.
    Note what Starter offers.
- **The stale-page race was not reproduced.** A page loaded before a subscription webhook landed
  was reasoned about from the checkout guard's code and its existing tests, not reproduced.
- **The server checkout guard was not re-mutated.** It is unchanged by the fix, and its own suites
  ran green in the full run.

## Product owner disposition (re-review)

- Both PR-bot defects fixed at `1d975f8` (trial/offer accounts reach Checkout; lifetime holders
  see no offer card).
- **R1 (major) accepted, folded into s52:** an offer/trial account holding a Starter subscription
  cannot upgrade to Pro in place during its free period (pre-existing for 14-day trials).
- **r2 folded into s52 as its first task:** a dialog-level test pinning `hasSubscription`.
- **r3 folded into s52:** a server-side guard against a lifetime owner buying a lower subscription.

Max severity: major
Ship allowed: yes
