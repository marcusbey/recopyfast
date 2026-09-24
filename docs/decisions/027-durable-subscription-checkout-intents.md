# ADR 027 — Durable subscription checkout intents

- Status: accepted
- Date: 2026-09-24
- Scope: s28-billing-correctness, audit A-21 and independent review m8
- Supersedes: ADR 014's checkout-reservation mechanism only; trial grant and conversion constraints remain in force.

## Context

The former timestamp reservation cannot retain a Stripe session identity or URL. A process lock cannot coordinate separate server instances, and clearing a reservation after an ambiguous provider response can expose two payable sessions. Trial conversion must remain inside the subscription checkout lock as required by ADR 014.

## Decision

Use `checkout_pending_intents`, created by the unapplied migration `20260924020000_checkout_pending_intents.sql`, as the durable subscription-checkout guard. An advisory transaction lock plus a partial unique index permits one pending intent per user. Service-role-only RPCs claim, attach, finish and expire an unattached intent; authenticated browser roles cannot remove the guard.

Claim before provider creation. Bind the immutable intent id and expiry to Stripe metadata, an intent-scoped idempotency key and session expiry. Store the resulting session id and URL and return an existing open session to the user on a retry. Provider failures retain the intent until recovery establishes its outcome. A reused unattached intent with fewer than 30 minutes remaining returns a bounded conflict with its retry time instead of sending an invalid expiry to Stripe; replacing an ambiguous intent early remains deferred to preserve duplicate-payment safety. A fresh claim skips recovery; reused claims search the relevant provider history. The local `withUserLock` remains an optimization, while the database and provider idempotency enforce cross-instance safety.

Completed webhooks persist subscription state before releasing the matching intent. Expired events release only their matching session. Late events for removed or already-released unattached intents are idempotent; a session mismatch on an existing attached intent remains an error. Null webhook URLs must not erase a stored checkout URL. Failed database writes remain retryable.

Checkout eligibility follows the existing `LIVE_SUBSCRIPTION_STATUSES` contract in `src/lib/billing/effective-plan.ts` and `getUserSubscription` in `src/lib/stripe/subscription.ts`: active, trialing and past_due require subscription management; unpaid, incomplete and paused do not confer a live plan and may start a new checkout. The claim RPC repeats that guard transactionally. Lifetime and credits purchases retain their separate rules.

## Considered alternatives

- Retain a timestamp-only row and process lock: cannot coordinate separate instances or recover a payable session.
- Release after every Stripe failure: an ambiguous response can hide a successful creation and allow a second subscription.
- Block every nonterminal subscription status: diverges from entitlement and upgrade rules and strands unpaid/incomplete/paused users. A billing portal would be a larger product change than restoring the existing policy.
- Replace trial grants or revoke them during checkout: unnecessary and reopens ADR 014's conversion race.

## Consequences

The database migration must precede application cutover. Keep the old reservation table for rollback. Operators must drain or expire legacy sessions and avoid mixed-version checkout traffic, because the new protocol cannot recognize old sessions lacking its metadata. Reverting application code restores the old protocol's limitations; retain compatible schema and repair forward. No database or provider change is executed by this story's local validation.

The independent review remains authoritative for ship approval. Local mocks and CI placeholders establish application behavior, not live provider delivery or cross-instance infrastructure behavior.
