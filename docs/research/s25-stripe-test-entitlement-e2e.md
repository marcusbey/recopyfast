# s25 — Stripe test payment to entitlement research

Date: 20 September 2026 UTC. Baseline `320ccc69`. Complexity 4. Dependency: s24's ephemeral
Supabase/Redis/Next stack.

## Verified gap

Existing Playwright billing coverage checks unauthenticated redirects/static pricing; the legacy
root `e2e-billing-tests.spec.ts` is outside Playwright's `e2e/` testDir and does not complete
Checkout. The earlier live $19 Pro Checkout remained open/unpaid. A `customer.created` webhook
proved signing-secret parity but not subscription or entitlement provisioning.

CI has no Stripe test secret, test price IDs or webhook forwarder. There is no disposable billing
fixture/cleanup harness. Test-mode and live keys are already separated by `src/lib/stripe/mode.ts`;
the provider proof must run explicitly in test mode on a non-production origin.

## Safe provider proof

Use a dedicated opt-in local/provider lane after s24. Start the ephemeral application stack and a
Stripe CLI listener forwarding genuine test-mode events to `/api/webhooks/stripe`; inject its
ephemeral signing secret into the local process only and mask logs. Use existing local Stripe test
credentials without copying them to GitHub. Create a confirmed disposable Auth user directly in
the ephemeral project without calling the production trial-grant callback—otherwise the 14-day
Pro trial would mask whether payment caused access.

Authenticate through the app, call the real `POST /api/billing/checkout` for one subscription
plan/period, complete Stripe-hosted Checkout using Stripe's documented test payment method, and
wait for the real handler to process provider event IDs. Require all of:

- Checkout Session is complete, paid and reconciled.
- `billing_customers` links the disposable user to the test customer.
- exactly one active `billing_subscriptions` row has expected plan/price/customer and period.
- `billing_events` records the genuine event IDs as processed.
- `/api/billing/entitlement` returns that purchased plan with no prior trial grant.
- replay of one captured event ID produces no duplicate subscription/effect.

Cleanup cancels the test subscription and deletes the test customer, then deletes only captured
ephemeral DB/Auth IDs. Assert no rows/provider objects remain. Checkout/event history may be
immutable at Stripe and must be documented rather than falsely claimed deleted. No browser storage,
test card detail, API key or signing secret is retained in Playwright reports.

## Live-payment boundary

Test mode proves code/provider integration without a charge. A live completed payment is a human
financial action and is not authorized by the prior unpaid $19 session. Before a live run, the user
must explicitly choose the live SKU/period and maximum total including tax, identify the payer, and
decide whether the resulting subscription is retained, cancelled or refunded. The user enters
payment details directly; the agent verifies webhook/ledger/entitlement afterward.

Expected files: an opt-in Playwright billing spec and shared provider fixture/cleanup, focused test
helpers, package scripts and operations documentation. Application source should not need behavior
changes; if the executed flow reveals one, stop and create a separate fix story rather than hiding
it in the harness.
