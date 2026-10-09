# Review — s82-billing-lifetime-guards

Reviewer: fresh-context `reviewer` subagents, 2026-10-09 (first review of c02df19; verification of 84d7b0c).
Diff: `git diff origin/main...feature/s82-billing-lifetime-guards` (rebased onto fc5968b).

## First review (c02df19) — Max severity: major, Ship allowed: yes

All 8 tasks present; every symbol checked (enforceRateLimit, logger, refundCharge, consumeFeatureUsage, checkOwnerCanEdit,
readGrantedPlanIds, findHeldPlan, LIVE_SUBSCRIPTION_STATUSES, PAID_PLAN_IDS). Reactivate guard uses the same grant reader
as the billing page and the same rank rule as the Stripe webhook (`stopBillingForLifetimeOwner`); fails closed. Translate
charges the site owner (service client scoped to that site's admin; refunds to the same wallet). "You were not charged"
only when the full refund succeeded. No Stripe/DB text to clients in the touched routes. 22 mutations, 20 red.

**major** — checkout's subscription intent and the plan-change PUT never read grants: a lifetime owner could start a new
subscription for a plan they hold. minors: a DB read error became a silent 404; M14 (allowance matcher "credit") and M20
(held-plan disable) unpinned; an overstated comment; the payment-methods 429 message hidden.

## Fix pass `84d7b0c` — verified (Max severity: minor, Ship allowed: yes)

Checkout subscription intent and `updateSubscription` refuse a covered plan (409 before Stripe), same rank rule (an Agency
subscription beside Lifetime Pro stays on sale), fail closed; UpgradeDialog shows covered plans "Included"; expired grants
dropped by `readGrantedPlanIds` (PostgREST `or=(expires_at.is.null,expires_at.gt.<iso>)` verified against the real
query builder) for every reader; read errors → logged 500, only no-row → 404; M14/M20 pinned; 429 shows the limiter sentence
+ retry time. Billing matrix (no grant / Lifetime Pro / Lifetime Pro + Agency sub / Founding Agency / expired grant / trial /
Agency subscriber × checkout / plan change / reactivate / lifetime purchase) matches the design and the webhook rule; no
legitimate purchase refused. 18 mutations, 17 red (R17 — highest-grant label — survived).

Minors: m1 checkout's catch still returned `error.message` (DB text to the signed-in caller); m2 R17 unpinned; m3 "for life"
shown for a dated grant (production QA grant `qa_recovery_20260919`).

## Fix pass `8b807a3` (rebased onto fc5968b) — orchestrator review

m1 checkout POST errors go through `billingErrorResponse` (generic 500 + log; customer refusals unchanged). m2 pinned
(unsorted `["agency","pro"]` → "Included in your lifetime Agency"; `.at(-1)`→`.at(0)` red). m3 the page's existing grant
query also reads `expires_at` (`readGrantedPlans`); a plan included only by dated grants reads "Included until <date>";
"for life" only for undated grants. 12 mutations red. Jest 389 suites / 5,093; type-check (both) 0; lint 0 errors;
format:check clean; build:embed 45828 / 33062; Playwright `--list` 80.

## Follow-ups (not blocking)

- s96: a dated grant on the plan *in force* is still labelled "Lifetime"/"Lifetime access" on the card and its own dialog
  tile (one production QA row today); the end date already reaches the dashboard.
- Owner (Stripe access): confirm the billing-portal configuration (`STRIPE_BILLING_PORTAL_CONFIGURATION_ID` or the default)
  has subscription updates disabled — otherwise a portal switch down into a covered plan bypasses these guards.
- Translate / A/B-generate refund failures still only `console.error`; reactivate reads the newest row whatever its status.

## Not verified

Stripe test-mode runs (payment-methods 404s, reactivate 409, Lifetime Pro + Agency checkout/PUT 409); a real-DB run of
`readGrantedPlanIds` with seeded expired/dated/trial/revoked grants; rendered UI at `md`; Sentry delivery of
`logger.error`; the payment-methods limiter during a Redis outage.

Max severity: minor
Ship allowed: yes
