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

## Creating Agency prices

The catalogue sync tool can create the two recurring Agency prices and the one-time Founding
Agency price. Creation is deliberately separate from verification: Stripe price amounts are
immutable, and the newly returned ids must first be installed in the matching environment.
Creation checks persistent price lookup keys and catalogue product/price metadata before creating
anything. Reused prices must match the active mode, currency, amount and billing interval.
Stable idempotency keys additionally protect short retries; Stripe may prune them after 24 hours,
so they are **not** a permanent deduplication mechanism. Run one catalogue-creation operator at a
time. An inactive or mismatched existing price is a blocker for review, not an instruction to
silently create another price.

For test mode, use the committed reviewed export (or export active rows from disposable local
Supabase). Test mode refuses remote Supabase reads without a local catalogue file:

```bash
node scripts/sync-stripe-catalogue.mjs --mode=test --catalogue=scripts/__tests__/fixtures/agency-catalogue.json --create=agency,lifetime_agency
npm run sync:stripe -- --catalogue=scripts/__tests__/fixtures/agency-catalogue.json --create=agency,lifetime_agency
npm run check:stripe -- --catalogue=scripts/__tests__/fixtures/agency-catalogue.json --only=agency,lifetime_agency
```

The first command previews; the second creates or reuses three prices and prints their price-id
environment assignments. Install the ids in the corresponding environment before verification.
No test or migration in this story uses production credentials.

## s33 live cutover — compatibility preparation, then migration first

These commands are **operator-only**, after review and merge authorization. None was run by the
implementation agent. Production already has `20260924020000` and `20260924050000`.
The unpublished `040000` has been re-dated; the final files are:

- `20260924065000_agency_plan_and_founding_capacity.sql`
- `20260924070000_subscription_plan_choice_from_catalogue.sql`

Do not use `--include-all`; `060000` and `070000` follow the applied migrations. Do not edit or
replay applied `020000`/`050000` to change their behavior.

1. **Prepare compatibility before the feature cutover.** Unpatched `300548a` throws on unknown
   active rows and is not a safe migration/rollback target. Backport the bounded compatibility
   patch from `docs/operations/patches/s33-catalogue-compat.patch` onto the current main release,
   run its tests and normal gates, and deploy it through the normal reviewed release process.
   Record that deployment as the pre-sale rollback baseline. This prerequisite does not expose
   Agency or change existing prices/limits. Never claim the original old binary is compatible.
2. **Prepare live prices from the reviewed local catalogue**, before changing the live DB. This
   keeps price creation/env installation outside the feature cutover window. In an authorized
   shell with the live Stripe key already securely installed, run exactly:

```bash
node scripts/sync-stripe-catalogue.mjs --mode=live --catalogue=scripts/__tests__/fixtures/agency-catalogue.json --create=agency,lifetime_agency
npm run sync:stripe:live -- --catalogue=scripts/__tests__/fixtures/agency-catalogue.json --create=agency,lifetime_agency
```

3. In the operator's production-linked Vercel checkout, install the returned ids interactively
   (price ids are non-secret; never paste the Stripe API key). For variables that already exist,
   use `vercel env update` instead of `add`:

```bash
vercel env add STRIPE_AGENCY_PRICE_ID_LIVE production
vercel env add STRIPE_AGENCY_YEARLY_PRICE_ID_LIVE production
vercel env add STRIPE_LIFETIME_AGENCY_PRICE_ID_LIVE production
vercel env add AGENCY_CHECKOUT_ENABLED production
```

   Set the last value to `true`. Install the returned `STRIPE_AGENCY_PRICE_ID_LIVE`, `STRIPE_AGENCY_YEARLY_PRICE_ID_LIVE`, and
   `STRIPE_LIFETIME_AGENCY_PRICE_ID_LIVE` in production's protected environment. Preserve
   Lifetime Pro's existing live price variable. Verify the prepared prices without DB reads:

```bash
npm run check:stripe:live -- --catalogue=scripts/__tests__/fixtures/agency-catalogue.json --only=agency,lifetime_agency
```

4. **Migration first, then feature application release.** From the reviewed release checkout,
   with the operator's Supabase CLI explicitly linked to the intended production project:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
