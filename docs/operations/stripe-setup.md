# Stripe catalogue and inbound webhook operations

This guide describes the Stripe configuration RecopyFast actually runs. It is an operator
runbook, not a list of product values to copy into Stripe. Product names, prices, limits and
features change independently of this document and must come from the application catalogue.

## Sources of truth

- The active rows in the Supabase `plans` table are the product catalogue. Pricing pages,
  Checkout, feature gates and credit grants all read those rows.
- Stripe Price ids are resolved from the per-row Stripe-id overrides when present, otherwise from
  the mode-specific environment variables listed in `src/lib/stripe/plans.ts`.
- `npm run check:stripe` compares the test catalogue with Stripe. Use
  `npm run check:stripe:live` for the live catalogue. The `sync:*` variants mutate Stripe and
  require an explicit, reviewed catalogue change.
- No free plan is sold. An account can hold a plan through an active trial, subscription or
  lifetime/support grant. Purchased credits can confer credits-only entitlement without a plan.
  Otherwise it is unentitled; do not infer that state from subscription absence alone.
- `STRIPE_TICKETS_PRICE_ID{,_LIVE}` intentionally keeps its legacy name even though the product
  is Credits. Renaming an environment variable is not a catalogue migration.

Never reconstruct prices, quotas or feature bullets from this guide. Never add a hardcoded
fallback catalogue: a database or Stripe failure must not silently sell stale terms.

## Environments

Test and live mode have different API keys, Price ids, endpoint ids and webhook signing secrets.
In Vercel production the application selects the `*_LIVE` variables. Local and non-production
deployments default to test unless `STRIPE_LIVE_MODE=true` explicitly overrides them. A signing secret belongs to one exact Stripe webhook
endpoint. It cannot be shared merely because two endpoints use the same URL and event list.

Do not put live ids or secret values in source, documentation, command arguments, screenshots,
shell history, CI output or tickets. Keep secret-bearing input out of tracing and pipe it from a
protected in-memory source directly to the provider API.

## Canonical inbound endpoint

The one enabled live endpoint is:

`https://www.recopyfa.st/api/webhooks/stripe`

The `www` host is mandatory. The apex host redirects, and Stripe signature delivery must reach
the route directly rather than traverse a redirect.

Subscribe the endpoint to exactly these 13 event types, matching the switch in
`src/app/api/webhooks/stripe/route.ts`:

1. `customer.subscription.created`
2. `customer.subscription.updated`
3. `customer.subscription.deleted`
4. `invoice.payment_succeeded`
5. `invoice.payment_failed`
6. `payment_intent.succeeded`
7. `checkout.session.completed`
8. `charge.refunded`
9. `charge.dispute.created`
10. `charge.dispute.closed`
11. `payment_intent.payment_failed`
12. `customer.created`
13. `customer.updated`

The production endpoint's write-only secret is the value of
`STRIPE_WEBHOOK_SECRET_LIVE`. `STRIPE_WEBHOOK_SECRET` is the separate test-mode secret. Stripe's
creation API returns the secret, while its endpoint retrieval API omits it. Authorized operators
can reveal an existing endpoint secret in Stripe Dashboard. Vercel Sensitive values cannot be read
back. If parity cannot be restored from the exact endpoint's secret, replace the endpoint using
the procedure below.

## Recovering signing-secret parity with overlapping endpoints

Use this procedure when the deployed secret cannot be proven to belong to the canonical live
endpoint. Keep the current endpoint until the replacement has delivered a signed event through
the new deployment. This is a recovery procedure, not an uninterrupted-delivery guarantee:
the incident's old endpoint already failed signature verification, and deployment transitions
can cause retries. Reconcile legitimate failed deliveries separately before declaring billing healthy.

1. **Resolve the baseline read-only.** Record, in protected process memory, the current endpoint
   id, canonical URL, enabled state and event set. Resolve the current production deployment and
   source commit. Confirm there is exactly one current endpoint before choosing any mutation
   target.
2. **Create the replacement first.** Create a live endpoint with the same canonical URL and exact
   13-event set. Capture its returned signing secret without printing it. Leave the old endpoint
   in place; during the overlap Stripe may deliver to both endpoints, and idempotency in
   `billing_events` prevents a successfully authenticated duplicate from granting twice.
