# Research — s112-verified-purchase-analytics

Date: 2026-10-12. Depends on s110 context and s111 outbox; released s82 billing fixes are the payment baseline. Documentation only.

## Verified sources and premise

`src/app/api/webhooks/stripe/route.ts` verifies the Stripe signature, records `billing_events` before handlers and marks it processed after success. Existing processed-event short-circuit is keyed by Stripe event ID. `claimBillingEvent` stores `event.data`, not the full event envelope, so the database JSON does not prove event-level `livemode`. Read the original event by its stored Stripe event ID through a bounded provider retrieve and cross-check the known authoritative payment object's mode; unavailable/mismatching proof is unknown/suppressed, never inferred from ID prefixes or the configured key. This cannot deduplicate two different event types describing one purchase.

- `handleInvoicePaymentSucceeded` resolves billing customer and invoice subscription across Stripe API shapes, then upserts `billing_invoices` by `stripe_invoice_id`. Later s82 paths can refund a payment already covered by a lifetime grant. Enqueueing analytics immediately after the invoice upsert would misclassify those refunds.
- `handlePaymentIntentSucceeded` provisions known credit/lifetime purchases using server-originated metadata. Lifetime also has `handleCheckoutSessionCompleted`, sharing the payment-intent ID. These are two evidence paths for one transaction.
- `handleCheckoutSessionCompleted` may handle incomplete subscriptions and returns for unpaid one-off sessions. Checkout completion is not a generic proof of collected money.
- `src/lib/stripe/checkout.ts` makes signed webhook reconciliation authoritative; the return URL is not authority. Payment-method setup has no purchase.
- `src/lib/stripe/config.ts` and `mode.ts` select test/live secrets explicitly. Existing invoice rows do not carry livemode; existing Pro status and trial entitlement must not be counted as paying customers.
- Refund/dispute handling affects entitlement and credits, while recurring subscription billing has its own termination semantics. Net revenue and current entitlement are different measures.

## Measurement definitions

**Paid transaction:** positive money actually collected in live mode for a recognized RecopyFast purchase, resolved to the authoritative billing customer/account, after successful reconciliation. Exclude test mode, trials, zero-dollar invoices, setup, failed/unpaid objects and payments that the s82 duplicate protection automatically returns.

**New paying account:** first qualifying live paid transaction for an account; recurring invoices add transactions/revenue, not new accounts. **Current paid entitlement** is a separate billing measure. **Net retained amount** subtracts successful refunds/lost disputes and does not equate a refund request with returned money.

All-account payment counts come from verified billing evidence. GA sends only the subset with context eligible at the true payment occurrence and still valid at dispatch; a renewal without a recent eligible marketing context remains in first-party metrics even if not sent to GA. The revised s110 proposal retains consent/client ID for 30 days to cover the normal 14-day trial; session eligibility remains a separate 24-hour window with actual session bounds. Day-14 conversion must not be discarded merely because the original session expired. Renewals/refunds after client-context expiry or consent withdrawal remain first-party evidence and may be absent from GA. Therefore GA is not a complete net-revenue ledger. A purchase with uncertain delivery is not known unsent; its refund must be held for explicit reconciliation, not discarded as an orphan.

## Official evidence and pitfalls

