# Research — s28-billing-correctness

## Verified context

Base `a9e3f21`, branch `feature/s28-billing-correctness`. Read AGENTS.md, CLAUDE.md and docs/architecture.md.

- A-19: `src/lib/credits/system.ts` queries only active subscriptions and uses `current_period_start` directly as the credit-usage lower bound. `annual-period.test.ts` retains two `test.failing` markers and all balance/purchased-credit guards.
- Entitlement authority: `src/lib/billing/effective-plan.ts:22-26` exports LIVE_SUBSCRIPTION_STATUSES = active, trialing, past_due; the effective-plan subscription query uses it at line 290. `src/lib/stripe/subscription.ts` follows the same policy. Include all three when selecting the allowance anchor, but the allowance amount still comes from getEffectivePlan.
- Cardless trial grants deliberately have one nonrenewing window from granted_at. Preserve this fallback when there is no live subscription.
- A-21 already has a partial mitigation: checkout-reservation.ts and withUserLock serialize same-process requests, backed by checkout_reservations (20260813130000). The two original concurrency tests are already plain `it` at base. Existing rows carry no Stripe URL/session/status; expiry refresh is unconditional, permits cross-process races and can reopen while the original Stripe session is still payable. No checkout.session.expired switch case exists.
- Existing checkout route guards active/trialing/past_due subscriptions and lifetime grants. Preserve those checks and all guard assertions. The webhook uses billing_events for replay deduplication; release writes must finish before event acknowledgement and only affect matching intents.
- Stripe session creation lives in src/lib/stripe/checkout.ts. Tests mock the SDK or this helper; no real Stripe or Supabase access is needed.
- SQL permissions precedent: 20260805190000 revokes PUBLIC, anon, authenticated function execution and grants service_role explicitly. New tenant table needs RLS and explicit service-role access.

## Decisions and traps

Use an original UTC date anchor plus whole-month offset, clamping each target month to its final day. Jan 31 becomes Feb 28/29 then Mar 31; preserve the time of day and boundary inclusivity. Avoid local DST arithmetic.

Reserve a durable pending intent before Stripe creation. Enforce one pending row with a partial unique index, use an atomic database claim/expiry operation, and store session id, URL and expiry. Use intent-scoped Stripe idempotency and metadata to tolerate retries/ambiguous creation. An unknown creation result must not release the slot while a payable session may exist. Completion must establish subscription state before unlocking so webhook ordering cannot permit a second checkout.

## Validation boundaries

Only CI placeholder env from .github/workflows/ci.yml. Setup installs root and server. Migration is authored, never applied locally or remotely in this task. SQL verification is static unless a non-mutating parser is available; state this gap. Required gates: precommit, build, embed --check, audit:prod. No catalogue changes, no production credentials, no provider mutations, no merge/deployment. Complexity 3; no split required.

## Official Stripe references checked 2026-09-24

