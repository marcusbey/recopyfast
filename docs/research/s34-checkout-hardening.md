# Research — s34-checkout-hardening

Verified against c3b2b28 on feature/s34-checkout-hardening, 2026-09-25. Scope is the user's pre-approved s33 n3/n4/n5/n7/n8/m5 and s28 N2 follow-ups, not a production audit.

## Current implementation and failure mechanisms

- `src/lib/billing/founding-agency.ts` synchronously reconciles all expired holds before a new claim. A single Stripe exception aborts the loop and the new checkout. Unbound history uses the DB creation timestamp without skew allowance. Holds count indefinitely until status changes.
- `20260924065000_agency_plan_and_founding_capacity.sql` serializes reserve, bind, release and complete with the shared founding capacity advisory lock. A partial unique index permits one reserved hold per user. Completion rejects released reservations, so a late paid webhook can be stranded. Completed rows survive refunds/account deletion; preserve this.
- `src/app/api/billing/checkout/route.ts` has no rate limiter. Existing `enforceRateLimit` supports separate IP/user buckets and explicit fail-closed storage errors. Rate limiting must precede Stripe calls and capacity writes, with IP limiting before authentication.
- Subscription checkout combines `withUserLock`, durable `checkout_pending_intents`, immutable provider params/idempotency and service-only RPCs. Both the route and current claim eligibility exclude incomplete/unpaid/paused. `checkout-concurrency.test.ts` explicitly expects those rows to allow a new checkout; those expectations must change under the new user-approved lifecycle policy, with the reason disclosed in the PR.
- `cancelSubscription` only selects live-entitlement statuses and is not reusable directly for recovering non-entitled obligations. Stripe cancellation already exists in the app. Entitlement eligibility must remain active/trialing/past_due; checkout eligibility is a different contract.
- `20260924070000_subscription_checkout_catalogue_choices.sql` validates `price_monthly > 0`, but tests do not isolate it from `is_active`. Activate free within a rollback transaction to make removal of positivity fail.
- Billing page duplicates the Agency flag instead of calling `isAgencyCheckoutEnabled`. The webhook FK comment is false: billing_subscriptions.plan has a CHECK. An applied migration's historical compatibility comment is also inaccurate; correct via an erratum rather than modifying applied SQL.
- `getUserSubscription` now throws on read errors, deliberately failing the Lifetime Pro/Agency guard closed; ADR 019's untouched claim needs a scoped erratum.

## Evidence and constraints

Read AGENTS.md, CLAUDE.md, architecture, goal-audit-closeout A-21/M-5, s28/s33 independent reviews and ADRs 028/029. No active it.failing/test.failing marker exists in the scoped billing suites at this base; add explicit red regressions and preserve all guards. The unrelated DB markers remain untouched.

`npm run setup` completed for root and server. Only `.env.example` exists here. Commands use CI placeholder env extracted from the main CI job; no production credentials or provider requests. Database tests may use only a newly created loopback PostgreSQL instance. Local PostgreSQL is available, but full Supabase parity is not assumed.

Complexity: 4. This is one coherent checkout safety change with a forward migration and focused recovery/abuse tests. All remote state and independent review remain outside local verification.

## Provider reference check

Official Stripe references retrieved 2026-09-25 by a bounded read-only researcher, checked against installed stripe@18.4.0. The portal has no universal paused/incomplete recovery flow; paused uses a separate resume API. Cancellation is an explicit alternative authorized for this story, not an entitlement change. Immediate cancellation makes the subscription terminal but defaults to stopping automatic collection of finalized invoices for the customer, which must be recorded in the decision and operational review.

- https://docs.stripe.com/api/subscriptions/cancel
- https://docs.stripe.com/api/subscriptions/object
- https://docs.stripe.com/api/subscriptions/resume
- https://docs.stripe.com/customer-management/portal-deep-links

No provider API was called.