- [Purchase deduplication](https://support.google.com/analytics/answer/12313109): web streams deduplicate `purchase` by transaction ID; ID must be unique, nonempty and omit customer-identifying information. It is a second layer, not a replacement for local source dedupe.
- [Ecommerce](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce): purchase/refund events reference transaction and item information. Revenue/item value semantics must be reconciled with Stripe amounts, tax, discounts and currency minor units; do not blindly divide all currencies by 100.
- [MP transport](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference): 2xx does not prove ingestion and non-2xx does not authorize indiscriminate retry. The s111 explicit uncertain state remains necessary.

Use invoice identity for recurring subscription purchases and payment-intent identity for one-offs, resolving relationships so an invoice-associated payment intent is never counted again as a separate purchase. Choose among same-account contexts whose capture and effective-consent interval predate/include true payment occurrence, latest capture first with context UUID as a stable tie-breaker. Freeze that source choice (or explicit absence) by canonical payment key; a later consent grant, marketing visit or different device cannot retrospectively attribute the payment or replace a revoked context. Still recheck revocation/expiry at dispatch claim. Stable opaque delivery transaction IDs can be persisted in the existing s111 outbox; raw customer/user IDs never leave. Refund source keys must distinguish partial refund IDs and support repeated webhook delivery without subtracting the same amount twice.

## Open questions and complexity

Exact catalog currencies and Stripe live-object linkage must be verified in tests/current schema before implementation. Read-only production aggregation may need provider verification for legacy rows lacking mode; classify unknown rather than guessing from ID prefixes or subscription status.

The current signature-verified webhook is the monetary authority. Analytics enqueue/transport must not change its refund, retry or provisioning decisions. Reconciliation from already processed `billing_events` and existing purchase tables avoids failing a payment merely because analytics is unavailable. A finite created-at cursor/overlap is insufficient: an old event can stay `processed=false` past the overlap and become true later, with no processing timestamp. The plan therefore requires indexed anti-join discovery of every processed source lacking a durable analytics receipt, regardless of its creation date. Receipts record only delivery-pipeline normalization/retry state, not a duplicate financial ledger.

Complexity 4/5 if limited to normalization, existing outbox integration and accurate aggregate definitions. No new payment ledger, billing UI, checkout product, live test charge or subscription behavior change.

## Implementation-readiness addendum — 2026-10-12

Read-only refresh against the s110 worktree with released billing fixes. This addendum clarifies correctness within the human-validated story; it adds no financial mutation, dependency, UI or provider action. Working source remains mutable and must be refreshed at implementation.

### Exact source and reusable interfaces

- `src/app/api/webhooks/stripe/route.ts`: `claimBillingEvent` writes `data: event.data`, not the envelope. JSON therefore contains `object` and possibly `previous_attributes`; it does not preserve envelope `created` or `livemode`. `markBillingEventProcessed` updates only the boolean. The migration `20260731003000_missing_tables_billing_credits.sql` supplies separate user, processed and created-at indexes plus unique `stripe_event_id`, not a processed-at cursor.
- Subscriptions: processed `invoice.payment_succeeded`; invoice `id`, `customer`, `amount_paid`, `currency`, `status`, `status_transitions.paid_at`. The subscription is `parent.subscription_details.subscription`, with legacy `subscription` fallback. `billing_invoices.stripe_invoice_id` is the canonical local join; its `created_at` is local insertion time, not settlement, and the row does not establish live mode.
- One-offs: `payment_intent.succeeded` and lifetime `checkout.session.completed` resolve to one PI key. `src/lib/stripe/checkout.ts` writes PI metadata `type=credit_purchase`, `user_id`, `credit_quantity`, or `type=lifetime_purchase`, `user_id`, `product_id`, `grants_plan_id`, optional `founding_reservation_id`. Cross-check matching `credit_purchases.stripe_payment_intent_id` or `plan_entitlements.stripe_payment_intent_id` and the customer/account mapping.
- `src/lib/stripe/plans.ts` exports `findPaidPlanIdByStripePriceId`, `getOneTimeProduct`, `getCreditPackConfig`, `resolveStripePriceId`. Unknown/ambiguous matches return no attribution. Account mapping is `billing_customers.stripe_customer_id -> user_id`. `requireBillingCustomer` and `subscriptionOfInvoice` are private route functions, not reusable exports; do not import the route to gain utilities or rewrite monetary handlers.
- The pinned Stripe SDK supports `invoicePayments.list({payment:{type:"payment_intent",payment_intent:id}})` for PI-to-invoice mapping. Inspect/paginate all relevant allocations or report incomplete proof. `charge.invoice` and `payment_intent.invoice` are not available in this pinned API. SDK `InvoicePayment` exposes `status`, `amount_paid`, `currency`, `livemode`, `payment.type`, PI/charge reference, and `status_transitions.paid_at`.

### Settlement and cash proof

`src/lib/stripe/lifetime-covered-billing.ts:lifetimePaymentTime()` returns PI **creation time**, despite its business-oriented name. Do not reuse it as analytics settlement time. Use the successful payment event's authoritative occurrence; a fully paid invoice has `status_transitions.paid_at` and paid allocations have their own `paid_at`. PI `created`, Checkout `created`/completion, webhook receipt time and database insertion time are not substitutes. A Checkout-only payment whose actual settlement time cannot be established stays unknown/unattributed; do not select consent context using a guessed earlier or later time.

Invoice `amount_paid` alone can include customer credit/balance. Verify paid invoice-payment allocations and their underlying successful charge/PI to distinguish newly collected money from credit-funded settlement. Attribute each payment's actual invoice share, not the entire PI amount to every invoice. Multiple allocations, partial settlement, credits or missing pages that cannot be reconciled exactly remain unknown; do not publish a fabricated cash amount or silently claim a first paying account.

### Refunds and disputes

Processed `charge.refunded` can represent partial refunds. Read authoritative refund IDs and exact amount/currency; only `status=succeeded` proves returned money. `pending`/`requires_action` remain pending normalization; `failed`/`canceled` are not returned money. Preserve retryable source bookkeeping so later status success can be observed even without a new applicable webhook.

The exported `COVERED_BY_LIFETIME = "covered_by_lifetime"` in `src/lib/stripe/lifetime-covered-billing.ts` is written to refund `metadata.reason_code` with `subscription_id`. The webhook's duplicate Founding Agency refund uses `reason_code=duplicate_founding_lifetime` and `founding_reservation_id`. Reuse the exported constant for identification, but never invoke `refundCoveredInvoice()` or any mutation-capable refund helper from analytics. Its classification of pending refunds as “live” prevents duplicate refund creation; it is not a successful-refund accounting predicate.

`charge.dispute.created` is provisional. For `charge.dispute.closed`, verify the authoritative status; `lost` differs from `won`/`warning_closed`. Keep a dispute separate from a refund and reconcile their relationship before computing net retained amount. A disputed charge can also be refunded; subtracting both blindly double-counts the same returned principal. Unresolved overlap is explicitly unknown, not a guessed net total.

### Currency and historical completeness

Current checkout config is explicitly `STRIPE_CONFIG.CURRENCY = "usd"`; no general minor-unit conversion helper was found. The minimal implementation supports verified USD amounts (`minor units / 100`) and fails closed as unsupported for other currencies. This is validation of actual supported money, not hardcoded product pricing. Do not silently adopt a new currency library, use a universal divisor or emit another currency as USD.

Older events may be unavailable and local invoice/entitlement rows alone do not establish live mode, real settlement or complete purchase history. Therefore verified live payers are a **lower bound** while unresolved historical evidence exists. Mark `customer_type` unknown/omit it unless older qualifying history is conclusively accounted for; never infer “new” from the earliest event currently available. Distinguish known returning, proven new and history-incomplete accounts in the bounded operator readout.

Minimum fixtures: two sources/one PI; late processed transition; invoice funded wholly/partly by customer credit; payment split across invoices; asynchronously settled payment with earlier creation time; partial and pending-to-success refunds; both automatic-refund reasons; lost dispute plus refund overlap; unavailable older events; and non-USD refusal. No live charge is needed.

## Local normalization slice — implementation clarification

The payment adapter's read-only ports are connected to the existing billing tables by `payment-reads.ts`. Its `reconciledOneOff` read must retain original payment evidence even when a lifetime grant is now revoked or a credit purchase refunded; it must not filter by current entitlement status. Historical paid status and net retained principal are separate outputs. A verified ordinary refund or lost dispute can leave a historical purchase with zero retained principal. Unknown dispute/refund overlap affects net completeness, not whether money was originally collected.

Refund settlement needs causal evidence for each individual refund. `Refund.created` is request time and cannot establish the successful settlement of a formerly pending refund. A later `charge.refunded` event listing several historical refunds does not establish one settlement time for every child. The local refund helper therefore returns accounting snapshots only, without inventing conversion occurrence timestamps. The integrated reconciler verifies causal successful transitions in the original processed charge event before enqueueing each refund. Missing proof remains explicitly unknown. No webhook subscription or monetary handler was changed to manufacture this evidence.

The bounded adapter supports recognized, fully cash-funded single-item subscription invoices and recognized one-time products. Mixed credit, unsupported item/tax shapes, direct-charge allocations without a PI, and unprovable partial refund allocation across multiple invoices remain explicit unknown outcomes. Complete returns preserve provable per-invoice cash/tax allocation and zero retained principal. Whole-PI amounts are never copied into each invoice. Reads are capped at 60 per source attempt, five pages per list, 100 rows per list and 20 invoice/payment fan-outs; exceeding a bound is pending/incomplete, never silent truncation. The integration's provider client must also keep request timeouts bounded.


## Fresh Devin review dispositions — 2026-10-13

1. **Automatic-exclusion ordering — actionable, reproduced and repaired.** An UPDATE-only
   exclusion before a stale purchase completion left no source disposition. The migration now
   creates a canonical suppressed outbox tombstone under the shared locks, preserves claimed,
   accepted and uncertain purchases, and rejects conflicting account ownership. Native PostgreSQL
   regressions failed before the repair and passed afterward. SQL and DB-test verification is
   separately owned during this repair round.
2. **Historical one-off price drift — actionable, reproduced and repaired.** The old comparison
   with today's catalog price erased legitimate lifetime/credit transactions after catalog
   changes. Original Checkout totals and quantity now govern those amounts. The existing credit
   ledger stores original `credits_purchased` and `price_cents` (the webhook writes
   `amount_received`); lifetime evidence retains the granted plan and PI identity. Original
   success-event metadata, customer/account links, mode, currency and full original cart must
   agree. No current-price fallback or provider mutation was introduced.
3. **Equal-second ordering — intentional omission.** Same-second distinct transactions do not
   prove first/second order. No code change invents order from source IDs; an earlier verified
   timestamp still proves returning. Explicit regressions cover both cases.
4. **Refund reread bounds — request/deadline guard confirmed; row-cap discrepancy repaired.**
   The real read factory's 60-call budget and 10-second admission deadline are shared across both
   passes and history. Admission61 and post-deadline admission reject before provider access.
   The second pass previously permitted500 rows while the normalizer permitted100; both now
   stop at100 total rows with a retryable incomplete outcome. In-flight requests retain their
   1.5-second timeout; ten seconds is not hard cancellation.

Pinned Stripe SDK18.4.0 types and the official versioned
[session list reference](https://docs.stripe.com/api/checkout/sessions/list?api-version=2025-07-30.basil)
confirm `payment_intent` filtering. The
[line-item reference](https://docs.stripe.com/api/checkout/sessions/line_items?api-version=2025-07-30.basil)
requires full pagination; the embedded first handful is insufficient. The
[session object reference](https://docs.stripe.com/api/checkout/sessions/object?api-version=2025-07-30.basil)
defines original subtotal/total and distinguishes complete from paid. The local CLI lacked
`stripe docs` and the connector required reauthentication, so these public official pages were
read directly; no account data or live Stripe request was needed for this documentation check.

Operator output explicitly names `scope: stored_billing_accounts`. Completeness describes the
stored billing-customer scan and retained evidence, not a complete Stripe-universe reconciliation.
