# Review — s82-billing-lifetime-guards

Reviewer: independent fresh-context `reviewer`, 2026-10-10.

Prior independently reviewed target (before the 2026-10-11 fix below):

- SHA `52d43cccb64e17d5886463cfe3ecc4cb98c0a508`
- tree `e5a35fddd7f00f3a736680e101c33642d216c833`
- diff `git diff origin/main...HEAD`, with `origin/main` `0dea1c0`
- both current main and prior PR head `d08b967` are ancestors; the worktree was clean before this report

## Findings

None. The earlier stored review was stale. Its findings and the later PR #81 / verification findings are repaired and pinned in the final integrated tree.

## Plan, rules and API verification

All validated plan tasks 1–43 are present. The diff remains inside the declared story: no migration, embed change, dependency or server change. Customer-facing billing refusals are typed; other route failures stay generic and are logged. The grant readers share the non-trial, non-revoked, unexpired rule, and the rank rule is shared across Checkout, plan changes, reactivation, the dialog and webhook reconciliation.

Every new production import and provider call was traced to its target. The installed Stripe 18.4.0 / `2025-07-30.basil` types confirm:

- invoice subscription identity at `parent.subscription_details.subscription`, plus the supported legacy top-level shape;
- expandable subscription, payment-intent and charge identities;
- paginated `invoicePayments.list` and `refunds.list`;
- refund statuses `pending`, `requires_action`, `succeeded`, `failed`, `canceled`;
- subscription cancellation parameters `prorate`, `invoice_now` and `cancellation_details.comment`.

## Billing invariants verified

- A live grant refuses redundant subscription Checkout, plan changes and reactivation before Stripe; a higher Agency subscription beside Lifetime Pro remains allowed.
- Open covered Checkouts are scanned page by page and expired. Broken cursor progress fails closed and alerts.
- Both webhook event orders apply the same earliest-cover timing rule. A subscription bought after coverage is cancelled immediately and its collected payments are refunded; a predating subscription ends at period end.
- Late invoice settlement checks Stripe's authoritative refusal marker even when the local row is stale or absent, verifies the invoice/subscription customer binding, and retries on a real local read failure.
- Every invoice-payment page is processed. Payment-intent and charge references, including expanded objects, resolve correctly.
- Refund metadata lookup reads every page before inferring absence. Unknown/null statuses fail closed; failed/canceled attempts receive a distinct deterministic retry key; concurrent idempotency-key conflicts do not create duplicate movement.
- The once-only refusal report is claimed through `billing_events`; actionable failures alert in words. Pending/action-required refunds are described as created or found rather than completed.
- A permitted plan switch clears scheduled cancellation and stale lifetime cancellation metadata, while a chargeback cancellation remains protected.
- The first three PR #81 findings were closed in that target: late Checkout payment, scheduled cancellation surviving a plan change, and dated grants presented as permanent. The fourth finding and its implementation evidence are recorded below; architect review is pending.
- Dated grants read “Included until <date>”; undated grants may read “Lifetime.” Included plans remain unbuyable.
- Translation charges the site owner through the authorised service client. AI suggestion failure says “not charged” only after a full credit refund.

## Independent test evidence

