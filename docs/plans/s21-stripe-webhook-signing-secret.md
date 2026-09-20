---
validated: yes
---

> Validated 2026-09-19 by the user's explicit instruction to rotate the exact live endpoint
> secret, redeploy safely, trigger a controlled real event, prove downstream processing, and
> clean disposable billing data.

# Plan — Story s21-stripe-webhook-signing-secret

Branch: `feature/s21-stripe-webhook-signing-secret`

Research: `docs/research/s21-stripe-webhook-signing-secret.md`

## Tasks

1. [x] **Capture a secret-safe baseline.** Resolve the one current live endpoint id, canonical URL,
       enabled status, exact 13-event set, current production deployment id/SHA, and one real pending
       `customer.created` event. Preserve ids in process memory only; record no secret value. Externally
       evidenced on 2026-09-19.

2. [x] **Create an overlapping replacement endpoint.** Create the same canonical URL/event set and
       capture the returned secret in memory while retaining the old endpoint as the rollback path.
       Externally evidenced on 2026-09-19.

3. [x] **Update Vercel and redeploy exact production source.** The CLI update failed twice because
       it resent the environment variable's immutable key. Resolve the existing variable id; call
       `PATCH /v9/projects/recopyfast/env/{envId}?teamId={teamId}` through protected stdin with only
       `{ value, type: "sensitive", target: ["production"] }`; suppress output; then redeploy the
       proven deployment. Require `READY`, source SHA `ee3942dd` and canonical aliases. Externally
       evidenced on 2026-09-19.

4. [x] **Prove the replacement before removing the old endpoint.** For one real overlap event, the
       replacement returned 200 and produced a processed `billing_events` row while the old endpoint
       returned 400 with its superseded signature; the shared event therefore remained
       `pending_webhooks=1` until cutover. Externally evidenced on 2026-09-19.

5. [x] **Cut over and run a fresh live proof.** Delete only the resolved old endpoint, verify the
       replacement is now the sole enabled endpoint, create one disposable tagged Stripe customer,
       require its `customer.created` event to reach `pending_webhooks=0` and a processed DB row, then
       delete the customer and both disposable event rows. Externally evidenced on 2026-09-19: the
       post-cutover event processed, both disposable customers were removed, and the final endpoint
       read-back showed one canonical endpoint with exactly 13 events.

6. [x] **Repair the operator guide.** Rewrite `docs/operations/stripe-setup.md` to the DB-driven
       catalogue/current product contract; canonical webhook URL; exact 13-event list; per-endpoint
       secret rule; overlapping-endpoint recovery; real signed-delivery verification; rollback points; and an
       explicit statement that unsigned curl does not prove secret parity. Never include a real key,
       endpoint id, customer id or event id.

7. [x] **Record cleanup proof and run repository documentation checks.** External evidence confirms
       the unpaid $19 Pro Checkout created no pre-payment subscription/entitlement and the two
       disposable Stripe customers and ledger rows were removed. Repository verification for this
       documentation-only execution is `git diff --check`, Prettier on the changed Markdown, and a
       secret/id-pattern scan. Immutable Stripe event history is expected.

## Interdicts

- No secret in command arguments, stdout/stderr, debug mode, temp artifacts, source, screenshots,
  docs, PR or chat. Pass it through in-memory stdin only.
- Never delete or disable the old endpoint before the replacement handles a signed event.
- Resolve provider/environment/deployment ids read-only before any mutation; no guessed target.
- Do not change route code, event semantics, product prices, subscriptions, entitlements or tax.
- Do not treat a 400 unsigned probe as success.

## Definition of Done

One canonical live endpoint with the route's exact events signs with the deployed secret; a new
real event reaches 2xx, `pending_webhooks=0`, and a processed billing ledger row; unpaid Checkout
creates neither access nor subscription; disposable data and secret material are gone; the operator
guide can reproduce and roll back the rotation without revealing credentials.

Plan executed on 2026-09-19. Provider tasks above were performed and evidenced externally; this
execution changed repository documentation only.
