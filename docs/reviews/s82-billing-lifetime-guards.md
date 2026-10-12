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
5. **Late payments on canceled subscriptions stay charged**
   (`route.ts:619`). Finding 4 refuses a terminal covered subscription without
   cancelling it, so Stripe carries no `covered_by_lifetime` marker on it. A
   payment still in flight at that refusal is reported as "refunded when it
   settles", but the settlement handler (`refundIfRefusedAsCovered`, on
   `invoice.payment_succeeded`) refunded only subscriptions with the marker, so
   the settled payment stayed charged.

   **Fix: a durable refusal record, read beside the marker.**
   - `recordTerminalRefusal` writes a `billing_events` row when the refusal of a
     terminal, unmarked subscription runs. It uses the synthetic
     `stripe_event_id` `covered_by_lifetime_terminal:<subscription>` and
     `event_type` `internal.terminal_subscription_refused`. This is the
     write-once pattern of `claimRefusalReport` and `credit-revocations.ts`.
     The table's UNIQUE constraint makes the row write-once, and the prefix can
     never match a Stripe event id. The table already has RLS: service role
     manages, users read their own rows. No migration and no Stripe write: a
     canceled subscription is never updated.
   - The row is written **before** the invoice is scanned for payments. If a
     payment settles before the row lands, it is `paid` when the scan reads it
     and is refunded there. If it settles after, its settlement finds the row.
     `refundOnce` (metadata lookup plus a deterministic idempotency key) makes
     it one refund either way.
   - A failed write alerts (`record_terminal_refusal`, "refund it by hand") and
     returns 5xx. Nothing is scanned, refunded or recorded live until Stripe
     redelivers. This differs from the report claim on purpose: here, a lost row
     means a payment stays charged.
   - Settlement now asks `wasRefusedAsCoveredByLifetime`: the Stripe marker,
     or, for a terminal subscription only, the record. A live subscription's
     renewal never reads the record. A record that cannot be read alerts and
     returns 5xx. The customer-binding check still runs first, and the marker
     path is unchanged.

   **Why not re-run coverage and payment order at settlement.** That design
   also works and needs no write, but it is not as safe. (1) It re-decides with
   the grants that exist at settlement. If the lifetime is refunded or revoked
   between refusal and settlement, the payment stays charged, even though the
   refusal told ops it would be refunded. The record keeps the decision that was
   made and reported. (2) It would also refund canceled covered subscriptions
   that the refusal never decided on. The existing case "never refunds an
   invoice of a subscription that ended for another reason" pins that it must
   not. (3) It adds a grant read and a Stripe payment-intent read to
   settlement.

   Test-first evidence, in `stripe-webhook-lifetime-covered.test.ts` under a new
   `finding 5` describe: **5 failed, 93 passed** before the production change,
   then **98/98**. Cases:
   (a) a terminal subscription bought after the grant, payment in flight, is
   refused, then refunded exactly once on settlement, with the customer's own
   reason untouched;
   (b) the same across an identical settlement replay, a new settlement event
   after Stripe's idempotency key expires, and a resent refusal: one refund;
   (c) a terminal subscription bought before the grant: no refund on
   settlement;
   (d) an Agency subscription beside Lifetime Pro, and an account with no grant,
   both canceled by the customer: no refund on settlement;
   (e) a subscription the refusal cancelled itself is refunded from the marker
   alone, without reading the record;
   plus a payment that settles while the refusal is scanning its invoice (one
   refund), a failed record write (5xx, alert, nothing scanned, then fixed on
   redelivery), a failed record read at settlement (5xx, alert, then refunded on
   redelivery), and a live renewal that does not depend on the record.
   (c), (d), (e) and the live-renewal case are guards: they pass before and
   after the fix.

   Mutations, each restored afterwards (files byte-identical to the backup; baseline 98/98):
   settlement reads the marker only (5 red); record written after the scan
   (2 red); record read for live subscriptions too (1 red); write failure
   swallowed (1 red); read failure taken as "not refused" (1 red). Total: 10
   red, none surviving.

   Test fixture changed, declared: the fake database can fail the record's
   write or read separately (`terminalRefusalWriteFails` /
   `terminalRefusalReadFails`, matched by the synthetic id's prefix). No
   existing assertion changed.

   The gap this pass found in the opposite ordering is finding 6 below, fixed
   in this PR by architect decision.
6. **Finding 6 (implementer-found, opposite ordering): a covered subscription
   the customer ended before the lifetime's event lands stays charged.** The
   failing order: the subscription's event is processed first, before any grant
   exists, so it is recorded live. The customer then cancels it. The lifetime's
   event is processed last. `stopBillingForLifetimeOwner` reads only live
   `billing_subscriptions` rows, and it `continue`s past any subscription Stripe
   says is over. So a subscription bought after the lifetime was never refunded
   or recorded. Its paid payments stayed charged, and so did any payment still
   in flight.

   **Fix: `refuseEndedSubscriptionsCoveredByGrant`, the last step of
   `grantLifetime`.**
   - **Bounded listing.** `listEndedSubscriptionsSince` (lib) calls
     `subscriptions.list` with this customer (`billing_customers`), status
     `ended` (`canceled` and `incomplete_expired`), and
     `created[gte]` = the lifetime payment intent's `created`. That is the
     same payment time the live path compares with. It reads 100 per page
     with `starting_after` until `has_more` is false. A page that says more
     but does not advance its cursor throws, through the shared
     `nextStripePageCursor`. No unbounded scan: one customer, ended
     subscriptions only, and only those created since the lifetime was paid.
   - **Same decision as findings 4 and 5.** Each listed subscription without
     the `covered_by_lifetime` marker goes through `refuseIfLifetimeCovers`
     with its resolved plan. That is the subscription-first ordering's own
     decision: `readLifetimeCover` (undated, non-trial, non-revoked grants,
     earliest first), then `wasBoughtWithPlanAlreadyOwned`. If the
     subscription was bought after the cover, `recordTerminalRefusal` runs
     before the invoice scan. Then `refuseSubscriptionCoveredByLifetime`
     refunds what the latest invoice collected through `refundOnce`, without
     cancelling again (`cancelCovered` skips terminal subscriptions) and
     without touching the cancellation reason. It is reported once through
     `claimRefusalReport`. A subscription bought before is returned untouched,
     with no record, no scan and no update. A subscription carrying the marker
     was refused by our own cancellation, and that refusal owns it.
   - **In-flight payments** settle later through `wasRefusedAsCoveredByLifetime`
     (finding 5), from the record.
   - **Retryable, unlike the rest of the grant's follow-up.** This step throws
     after alerting, and the route answers 5xx, in four cases: listing
     failure (`refuse_ended_covered_subscriptions`), plan-resolution failure,
     record-write failure (`record_terminal_refusal`, as in finding 5), and
     refund failure. A 5xx alone would not help, because a redelivered grant
     short-circuits on its duplicate. So `grantLifetime`'s duplicate branch now
     runs this one step again. Everything else stays first-delivery-only and
     keeps its never-throw rule. Every part is idempotent: the record is
     write-once, refunds are found by metadata, the report is claimed once.
     The step runs last, so every never-throw step has already run when it
     throws. It tries every subscription before rethrowing the first failure.
   - **Live path unchanged.** A live subscription bought after the lifetime is
     still cancelled with the marker and refunded once. A live subscription
     bought before is still set to end at period end. The ended-subscription
     step skips both: the marker for the first, the `ended` filter for the
     second.

   Test-first evidence, in `stripe-webhook-lifetime-covered.test.ts` under a new
   `finding 6` describe. Before the production change: **10 failed, 100
   passed**. Nine were the new or changed cases. The tenth was a neighbouring
   test hit by the refund-failure case's unconsumed `mockRejectedValueOnce`,
   because that refund is never attempted before the fix. After: **110/110**.
   Cases:
   (a) the lifetime event after the subscription's, with the subscription
   ended and paid after the grant. Run with the local row `canceled` and
   still `active`: one refund, one record, no cancel or update, the
   customer's reason kept, one report;
   (b) the same with a payment in flight: no refund at the lifetime event, then
   one refund at settlement;
   (c) an ended subscription bought before the grant: untouched, before and at
   settlement (no record, no scan, no refund, no alert). An ended Agency
   subscription beside Lifetime Pro: also untouched;
   (d) the lifetime event replayed (ledger duplicate), then the same purchase's
   other event after Stripe's idempotency key expires (grant duplicate, step
   re-run): still one refund, one record, one report;
   (e) the live path unchanged. Bought after: cancelled with the marker, one
   invoice scan, one refund, no record. Bought before: one period-end update,
   no scan, no refund, no record;
   plus four more cases: a second-page covered subscription, which pins the
   exact list parameters (customer, `ended`, `created.gte`, limit 100,
   `starting_after`) and another customer's subscription never being listed;
   a cursor that does not advance (5xx and alert, then finished on
   redelivery); a record-write failure (5xx and alert, nothing scanned, then
   finished on redelivery); and a refund failure (5xx and alert, then one
   refund on redelivery).
   The fake `subscriptions.list` applies the customer and status filters but
   deliberately not the creation window. So (c) proves the route's own
   payment-order check spares a predating subscription, and the window itself
   is pinned by the request parameters.

   **Existing assertion changed, declared:** "m-3: leaves alone a subscription
   Stripe already ended for another reason" was a subscription bought after
   the lifetime and ended by the customer, with no refund expected. That
   expectation encoded this finding. It now expects one refund, still no
   cancel or update, and one report with no false alarm. The predating case
   (c) keeps the legitimate no-refund behaviour.
   **Fixtures changed, declared:** the lifetime-covered suite's Stripe fake
   gained `subscriptions.list`. `lifetime-grant-plan.test.ts`'s Stripe fake
   gained `subscriptions.list` (no ended subscriptions) and
   `paymentIntents.retrieve`. No assertion changed there.

   Mutations, each restored afterwards (files byte-identical to the backup;
   baseline 110/110):

   | Mutation | Red |
   |---|---:|
   | duplicate path does not re-run the step | 3 |
   | step never runs on a fresh grant | 9 |
   | no creation window | 1 |
   | first page only | 1 |
   | cursor not validated | 1 |
   | marker not skipped | 2 |
   | predating terminal not spared | 3 |
   | per-subscription failures swallowed | 2 |
   | listing failure swallowed | 1 |

   Total: 23 red. One mutation survived: removing a pre-filter
   (`isPlanCoveredByGrants(plan, [grantsPlanId])`) that duplicated
   `readLifetimeCover`'s own coverage rule. The filter was removed rather than
   kept as a dead guard, so every ended subscription in the window gets
   exactly the other ordering's decision. The suite stays 110/110.

   Limit, same as findings 1 and 4: only the subscription's latest invoice is
   refunded. A subscription bought after the lifetime and ended before its
   event has, in practice, only its first invoice.

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