- [Create Checkout Session](https://docs.stripe.com/api/checkout/sessions/create#expires_at): expires_at is epoch seconds, 30 minutes to 24 hours after creation, default 24 hours. A fixed intent deadline needs enough headroom for the minimum.
- [Idempotent requests](https://docs.stripe.com/api/idempotent_requests): retry uncertain POST results with the same key and identical parameters; first responses including 500 are cached, and keys may be pruned after at least 24 hours.
- [Webhook ordering](https://docs.stripe.com/webhooks#event-ordering): events are not guaranteed in generation order. Retrieve missing current objects rather than assuming subscription.created preceded checkout.completed.
- [Session expiry](https://docs.stripe.com/api/checkout/sessions/expire): only open sessions can be explicitly expired; successful expiry prevents completion. Timestamp expiry alone is not proof a previously completed session has no subscription.

## A-19 execution evidence

The two audit markers were changed to ordinary tests before the fix and failed on their original assertions: usedThisMonth expected 0, got 500; expected 100, got 600. With the added live-status/month-end cases the initial run had 8 failed and 5 passed. After implementation, the focused suite has 14 passed (including the subsequent pre-boundary test); all credit suites have 53 passed across 6 suites. Existing guards remain; supporting fakes only gained the .in() query method.

Commands used the CI-placeholder runner: `npm test -- --runInBand src/__tests__/lib/credits/annual-period.test.ts` and the credit test directory. The leader independently repeated `npm test -- --runInBand --runTestsByPath src/__tests__/lib/credits/annual-period.test.ts`: 14 passed, no failures.

## Operator cutover constraint

The previous checkout_reservations table carries no Stripe session id. The new protocol cannot retroactively identify an open legacy session by its new intent metadata, and old application instances do not use the new partial unique index. At deployment, the operator must prevent mixed-version checkout traffic and drain/expire any pre-cutover subscription Checkout sessions before admitting new checkout traffic. No provider inspection or expiry is performed in this task. Keep the old table for rollback compatibility; rolling back restores the old guard's limitations.

## A-21 execution evidence

Migration: `supabase/migrations/20260924020000_checkout_pending_intents.sql` (unapplied). It uses a per-user advisory transaction lock plus a partial unique index for pending rows. Its service-only claim checks active/trialing/past_due subscriptions before creating a new row, closing the webhook-release/new-claim race only for those live statuses. Incomplete, unpaid and paused subscriptions do not block checkout and may later recover, creating parallel live subscriptions (re-review N2; explicitly deferred in the plan). Expiry is one hour, fixed before Stripe creation; a timestamp alone never releases an attached intent. Provider recovery scans all customer session pages and matches both user and intent metadata. A lost creation response or attach write recovers the original session; an unattached expired intent with no provider session can be safely replaced. Completion persists current subscription state before release, including incomplete/unpaid rows, but those statuses do not block a new claim. Persistence is not protection against their later recovery. A delayed old event cannot alter a newer intent.

The new unpaid checkout completion assertion was red with missing subscription state, then green after reconciliation was placed ahead of the one-off unpaid guard. Focused checkout/concurrency/webhook/SDK tests: 3 suites, 28 passed. Full billing and Stripe command: `npm test -- --runInBand src/__tests__/api/billing src/__tests__/lib/stripe`: 19 suites, 217 passed. Type-check passed.

The trial-lifecycle integration fake now models the pending-intent RPCs; its durable reservation assertion checks checkout_pending_intents instead of checkout_reservations. All existing scenario assertions remain, with 7 of 7 tests passing. SDK tests assert fixed expires_at and intent-scoped idempotency on repeated requests. No catalogue expectations were changed.

## Final local gates

All provider values came from the CI placeholders in `.github/workflows/ci.yml`; no production env file was copied. `npm run setup` installed both root and server dependencies.

- `npm run precommit -- -- --maxWorkers=2 --workerIdleMemoryLimit=512MB` in local Linux / Node 20.20.2: **212 suites passed, 1 inherited skipped suite; 2,754 tests passed, 36 inherited skipped tests, 0 failed**. Lint: **0 errors, 39 warnings**, matching the initial baseline. Type-check passed. The local container used `NODE_OPTIONS=--max-old-space-size=2304` because its default heap was too small for TypeScript.
- `npm run build`: passed, including TypeScript and **96/96** generated static pages.
- `npm run format:check`: passed.
- `node scripts/build-embed.mjs --check`: fresh; Node gzip bundle **46,480 / 46,681 B**, widget **33,707 / 33,865 B**, transport **13,122 B**. Embed source and generated files are unchanged.
- `npm run audit:prod`: **0 vulnerabilities**.
- `git diff --check`: passed. Exactly two failing markers removed; catalogue, catalogue verifier and dependency manifests/lockfiles unchanged. Migration prefix is unique in this branch.

### Native macOS validation limitation

The native full run had one inherited BulkOperations import-size test failure (2,753 passed, 36 skipped). It failed identically in a clean archive of base a9e3f21 under Node 20.15.1. A direct timing probe measured 1,326 ms for the real FileReader/Blob-envelope path against the test's default one-second alert wait. No test assertion or timeout was modified. The complete Linux run above passes that same test. Git-hook Jest runs use the same Linux volume, freshly synchronized from the worktree, with unchanged CI placeholders and assertion settings.

The migration is statically inspected and mocked at application boundaries only; it has not been executed by this task. Independent review remains pending.


## Independent review repair — 2026-09-24

The reviewer-owned `docs/reviews/s28-billing-correctness.md` is preserved byte-for-byte and excluded from all commits. Its blocked verdict is historical evidence, not replaced by this repair report.

C2 and m4 now have RED evidence (3 failed / 14 passed) and GREEN evidence (17 focused tests, 56 across 6 credit suites). The exact Feb 28 → Mar 31 / Mar 29 and Apr 30 → May 31 / May 30 fixtures retain all usage from the Stripe monthly period. Annual terms retain anchored UTC stepping. The database fake implements ordering, limit and multi-row errors. Re-review mutation R5 showed that the original two-row fixture still passed without ordering because both windows excluded the sampled usage; the fixture did not yet prove newest-row selection. Fix mode 2 strengthens that fixture and records a fresh mutation result below.

M2 has RED evidence (1 failed / 1 passed), then 21 passing tests across 3 billing component suites. A 409 with a non-empty URL follows the existing full-browser navigation; a conflict without a URL remains an error. The billing page already renders `BillingDashboard` → `UpgradeDialog` → `useCheckout`, so this repair covers its purchase entry point without a separate page redirect implementation.

M3 follows the existing live entitlement contract, not a new dunning policy: `LIVE_SUBSCRIPTION_STATUSES` in `src/lib/billing/effective-plan.ts` and `getUserSubscription` in `src/lib/stripe/subscription.ts` use active/trialing/past_due. Unpaid/incomplete/paused rows can start a new checkout, while current live subscriptions remain guarded transactionally.

m8 is recorded in ADR 028 and the ADR 014 pointer erratum. The immutable accepted ADR body remains untouched.

m5 has a bounded mitigation, with immediate late-retry recovery deferred: once fewer than 30 minutes remain on a reused unattached intent, provider recovery still runs, but a missing session no longer triggers a Stripe create request with an invalid expiry. The response is a 409 with the fixed retry time. The intent remains reserved until its original expiry, because changing expiry/idempotency parameters after an ambiguous request can permit a duplicate payable session. Eliminating that remaining wait requires a separately designed provider-confirmed cancellation/replacement protocol.


The checkout repair produced 11 failing regression cases before implementation. The final route/webhook/SDK set passes 42 tests across 3 suites. The exact reviewer M5 mutation (replacing the fifth `createCheckoutSession` argument with `{}`) now fails the route test on both the intent id and the database row's exact expiry; restoring the options makes it green. Existing expiry-order assertions are preserved with the new recovery-time-bound argument added. Missing-intent webhook fakes now emit the SQL's `P0002`; `P0003` session mismatches and all other write failures remain retryable errors.


A disposable PostgreSQL 14.17 cluster executed the renamed migration twice and passed 11 validation groups. Twenty simultaneous claims yielded 1 new intent, 19 reused results and 1 row. The tests covered active/trialing/past_due blocking; unpaid/incomplete/paused eligibility; URL COALESCE; exact P0001/P0002/P0003 behavior; terminal replay; anon/authenticated table and four-RPC denial; service-role execution and DELETE denial. The socket-only cluster was stopped and removed. This used a minimal required schema, not the complete Supabase migration chain or PostgREST.

A native macOS full run with exact CI placeholders reached 2,785 passing tests, 36 inherited skips and one failure: the unchanged database grant test found `update_translation_coverage(uuid) -> authenticated` in an already-running local ReCopyFast database. That schema/function is outside this repair; neither its source nor assertion changed. No attempt was made to alter that database. Final full validation uses isolated Linux/Node 20 as CI does, where the database-invariant suite's existing no-database gate applies. The new SQL has the separate execution evidence above.


Pre-integration repair gates: `npm run precommit -- -- --maxWorkers=2 --workerIdleMemoryLimit=512MB` passed with native lint/type-check and isolated Linux/Node 20 Jest: 213 suites passed, 1 inherited skipped; 2,773 tests passed, 36 inherited skipped, 0 failed. Lint stayed at 0 errors / 39 inherited warnings. `npm run build` passed, generating 96/96 static pages. An independent repair review found zero actionable issues and passed 5 targeted suites / 61 tests, with zero TypeScript diagnostics. The reviewer-owned ship verdict remains blocked pending its owner's re-review.


## Final integrated repair gates

Integrated `origin/main` at `a687181` (PR #22 lockfile and PR #26 auth hotfix). The only merge conflict was the adjacent story additions in `docs/stories.md`; both complete entries were retained. Clean installs refreshed the merged lockfile in native and isolated Linux environments.

- `npm run precommit -- -- --maxWorkers=2 --workerIdleMemoryLimit=512MB`: **213 suites passed, 1 inherited skipped; 2,796 tests passed, 36 inherited skipped, 0 failed**. Lint **0 errors / 39 inherited warnings**; full type-check passed. Jest runs the current worktree under Linux/Node 20 with exact CI placeholders, two workers and `NODE_OPTIONS=--max-old-space-size=3072`. Native lint/type-check use Node 24.14.0.
- `npm run build`: passed, **96/96** static pages.
- `npm run type-check:build`: passed.
- `npm run format:check`: passed.
- `node scripts/build-embed.mjs --check`: fresh; Node 24 zlib bundle **46,604 / 46,681 B**, widget **33,828 / 33,865 B**, transport **13,141 B**. Source and generated embed unchanged.
- `npm run audit:prod`: **0 vulnerabilities**.
- `git diff --check`: passed.
- No new failing markers flipped during fix mode; the original two A-19 tests remain enabled. No test was removed, skipped or weakened.

All Critical/Major findings and m1–m4/m6–m9 are fixed. m5's invalid-expiry 500 is replaced by an explicit bounded 409/retryAt; immediate recovery before the fixed expiry remains deferred for the duplicate-payment safety reason above. The independent review file remains byte-identical (SHA-256 `40d7508d8af3d2399877ada79301b86d2b6987c2b0186739710a6e4ad4985f0b`) and excluded from repair commits. Remote migration application and deployment remain operator actions.

The durable-intent ADR uses 028 because open PR #24 already owns ADR 027 for page-scoped identity/content attributes. Only its identifier and references changed; the decision is unchanged.


## Re-review fix mode 2 — 2026-09-24

The current reviewer-owned re-review permits ship (`Max severity: major`, `Ship allowed: yes`). It remains unmodified and uncommitted. N2 is explicitly out of scope: incomplete/unpaid/paused subscriptions may recover after a second checkout. The plan records the required follow-up; this fix does not change that eligibility contract.

N3: the operations runbook now lists all 14 handler events, including `checkout.session.expired`, and requires the operator to update the live endpoint subscription at cutover. No Stripe configuration was accessed or changed.

N4: the two-row fixture now includes April 30 usage inside the newer monthly window and outside the older annual row's May 1 window. Removing `.order("created_at", { ascending: false })` produces exactly one failing test (16 pass): expected usage 275, received 75. The order clause was restored byte-for-byte; `src/lib/credits/system.ts` has no fix-mode-2 diff. This replaces the earlier R5 zero-red gap with observed mutation evidence.

m5: a valid 409 `retryAt` is appended to the existing billing error as “You can start a new checkout at HH:MM.” in the browser's local 24-hour time. Missing/invalid timestamps preserve the error; a reusable URL still redirects. The hook regression was red (1 failed, 20 passed) before implementation. Hook, rendered LifetimeOfferCard, and annual-period suites then passed 35 tests across 3 suites. The same hook error is displayed by UpgradeDialog on the billing subscription purchase path.


N1: `20260924050000_checkout_intent_requested_choice.sql` adds the requested Stripe price, plan and billing period and a service-only five-argument claim RPC. A pending row returns its original choice unchanged. The route resumes only an identical choice; a changed choice expires the known or recovered Stripe session, confirms any already-expired error by retrieval, then finishes/reclaims before creating the new checkout. A request replaces at most one different choice, so it does not cancel a competing successor. Completed sessions and ambiguous expiry stay closed. An unattached ambiguous choice waits until recovery or expiry, with `retryAt`; after expiry and an empty recovery result, a changed choice can be claimed. The exact persisted price is passed into Stripe line items and pinned by the SDK test.

The two-argument service-only claim overload is intentionally retained for rollback compatibility with the preceding s28 application. The current application's sole caller passes all five named arguments. Legacy rows may have null choice columns and are treated as non-identical; the existing no-mixed-version cutover requirement still applies. No browser role can invoke either claim RPC.

N1 TDD evidence: initial route/helper run had 5 failures and 26 passes; the final checkout/Stripe/webhook/trial-lifecycle set passed 59 tests across 4 suites. No scoped failing markers were added, removed or flipped in this pass; existing guards remain enabled.

The new migration was executed twice after its predecessor in a disposable socket-only PostgreSQL cluster with minimal auth/subscription stubs. Checks passed for exact choice persistence, immutable reuse, replacement after idempotent finish, one pending row, service-only RPC/table privileges, active/trialing/past_due blocking and null-choice rejection. The cluster was stopped and removed. This is local PostgreSQL evidence, not a full Supabase/PostgREST or remote migration execution. The new prefix has zero matches across fetched remote branches.


### Fix mode 2 final gates

Merged `origin/main` at `9f22598` in `3d5f04e`; the merge only adds s25 documentation. All gates used the exact CI placeholder values extracted from `.github/workflows/ci.yml` in a clean environment, native Node 24.14.0. No `.env` was copied. A temporary npm launcher bounds Jest to `--maxWorkers=2 --workerIdleMemoryLimit=512MB`; it preserves every test and repository hook.

- `npm run precommit`: **213 suites passed, 1 inherited skipped; 2,809 tests passed, 36 inherited skipped, 0 failed**. Lint **0 errors / 39 inherited warnings**; full type-check passed.
- `npm run build`: passed, **96/96** static pages.
- `npm run type-check:build`: passed.
- `npm run format:check`: passed.
- `node scripts/build-embed.mjs --check`: fresh; Node zlib bundle **46,604 / 46,681 B**, widget **33,828 / 33,865 B**, transport **13,141 B**. Embed source and generated files unchanged.
- `npm run audit:prod`: **0 vulnerabilities**.
- `git diff --check`: passed.

The preserved re-review SHA-256 is `bab8cd3a7576f507e1630c4fe044e304983ce542a2cf0a9eed8e97bfca3240dd`. Its content is excluded from this commit. Provider behavior is SDK-mocked; no real Stripe checkout, endpoint update, remote migration, merge into main or deployment was performed. N2 and the bounded ambiguous-unattached retry wait remain explicit limitations.

Independent fix-mode-2 review passed 78 targeted tests across 6 suites. Forcing `isIdenticalChoice = true` produced **7 failing / 24 passing** checkout tests; the reviewer restored the exact source and reran **31/31 passing**. No current blocking finding remains. This review evidence does not overwrite the independent re-review file or its gate.
