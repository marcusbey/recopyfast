# Runbook — before deploying s51 (editing needs a plan)

s51 ([ADR 041](../decisions/041-editing-needs-the-site-owners-plan.md)) makes AI credits spendable
only once the site owner holds a plan, and stops selling credits to accounts without one. An
account that **paid** for credits and holds no plan would lose the use of what it bought. Before
the deploy, the operator lists those accounts and comps a plan or refunds each one.

This is the operator's step, not the implementer's. Run it read-only against production through
the `read-prod-database` path. Never write through it.

## Paid credits-only accounts

A paid pack has a real Stripe payment intent: refund grants are recorded as `refund_%`, and
included or complimentary credits carry none. An account is credits-only when no live plan
entitlement and no live paid subscription exists for it.

```sql
SELECT cp.user_id, u.email, count(*) AS packs, sum(cp.price_cents) AS paid_cents,
       sum(cp.credits_remaining) AS credits_left
FROM credit_purchases cp JOIN auth.users u ON u.id = cp.user_id
WHERE cp.stripe_payment_intent_id IS NOT NULL
  AND cp.stripe_payment_intent_id NOT LIKE 'refund_%'
  AND NOT EXISTS (SELECT 1 FROM plan_entitlements pe WHERE pe.user_id = cp.user_id
        AND pe.revoked_at IS NULL AND pe.plan_id <> 'free'
        AND (pe.expires_at IS NULL OR pe.expires_at > now()))
  AND NOT EXISTS (SELECT 1 FROM billing_subscriptions bs WHERE bs.user_id = cp.user_id
        AND bs.status IN ('active','trialing','past_due') AND bs.plan <> 'free')
GROUP BY cp.user_id, u.email;
```

## What to do with each row

- **Comp**: grant a plan entitlement, which makes the credits spendable again.
- **Refund**: refund the pack's payment in Stripe.

Record the choice for each `user_id`. An empty result means nothing to do, and the deploy can go
ahead.