### Finding 5 verification

Same environment: Node `24.14.0`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`,
no provider environment variables, and no Stripe, Supabase or production calls.

- `npm run lint`: passed, 0 errors / 31 existing warnings.
- `npm run type-check`: passed, no diagnostics.
- `npm run format:check`: passed.
- `npm test -- --runInBand --runTestsByPath src/__tests__/api/billing/stripe-webhook-lifetime-covered.test.ts`:
  1 suite, 98/98 passed. Before the production change: 5 failed / 93 passed.
- `npm test -- --runInBand --testPathPatterns='src/__tests__/api/billing/|src/__tests__/lib/stripe/|src/__tests__/lib/billing/|src/components/billing/__tests__/'`:
  53 suites / 879 tests passed, 0 failures.
- `npm test`: 437 suites passed, 2 skipped; 6,080 tests passed, 38 skipped;
  0 failures.
- DB harness: not run. No migration was added, and the record reuses
  `billing_events` and its existing UNIQUE constraint and RLS.

### Finding 6 verification

Same environment and rules: no Stripe, Supabase or production calls.

- `npm run lint`: passed, 0 errors / 31 existing warnings.
- `npm run type-check`: passed, no diagnostics.
- `npm run format:check`: passed.
- `npm test -- --runInBand --runTestsByPath src/__tests__/api/billing/stripe-webhook-lifetime-covered.test.ts src/__tests__/api/billing/lifetime-grant-plan.test.ts`:
  2 suites, 128/128 passed (110 + 18). Before the production change, the
  lifetime-covered suite had 10 failed / 100 passed.
- `npm test -- --runInBand --testPathPatterns='src/__tests__/api/billing/|src/__tests__/lib/stripe/|src/__tests__/lib/billing/|src/components/billing/__tests__/'`:
  53 suites / 891 tests passed, 0 failures.
- `npm test`: 437 suites passed, 2 skipped; 6,092 tests passed, 38 skipped;
  0 failures.
- DB harness: not run. No migration was added.

The prior independent review remains evidence for its stated SHA only. No
production/provider call or deployment was made by this implementation pass.

Max severity: none
Ship allowed: yes