3. **Patch the existing Vercel variable by environment-variable id.** Resolve the production
   `STRIPE_WEBHOOK_SECRET_LIVE` record, then use Vercel's authenticated environment API to
   `PATCH /v9/projects/recopyfast/env/{envId}?teamId={teamId}`. Send a body containing only
   `{ value, type: "sensitive", target: ["production"] }` through protected stdin; omit `key` and
   suppress output. The CLI update path failed twice during the 2026-09-19 rotation with
   `You cannot change the key of a Sensitive Environment Variable` because its request resent the
   immutable key. A CLI attempt is therefore not proof of an update. Keep request bodies and
   verbose HTTP logging disabled.
4. **Redeploy the exact proven source.** Redeploy the intended production commit without mixing
   in repository changes. Require `READY`, the expected commit SHA and the canonical production
   aliases before continuing.
5. **Prove the replacement while both endpoints exist.** Deliver a real Stripe-signed event to
   both endpoints. Require the replacement delivery to return 2xx and the handler to write a
   processed `billing_events` row. The old endpoint now signs with the superseded secret, so its
   delivery can return 400 and keep the shared event at `pending_webhooks = 1` during overlap;
   that is not a replacement failure. Attribute each response to its endpoint and do not infer
   parity from endpoint metadata alone.
6. **Remove only the old endpoint.** After the replacement proof succeeds, delete the previously
   resolved old endpoint id. Re-read Stripe configuration and require exactly one enabled
   canonical endpoint with the exact 13-event set.
7. **Run a fresh post-cutover proof.** Create one disposable, clearly tagged Stripe customer and
   require its new `customer.created` event to reach `pending_webhooks = 0` and a processed
   ledger row. Remove both proof customers and both application ledger rows. Stripe's immutable
   event history remains; document it rather than trying to erase it.

### Why curl is not proof

An unsigned or incorrectly signed `POST` that returns
`Webhook signature verification failed` proves the route is reachable and fails closed. It does
not prove that Stripe's endpoint secret matches the deployed environment value. Only a delivery
signed by the exact live endpoint crosses that boundary.

## Rollback

Before the old endpoint is deleted, rollback is possible only if its verified signing secret is
available securely, for example through an authorized Stripe Dashboard operator:

1. Set the secret known to belong to the retained old endpoint through the protected PATCH-by-id
   path. Never restore the known-mismatched previous Vercel value.
2. Redeploy the same proven source commit.
3. Confirm the old endpoint handles a real signed delivery.
4. Remove the unproved replacement only after the rollback delivery succeeds.

If no known-good old secret is available, retain the endpoints and repair forward using the
replacement secret; do not claim an unperformed secret backup. If the old endpoint has already
been deleted, create another
replacement and repeat the overlap procedure. Never disable the only proven endpoint and never
guess a signing secret.

## Verification and cleanup checklist

- [ ] One enabled live endpoint uses the canonical `www` URL.
- [ ] Its enabled event set is exactly the 13 events above.
- [ ] The production deployment is `READY` at the intended source commit.
- [ ] A real signed delivery returns 2xx, reaches `pending_webhooks = 0`, and records a processed
      `billing_events` row.
- [ ] A hosted Checkout test stays unpaid/open until payment and creates no subscription or
      entitlement before payment.
- [ ] Disposable Stripe customers and application customer/ledger/test rows are removed.
- [ ] Disposable Checkout Sessions are expired; Stripe retains session and event history.
- [ ] Legitimate billing events from the failure interval are reconciled independently of QA events.
- [ ] No secret material remains in process environment, temp files, shell history, logs,
      screenshots or artifacts.
- [ ] `npm run check:stripe:live` passes without applying changes.

## Stripe Tax launch note

Webhook-secret parity does not prove tax readiness. Before accepting completed live card
payments, separately confirm the business's Stripe Tax registration, registrations by
jurisdiction, product tax codes, customer-address collection and live Checkout tax calculation.
That commercial launch gate is outside webhook rotation and must not be inferred from an unpaid
Checkout Session or a successful `customer.created` delivery.
