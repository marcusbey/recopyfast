# Review — Story s28-billing-correctness (re-review)

Fresh-context `/ks-review` re-review of `git diff origin/main...feature/s28-billing-correctness`
at head `1f03325` (draft PR #25). Merge-base is `a687181`, the current `origin/main` tip. Codex
added two commits since the blocked review at `46985bc`. `9f4f871` is the repair. `1f03325` merges
`origin/main` (PRs #22 and #26); its only s28-relevant hunks renumber the ADR from 027 to 028.
The reviewer modified no source file and committed nothing. Every mutation was reverted and
proven clean with `git diff --exit-code`.

**Verdict: ship allowed, with two majors to fix next cycle.** Both criticals are fixed. C1: the
migration number is now unique across every remote branch. C2: monthly Stripe periods are used
verbatim, and only multi-month terms are stepped. That was checked hour-by-hour against Stripe's
month-end clamping. The M5 mutation now goes red. What remains comes from the new behaviour:

- A resumed checkout ignores the plan the customer just picked (N1).
- The restored live-only guard lets a second subscription start while an `incomplete`, `unpaid`
  or `paused` one can still recover. That reopens the A-21 race for asynchronous payments (N2).

## Prior findings → status

| ID | Prior finding | Status | Evidence |
|---|---|---|---|
| C1 | Migration collides with PR #24 | **Fixed** | `supabase/migrations/20260924020000_checkout_pending_intents.sql`. `git ls-tree` over all 19 remote branches finds only s29 `20260924000000`, s27 `20260924010000` and this file. No stale reference remains outside the research's history note. |
| C2 | Monthly 29th–31st anchors get extra resets | **Fixed** | `src/lib/credits/system.ts:178-186` steps only when `spansMoreThanOneCalendarMonth` (`:230-247`) holds. Harness below. R2 and R3 each give 3 red. |
| M1 | Route↔Stripe intent binding untested (M5 = 0 red) | **Fixed** | `checkout-concurrency.test.ts:322-331` pins the exact 5th argument. R1 (the old M5) gives 1 red. |
| M2 | Reusable 409 URL discarded by the hook | **Partly fixed** | `src/components/billing/useCheckout.ts:56-70` follows a 409 that carries a URL; R11 gives 1 red. The resumed session ignores the plan the customer requested, so a new defect follows (N1). |
| M3 | Widened guard strands unpaid/incomplete/paused | **Fixed as specified** | `route.ts:148-153` and the migration's `:48-55` are back to active/trialing/past_due, verified in SQL. R12 gives 3 red. The residual double-subscription risk is N2. |
| m1 | Cross-isolate race → 500 | **Fixed** | `route.ts:49-56, 297-305`. The stripe-node 18.4.0 `type`/`code` values were verified in `node_modules/stripe/cjs/Error.js`. R10 gives 2 red. |
| m2 | Poison webhook events | **Fixed** | Migration `:74-94` raises typed P0003 (mismatch) or P0002 (not found). `checkout-reservation.ts:84` tolerates only P0002. The webhook no-ops at `route.ts:953` and `:1022`. SQL case G below. R14 gives 3 red. |
| m3 | Attach overwrites URL with NULL | **Fixed** | Migration `:69` `COALESCE`, confirmed in SQL (case B). |
| m4 | `.maybeSingle()` without order/limit | **Fixed in code, half-tested** | `system.ts:143-156` mirrors `effective-plan.ts:287-293`. R6 (drop `limit`) gives 1 red. R5 (drop `order`) gives **0 red** (N4). |
| m5 | Late retry → 500 | **Mitigated, still open (deferred)** | `route.ts:271-281` returns 409 with `retryAt`; R9 gives 1 red. The lock-out, up to about 30 min, is unchanged by design (ADR 028). |
| m6 | `isNew` unused; unbounded pagination | **Fixed** | `route.ts:214-226` skips recovery on a fresh claim. `src/lib/stripe/checkout.ts:63-65` sets a `created.gte` bound (`SessionListParams.created` exists in the SDK types). R8, R15 and R16 give 1, 1 and 2 red. |
| m7 | TTL rationale removed | **Fixed** | `src/lib/billing/checkout-reservation.ts:3-9` |
| m8 | No ADR | **Fixed** | `docs/decisions/028-durable-subscription-checkout-intents.md`, plus the ADR 014 pointer in `docs/decisions/errata.md`. The number 028 is clear of s27's 027. |
| m9 | Misleading "in progress" message after a paid session | **Fixed** | `route.ts:197-203, 320-335`. R18 and R19 give 1 and 3 red. |

## Verification performed

**Tests.** The reviewer ran them with the placeholder env copied from `.github/workflows/ci.yml`.
There is no `.env` in the worktree and no production value was used.

- Focused set (all billing, credits, Stripe, webhook, trial-lifecycle and `useCheckout` suites):
  **34 suites, 405 tests passed.**
- Full suite: **213 suites passed, 1 skipped; 2,796 tests passed, 36 skipped, 0 failed.**
  - The first full run had 2 environment failures while the host disk was full:
    - `build-size-gate` hit ENOSPC and left `public/embed/recopyfast.js` modified. It was restored
      with `git checkout` and proven clean.
    - The `BulkOperations` test failed on timing, a flake the research already documents.
  - Both suites passed when run alone (22/22), and the clean re-run gave the counts above.

**CI.** `gh pr checks 25` at head `1f03325`: Lint/Test/Build, TypeScript incl. tests, E2E
(Playwright), realtime audit and Vercel all pass.

**Migration, executed.** The reviewer ran it on a throwaway PostgreSQL 14.17 cluster: loopback
only, stub `auth.users`, `billing_subscriptions` and roles. The cluster was stopped and deleted
afterwards.

- Applied twice: idempotent.
- A: claim then re-claim gives `t` then `f`, on the same row.
- B: attach with a URL, then attach with NULL. The URL is kept (COALESCE).
- C and D: a different session, or the wrong user, raises **P0003**.
- E: an unknown intent raises **P0002**.
- F: `finish` to expired, then replaying the attach, returns OK.
- G: `expire_unattached` then a late attach raises **P0002**, which the webhook ignores.
- H: `unpaid`, `incomplete`, `paused`, `incomplete_expired` and `canceled` may claim.
  `active`, `trialing` and `past_due` raise **P0001**.
- I: `authenticated` and `anon` are denied on the table and the RPCs; `service_role` DELETE is
  denied.
- 20 concurrent claims for one user: **1 `t`, 19 `f`, 1 pending row.**

**Allowance-window harness.** The reviewer extracted `system.ts:230-309` verbatim, composed it as at
`:178-186`, and ran it with `tsx`.

- Monthly: 14 consecutive Stripe-clamped periods for each of these anchors: Jan 31 (2024 and
  2025), Jan 30, Jan 29, Feb 28, Mar 31 and Dec 31 23:59:59. Sampled every hour, the window
  **always equals Stripe's `current_period_start`**: 0 extra resets, 14 windows for 14 periods.
- Yearly: for terms anchored Jan 31, Feb 29 2024, Mar 31 and Oct 15, there are **exactly 12
  anchor-derived monthly windows per term**. None is in the future and none regresses.

**Symbols.** Each new or changed reference resolves with the signature used:

- `LIVE_SUBSCRIPTION_STATUSES` (`effective-plan.ts:22`) and `STRIPE_CHECKOUT_MIN_EXPIRY_MS` /
  `SUBSCRIPTION_CHECKOUT_TTL_MS` (`checkout-reservation.ts:8-9`).
- `attachCheckoutSession(..., { ignoreMissingIntent })` (`:71-90`).
- `findCheckoutSessionForIntent(..., createdAfter)` (`checkout.ts:50`).
- In stripe-node 18.4.0: `StripeError.type` equals the class name and `code` is copied from the raw
  error. The default `maxNetworkRetries` is 2, and the SDK retries HTTP 409 itself.

## Mutation testing

Each mutant ran against the 34-suite focused set of 405 tests. Each was reverted and checked with
`git diff --exit-code`, and `git status` shows only this review file.

| # | Location | Neutralized | Red |
|---|---|---|---|
| R1 (old M5) | `route.ts:295` | intent options → `{}` | **1** |
| R2 | `system.ts:246` | `spansMoreThanOneCalendarMonth` → `true` (the C2 bug) | 3 |
| R3 | `system.ts:246` | `> 1` → `>= 1` | 3 |
| R4 | `system.ts:246` | → `false` (annual never steps) | 9 |
| R5 | `system.ts:149` | drop `.order("created_at", desc)` | **0** |
| R6 | `system.ts:150` | drop `.limit(1)` | 1 |
| R7 | `system.ts:148` | live statuses → `.eq("status","active")` | 2 |
| R8 | `route.ts:214` | recover even on a fresh claim | 1 |
| R9 | `route.ts:272` | drop the `retryAt` floor guard | 1 |
| R10 | `route.ts:298` | idempotency conflict → rethrow (500) | 2 |
| R11 | `useCheckout.ts:57` | never resume a 409 URL | 1 |
| R12 | `route.ts:152` | re-widen the guard to incomplete/paused/unpaid | 3 |
| R13 | webhook `route.ts:953` | completed event continues for a missing intent | 1 |
| R14 | `checkout-reservation.ts:84` | no P0002 tolerance | 3 |
| R15 | `checkout.ts:63-65` | drop the `created.gte` bound | 1 |
| R16 | `route.ts:223-225` | route omits `createdAfter` | 2 |
| R17 | webhook `route.ts:1022` | expired event continues for a missing intent | 0 (equivalent: `finish` is a zero-row no-op in SQL) |
| R18 | `route.ts:197` | release a *completed* known session as expired | 1 |
| R19 | `route.ts:232` | release every recovered session | 3 |
| R20 | `route.ts:191-194` | drop the open session from the 409 body | 1 |

R5 at zero red is finding N4. R17 is an equivalent mutant, not a gap.

## Findings

### Major

**N1 — A resumed checkout ignores the plan and period the customer just picked.**
Resume has two paths:

- `route.ts:182-196`: the stored open session.
- `route.ts:241-253`: the recovered session.

Both return the existing session's URL whatever `parsed.intent` asks for.
`checkout_pending_intents` has no plan or period column (migration `:3-14`), so the route cannot
tell the two apart. `useCheckout.ts:56-70` now follows that URL automatically.

The scenario:

1. The customer opens Pro yearly.
2. They click Stripe's back link (`?checkout=cancelled`).
3. They pick Starter monthly.
4. They are sent to the Pro yearly payment page, with no message.

Every retry loops back to that page until the session expires, up to 60 minutes. This cannot
produce two subscriptions, and it is not a charge without entitlement: the session's metadata
carries its own plan, and the webhook provisions what was paid. It does invite a wrong-plan charge,
and the refund that follows.

The prior review's M2 fix direction named exactly this case ("…for the same plan, or expire the open
session and re-claim when the requested plan differs"). No test covers a different-plan retry.

*Fix:* store `plan_id` and `billing_period` on the intent, or compare the session's metadata and
price. When they differ, call `stripe.checkout.sessions.expire` on the open session, finish the
intent, then re-claim. Alternatively, return 409 without a URL and name the open plan.

**N2 — The live-only guard reopens the duplicate-subscription window A-21 closes, for subscriptions
that can still recover.**

The mechanism:

- `handleCheckoutSessionCompleted` persists the subscription "even when it is still `incomplete`".
  It then releases the intent (webhook `route.ts:964-976`), and the test at
  `stripe-webhook-ordering.test.ts:511` models exactly that case: an unpaid session with an
  incomplete subscription.
- The claim RPC (migration `:48-55`) and the route (`route.ts:148-153`) no longer count
  `incomplete` as blocking. `checkout-concurrency.test.ts:625-638` asserts that a new checkout is
  allowed.

Who is exposed:

- With a delayed-settlement payment method, the customer can open and pay a second Checkout while
  the first payment is still processing, and end up with two live subscriptions once both settle.
  This product sets no `payment_method_types`, so the methods offered come from the dashboard.
- The same holds for an `unpaid` subscription whose open invoice is later paid, and for a `paused`
  one that resumes.

Nothing cancels the older subscription when a newer one goes live. Entitlement and credits follow
the newest row, so both keep billing. This is not a regression against `origin/main`, which guarded
the same three statuses, and that is why it is major and not critical. It does contradict two
things:

- The story's premise, "opening Checkout twice cannot create two subscriptions".
- The research's A-21 claim that the claim "checks existing nonterminal subscriptions … closing the
  webhook-release/new-claim race" (`docs/research/s28-billing-correctness.md:44`). That is no
  longer true.

ADR 028 accepts the eligibility rule but does not record this consequence.

*Fix:* on `customer.subscription.created` or `updated` going live, cancel the customer's other
non-terminal subscriptions, or refuse checkout while an `incomplete` subscription is within
Stripe's 23-hour window. Then record the choice in ADR 028's Consequences.

### Minor

- **m5 (carried, deferred) — A reused intent under Stripe's 30-minute floor still locks the
  customer out until expiry.** The response is now an honest 409 with `retryAt`, but the UI shows
  only the message (`useCheckout` ignores `retryAt`). A parameter-mismatch idempotency error, for
  example a plan change after an ambiguous failure, says "try again in a moment" for up to about
  60 minutes. ADR 028 accepts the lock-out.
- **N3 — The ops runbook is now wrong about the webhook events.** `docs/operations/stripe-setup.md:45`
  says "Subscribe the endpoint to exactly these 13 event types, matching the switch". The switch
  now has 14; `checkout.session.expired` is at webhook `route.ts:252` and is not listed. An
  operator who follows the runbook never enables it. That degrades gracefully, because the route
  releases an expired session lazily through Stripe (`route.ts:183-211`). But the new
  "`handleCheckoutSessionExpired`" path will not run in production, and the ADR and research do not
  mention the endpoint change.
- **N4 — The m4 ordering fix is not pinned (R5: 0 red).** "uses the newest live subscription row"
  (`annual-period.test.ts:295`) builds its two rows so that both produce the same window: the
  older yearly row steps to May 1, and the newer monthly row starts on Apr 30. Neither window
  counts the Apr 1 usage. Dropping `.order(...)` therefore stays green. That contradicts the
  research line saying the regression "cannot pass through" (`research:72`). Change the fixture
  so the two rows give different windows.
- **N5 — The research is stale in two places.** It carries the nonterminal-guard claim quoted in
  N2 and the "cannot pass through" claim in N4. It also still says (`:44-46`) that completion
  releases "including incomplete/unpaid obligations" as a protection. That protection no longer
  blocks anything for those statuses.

## Answers to the scoped questions

- **Can resuming a checkout URL produce two live subscriptions, or a charge without an entitlement?**
  No, on the evidence:
  - One pending intent per user holds in SQL (20-way claim).
  - A completed known session or recovered session blocks with 409 and is never resumed (R18, R19).
  - The session's metadata carries its plan to the webhook.
  - What it can produce is a charge for the plan the customer did not just pick (N1).
- **Can unpaid, incomplete or paused users starting checkout produce two live subscriptions?**
  Yes, if the old subscription recovers (N2). A charge without an entitlement: no path found.
  - A completed event for a missing intent returns before persisting (`route.ts:953`, R13), so
    persistence rests on `customer.subscription.created`, which is still handled at `:212`.
- **Month-end cases.**
  - Monthly periods starting Jan 31, Feb 28 and Mar 31 (plus 29th/30th, leap-year and Dec 31
    anchors) gain no allowance; the window is Stripe's period start at every sampled hour.
  - Yearly periods step monthly from the original anchor: Jan 31 → Feb 28/29 → Mar 31, 12 windows
    per term.
  - The two exact monthly fixtures (`annual-period.test.ts:259, 277`) fail when C2 is
    reintroduced (R2).
  - Residual: a Feb 29 yearly anchor steps from the clamped Feb 28 start in non-leap terms. That
    shifts windows one day earlier and grants no extra allowance.
- **Migration number.**
  - `20260924020000` is unique. The neighbours are s29 `…000000`, s27 `…010000`, the planned s27
    fix `…030000` and the s33 plan's `…040000`.
  - Operator note: if s28 is pushed before s27 or s29 lands, their lower timestamps become
    out-of-order for `supabase db push`, which then needs `--include-all`. Apply in timestamp
    order where possible.

## Plan compliance

The fix-pass tasks (C1, C2/m4, M1, M2, M3, m1–m9, and the merge) are all present in the diff.
The plan says M2 is routed "through the checkout hook and billing page". Only the hook changed. The
research explains that the billing page reaches it through `BillingDashboard` → `UpgradeDialog` →
`useCheckout`, which holds, so this is not drift.

Nothing unplanned was found in the code. The drift is in the docs: the research statements in N5
and the runbook in N3. No test was skipped, deleted or weakened. The fakes gained `.in()`,
`order`/`limit`, a multi-row error and `rpc`. The trial-lifecycle durable-row assertion was
retargeted to `checkout_pending_intents`.

## Not verified — and what a human should do instead

- **Real Stripe.** Not observed:
  - idempotency-in-use behaviour under the SDK's own 409 retries;
  - `sessions.list` with `created.gte`, including app↔Stripe clock skew (the bound has no skew
    margin, only `Math.floor` seconds);
  - acceptance of `expires_at`;
  - timing of `checkout.session.expired`;
  - the subscription status at `checkout.session.completed` for async payment methods, which
    decides how exposed N2 is.

  *Gesture:* in test mode:
  1. With a test clock, check the Jan 31 monthly and yearly balances.
  2. Open checkout for Pro yearly, cancel, then choose Starter monthly and watch N1.
  3. With a delayed-settlement test payment method, complete a checkout and try a second one
     before settlement (N2).
- **Payment-method and dunning configuration.** Whether ACH/SEPA-style methods, `unpaid` or
  `paused` can occur in this Stripe account. *Gesture:* read Dashboard → Payment methods and
  Billing → Revenue recovery settings.
- **Supabase proper.** The SQL ran on vanilla PG 14 with stubs, not through PostgREST, and not on
  the full migration chain (CI's E2E `supabase start` did apply it). *Gesture:* on a local stack,
  call each RPC through supabase-js with service role and confirm `error.code` is `P0002` or
  `P0003` for cases E and C. With the anon and user keys, expect a permission error.
- **Cross-instance concurrency.** Two POSTs landing on different Vercel instances were never run.
- **UI.** The 409 resume redirect was only exercised in jsdom. *Gesture:* in a browser, do billing
  → Upgrade → Stripe → back → Upgrade again, once with the same plan and once with a different one.
- **Webhook endpoint configuration.** Whether production subscribes to `checkout.session.expired`
  (N3).
- **Cutover.** Mixed-version traffic and legacy sessions without intent metadata (ADR 028
  Consequences) were not exercised.

## Delta review 188ba10

This is a fresh-context delta review of `git diff 1f03325..188ba10 -- . ':!docs/stories.md'`.
PR #25 is still a draft, and its head is `188ba10`. The diff has two parts:

- `3d5f04e` merges `origin/main` at `9f22598`. Against `1f03325` it only adds the s25 story to
  `docs/stories.md`, which is out of scope here. The merge-base is now the `origin/main` tip.
- `188ba10` is the fix commit.

The reviewer modified no source file and committed nothing. Every mutant was reverted with
`git checkout` and checked with `git diff --exit-code`. `git status` shows only this file.

**Verdict for the delta: N1, N3, N4, N5 and m5 are fixed. No new critical or major was found.**
N2 is still open. It was deferred on purpose (plan "Out-of-scope follow-up — N2" and
`docs/stories.md:1238`), so the gate stays at major with ship allowed. The four new findings are
minor, and most of them are test gaps around the N1 replacement.

### Prior findings → status at 188ba10

| ID | Status | Evidence |
|---|---|---|
| N1 | **Fixed** | See the N1 walkthrough below. Mutants D1–D7 and D18 all go red. |
| N2 | **Open (deferred, major)** | The claim RPC's blocking list is unchanged (`20260924050000…sql:63-70`, verified in SQL: `incomplete`, `unpaid` and `paused` still claim). The research no longer claims otherwise. No follow-up story exists yet, only the plan note. |
| N3 | **Fixed** | `docs/operations/stripe-setup.md:45-66` lists 14 events. The list is set-equal to the 14 `case` labels at webhook `route.ts:212-276` (diffed mechanically). It adds the operator step for the live endpoint. The only remaining "13-event" mentions are in s21's historical docs. |
| N4 | **Fixed** | `annual-period.test.ts:295` now puts usage on Apr 30. That day is inside the newer monthly window and outside the older annual row's May 1 window. D17 (drop `.order(...)` at `system.ts:149`) gives **1 red**. |
| N5 | **Fixed** | `docs/research/s28-billing-correctness.md:44` now limits the race closure to active/trialing/past_due and names N2. `:72` withdraws "cannot pass through". |
| m5 | **Fixed (UI half)** | `useCheckout.ts:30-47, 80-87` appends "You can start a new checkout at HH:MM." to a 409 that carries a valid `retryAt`. `UpgradeDialog.tsx:66, 73, 157-159` renders that hook error on the subscription path. D16 gives **2 red**. The lock-out itself is unchanged by design (ADR 028). |

### N1 walkthrough (order, failure handling, races)

**Order of operations.**

- `route.ts:146-153` resolves the requested price, plan and period before the lock.
  `route.ts:195-198` compares all three against the intent row.
- **Stored open session, different choice** (`:205-223`): Stripe `expire`, then
  `finish(expired)`, then re-claim.
- **Recovered session** (`:264-296`): `attach`, then `expire`, then `finish`.
- **Unattached, not expired, different choice** (`:326-332`): 409 with `retryAt`, with no
  provider write.
- The new session gets the persisted price (`:364-368` → `checkout.ts:204-206`).
- `stripe.checkout.sessions.expire(id, params?, options?)` and `retrieve` exist in the installed
  stripe-node (`types/Checkout/SessionsResource.d.ts:3263`; `cjs/resources/Checkout/Sessions.js:22`).

**If `expire` fails.**

- `expireCheckoutSession` (`checkout.ts:56-63`) swallows the error only when a follow-up
  `retrieve` reports `expired`. Otherwise it rethrows, and the route answers 500 before `finish`.
- The intent stays pending and keeps its session.
- The next request reads `complete` → 409 `isCompleted` (existing R18/R19 path), or reads
  `expired` → `finish` and re-claim.
- If `retrieve` also fails, the call still fails closed. If `finish` fails after a successful
  `expire`, the next request sees `expired` and heals.

**Paid seconds ago (Starter → Pro).**

- A session already `complete` at the status read gives 409 `isCompleted`.
- A session that completes between the read and `expire` makes `expire` fail and `retrieve`
  report `complete`. The route answers 500, the intent is untouched, and the webhook finds it.

**Can the webhook lose the intent?**

- No path deletes an intent. Replacement only flips the status, and the old session id stays on
  the row.
- In SQL, `attach(old intent, old session)` after `finish` returns OK through the EXISTS branch.
  A late `completed` event would therefore still persist the subscription, and a late `expired`
  event is a no-op.

**Is `expire` idempotent?**

- An already-expired session is tolerated by the retrieve check.
- A retried POST goes through the SDK's automatic idempotency keys.

**Can two requests with different choices both create a session?**

- Within one isolate, `withUserLock` serialises them.
- Across isolates, only one pending row can exist. PostgREST test: 20 concurrent mixed
  Starter/Pro claims give 1 `is_new=true`, 19 false and 1 pending row. The old session is expired
  before its intent is finished, so no successor can be claimed while it is payable.
- A request that already replaced one choice and then meets a different successor gets 409
  (`:207-213`, `:280-286`) and never expires the successor.
- Result: at most one payable session per user at any time. A second request can at worst:
  - resume a URL another request is expiring, which lands the customer on Stripe's expired page;
  - later replace the other tab's session ("last choice wins"). Neither path involves money.
- One residual window: Stripe letting a session complete after a successful `expire`, for
  example mid-3DS. That needs real Stripe to rule out (see "Not verified").

**Migration `20260924050000_checkout_intent_requested_choice.sql`.**

The reviewer ran it on a throwaway PostgreSQL 14.17 cluster, bound to loopback only, after
`20260924020000`. A NULL-choice legacy row was created first through the 2-arg RPC.

- **Idempotent.** Applied twice with only "already exists / skipping" notices. The CHECKs are
  added after that legacy row exists: NULL passes, so no backfill is needed.
- **Legacy row.** The new claim returns it with NULL choice and `is_new=f`. The route then
  treats it as non-identical.
- **Choice handling.**
  - A new claim persists its choice.
  - A re-claim with a different choice returns the **original** choice unchanged.
  - `finish` → re-claim creates a new row with the new choice. The replay of `finish` is a no-op.
- **Invalid input.** NULL or blank price, plan `enterprise`, period `weekly` and NULL period
  each raise **22023**. A direct UPDATE to `plan_id='enterprise'` violates the CHECK.
- **Blocking statuses.** `active`, `trialing` and `past_due` raise P0001. `incomplete`, `unpaid`
  and `paused` claim (N2 unchanged).
- **Grants.** They follow the `20260805190000` precedent: REVOKE from PUBLIC, anon and
  authenticated, then GRANT EXECUTE to service_role (`:93-98`). `proacl` on both overloads is
  `{postgres=X, service_role=X}`.
  - anon and authenticated: `permission denied` on the table and on both overloads.
  - RLS is still enabled, with the single service_role policy. Nothing is weakened.
- **PostgREST 14.16.** The throwaway instance was loopback only, with a local test secret.
  - Named 5-arg bodies resolve to the new overload and return the choice columns.
  - The 2-arg body still resolves to the old one.
  - 22023 surfaces as `code: "22023"`, and anon gets 42501.
- **Ordering.** `…050000` sorts after `…020000`. The prefix is unique across every remote branch:
  the others are s29 `…000000`, s27 `…010000` and `…030000`, and s28 `…020000`.
- CI's E2E job (`supabase start`, full chain) is green at `188ba10`.
- The cluster and PostgREST were stopped and deleted.

### Verification performed (delta)

**Tests.** They ran with the placeholder env copied from `.github/workflows/ci.yml`. There is no
`.env` in the worktree.

- Focused set: every billing, credits, Stripe, webhook, trial-lifecycle, `useCheckout` and
  `LifetimeOfferCard` suite, **43 suites and 546 tests, all passed.**
- Full suite: **213 suites passed, 1 skipped; 2,809 tests passed, 36 skipped, 0 failed.** This
  matches the research's claim exactly.
- `npm run type-check`: passed.
- `gh pr checks 25` at `188ba10`: Lint/Test/Build, TypeScript incl. tests, E2E (Playwright),
  realtime audit and Vercel all pass.

**Mutation testing.** Each mutant ran against the 43-suite focused set of 546 tests. Each was
reverted and checked clean.

| # | Location | Neutralized | Red |
|---|---|---|---|
| D1 | `route.ts:195-198` | `isIdenticalChoice = true` (the N1 bug) | **7** |
| D2 | `route.ts:214` | drop the stored-path `expire` | 6 |
| D3 | `route.ts:214-220` | `finish` before `expire` (stored path) | 1 |
| D4 | `route.ts:207` | stored-path "already replaced" guard → `false` | 1 |
| D5 | `route.ts:326` | unattached different choice → create anyway | 1 |
| D6 | `route.ts:279` | recovered open different → resume instead | 1 |
| D7 | `route.ts:196` | ignore the Stripe Price in the comparison | 1 |
| D8 | `checkout.ts:61` | tolerate `complete` as well as `expired` (`=== "open"` rethrows) | **0** |
| D9 | `checkout.ts:61` | swallow every `expire` error | 1 |
| D10 | `route.ts:280` | recovered-path "already replaced" guard → `false` | **0** |
| D11 | `route.ts:247` | drop the replaced flag on a stored expired different choice | **0** |
| D12 | `route.ts:276` | drop the replaced flag on a recovered expired different choice | **0** |
| D13 | `route.ts:195-198` | treat a NULL (legacy) choice as matching | **0** |
| D14 | `route.ts:367` | route omits `priceId` | 2 |
| D15 | `checkout.ts:205` | ignore `options.priceId` | 1 |
| D16 | `useCheckout.ts:83` | never append the retry sentence | 2 |
| D17 | `system.ts:149` | drop `.order("created_at", desc)` (N4) | 1 |
| D18 | `route.ts:287` | drop the recovered-path `expire` | 1 |
| D19 | `route.ts:287-293` | `finish` before `expire` (recovered path) | **0** |

The N1 guard itself is firmly pinned (D1–D7, D18). The zero-red mutants are findings N6–N8.

### New findings (delta)

All four are minor. None blocks.

**N6 (minor, highest of the minors) — Two fail-closed branches of the change-of-choice
replacement are unpinned.**

- D8: `expireCheckoutSession` would swallow a `complete` result.
- D19: the recovered path would finish the intent before `expire`.

Both give 0 red. The code is correct today, but either regression reopens a double-subscription
window, and that is the story's premise. The scenario:

1. A session completes between the status read and `expire`.
2. Its intent is marked `expired`.
3. Until the completed webhook writes the subscription, the next claim may create a second
   payable session.

The stored-path ordering is pinned (D3), so the recovered path and the SDK helper are the gaps.
The existing "ambiguous" test only covers `retrieve` → `open`
(`checkout-pending-intent.test.ts:167`).

*Fix:* add an SDK test where `retrieve` returns `complete` and the call must reject. Add a route
test where the recovered-path `expire` rejects and `finish_subscription_checkout_intent` must not
be called.

**N7 (minor) — The race-only bookkeeping is unpinned, and the retry time it shows is overstated.**

- D10, D11 and D12 give 0 red. A regression would let one request expire a session that a
  concurrent tab had just been handed. This is a UX failure, not a money path.
- When the guard does fire (`:207-213`, `:280-286`), the 409 carries the successor's
  `expiresAt`. The UI now says "You can start a new checkout at HH:MM", up to about 60 minutes
  away. In fact an immediate retry succeeds, because each fresh request may replace one
  different choice. This is only misleading in a two-tab race.

*Fix:* pin D10 with a recovered-path twin of `checkout-concurrency.test.ts:538`. Omit `retryAt`
on the "already replaced" conflict, or word it as "try again".

**N8 (minor) — Legacy NULL-choice rows are untestable in the fake, and the 2-arg overload stays
live.**

- The concurrency fake turns a stored NULL choice into `price_pro_monthly`/`pro`/`monthly`
  (`checkout-concurrency.test.ts:138-140`). The fixtures therefore cannot express a legacy row.
- D13 gives 0 red, so the research's "legacy rows … are treated as non-identical" is true in the
  code but unproven by tests.
- The 2-arg `claim_subscription_checkout_intent(uuid, timestamptz)` is intentionally kept for
  rollback. It still exists, is still service-role callable through PostgREST (verified), and
  still inserts NULL-choice rows that the current route can never resume. For an unattached row
  that means a 409 until expiry.
- Practical exposure is low, because s28 has never been deployed.

*Fix:* stop coercing NULL in the fake and pin the legacy path. Schedule a forward migration that
drops the 2-arg overload once cutover is complete.

**N9 (minor) — ADR 028 was not updated for the N1 change.**

- ADR 028's Decision (`:16`) still says "Store the resulting session id and URL and return an
  existing open session to the user on a retry", and it names only `20260924020000`.
- What the code now does, and ADR 028 does not record:
  - it resumes only an identical price, plan and period;
  - otherwise it performs a provider-side write (`checkout.sessions.expire`) and re-claims;
  - it needs a second migration before cutover. Without `…050000` the 5-arg RPC does not exist,
    so every subscription checkout would 500 on the claim;
  - it keeps a 2-arg overload for rollback.
- AGENTS.md treats ADRs as the record of structural decisions. ADR 028 still travels unmerged
  on `feature/s28`, so an in-place amendment before merge is enough.

### Plan compliance (fix mode 2)

Every fix-mode-2 task is present:

- **N1.** Migration, identical-only resume, and expiry that tolerates an already-expired session.
  Then `finish` → re-claim, and fail-closed handling for completed, ambiguous and concurrent cases.
  The tests cover Pro yearly → Starter monthly, the recovered-session case and the unattached-expiry
  case. The already-expired retry is covered at SDK-helper level.
- **N3.** Done, with no Stripe action.
- **N4.** Done, and the mutant now goes red.
- **N5.** Done.
- **m5.** Done.
- **Merge.** Done.
- **Gates.** Re-verified above.

No unplanned change: moving `resolveStripePriceId` ahead of the lock and the `priceId` creation
option are the plan's "persist requested price". No test was skipped, deleted or weakened. The
two fixtures that changed (N4 and the trial-lifecycle fake) were made stricter.

### Not verified (delta) — and what a human should do instead

- **Real Stripe `expire` semantics.** Not observed:
  - the error `expire` returns on an already-expired or completed session;
  - whether a session can still complete after `expire` succeeds while a 3DS challenge or a
    delayed-method submission is in flight;
  - what happens to an `incomplete` subscription Checkout may already have created at that point.

  *Gesture:* in test mode:
  1. Open Pro yearly and go back.
  2. Choose Starter monthly. Confirm the Pro URL now shows "expired", the Starter session opens,
     and Pro's `checkout.session.expired` webhook is a no-op.
  3. Repeat while a 3DS test card's challenge is open on the Pro page, and check that no Pro
     subscription survives.
- **Browser rendering of the retry sentence.** Only jsdom was used, with a timestamp that has no
  zone. *Gesture:* force a 409 with `retryAt` in a browser in a non-UTC zone and check the local
  HH:MM.
- **Cross-instance timing.** Real overlap was not reproduced; the only evidence is the SQL
  concurrency test and code reasoning.
- **Cutover order.** *Gesture:* apply **both** `…020000` and `…050000` before deploying. Confirm
  `pg_proc` shows both overloads. Enable `checkout.session.expired` on the live endpoint (runbook
  step 14).

Max severity: major
Ship allowed: yes
