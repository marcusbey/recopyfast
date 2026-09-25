# Research — s34-checkout-hardening

Verified against c3b2b28 on feature/s34-checkout-hardening, 2026-09-25. Scope is the user's pre-approved s33 n3/n4/n5/n7/n8/m5 and s28 N2 follow-ups, not a production audit.

## Initial baseline implementation and failure mechanisms (before s34)

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

## Initial provider reference check (superseded by fix-mode decision below)

Official Stripe references were retrieved 2026-09-25 by a bounded read-only researcher and checked against installed stripe@18.4.0. That initial research considered cancellation and its invoice-collection effects. The operator subsequently rejected that policy: checkout must never cancel an existing subscription. The authoritative recovery policy is the fix-mode decision below and updated ADR 031; these initial references are retained only as historical research.

- https://docs.stripe.com/api/subscriptions/cancel
- https://docs.stripe.com/api/subscriptions/object
- https://docs.stripe.com/api/subscriptions/resume
- https://docs.stripe.com/customer-management/portal-deep-links

No provider API was called.

## Fix-mode evidence and operator decisions — 2026-09-25

The uncommitted independent review identifies M1 and m1–m5. The operator confirmed live methods
include card, Apple Pay, Link, Klarna, Affirm, Bancontact and EPS; the last two can renew through
SEPA and processing can last days. No live provider inspection is authorized or needed.

### Subscription recovery, not cancellation

Cancelling `incomplete`, `past_due`, `unpaid` or `paused` subscriptions from checkout is unsafe:
an invoice payment already in `processing` can settle after cancellation and leave a charge
without its recurring entitlement. The fix retrieves authoritative Stripe state plus the latest
invoice, paginates its invoice-payment list and resolves any unexpanded PaymentIntent before
deciding. A processing payment returns 409 with the operator-approved exact message. Otherwise
incomplete/past-due/unpaid rows expose the hosted invoice URL; paused uses a configured billing
portal session. Missing recovery configuration is a clear 409, not a replacement Checkout.
Stripe-active/trialing recovery maps to the existing upgrade conflict instead of a raw 500.
Checkout never calls Stripe cancellation.

The applied checkout-intent migrations are not edited. The two-argument claim overload is not a
deployed call site: deployed `main` already uses the five-argument catalogue-choice overload.
The inaccurate rolling-deploy claim is corrected in the errata, and the new forward migration
removes the unused overload without rewriting migration history. The reconciler's history-discovered session also does not
need a bind write: release records the session id, and completion keys on reservation id.

### One founding lifetime and asynchronous failure

A released first hold can complete after the same account reserves a successor. The first valid
paid completion still wins over the cap, but the database must return a distinct
duplicate-account outcome for a later payment without inserting another entitlement or completed
sale. The webhook refunds that later payment with an idempotency key scoped to its Checkout
Session, logs it and remains retry-safe. The forward migration is
`20260925110000_enforce_one_founding_lifetime_per_account.sql`; applied migrations stay untouched.

`checkout.session.async_payment_failed` is a terminal founding failure and releases its hold.
The handler alone is not live configuration proof: the operator must add the event to the
canonical Stripe endpoint and retrieve the endpoint to verify the complete event set.

### Session quota and failure policy

The shared five-request bucket counted harmless resumes and could stop all revenue during a Redis
outage. The accepted policy is ten **new** Checkout Sessions per user per 15 minutes; returning
an already-open durable session consumes none of that quota. The IP flood bucket remains
independent. Limiter-store failures log and allow subscription, credits, payment-method and
non-founding lifetime checkout. Only Founding Agency denies when the store is unavailable because
each admitted request can consume scarce capacity. The 429 payload carries its retry time, and the
billing UI formats it as `Try again at HH:MM`.

Historical test/gate numbers above precede this fix. Fresh targeted, disposable-Postgres and full
gate evidence is recorded by the implementation plan after the fixes complete.
