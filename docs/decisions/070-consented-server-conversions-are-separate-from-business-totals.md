# ADR 070 — Consented server conversions are separate from complete business totals

- Status: accepted; independently reviewed and human-validated with s110–s112 on2026-10-12
- Date: 2026-10-12
- Scope: s110-analytics-consent-context, s111-verified-signup-analytics,
  s112-verified-purchase-analytics
- Extends ADR063/069 without changing their Google-script or private-document boundary.

## Context

The owner requested working visitor, completed-signup and paying-customer measurement. s107
tracks public traffic and marketing actions but deliberately excludes authentication and private
billing documents. Passwordless auth confirmation is also login; counting every callback would
inflate acquisition. Stripe TEST events exist in the production database, and one payment can
appear under several Stripe event types. A positive paid invoice in this database alone does
not establish live revenue. The product trial lasts14 days, so a24-hour retained client identity
would miss its normal trial-to-paid journey.

## Decision

1. Auth and reconciled live billing records remain complete business truth. Google Analytics
   receives only eligible consented conversions. Visitor/session/user counts in GA are not
   unique billing-account customer counts; missing consent or attribution is an explicit gap.
2. Capture documented Google client/session identifiers only while the existing public runtime
   is active. Carry a random browser capability in a secure host-only HttpOnly cookie; store
   only its hash server-side. A bounded same-origin, fail-closed rate-limited first-party
   endpoint can create/refresh/revoke the presented context. Verified server authentication
   alone may bind it to an account, immutably. Service-only functions/tables with RLS and
   explicit grants are a named analytics authority; site-token auth is not copied here.
3. Proposed maximum client/consent context retention is30 days from an actual eligible public
   interaction, never beyond consent expiry or withdrawal. Auth, billing, cron and webhook
   activity do not extend it. This duration is a product/privacy choice for the trial journey,
   not a Google-mandated retention period. No raw IP, geography, email, name, customer page
   text, private URL or auth token is stored as analytics context or sent to Google.
4. Session linkage has a separate, shorter validity. Include an actual session ID only where
   the true conversion occurrence and delivery meet Google's documented session-attribution
   requirements. Otherwise an eligible client ID may support an event without asserting
   session attribution. Never invent engagement, a session, or a newer occurrence timestamp.
5. Keep one private delivery outbox and minimal source dispositions. A completed signup is
   the first confirmed account after an explicit activation baseline, not an email request,
   trial creation or later login. A purchase is a recognized successfully provisioned,
   positive live payment, normalized to its canonical invoice/payment identity. Separate
   transactions, first paying accounts, renewals, refunds and current paid access.
6. Source reconciliation must revisit newly completed sources even after an earlier cursor
   advanced. Bounded source-key anti-joins or durable pending candidates prevent a late
   processed=true transition from being skipped. Unknown mode/amount/provisioning evidence
   remains unknown; never manufacture an eligible event from an ambiguous ledger row.
7. Successful atomic dispatch claim is the in-flight boundary. Consent withdrawal cancels
   future claims; an already claimed request may still send. No database transaction stays
   open during a Google request. Auth/payment success never depends on Google's response.
   Uncertain signup delivery is held for reconciliation rather than blindly replayed.
8. Purchases use stable opaque transaction IDs and provider-verified amounts/currency.
   A later refund needs its own verified source and a known corresponding purchase delivery
   disposition. An uncertain purchase holds its refund for reconciliation. Expired/revoked
   identity makes later refunds first-party-only; GA is never promised as a complete net
   revenue ledger.
9. Purge identifier-bearing context by its expiry/withdrawal policy. Do not cascade that purge
   into source-key dedupe dispositions: a later callback must not become a second signup or
   purchase. Minimal internal account/source keys remain sensitive and require explicit
   retention/account-deletion handling in the validated plans; they are not anonymous data.
10. No Google scripts on auth/dashboard/report documents, no private CSP expansion, no new
    dependencies, no advertising signals or user_id. Use server-only Measurement Protocol
    configuration and explicit payload allowlists. Synthetic conversion ingestion is verified
    in an authorized separate QA destination, never as a fake live sale.

Attribution is selected once from context that was eligible at the true conversion occurrence,
not from whatever consent exists when the dispatcher runs. Capture and effective consent must
predate `occurred_at`; first-signup verified binding may follow confirmation only through the
same real browser capability, never a later unrelated visit. For payments choose the most recent
eligible capture before occurrence, with a stable context-ID tie break, then freeze that choice
with the source disposition. A later grant, replacement context or campaign visit cannot restore
missing/revoked attribution or rewrite an older conversion. Claim still rechecks withdrawal and
expiry. Tests cover late grants, replacement context and concurrent devices.

s110 must own physical cleanup even before s111 ships its dispatcher. The plan names its
credential-checked schedule, bounded deletion/indexes and overdue-cleanup signal. Eligibility
expires immediately at the cutoff; physical purge cadence and incident delays are disclosed
separately rather than claiming an impossible instantaneous remote deletion guarantee.

## Alternatives rejected

- Count CTA clicks, active subscriptions or Checkout returns as outcomes: they do not establish
  confirmed accounts or collected live payments.
- Put Google on private pages: changes the accepted security/privacy boundary unnecessarily.
- Store only24 hours of client identity: excludes ordinary14-day trial conversion.
- Retain identifiers indefinitely: not needed for initial acquisition validation and extends
  privacy exposure. Later renewals outside the chosen retention stay in first-party totals.
- Generate an identity when none is available: invents attribution and can bypass consent.
- Couple the Stripe response to Google delivery: exposes payment processing to analytics
  outages and replays. Outbox/reconciliation remains operationally independent.
- Promise exactly-once external delivery from a database claim: the network outcome can be
  ambiguous; acceptance and ingestion remain different evidence.

## Acceptance and release

The canonical plans define exact schemas, indexes, retention and failure-state tests before
implementation. Each story receives independent review and normal repository gates. Real
PostgreSQL concurrency/grant tests, separate QA receipt and production public-page collection
are separate gates. No live charge is made for acceptance; first real live-customer purchase
receipt remains an operational observation after release. The user's current release request
is authority for the intended analytics outcome, while required plan validation and concrete
credential/destructive-action checks remain intact.

References: [Google tag get](https://developers.google.com/tag-platform/gtagjs/reference#get),
[Measurement Protocol requirements](https://developers.google.com/analytics/devguides/collection/protocol/ga4/use-cases),
[Measurement Protocol reference](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference),
[purchase deduplication](https://support.google.com/analytics/answer/12313109).