Runtime: Node `24.14.0`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`, no production environment or provider calls.

`npm run test:coverage -- --runInBand` passed:

- 422 passed suites, 2 skipped, 424 total
- 5,815 passed tests, 38 skipped, 5,853 total
- 0 snapshots
- coverage: 72.50% statements, 65.91% branches, 69.71% functions, 73.05% lines

After all mutations were restored, the two repaired webhook suites passed again: 2 suites, 94 tests.

## Independent mutation proof

Each mutation was applied to the final tree, its focused tests ran red, and the source was restored in the same tool call.

| Mutation | Neutralized invariant | Red |
|---|---|---:|
| RP01 | Refund lookup stops after page one | 5 |
| RP02 | Unknown/null refund status is accepted | 4 |
| X01 | Latest covering grant replaces earliest | 1 |
| T40 | Late refund depends on a terminal local row | 2 |
| T41 | Invoice-payment lookup stops after page one | 3 |
| T42 | Pagination cursor validation is disabled | 2 |
| T40-CUSTOMER | Invoice/subscription customer binding is disabled | 1 |
| T39 | Subscription read errors are ignored | 1 |

Total: 19 red tests; zero surviving mutations.

Restored SHA-256:

- `src/lib/stripe/lifetime-covered-billing.ts`: `52caa805e4474c8f63a2384b16d2a0b0dd7029b3ec4047ba1f6b3dbd96cfdc47`
- `src/app/api/webhooks/stripe/route.ts`: `3bbf72639dc65ce4b7dad26861bcb77a89b5cc67ac3c4418a88242db7f76476e`
- webhook lifetime test: `1987fabd067af16ee339c1f64e0af4bbb0d46e72e179c72359c7611622707613`

`git diff --exit-code` passed after every restoration.

## Supporting evidence kept separate

- Parent read-only `npm run audit:prod`: exit 0, 0 vulnerabilities.
- Implementer/parent reported the production typecheck and build green, with expected missing-local-provider warnings only.

These are supporting reports, not substitutes for the independent Jest, static and mutation evidence above.

## Not verified

- The 2 database suites / 38 database tests were skipped without disposable PostgreSQL.
- No Stripe test-mode or live call proved cancellation/refund delivery, the configured webhook endpoint API version, or whether the billing portal has subscription updates disabled. Verify the portal setting before production rollout.
- No real Sentry delivery, rendered responsive billing UI, hosted CI run or production deployment was exercised.
- Pre-existing follow-ups remain outside this story: chargeback protection on reactivation and the dropped database error in `stopBillingForLifetimeOwner`'s subscription lookup.

## Devin Review on PR #81

Implementer update, 2026-10-11. Merged `origin/main` (including s76 #84 and s84 #86)
without conflicts. `git diff origin/main -- docs/stories.md` contains only the s82
entry; both main's entries and this branch's entry remain intact.

1. **Open checkout bills a lifetime owner.** The earlier fix expires open covered
   subscription Checkouts when the lifetime grant lands, and reconciles a paid
   subscription against the earliest covering grant. A subscription bought after
   coverage is stopped and its collected invoice refunded through the durable
   refund guard. `stripe-webhook-lifetime-covered.test.ts` covers Checkout expiry,
   late payment, both webhook orders, higher-plan exceptions, retries and refund
   idempotency. Production: `src/lib/stripe/lifetime-covered-billing.ts` and
   `src/app/api/webhooks/stripe/route.ts`.
2. **Agency upgrade keeps scheduled cancellation.** The earlier fix in
   `src/lib/stripe/subscription.ts` clears both period-end and dated cancellation
   on an allowed plan change, and removes stale lifetime cancellation metadata;
   chargeback cancellation stays protected. `subscription-rls.test.ts` covers both
   scheduling forms and metadata/chargeback cases. `BillingDashboard.plan-change.test.tsx`
   covers the pre-click renewal notice in `UpgradeDialog.tsx`.
3. **Dated plans falsely show lifetime access.** The earlier fix carries the
   grant end through `BillingDashboard.tsx`, `SubscriptionCard.tsx` and
   `UpgradeDialog.tsx`: dated grants read "Included until <date>" instead of
   "Lifetime"/"for life", while included plans remain unbuyable.
   `BillingDashboard.plan-card.test.tsx`, `SubscriptionCard.badge.test.tsx` and
   `UpgradeDialog.agency.test.tsx` cover dated and permanent grants.
4. **Canceled covered subscriptions remain charged.** This fix removes the
   terminal-status shortcut before the coverage/payment-order check in
   `refuseIfLifetimeCovers`. A subscription bought after its covering grant now
   reaches the existing `refuseSubscriptionCoveredByLifetime` helper even if
   already terminal. That helper skips cancellation, preserves the existing
   cancellation reason and metadata, and refunds collected invoice payments via
   `refundCoveredInvoice` and its existing durable guard. A predating terminal
   subscription returns unchanged, without refund or period-end update. The ops
   report states the actual terminal status instead of claiming this handler
   canceled it.

   Test-first evidence: the focused suite failed with **3 failed, 85 passed**
   before the production change, then passed **88/88**. Cases cover a canceled
   subscription paid after the grant (one full refund, no cancel/update, reason
   preserved); one paid before the grant (no refund); identical event replay plus
   a distinct delivery after simulated Stripe idempotency-key expiry (still one
   refund); and `incomplete_expired` with no collected payment (no refund). The
   expanded invoice fixture uses basil's `parent.subscription_details` shape.

   **Existing assertion changed, declared:** M21 previously required no refund
   for every customer-canceled subscription, including purchases after coverage.
   That expectation encoded this finding. It now requires the refund; a separate
   predating case retains the legitimate no-refund behavior.

### Current implementation verification

Node `24.14.0`, npm `11.9.0`; dependencies installed with `npm ci`. No provider
environment variables or local `.env` files were present. Test commands below
used `NEXT_PUBLIC_APP_URL=http://localhost:3000`.

- `npm run lint`: passed, 0 errors / 31 existing warnings.
- `npm run type-check`: passed, no diagnostics.
- `npm run format:check`: passed, all matched files formatted.
- `npm test -- --runInBand --runTestsByPath src/__tests__/api/billing/stripe-webhook-lifetime-covered.test.ts`:
  passed, 1 suite / 88 tests, 0 failures.
- `npm test -- --runInBand --testPathPatterns='src/__tests__/api/billing/|src/__tests__/lib/stripe/|src/__tests__/lib/billing/|src/components/billing/__tests__/'`:
  passed, 53 suites / 869 tests, 0 failures.
- `npm test`: the first full run reported 436 passed / 1 failed / 2 skipped suites.
  The one failure was `src/contexts/__tests__/AuthContext.test.tsx`, whose Jest
  worker was terminated with `SIGSEGV` (`exitCode=null`), not an assertion failure.
  This was an environment crash, not a defect in the change: the machine load
  average was about 250 right after a reboot. The architect re-ran that suite
  alone on this tree and it passed 14/14.

The architect reviewed and approved the finding-4 fix: terminal subscriptions go
through the coverage and payment-order check; `cancelCovered` skips terminal ones;
the refund is idempotent; a predating terminal subscription returns without a refund.

The prior independent review remains evidence for its stated SHA only. No
production/provider call or deployment was made by this implementation pass.

Max severity: none
Ship allowed: yes
