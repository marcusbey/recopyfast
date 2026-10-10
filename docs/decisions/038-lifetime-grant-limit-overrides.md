# ADR 038 — A lifetime product may override limits of the plan it grants

- Status: accepted
- Date: 2026-09-26
- Scope: s45-lifetime-ai-credits (operator decision 2026-09-26)
- Amends: ADR 029 only by adding what a purchased Agency grant's *limits* are; its precedence
  (Agency outranks lower tiers, grant-first otherwise) is unchanged.

## Context

The operator limited the $299 lifetime Founding Agency to 250 monthly AI credits; the Agency
subscription keeps 1,000, and everything else Founding Agency confers stays exactly Agency.
Until now a purchase conferred its granted plan verbatim: `complete_founding_agency_purchase`
writes `plan_entitlements.plan_id = 'agency'` literally (20260925110000), the resolver returns
the `agency` catalogue row (`resolveEntitlement` → `findPlanById`), and the credit allowance is
that row's `limits.monthly_credits` (`getUserCreditBalance`). Every feature gate reads limits,
never the plan id; the plan id `agency` is instead the identity that the webhook guard, checkout
eligibility, the lifetime offer card, dashboard navigation, the entitlement summary and the
database "owned" check all compare against.

## Decision

**A one-time product that grants a plan may carry, in its own `plans.limits`, overrides of the
granted plan's limits. They apply to an account that holds that plan through a purchase only.**
The Founding Agency row carries `{"monthly_credits": 250}` (migration 20260926120000).

- **Held through a purchase only** = every live grant of the plan carries a Stripe payment
  intent (the database's own definition of owning the founding lifetime,
  `reserve_founding_agency_spot`), **and** no live subscription bills the same plan. A support
  comp or a trial (no payment intent) confers the full plan; so does a live subscription on the
  same plan, which covers a subscriber who buys the lifetime and keeps the period already paid.
- **An override never lowers an allowance the account already holds.** For a plan held by
  purchase only, the monthly AI-credit allowance is the highest of the purchased view's and that
  of every other plan the account holds through a live non-trial grant (bought or comped, each
  counted the way it is held) or its live subscription. A Lifetime Pro owner (500) who buys
  Founding Agency keeps 500; a Pro subscriber who buys it keeps 500 until that subscription's paid
  period ends, then 250; a Starter subscriber gets 250, not 0. Trials do not count (ADR 029 keeps a
  Pro trial from outranking the purchase; it does not lift the allowance either). Only
  `monthlyCredits` is floored — the only key any product overrides — and the plan id and every other
  limit are unchanged (`withAllowanceFloor`, `effective-plan.ts`). Added after the s45 review
  (findings 1 and 2): without it, both buyers dropped to 250 while the offer is sold to them.
- **The plan id does not change.** The owner still resolves to `agency`; only the limits object
  differs (`findPlanHeldByPurchase` / `findPurchasedPlanById`). No DB function, Stripe metadata,
  identity check or `PaidPlanId` changes.
- **Strictly parsed.** Override keys must be the six plan-limit keys with the right types;
  anything else fails the catalogue load, like every other malformed known row (ADR 029).
- **Unambiguous.** At most one active one-time product may grant a given plan; the loader
  refuses a second.
- **The overriding row stays active** while anyone holds its grant: the loader reads active rows
  only, so deactivating it would silently restore the full plan. The offer is withdrawn with
  `AGENCY_CHECKOUT_ENABLED=false` or the founding cap, never `is_active`.
- **Never re-run 20260924065000.** Its seed upsert ends in `ON CONFLICT (id) DO UPDATE SET …
  limits = EXCLUDED.limits` (line 61), which would write `lifetime_agency.limits` back to `{}` —
  silently restoring 1,000 credits to every lifetime owner — and the "Everything in Agency" copy
  with it. Migrations are forward-only (AGENTS.md non-negotiable 5) and an applied one is never
  re-run; this names the one that would undo this decision if it were. A later reseed of this row must
  carry `{"monthly_credits": 250}` itself.
- `/api/pricing` does not publish overrides; the offer's copy (description and bullets on the
  same row) states them.

## Alternatives rejected

- **A hidden `agency_lifetime` plan row with `lifetime_agency.grants_plan_id` repointed.** Every
  `'agency'` identity check — two SQL money functions restated by `CREATE OR REPLACE`, the
  webhook guard, checkout, the offer card, nav rank, the entitlement summary, `PaidPlanId` and
  `PRICE_ID_ENV_VARS` — would need the new id, and a missed one either locks the owner out of
  Agency navigation or sells the hidden plan. Applying the repoint before the code deploys makes
  the running loader throw on an unknown grant target: pricing, checkout and every gate down at
  once (the ADR 014 failure class). The override is inert to deployed code and safe in either
  deploy order.
- **Keying the override on `plan_entitlements.source`.** `source` is rewritten on revocation and
  restored on a won dispute, and the column default is `lifetime_purchase`, so a hand-inserted
  comp would read as a purchase. The payment intent is what the database already uses.
- **A per-entitlement product/limits column on `plan_entitlements`.** Needs a schema change, a
  backfill and a restated grant function for one number that belongs in the catalogue.
- **A constant in code.** `plans` is the source of truth (AGENTS.md non-negotiable 7).

## Consequences

- Monthly allowance for a lifetime Founding Agency owner: 250 from the migration onward, or more
  when another plan they hold gives more (none exist at the time of writing). Credit packs stack
  on top as before.
- A purchase-only Agency holder now costs one extra `billing_subscriptions` read per resolution
  (the Agency short-circuit is kept for any grant that confers the full plan), plus cached
  catalogue lookups for the other plans it holds; the entitlement read also selects `source`.
- The billing page's plan card states the allowance the server resolved (the credit wallet's
  `included`) in place of the catalogue plan's "1,000 AI credits / month" bullet, and shows
  "Lifetime access" rather than a monthly price when the plan in force is held by a permanent
  grant that no subscription bills (s45 review, finding 3; before it, every lifetime owner saw
  "$49/month" or "$19/month").
