# Review — s82-billing-lifetime-guards

Reviewer: independent fresh-context `reviewer`, 2026-10-10.

Final target:

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
- The three PR #81 findings are closed: late Checkout payment, scheduled cancellation surviving a plan change, and dated grants presented as permanent.
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

Max severity: none
Ship allowed: yes
