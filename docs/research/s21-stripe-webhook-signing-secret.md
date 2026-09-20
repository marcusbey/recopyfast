# Research — Story s21-stripe-webhook-signing-secret

## Verdict first

The production failure was provider/deployment parity, not route code. Stripe's baseline live
endpoint used the canonical `www` URL and its enabled events matched all 13 switch cases exactly.
A real Checkout-created `customer.created` event nevertheless remained pending, while Vercel
logged `Webhook signature verification failed: No signatures found matching the expected
signature for payload` on the delivery and its retry. The deployed
`STRIPE_WEBHOOK_SECRET_LIVE` belonged to a different endpoint secret. The rotation below repaired
that mismatch and a fresh signed event processed successfully.

`docs/reviews/stories.md` currently says `Stories ready: no` for the original backlog. This
bounded operator repair was explicitly authorized and plan-validated by the user on 2026-09-19.

## Production evidence — 2026-09-19

- Baseline deployment: Vercel `READY`, exact `main` SHA `ee3942dd`; the rotation redeployed that
  same source rather than mixing the provider repair with repository changes.
- Health, readiness and pricing: HTTP 200; database/storage/critical paths pass.
- Stripe: one live enabled endpoint, canonical
  `https://www.recopyfa.st/api/webhooks/stripe`, exact 13 handled event types; no missing or extra
  subscriptions.
- Controlled Checkout: hosted live subscription Checkout created an open/unpaid USD session for
  `RecopyFast Pro`, $19.00. The application customer mapping existed; no subscription or
  entitlement existed before payment. The session was expired and disposable data removed.
- The corresponding real `customer.created` event stayed `pending_webhooks=1` after 60 seconds.
- Vercel runtime at the delivery timestamps logged signature mismatch twice. The earlier unsigned
  probe logged a different parse error, separating the real Stripe attempts from the probe.

## Why an unsigned probe is insufficient

`POST` with an invalid or absent `Stripe-Signature` proves only that the route is reachable and
rejects unauthenticated input. It cannot prove the configured endpoint secret. Only a
Stripe-signed event sent by the exact live endpoint can cross that boundary.

## Successful safe rotation

The endpoint creation API returns its signing secret; endpoint retrieval does not. An authorized
Dashboard operator can reveal an existing endpoint's secret. The executed recovery sequence used
overlapping endpoints; uninterrupted delivery was not established because the baseline was already broken:

1. Snapshot old endpoint id/event set and current deployment id; never print a secret.
2. Create a replacement live endpoint with the same canonical URL and exact 13-event set. Capture
   its returned secret in process memory only.
3. Resolve the existing Vercel production variable id and update it through authenticated
   `PATCH /v9/projects/recopyfast/env/{envId}?teamId={teamId}` with only
   `{ value, type: "sensitive", target: ["production"] }`, omitting its immutable key and
   suppressing output. The CLI update failed twice because its request resent that key; no
   provider state was inferred from either failed CLI operation.
4. Redeploy the exact current production source. If it fails, leave both endpoints intact and
   repair forward. No usable old-secret snapshot was captured; restoring the mismatched prior
   Vercel value would not restore service.
5. Once the deployment is `READY`, prove the replacement with a real signed overlap delivery.
   The replacement returned 200 and wrote a processed `billing_events` row; the old endpoint
   returned 400 because it signed with the superseded secret, so the shared event correctly
   remained at `pending_webhooks=1`. Only then delete the resolved old endpoint id.
6. Create a second disposable tagged Stripe customer after cutover. Its `customer.created` event
   reached `pending_webhooks=0` and a processed `billing_events` row. The two disposable Stripe
   customers and their application ledger rows were then removed.

The overlap is intentional: one endpoint remains recoverable while the replacement is proven.
The final read-back showed one enabled canonical endpoint with the exact 13-event set.

## Existing code and docs

- Signature gate: `src/app/api/webhooks/stripe/route.ts` reads the raw body and calls
  `stripe.webhooks.constructEvent` with the mode-specific secret.
- Mode selection: `src/lib/stripe/mode.ts` uses `*_LIVE` in Vercel production or when
  `STRIPE_LIVE_MODE=true` explicitly selects live elsewhere.
- `.env.example` correctly says webhook secrets are per endpoint and that mismatch makes every
  delivery 400.
- `docs/operations/stripe-setup.md` is materially stale: apex URL, six events, obsolete product
  names/prices/limits, and no safe rotation/real-delivery proof. It must be repaired rather than
  used during the operation.
- Targeted webhook suites already cover raw-body signature validation, claim-before-effect,
  ordering/stale writes and write failures. They do not and cannot prove provider secret parity.

## Rollback

Until old-endpoint deletion, rollback requires a secret verified to belong to that endpoint,
obtained securely from an authorized Dashboard operator or a preexisting protected backup.
Sensitive Vercel values cannot be retrieved, and the previous value was known mismatched.
Without a known-good old secret, repair forward. After the old endpoint is deleted, recovery is to
recreate another endpoint and repeat the same overlap; Stripe cannot reveal the deleted endpoint's
secret.

## Complexity

2. No application behaviour or schema changes are required. The repository change is the operator
   guide; the actual repair is an authenticated provider/environment transition with a controlled
   live proof.

## Remaining launch boundary

Endpoint parity is repaired. Reconciliation of legitimate failed events, Stripe Tax registration and completed-card subscription provisioning
remain separate launch acceptance and are not inferred from an unpaid Checkout Session.

Research updated with the executed rotation evidence on 2026-09-19.
