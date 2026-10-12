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
     (Changed by the independent review, minor 3 below: a plan that cannot be
     resolved is now skipped with a warning, not retried.)
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
   The fake `subscriptions.list` applied the customer and status filters but
   deliberately not the creation window, so (c) proved the route's own
   payment-order check. (Changed by the independent review, minor 5 below:
   the fake now honours `created.gte` too.)

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
   (Changed by the independent review, minor 3 below: the cover is now read
   once per run for the grant's plan, so the filter is back and no longer
   redundant; mutation R14 pins it.)

   Limit, same as findings 1 and 4: only the subscription's latest invoice was
   refunded. (Fixed by the independent review, minor 2 below, for
   subscriptions the customer ended.)

## Independent review of `9807278..5ae80b1`

The review blocked ship at max severity major. Each finding was fixed in this
branch, test-first.

1. **MAJOR 1: a charge already refunded or disputed outside the webhook stays
   at 500 forever.** `refundOnce` is reachable from the subscription refusal,
   the lifetime step and settlement. Suppose support fully refunds or cancels
   from the dashboard before a delayed `customer.subscription.created` or
   `checkout.session.completed` is redelivered. `findCoveredRefund` misses that
   refund, which has no metadata. `refunds.create` fails with
   `charge_already_refunded` or `charge_disputed`, which becomes
   `CoveredRefundFailed` and a 500 forever. The `billing_subscriptions` upsert
   and `finishSubscriptionCheckoutIntent` never run, so the user cannot start
   another Checkout.

   **Fix.** After our own refund is looked up (our refund is what makes a
   charge read as refunded, so it is looked up first), `refundOnce` reads the
   charge: the payment intent's `latest_charge` (expanded), or the charge
   itself.
   - **Refunded in full**: settled outside this flow
     (`refundedOutsideChargeIds`). Reported at info; nothing more is refunded
     and nothing throws.
   - **Partly refunded**: only `amount_captured - amount_refunded` is
     refunded, under a key that names the remainder
     (`…-remainder-<amount>`), so a full-refund key is never reused with other
     parameters.
   - **Disputed** (`disputedChargeIds`): nothing is refunded and nothing
     throws. The new `warnOps` warns ops once per charge, as a Sentry
     *warning*: "is disputed, so it was not refunded: resolve it in Stripe".
     "Once" comes from a write-once `billing_events` claim
     (`covered_by_lifetime_disputed:<charge>`). `logger.warn` reaches stdout
     only, so `warnOps` sends the Sentry warning itself, behind the logger's
     production gate.
   - **Backstop**: `charge_already_refunded` and `charge_disputed` from
     `refunds.create` are caught, with the same outcomes.
   - A payment intent with no charge is refunded as before, with Stripe's
     refusal as the backstop. A charge that cannot be read still throws: no
     money decision is made without knowing.

   Tests, all through `checkout.session.completed`, assert 200, the
   subscription recorded and the Checkout intent `completed`:
   - a charge already refunded in full;
   - a partly refunded charge (`amount: 1400`, the remainder key, and found
     again by the subscription's own event);
   - a disputed charge (one warning across two events);
   - each backstop code;
   - a late payment refunded outside before it settles (settlement answers 200,
     no refund).
2. **Minor 2: only `latest_invoice` was refunded.**
   `refuseSubscriptionCoveredByLifetime` now marks a subscription that was
   already over, and not by our cancellation, as `endedBeforeRefusal`. For
   those it refunds the latest invoice plus every paid invoice
   (`invoices.list({subscription, status: "paid", limit: 100})`, paged with
   the shared cursor check), each once. A live subscription keeps the
   latest-invoice refund: our cancellation issues no final invoice. After an
   ended subscription's refusal is reported (once), the customer's credit
   balance is read. If it holds credit, likely its cancellation's proration,
   ops get a warning to clear it, since otherwise the unused time is paid
   back twice. A balance that cannot be read is itself the warning. Never
   throws.
   Tests: the latest invoice is a final credit invoice and the first invoice
   is refunded; two pages of paid invoices; a non-advancing cursor fails
   closed; one credit warning across two events; a live subscription lists
   no invoices and reads no balance.
3. **Minor 3: duplicate-path fragility.** `refuseEndedSubscriptionsCoveredByGrant`
   now reads the billing customer, then `readLifetimeCover` for the grant's
   plan once per run, and returns early when there is no live cover. Such as
   a revoked lifetime whose late duplicate event arrives: nothing is listed.
   The cover's `paidAt` bounds the listing. Each subscription gets
   `refuseIfLifetimeCovers` with that cover, so its plan must be one the grant
   covers (`isPlanCoveredByGrants`). The cover's `paidAt` also handles a
   payment Stripe does not have, which `lifetimePaymentTime` threw on. An
   ended subscription whose plan cannot be resolved is skipped with a
   warning, not retried for days.
   Tests: a revoked lifetime lists nothing; two ended subscriptions read the
   lifetime's payment once; an unresolvable plan gets one warning while the
   covered subscription is still refunded.
4. **Minor 4: a false alarm when nothing was collected.** A refusal that
   refunded nothing and left nothing pending or in flight is reported at info
   ("nothing it collected needed refunding"), not as an error. A refusal
   whose only outcome is "refunded outside" or "disputed" is also reported at
   info, with the dispute's own warning.
   Test: an `incomplete_expired` subscription bought after the grant produces
   no `logger.error`.
5. **Minor 5: the fake honours `created.gte`.** `subscriptions.list` in the
   suite now applies the creation window. The pagination case includes a
   predating ended subscription of the same customer, which is not listed.

**Red first:** in the lifetime-covered suite, 14 failed, 111 passed. In
`ops-alert.test.ts`, 2 failed, 3 passed (`warnOps` did not exist). After: 125/125
and 5/5. The live-subscription case of minor 2 is a guard that passed before.

**Fixtures changed, declared.**
- Lifetime-covered suite: its Stripe fake gained `charges.retrieve`,
  `invoices.list` (default: the first invoice, paid) and `customers.retrieve`
  (balance 0). `paymentIntents.retrieve` now answers `latest_charge` from a
  per-test charge table with a clean default. The logger's `warn` is a named
  mock. In "mi-2", the fake rejects only the seeded grant's missing payment
  (`pi_qa_journey`) instead of every payment intent, because the refund now
  reads the subscription's own payment, which exists. No assertion changed.
- `lifetime-grant-plan.test.ts`: the fake database gained `neq` and `or`,
  which the shared grant reader uses now that a new grant reads its cover.
  No assertion changed.

**Mutations,** each restored afterwards (files byte-identical; baseline
125/125):

| Mutation | Red |
|---|---:|
| R1 no charge pre-check | 4 |
| R2 full outside refund not settled | 2 |
| R3 partial refunds the whole charge | 1 |
| R4 dispute not detected | 1 |
| R5a backstop `charge_already_refunded` missing | 1 |
| R5b backstop `charge_disputed` missing | 1 |
| R6 dispute warning not once | 1 |
| R7 ended subscription: latest invoice only | 4 |
| R8 paid invoices: first page only | 3 |
| R9 credit balance never checked | 1 |
| R10 cover re-read per subscription | 1 |
| R11 no early return without a cover | 1 |
| R12 unresolvable plan fails the run | 1 |
| R13 nothing collected reported as an error | 4 |
| R14 no plan-coverage filter | 2 |

Total: 28 red. All 15 mutations were caught.

### Known follow-up, not this PR: s82b

**s82b: a subscription `incomplete` at both events, then activating.** A
subscription Checkout is paid after the lifetime, but its first payment needs
action (3-D Secure, a bank debit), so the subscription is `incomplete`.

1. Its own event is processed before the grant exists:
   `refuseIfLifetimeCovers` finds no cover, and the subscription is recorded
   `incomplete`.
2. The lifetime's event comes next. `stopBillingForLifetimeOwner` reads only
   live rows (`active`, `trialing`, `past_due`), and the ended-subscription
   step lists only `ended` ones. An `incomplete` subscription is neither, so
   nothing refuses it.
3. When its payment then completes, `customer.subscription.updated` records it
   `active` without any refusal. The owner is billed monthly for a plan the
   lifetime covers.

Decision needed: refuse on the transition to live in the update handler,
include `incomplete` subscriptions in the lifetime step, or both.


## Re-review of `76f610f`: N1–N3

The re-review gave `Max severity: minor`, ship allowed. Devin rated N1 🔴
(comment 4244242732 on `route.ts:1865`). The architect asked for N1–N3 to be
fixed before accepting that verdict. Each was fixed test-first.

1. **N1 (Devin 🔴, reviewer minor): a transient catalogue failure skipped a
   refund for good.** `configuredStripePriceId` turns a failed `plans` read
   into null. So `resolveSubscriptionPlan` threw "resolves to 0 plans", which
   looked exactly like an unknown price. The ended-subscription step then
   skipped the subscription with a warning and answered 200, and Stripe
   stopped retrying.

   **Fix.**
   - New `loadPaidPlanPriceIndex()` in `plans.ts`: one `getPlanCatalogue()`
     load, from which every sold plan's configured monthly and yearly prices
     are indexed. The column-or-environment rule moved, unchanged, into
     `configuredPriceIdOf`, which `resolveStripePriceId` now shares. A read
     failure throws. A pair with no price configured is simply absent. So
     "not in the index" means "not sold by a catalogue that loaded".
   - The ended-subscription step loads the index once per run, after the
     early returns (no customer, no live cover, no ended subscription), inside
     its alert-and-5xx block. A catalogue read failure therefore answers 5xx
     and is retried, with nothing skipped.
   - Each subscription's plan comes from `planOfPrices`, using the snapshot:
     - **Confirmed unknown** (no price the loaded catalogue sells): skipped,
       with one warning across every duplicate event. That warning is claimed
       through a write-once `billing_events` row
       (`covered_by_lifetime_unknown_price:<sub>`); the dispute warning now
       shares the same claim helper.
     - **Undecidable** (a price configured for two plans, or two plans
       `metadata.plan_id` does not settle): alerted and counted as a failure,
       not skipped.
   - Failures do not stop the loop. Every subscription is tried, then the
     first failure is thrown, so the retry handles the rest idempotently.
   - Tests:
     - The catalogue cannot be read: 5xx, nothing refunded, no skip warning;
       the retry refunds.
     - A confirmed-unknown price: one warning across two deliveries.
     - One transient refund failure beside a coverable subscription: that one
       is refunded, the event still answers 5xx, and the retry refunds the
       other.
     - A price configured for two plans: 5xx and alert, no skip.
     - Six index unit tests in `plans.test.ts`, including "throws when the
       catalogue cannot be read, where the single lookup answers null".
2. **N2 (minor): every paid invoice was refunded for the plan the
   subscription ended on.** (Superseded by the Devin round on `8744bed`
   below: invoices are now decided per invoice, over every line, by product,
   against every grant paid before the subscription.)

   **Fix.** For a subscription the customer ended, each candidate invoice
   (every paid one, plus the latest, retrieved when it is not among them) is
   refunded only when one of its lines bills a plan the covering grant covers.
   - The covering grant's plan is a new `LifetimeCover.planId`.
   - Line prices come from basil's `pricing.price_details.price`, or from an
     older endpoint's `price`. They are read from every page when an invoice's
     `lines.has_more` is true (`invoices.listLineItems`, cursor checked).
   - They are resolved through the same snapshot: passed in by the
     ended-subscription step, or loaded once by the refusal itself for the
     subscription-first path.
   - A line price configured for two plans fails closed.
   - A live subscription keeps its latest invoice.
   - Tests:
     - A subscription bought on Agency after Lifetime Pro, downgraded to Pro,
       then ended: the Pro-period invoice is refunded, the Agency-period one is
       neither scanned nor refunded.
     - An invoice whose covering line is on its second page of lines.
     - A two-plan line price: 5xx and alert.
3. **N3 (minor): our own refund could be reported as "refunded outside".**
   Another delivery of the same refusal can land our refund between our
   metadata lookup and the charge read, or the refund request.

   **Fix.** `outsideUnlessOurs` looks for our refund by metadata once more
   before saying "refunded outside", from both the charge pre-check and the
   `charge_already_refunded` backstop.
   - Tests: the refund lands between our lookup and the charge read; it lands
     between the charge read and our request. Both are reported as one refund
     of ours (`re_concurrent`), never as "outside".

**Red first:** 14 failed. Six were in `plans.test.ts` (the index did not
exist). Eight were in the lifetime-covered suite: N1 ×3, N2 ×3, N3 ×2. The
transient-failure case (N1) was already green, a guard for existing
behaviour. After: `plans.test.ts` 55/55, the lifetime-covered suite 134/134.

**Fixtures changed, declared:**
- The lifetime-covered suite's `plans` mock gained `loadPaidPlanPriceIndex`:
  the same fixture catalogue, plus `price_shared` configured for two plans,
  and a `mockCatalogueReadFails` switch.
- Its invoices now carry line prices: `invoiceFor`, and an `invoices.list`
  default answering the subscription's latest invoice at its own price.
- Its Stripe fake gained `invoices.retrieve` and `invoices.listLineItems`.
- The minor-2 cases' invoices carry Pro lines.
- No assertion changed.

**Mutations,** each restored afterwards (files byte-identical; baseline
189/189 across both suites):

| Mutation | Red |
|---|---:|
| N1a catalogue failure read as an empty catalogue | 1 |
| N1b unknown-price warning not once | 1 |
| N1c undecidable plan skipped as unknown | 1 |
| N1d first per-subscription failure stops the run | 1 |
| N1e index swallows a catalogue read failure | 1 |
| N2a every paid invoice refunded whatever it bills | 1 |
| N2b only the lines an invoice carries | 1 |
| N2c a two-plan line price read as uncovered | 1 |
| N3a pre-check: ours reported outside | 1 |
| N3b backstop: ours reported outside | 1 |

Total: 10 red. All 10 mutations were caught.

## Devin round on `8744bed`

Devin re-ran on `8744bed` and raised four 🔴 and one 🟡, all against N2's
invoice coverage. The architect mandated one design rather than five patches.
It covers the refunds of ENDED subscriptions bought after a grant; live
subscriptions are unchanged.

| Comment | Finding | Fixed by |
|---|---|---|
| 4244837497 🔴 | A payment settling later on an invoice the refusal excluded was refunded: settlement trusted the subscription-wide record. | Settlement runs the same per-invoice decision for a refusal known by its record. |
| 4244837575 🔴 | A Pro + Agency invoice on one payment was refunded in full once a Pro line was found. | Every billable line must be covered; a mixed invoice goes to a person. |
| 4244837615 🔴 | A paid invoice on a retired Pro price mapped to no plan and was left charged. | Lines map to plans by Stripe product, which a price change keeps. |
| 4244837673 🔴 | Only the earliest grant counted, so an Agency invoice beside Lifetime Pro then Founding Agency was excluded. | Coverage is every live grant paid at or before the subscription was bought. |
| 4244837719 🟡 | `some` stopped at the first covered line, so a later ambiguous line escaped. | Every line is read before deciding. |

**Design.**
- **Pure decision.** `decideInvoiceRefund(lines, coverage, productIndex)` lives
  in the new `src/lib/stripe/covered-refund-decision.ts`, with no I/O. It reads
  every line. Zero-amount and negative lines (proration credits) never decide
  anything. Each billable line maps to plans through its product:
  - **refund**: every billable line bills a covered plan;
  - **skip**: no line bills a covered plan, or nothing was charged;
  - **manual**: covered and uncovered lines together, an ambiguous product
    (several plans), or an unresolvable line (no product, or a product no plan
    sells).

  One deliberate tightening: a billable line whose product maps to no plan is
  *unresolvable*, not "uncovered". An old price moved to a new product must
  reach a person rather than be skipped silently, which is Devin's own advice
  on 4244837615. The same module holds `planOfProducts`, the product-based
  successor of N1's `planOfPrices`, for a subscription's own plan.
- **Coverage.** `readDatedLifetimeGrants` reads every live undated grant with
  its payment time, once per run. `coverageAt` keeps the grants paid at or
  before the subscription was bought (`wasBoughtWithPlanAlreadyOwned`).
  `coverFrom` derives the earliest cover from the same read, so minor 3's
  "once per run" holds.
- **Product index.** The catalogue stores price ids only, no products.
  `loadPlanProductIndex` loads the catalogue once (`loadPaidPlanPriceIndex`,
  failing loudly, as in N1). It reads each configured price's product from
  Stripe once per run, cached, and maps product to plans.
  - Basil lines carry `pricing.price_details.product` directly. An older
    endpoint's `price.product`, or the price's product read through the same
    cache, is the fallback.
  - A subscription's own plan is resolved by its items' products too, so a
    subscription still on a retired price is not skipped as "unknown".
- **Refusal path.** For an ended subscription, the latest invoice and every
  paid invoice are decided over all their lines. Refund goes through the
  existing idempotent path. Skip is silent. Manual is reported in the refusal
  (`manualReviewInvoices`) and warned once per invoice: a write-once
  `billing_events` row (`covered_by_lifetime_manual_invoice:<invoice>`), as a
  Sentry warning: "invoice <id> mixes covered and uncovered charges … refund
  the covered lines by hand".
- **Settlement path.** When a refusal is known by its terminal record rather
  than our marker, `refundIfRefusedAsCovered` makes the same decision on the
  settled invoice before refunding. It never refunds an uncovered or mixed
  invoice; a mixed one is warned once. Marker refusals are unchanged.

**Tests, red first.**
- `covered-refund-decision.test.ts` (new, 17): could not run before the module
  existed. It covers:
  - all covered;
  - Starter beside Lifetime Pro;
  - none covered;
  - mixed;
  - ambiguous after covered;
  - an unmapped product after covered;
  - no product;
  - a retired price on a covered product;
  - two grants (Pro then Agency) covering an Agency invoice;
  - zero and credit lines (including an ambiguous credit);
  - only credits;
  - no grant;
  - reason precedence;
  - four `planOfProducts` cases.
- Lifetime-covered suite: **8 failed, 136 passed** before the change, then
  **144/144**. The new "Devin round on 8744bed" describe:
  - 4244837497 ×3: an excluded Agency invoice settling later is not refunded;
    a covered invoice settling later still is; a mixed one settling later is
    warned once.
  - 4244837575: a Pro + Agency invoice is not refunded, with one warning
    across two events.
  - 4244837615: a retired Pro price is refunded through its product.
  - 4244837673 ×2: Lifetime Pro then Founding Agency covers the Agency
    invoice; an Agency grant paid after the subscription does not.
  - 4244837719: an ambiguous line after a covered one is not refunded.
  - A proration credit does not make a Pro invoice mixed.
  - A live subscription's refusal is unchanged: no invoice listing, retrieval
    or price read.
  - The covered-settlement, later-grant, credit and live cases are guards that
    passed before.

**Existing assertions changed, declared:** two N2 cases.
- "fails closed when an invoice line's price is configured for two plans"
  (500) became "sends an invoice whose line product is configured for two
  plans to a person, never refunding it" (200 and one warning). The design
  sends ambiguity to a person, not into a retry loop.
- "reads an invoice's lines past the first page before deciding" now proves
  paging by an Agency line on page two that makes the invoice mixed. Before,
  its first-page Agency line plus a second-page Pro line was refunded; that
  is mixed under this design.

**Fixtures changed, declared:**
- The Stripe fake gained `prices.retrieve`.
- Lines carry `amount` and their product (`productOf`, where the retired
  `price_pro_v1` belongs to Pro's product).
- The `plans` mock's index gained `priceIds`.
- `invoicePaid` takes an invoice id.
- `plans.test.ts` asserts the index's `priceIds`.

**Mutations,** each restored afterwards (files byte-identical; baselines
17/17 and 144/144):

| Mutation | Suite | Red |
|---|---|---:|
| P1 zero-amount lines decide | pure | 2 |
| P2 credit lines decide | pure | 2 |
| P3 a line with no product is ignored | pure | 2 |
| P4 ambiguous product counted as covered | pure | 2 |
| P5 unmapped product counted as uncovered | pure | 1 |
| P6 stops at the first covered line | pure | 3 |
| P7 only the first grant covers | pure | 1 |
| P8 ambiguity not reported | pure | 2 |
| P9 unresolvable not reported | pure | 3 |
| P10 ambiguity named after a missing product | pure | 1 |
| P11 nothing covered is not skipped | pure | 3 |
| P12 a mixed invoice is refunded | pure | 1 |
| P13 `planOfProducts` ignores ambiguity | pure | 1 |
| P14 `planOfProducts` ignores the declared plan | pure | 1 |
| I1 settlement skips the per-invoice decision | webhook | 2 |
| I2 coverage ignores payment order | webhook | 1 |
| I3 coverage from the earliest grant only | webhook | 1 |
| I4 manual-review warning not once | webhook | 2 |

Total: 31 red. All 18 mutations were caught.

**Scope note on 4244837673.** The architect's rule judges an ended
subscription's invoices against the grants paid before *the subscription* was
bought, not before each invoice. Suppose a subscription was bought between a
Lifetime Pro and a later Lifetime Agency. Its Agency-period invoices are not
refunded here; that subscription predates the Agency grant. The later grant's
own event treats a live subscription it covers in the usual way (set to end
at period end). This is recorded so the architect can confirm it is the
intended boundary.

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

### Independent-review fixes verification

Same environment and rules: no Stripe, Supabase or production calls.

- `npm run lint`: passed, 0 errors / 31 existing warnings.
- `npm run type-check`: passed, no diagnostics.
- `npm run format:check`: passed.
- `npm test -- --runInBand --runTestsByPath src/__tests__/api/billing/stripe-webhook-lifetime-covered.test.ts src/__tests__/api/billing/lifetime-grant-plan.test.ts src/__tests__/lib/monitoring/ops-alert.test.ts`:
  3 suites, 148/148 passed (125 + 18 + 5).
- `npm test -- --runInBand --testPathPatterns='src/__tests__/api/billing/|src/__tests__/lib/stripe/|src/__tests__/lib/billing/|src/components/billing/__tests__/|src/__tests__/lib/monitoring/'`:
  54 suites / 911 tests passed, 0 failures.
- `npm test`: 437 suites passed, 2 skipped; 6,109 tests passed, 38 skipped;
  0 failures.
- DB harness: not run. No migration was added; the dispute claim reuses
  `billing_events`.

### N1–N3 verification

Same environment and rules: no Stripe, Supabase or production calls.

- `npm run lint`: passed, 0 errors / 31 existing warnings.
- `npm run type-check`: passed, no diagnostics.
- `npm run format:check`: passed.
- `npm test -- --runInBand --runTestsByPath src/__tests__/api/billing/stripe-webhook-lifetime-covered.test.ts src/__tests__/lib/stripe/plans.test.ts src/__tests__/api/billing/lifetime-grant-plan.test.ts src/__tests__/lib/monitoring/ops-alert.test.ts`:
  4 suites, 212/212 passed (134 + 55 + 18 + 5).
- `npm test -- --runInBand --testPathPatterns='src/__tests__/api/billing/|src/__tests__/lib/stripe/|src/__tests__/lib/billing/|src/components/billing/__tests__/|src/__tests__/lib/monitoring/'`:
  54 suites / 926 tests passed, 0 failures.
- `npm test`: 437 suites passed, 2 skipped; 6,124 tests passed, 38 skipped;
  0 failures.
- DB harness: not run. No migration was added; the unknown-price claim reuses
  `billing_events`.

### Devin round on `8744bed` verification

Same environment and rules: no Stripe, Supabase or production calls.

- `npm run lint`: passed, 0 errors / 31 existing warnings.
- `npm run type-check`: passed, no diagnostics.
- `npm run format:check`: passed.
- `npm test -- --runInBand --runTestsByPath src/__tests__/api/billing/stripe-webhook-lifetime-covered.test.ts src/__tests__/lib/stripe/covered-refund-decision.test.ts src/__tests__/lib/stripe/plans.test.ts src/__tests__/api/billing/lifetime-grant-plan.test.ts src/__tests__/lib/monitoring/ops-alert.test.ts`:
  5 suites, 239/239 passed (144 + 17 + 55 + 18 + 5).
- `npm test -- --runInBand --testPathPatterns='src/__tests__/api/billing/|src/__tests__/lib/stripe/|src/__tests__/lib/billing/|src/components/billing/__tests__/|src/__tests__/lib/monitoring/'`:
  55 suites / 953 tests passed, 0 failures.
- `npm test`: 438 suites passed, 2 skipped; 6,151 tests passed, 38 skipped;
  0 failures.
- DB harness: not run. No migration was added; the manual-review claim
  reuses `billing_events`.

The gate lines below were `pending` until the architect's re-review. The
re-review's verdict (minor, ship allowed) stood with N1–N3 fixed and stands
with the Devin round on `8744bed` fixed. s82b remains the recorded follow-up.

The prior independent review remains evidence for its stated SHA only. No
production/provider call or deployment was made by this implementation pass.

Max severity: minor
Ship allowed: yes
