# ADR 031 — Bounded founding holds and recoverable subscription checkout

- Status: accepted
- Date: 2026-09-25
- Scope: operator-prevalidated s34-checkout-hardening; s33 n4/n5 and s28 N2
- Supersedes: ADR 028 only for checkout eligibility of incomplete/past_due/unpaid/paused subscriptions; ADR 029 only for unresolved hold release, its absolute first-50 wording and duplicate founding completion; ADR 019 only for its claim that getUserSubscription remains untouched.

## Context

A Stripe lookup failure on one expired founding reservation previously stopped every new
founding checkout. Retaining unresolved capacity forever protects the numerical cap at the
expense of indefinitely closing the live offer. Releasing that capacity without changing
completion would instead deny Agency access to a customer whose successful payment arrived
late. A late payment could also complete after the same account reserved a second spot, charging
twice and consuming two founding sales for one account.

The checkout path also allowed a new subscription while an incomplete, past-due, unpaid or
paused subscription could still recover into a second live obligation. Automatic cancellation
was considered, but the live account offers card, Apple Pay, Link, Klarna, Affirm, Bancontact and
EPS. Bancontact and EPS renew through SEPA Direct Debit, whose payment can remain processing for
days. Cancelling a subscription from checkout while its invoice payment is processing can leave
the customer charged without the corresponding recurring entitlement.

## Decision

### Founding capacity, late payment and one purchase per account

Keep the shared PostgreSQL capacity lock and one reserved hold per account. Ordinary new claims
remain limited to 50 completed sales plus held spots. A provider-confirmed expired, unpaid session
can release normally. An unresolved hold has a ten-minute safety margin after its session
deadline; once that margin elapses, an atomic service-only transition releases capacity and
records a reconciliation timestamp and bounded reason. Provider failures affect that row rather
than every buyer. Genuine database errors still fail closed. Stripe history search starts five
minutes before the database creation timestamp to allow clock skew. A history-discovered session
does not need to be rebound: release records its session id, while completion is keyed by the
reservation id.

Known paid/completed sessions retain capacity and await normal webhook reconciliation. An open
provider session remains protected through its authoritative payable window. Failed or missing
provider information does not become evidence of a successful payment or grant.

A signed, validated late checkout completion may transition a released reservation to completed
and atomically grant Agency. Payment-intent idempotency and reservation ownership still apply.
The grant does not re-check available capacity: a customer whose first founding payment was
accepted is never refused because another buyer used the released spot. Preserve the
reconciliation flag for operator investigation, including after a late grant.

One account can own only one completed Founding Agency lifetime. If another founding Checkout
for that account is paid after the first purchase has completed, the database records the
duplicate-account outcome without adding a completed sale or another entitlement. The webhook
refunds the duplicate payment through Stripe with an idempotency key scoped to that Checkout
Session, logs the resolution, and retries safely if Stripe does not confirm the refund. Successful
refunds persist their provider id and completion timestamp; retries reconcile provider refund
metadata if that database write was lost. This protection survives the provider's idempotency-key
retention window. A replay cannot grant, count or refund the duplicate twice.

**The trade-off is explicit:** normal claims cannot oversell, but a first late paid completion
can make the durable completed count 51; several different accounts with late accepted payments
can exceed 51. This is an accepted exception, not a new inventory allowance. A duplicate payment
from an account that already owns Founding Agency is refunded and does not increase that count.
Once completed sales reach 50, new claims remain closed. Refunds, disputes and account deletion
do not reopen completed sales. Public remaining capacity stays floored at zero, and the
service-role ledger retains the exact count.

`checkout.session.async_payment_failed` releases the matching founding hold. The live Stripe
endpoint must subscribe to that event as well as `checkout.session.expired`; changing source or
this ADR does not change the provider endpoint configuration.

### Recoverable subscriptions block replacement and direct the customer to recovery

Checkout never cancels an existing subscription. For every owned local row in `incomplete`,
`past_due`, `unpaid` or `paused`, retrieve the authoritative Stripe subscription with its latest
invoice and inspect every invoice payment. If any latest-invoice payment is `processing`, return
HTTP 409 with exactly:

> A payment is still processing on your current subscription. We'll email you when it clears.

Otherwise, return HTTP 409 with a recovery destination instead of creating a replacement:

- `incomplete`, `past_due` and `unpaid` use the latest invoice's `hosted_invoice_url`.
- `paused` uses a configured Stripe billing portal session.
- If the relevant invoice URL or portal configuration is unavailable, return a clear recovery
  message and no replacement URL. Provider ambiguity remains fail closed.

