# ADR 031 — Bounded founding holds and terminal subscription replacement

- Status: accepted
- Date: 2026-09-25
- Scope: operator-prevalidated s34-checkout-hardening; s33 n4/n5 and s28 N2
- Supersedes: ADR 028 only for checkout eligibility of incomplete/unpaid/paused subscriptions; ADR 029 only for unresolved hold release and its absolute first-50 wording; ADR 019 only for its claim that getUserSubscription remains untouched.

## Context

A Stripe lookup failure on one expired founding reservation previously stopped every new
founding checkout. Retaining unresolved capacity forever protects the numerical cap at the
expense of indefinitely closing the live offer. Releasing that capacity without changing
completion would instead deny Agency access to a customer whose successful payment arrived
late. The checkout path also allowed a new subscription while an incomplete, unpaid or paused
subscription could still recover into a second live obligation.

## Decision

### Founding capacity and late payment

Keep the shared PostgreSQL capacity lock and one reserved hold per account. Ordinary new
claims remain limited to 50 completed sales plus held spots. A provider-confirmed expired,
unpaid session can release normally. An unresolved hold has a ten-minute safety margin after
its session deadline; once that margin elapses, an atomic service-only transition releases
capacity and records a reconciliation timestamp and bounded reason. Provider failures affect
that row rather than every buyer. Genuine database errors still fail closed. Stripe history
search starts five minutes before the database creation timestamp to allow clock skew.

Known paid/completed sessions retain capacity and await normal webhook reconciliation. An
open provider session must remain protected through its authoritative payable window. Failed
or missing provider information does not become evidence of a successful payment or grant.

A signed, validated late checkout completion may transition a released reservation to
completed and atomically grant Agency. Payment-intent idempotency and reservation ownership
still apply. The grant does not re-check available capacity: a customer whose money was
accepted is never refused because another buyer used the released spot. Preserve the
reconciliation flag for operator investigation, including after a late grant.

**The trade-off is explicit:** normal claims cannot oversell, but a late paid completion can
make the durable completed count 51; several such payments can exceed 51. This is an accepted
exception, not a new inventory allowance. Once completed sales reach 50, new claims remain
closed. Refunds, disputes and account deletion do not reopen completed sales. Public remaining
capacity stays floored at zero, and the service-role ledger retains the exact count.

### Recoverable subscription replacement

Choose cancellation before replacement for `incomplete`, `unpaid` and `paused` obligations.
The user initiated a new subscription checkout; this policy deliberately abandons those
non-entitled obligations before offering its replacement. Query all owned recoverable rows,
verify their Stripe state, cancel only eligible recoverable states, and require a confirmed
terminal result (`canceled` or `incomplete_expired`). An ambiguous cancel response is safe only
when a subsequent provider read confirms a terminal state. Persist that result before claiming
or creating a replacement. Missing ownership, provider identity, provider state, or a failed
persistence operation blocks the replacement.

A pre-cancellation provider result of active/trialing/past_due requires subscription management
and cannot be treated as safe replacement. Stripe does not expose an atomic cancel-if-status
operation: payment recovery can race the read and cancellation. A confirmed cancellation still
prevents two live subscriptions, but does not undo a payment settled during that interval;
that historical payment needs operator reconciliation under the normal refund policy. Entitlement eligibility is unchanged: those three states retain
their existing entitlement behavior; recovery eligibility is a separate checkout contract.
The service-only claim RPC checks all nonterminal statuses transactionally, including when a
pending intent already exists. Preserve the partial unique index, immutable Stripe parameters,
intent-scoped idempotency and conversion-inside-the-user-lock protocol from ADR 028.

Cancel without requesting immediate invoicing or proration charges. Stripe immediate
cancellation defaults to stopping automatic collection of finalized invoices for the customer;
that provider consequence is accepted for the abandoned obligation and must be considered in
operator reconciliation. This story does not void invoices, collect outstanding invoices, or
refund previous payments. It prevents a second live subscription; it does not retroactively
repair existing double subscriptions or erase historic debts.

### Existing fail-closed read contract

`getUserSubscription` throws when its database read fails. Returning null would let the
Lifetime Pro checkout treat an unknown Agency subscription as absent and sell a lower-tier
lifetime product. The throwing contract introduced in s33 is deliberate; callers must keep
it inside their error handling. This supersedes ADR 019's “untouched” statement for that
function, in addition to ADR 029's already recorded entitlement precedence change. The
agency-only payer identity remains unchanged.

## Alternatives rejected

- Retain unresolved founding holds forever: one stale or missing provider session can close
  the live offer indefinitely.
- Release on the first timeout without a grace period or operator record: increases avoidable
  capacity races and loses evidence needed to reconcile accepted money.
- Reject paid late completion at the cap: takes a customer's money without the purchased access.
- Permit another subscription solely because the old one grants no entitlement: an old unpaid,
  incomplete or paused subscription can recover after the new one becomes active.
- Rely only on a process lock: does not coordinate separate application instances.
- Use the billing portal as a universal recovery flow: its deep links do not provide a universal
  paused/incomplete recovery operation; paused resumption and initial-invoice payment differ.
  A full recovery UI is a separate product flow, while cancel-before-replacement is explicitly
  authorized in this scope.

## Rollout, verification and rollback

Apply `20260925100000_checkout_hardening.sql` before the application release, using an authorized
operator. Migration and application checks in this story are local only. Reapply the migration
to prove idempotence; verify service-only grants, the grace boundary, ordinary cap concurrency,
late payment idempotency and all nonterminal claim guards on disposable PostgreSQL. Stripe
calls are mocked, so the tests do not prove live payment-provider delivery.

Retain the forward schema and completion function during rollback. Reverting completion to
reject released holds would strand already accepted late payments. Disable new Agency sales
with the existing kill switch if necessary, preserve paid entitlements/webhooks, and repair
forward. Do not roll the subscription claim guard back to allow recoverable obligations.

## Provider references

Checked 2026-09-25 against the installed Stripe 18.4.0 type surface:

- [Subscription status semantics](https://docs.stripe.com/api/subscriptions/object)
- [Immediate subscription cancellation and invoice effects](https://docs.stripe.com/api/subscriptions/cancel)
- [Paused-subscription resumption](https://docs.stripe.com/api/subscriptions/resume)
- [Customer portal deep links](https://docs.stripe.com/customer-management/portal-deep-links)
