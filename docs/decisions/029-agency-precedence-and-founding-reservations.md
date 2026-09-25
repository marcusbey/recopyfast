# ADR 029 — Agency precedence and durable founding reservations

- Status: accepted
- Date: 2026-09-24
- Scope: s33-agency-plan; operator-approved fix scope
- Supersedes: ADR 014 only for Agency versus a lower-tier trial; ADR 019 only for its statement that the entitlement resolver remains untouched. Agency-only payer identity is unchanged.

## Context

An Agency subscriber or lifetime owner must not lose 10-site access because a newer Pro trial
or support grant exists. Founding Agency is limited to 50 completed purchases. Hosted Checkout
can be abandoned, fail during creation, or deliver duplicate/out-of-order webhooks. Counting
sessions as sales either oversells capacity or permanently loses unsold capacity.

## Decision

Agency is the highest currently supported paid tier. A live Agency grant or subscription
outranks a lower-tier grant, including a Pro trial. Otherwise the inherited grant-first and
newest-grant behavior remains. Revoked or expired grants are excluded before precedence.
Lifetime Pro remains on sale alongside Founding Agency. The server rejects Lifetime Pro for
Agency subscribers and Agency lifetime owners: it cannot cancel a higher subscription or sell
a benefit already owned.

A service-role-only reservation ledger separates temporary holds from completed sales. Every
capacity decision uses one PostgreSQL advisory transaction lock. At most one active hold exists
per account. Holds use the Checkout Session expiry and the Stripe 30-minute minimum plus a 10-second transport allowance; binding can narrow the deadline but never extend it. Expired
holds are reconciled against Stripe before a new claim even if an expiry webhook never arrives;
a clock alone cannot prove an unbound hold has no remotely created session. Failed creation is
reconciled/released in the request where safe. Webhook handling claims its event before side
effects, and payment completion is idempotent by payment intent. Subscription checkout retains
s28's separate durable intent and expiry cleanup.

A refund or dispute revokes the purchased entitlement but does **not** free a founding sale.
A completed reservation remains durable even after account deletion. The cap means 50 founding
purchases ever, not 50 currently entitled accounts. Refunded founding buyers receive an accurate
prior-purchase message instead of a false claim that they still own Agency access.

The catalogue is extensible: checkout choices reference `plans(id)` with a foreign key, and the
claim RPC validates active paid subscription rows and available billing periods. Loaders ignore
unknown identities with a once-per-process warning. Missing Agency rows make Agency unavailable
without removing Starter, Pro, Credits, or Lifetime Pro. Supported malformed rows still fail
validation rather than silently changing paid limits.

## Alternatives rejected

- Newest entitlement always wins: a later Pro trial could silently downgrade Agency.
- Counting open Stripe sessions as purchases: abandoned and failed sessions are not sales.
- A process-local mutex or counting before an unlocked insert: parallel processes can oversell.
- Releasing a completed spot on refund/dispute: permits more than 50 founding purchases.
- Dropping Agency catalogue rows during rollback: breaks paid Agency feature limits.
- Hard-coded subscription lists in SQL: repeats the s28/Agency checkout incompatibility for the next plan.

## Consequences

Schema changes are forward-only. The compatibility loader must precede introducing unknown
active rows to an older deployment. The feature cutover is migration first, then the Agency
application release. After sales, rollback disables new Agency sales while retaining catalogue
rows, entitlements and payment/webhook processing; it never reverts to a binary that cannot
recognize Agency. The exact operator sequence is in `docs/operations/stripe-setup.md`.