```

   The dry run must list only reviewed pending migrations, including `060000` then `070000`.
   Stop if the project identity or migration list differs. Verify the schema/catalogue, then
   promote the reviewed s33 deployment with the live price ids installed and
   `AGENCY_CHECKOUT_ENABLED=true`. This is the feature release's migration-first order; the
   compatibility preparation above is mandatory. Confirm the Stripe endpoint has all 14 events
   below, including `checkout.session.expired`.

```bash
npm run check:stripe:live
```

5. Verify pricing contains Starter, Pro, Agency, Lifetime Pro and Founding Agency; annual Agency
   bills exactly $490. Confirm existing account limits and a separate test-mode founding
   purchase/expiry/refund cycle. A mocked test, a price creation response, and production
   promotion are distinct pieces of evidence.

### Safe rollback

Before any Agency sale, the recorded compatibility baseline can serve the expanded DB safely:
it ignores unsupported rows and preserves Starter/Pro/Lifetime Pro. After any Agency sale,
**retain the Agency-capable application and both migrations**. Set
`AGENCY_CHECKOUT_ENABLED=false` in the production deployment environment and redeploy that same
reviewed release. This stops new Agency subscription and founding checkout and hides their
purchase offers while preserving paid Agency limits, renewals, refunds and webhook processing.
Lifetime Pro remains available to eligible buyers. Do not deactivate the Agency plan row,
delete reservations, revert the schema, or roll back to a binary that cannot recognize Agency.
Exact rollback commands, from the correctly production-linked checkout at the reviewed s33
commit (`VERIFIED_S33_DEPLOYMENT_URL` must identify that release, not a preview with test env):

```bash
printf '%s' false | vercel env update AGENCY_CHECKOUT_ENABLED production
vercel redeploy "$VERIFIED_S33_DEPLOYMENT_URL" --target production
```

Confirm the new deployment is ready and is serving the intended source commit and updated
variable. Re-enable with `true` and redeploy only after the corrected release and price
verification pass. Existing open Checkout Sessions remain valid until their expiry; if sales
must stop immediately, inspect and expire unpaid Agency sessions individually in Stripe,
never paid sessions.

### Founding hold recovery without an expiry webhook

Checkout reserves one hold per account. The fixed session deadline uses Stripe's 30-minute
minimum plus a 10-second transport allowance (not the old 31-minute hold). Binding records the
provider expiry and may shorten, never lengthen, that hold. Definitive create failures release the unbound hold in the
same request. A failed response whose Stripe outcome is uncertain must not free a potentially
paid session merely to make a retry look successful.

When another founding checkout runs, the clock selects expired holds for provider reconciliation.
Bound sessions are retrieved directly; unbound holds are searched by reservation metadata in
Stripe session history, including lost-create-response recovery. Only confirmed expired/unpaid
sessions, or holds with no provider session after a complete successful search, are released.
The reserve RPC never frees capacity merely because a deadline passed. Completed or
paid sessions retain capacity until their success delivery is reconciled; provider outages fail
closed. This recovery does not require an expiry webhook or a new cron. Availability display
can lag cache expiry; checkout remains authoritative.

For an operator recovery, first inspect the reservation and matching session using the protected
production DB service profile and Stripe's authenticated CLI. IDs below are operator-supplied,
not credentials; never copy secret keys into command arguments:

```bash
PGSERVICE=recopyfast-production psql -X -v ON_ERROR_STOP=1 -c "SELECT id, user_id, status, stripe_checkout_session_id, checkout_expires_at FROM public.founding_agency_reservations WHERE status = 'reserved' AND checkout_expires_at <= EXTRACT(EPOCH FROM NOW());"
stripe checkout sessions retrieve "$SESSION_ID" --live
```

For an open unpaid session, explicitly expire it and re-retrieve its terminal status before
release. Never release a complete/paid session: replay/reconcile its success event instead.

```bash
stripe checkout sessions expire "$SESSION_ID" --live
stripe checkout sessions retrieve "$SESSION_ID" --live
PGSERVICE=recopyfast-production psql -X -v ON_ERROR_STOP=1 -v reservation_id="$RESERVATION_ID" -v user_id="$USER_ID" -v session_id="$SESSION_ID" <<'SQL'
SELECT public.release_founding_agency_checkout(:'reservation_id'::uuid, :'user_id'::uuid, :'session_id');
SQL
```

For an unbound hold, inspect Stripe request/session history by `founding_reservation_id` metadata
and the reservation's idempotency key. Only after confirming no session/payment exists (or
expiring and confirming an unpaid recovered session), release with the corresponding session
id; use SQL `NULL` only when there truly is no session. Re-check capacity and retry checkout.
Never decrement completed sales for a refund or dispute: the buyer loses entitlement, the
historical founding spot stays consumed (ADR 029).

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

Subscribe the endpoint to exactly these 14 event types, matching the switch in
`src/app/api/webhooks/stripe/route.ts`:

1. `customer.subscription.created`
2. `customer.subscription.updated`
3. `customer.subscription.deleted`
4. `invoice.payment_succeeded`
5. `invoice.payment_failed`
6. `payment_intent.succeeded`
7. `checkout.session.completed`
8. `checkout.session.expired`
9. `charge.refunded`
10. `charge.dispute.created`
11. `charge.dispute.closed`
12. `payment_intent.payment_failed`
13. `customer.created`
14. `customer.updated`

The operator must subscribe to `checkout.session.expired` during cutover. This event releases
both the matching s28 checkout intent and the s33 founding reservation; webhook event claiming
still precedes either effect. Verify the live subscription: changing this runbook does not
change Stripe. Time-based reservation recovery also handles missed expiry deliveries.


The exact event-update command is below. Resolve `STRIPE_WEBHOOK_ENDPOINT_ID` from the existing
canonical live endpoint first; this updates its event selection and does not create an endpoint
or rotate its signing secret:

```bash
stripe webhook_endpoints update "$STRIPE_WEBHOOK_ENDPOINT_ID" --live \
  -d 'enabled_events[]=customer.subscription.created' \
  -d 'enabled_events[]=customer.subscription.updated' \
  -d 'enabled_events[]=customer.subscription.deleted' \
  -d 'enabled_events[]=invoice.payment_succeeded' \
  -d 'enabled_events[]=invoice.payment_failed' \
  -d 'enabled_events[]=payment_intent.succeeded' \
  -d 'enabled_events[]=checkout.session.completed' \
  -d 'enabled_events[]=checkout.session.expired' \
  -d 'enabled_events[]=charge.refunded' \
  -d 'enabled_events[]=charge.dispute.created' \
  -d 'enabled_events[]=charge.dispute.closed' \
  -d 'enabled_events[]=payment_intent.payment_failed' \
  -d 'enabled_events[]=customer.created' \
  -d 'enabled_events[]=customer.updated'
stripe webhook_endpoints retrieve "$STRIPE_WEBHOOK_ENDPOINT_ID" --live
```

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
   14-event set. Capture its returned signing secret without printing it. Leave the old endpoint
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
   canonical endpoint with the exact 14-event set.
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
- [ ] Its enabled event set is exactly the 14 events above.
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
