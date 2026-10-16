# ADR 071 — Signup delivery freezes the verifying browser

- Status: accepted within the human-validated s111 plan; implementation review pending
- Date: 2026-10-12
- Extends ADR070

## Decision

One private `analytics_delivery_events` outbox holds the once-per-account signup disposition.
Its activation migration locks Auth writes briefly and atomically records both an immutable
activation timestamp (a literal SQL function) and suppressed baseline rows for every confirmed
account. Confirmation timestamps can change later; baseline source keys do not. A single DO
statement is atomic under both plain psql replay and the release executor's larger transaction;
it never commits the executor's migration ledger early.

The verified auth handler calls one service-only transaction under advisory lock710110. It reads
the account's confirmation time, binds only the actual request capability, and freezes its
eligible pre-confirmation context or absence. Only successful explicit signup/invite verification
is initial-confirmation evidence. Generic email, existing magic links and PKCE cannot expose
that provider proof through this SDK and freeze `initial_confirmation_unproven`. The no-code
existing-session callback only binds context and does not create a signup disposition.

The freeze function is SECURITY DEFINER solely for its fixed-schema read of `auth.users`;
PUBLIC, anon and authenticated have no execute privilege. The other private RPCs are invoker
functions. Source keys and account references remain sensitive. Context deletion sets its FK
NULL while retaining the frozen source UUID. Account deletion cascades the disposition; replay
requires a still-existing confirmed account. No Auth trigger, metadata writer or second account
ledger is introduced.

Claim checks the frozen context under the same lock as withdrawal, then commits `sending`
before network. No lock crosses HTTP. An expired claim becomes uncertain and is never reclaimed
for automatic sending. Terminal rows immediately discard their event payload; the minimal
source/state disposition remains for the account's lifetime. Reconciliation visits only durable
outbox rows. A complete freeze failure cannot reconstruct the original browser later; logs and
the confirmed-account/outbox gap expose possible loss without inventing per-user certainty.

The transport allows only reviewed signup fields, no user ID, email, private URL, session or
invented engagement. Application sends require explicit production configuration; synthetic
validation/collection has a separate fixed QA command and destination. Sentry's exact MP fetch
requests, breadcrumbs and spans are excluded because the provider requires a query-string
secret. Other monitoring remains enabled.

## Alternatives rejected

- Timestamp proximity or any bound context as signup proof: falsely attributes later logins.
- Cutoff alone: admin reconfirmation can reset an existing account's timestamp.
- Separate bind and enqueue: loses atomic provenance and permits another browser to win.
- Retrying ambiguous sends: may count the same signup twice.
- Short-lived dedupe rows: repeat login becomes another signup after cleanup.
- Extending private CSP or loading Google there: changes the accepted privacy boundary.

Current confirmed-account totals count surviving accounts with confirmation present. Historical
period counts based on mutable confirmation timestamps are explicitly limited. GA is the optional
attributed subset, and HTTP acceptance is not ingestion evidence.
