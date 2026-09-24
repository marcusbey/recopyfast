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

Migration: `supabase/migrations/20260924010000_checkout_pending_intents.sql` (unapplied). It uses a per-user advisory transaction lock plus a partial unique index for pending rows. Its service-only claim checks existing nonterminal subscriptions before creating a new row, closing the webhook-release/new-claim race. Expiry is one hour, fixed before Stripe creation; a timestamp alone never releases an attached intent. Provider recovery scans all customer session pages and matches both user and intent metadata. A lost creation response or attach write recovers the original session; an unattached expired intent with no provider session can be safely replaced. Completion persists current subscription state before release, including incomplete/unpaid obligations; a delayed old event cannot alter a newer intent.

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