The UI follows `resumeUrl` when present. If Stripe says a stale recoverable local row is now
active or trialing, return the existing 409 upgrade message rather than a raw 500. A provider
terminal result may be persisted to the same owned local row so a genuinely ended obligation no
longer blocks checkout. Every write remains scoped by local id, user id and Stripe subscription
id.

The service-only claim RPC continues to reject every nonterminal subscription status
transactionally, including when a pending intent already exists. Preserve the partial unique
index, immutable Stripe parameters, intent-scoped idempotency and conversion-inside-the-user-lock
protocol from ADR 028. Entitlement eligibility is unchanged: active, trialing and past-due rows
retain their existing entitlement behavior; recovery eligibility is a separate checkout
contract.

### Checkout rate limits

The pre-authentication IP flood bucket remains independent. Its store failure is logged and
allowed so a Redis outage does not stop ordinary revenue. A user may create at most ten new
Checkout Sessions per 15 minutes. Returning an existing open session does not consume that
new-session quota. A 429 response carries its retry time, and the UI renders it as
`Try again at HH:MM` in the user's locale.

Only the Founding Agency hold boundary denies checkout when the rate-limit store is unavailable,
because each admitted request can consume scarce capacity. Subscription, credit, payment-method
and non-founding lifetime checkouts log the limiter failure and continue.

### Existing fail-closed read contract

`getUserSubscription` throws when its database read fails. Returning null would let the Lifetime
Pro checkout treat an unknown Agency subscription as absent and sell a lower-tier lifetime
product. The throwing contract introduced in s33 is deliberate; callers must keep it inside
their error handling. This supersedes ADR 019's “untouched” statement for that function, in
addition to ADR 029's already recorded entitlement precedence change. The agency-only payer
identity remains unchanged.

## Alternatives rejected

- Retain unresolved founding holds forever: one stale or missing provider session can close the
  live offer indefinitely.
- Release on the first timeout without a grace period or operator record: increases avoidable
  capacity races and loses evidence needed to reconcile accepted money.
- Reject paid late completion at the cap: takes a customer's money without the purchased access.
- Grant or count a second founding lifetime for one account: charges twice for one durable
  product and consumes scarce capacity without adding value.
- Permit another subscription solely because the old one grants no entitlement: an old unpaid,
  incomplete, past-due or paused subscription can recover after the new one becomes active.
- Cancel recoverable subscriptions from checkout: delayed invoice payments can settle after
  cancellation and produce a charge without entitlement.
- Restrict the live subscription offer to card-only settlement: removes payment methods the
  operator deliberately offers and does not help an already-open invoice.
- Rely only on a process lock: does not coordinate separate application instances.
- Fail every checkout closed when Redis is unavailable: protects a soft abuse control by
  stopping subscription and credit revenue. Scarce founding holds keep the stricter policy.

## Rollout, verification and rollback

Apply `20260925100000_checkout_hardening.sql` and
`20260925110000_enforce_one_founding_lifetime_per_account.sql` in order before the application
release, using an authorized operator. Migration and application checks in this story are local
only. Reapply both migrations to prove idempotence; verify service-only grants, the grace
boundary, ordinary cap concurrency, first late payment idempotency, duplicate-account exclusion,
and all nonterminal claim guards on disposable PostgreSQL. Stripe calls are mocked, so the tests
do not prove live payment, invoice recovery or refund delivery.

Update the canonical live Stripe endpoint to include
`checkout.session.async_payment_failed`, then retrieve the endpoint and verify the exact event
set. This is an operator action after review; the implementation agent does not mutate live
Stripe.

Retain the forward schema and completion functions during rollback. Reverting completion to
reject released holds would strand already accepted first payments; reverting duplicate-account
handling could charge and grant twice. Disable new Agency sales with the existing kill switch if
necessary, preserve paid entitlements/webhooks, and repair forward. Do not roll the subscription
claim guard back to allow recoverable obligations.

## Provider references

Checked 2026-09-25 against the installed Stripe 18.4.0 type surface:

- [Subscription status semantics](https://docs.stripe.com/api/subscriptions/object)
- [Invoice payments](https://docs.stripe.com/api/invoice-payment/list)
- [Paused-subscription resumption](https://docs.stripe.com/api/subscriptions/resume)
- [Customer portal sessions](https://docs.stripe.com/api/customer_portal/sessions/create)
- [Refund creation and idempotent requests](https://docs.stripe.com/api/refunds/create)
