# ADR 039 — The founding offer is the account's one trial, lengthened and metered monthly

- Status: accepted
- Date: 2026-09-28
- Scope: story s47a-founding-20-grant (operator decision 2026-09-27, plan validated 2026-09-28)
- Amends: ADR 014 only on the trial's credit window, which becomes monthly windows anchored on
  the grant (a 14-day trial still sees exactly one). ADR 014's representation, its one-trial
  index and its expiry-in-the-query rule are unchanged, and this decision relies on all three.
  Also amends ADR 038 on "a trial confers the full plan": an offer trial confers every Pro limit
  except the monthly AI-credit allowance, which is 100 (floored by any higher allowance held).

## Context

The operator decided that the first 20 new accounts get Pro free for 90 days, with 100 AI
credits a month and no card; account 21 onward gets today's 14-day trial. Nothing in the
product could say any of that:

- A trial is a `plan_entitlements` row, `plan_id 'pro'`, `source 'trial'`, with an `expires_at`
  (ADR 014). Written by `grantTrialEntitlement` on the first sign-in that resolves to "no plan".
- "One trial per account, ever" is the partial unique index
  `plan_entitlements_one_trial_per_user` on `(user_id) WHERE source = 'trial'`. It is the only
  thing standing between a lapsed grant and a second trial, because a lapsed grant resolves to
  "no plan" and `ensureTrialStarted` then tries the 14-day insert.
- Three readers single out trials by `source = 'trial'`: `readGrantedPlanIds` (so a trialling
  account can still buy Lifetime Pro), `otherHeldPlans` (so a trial never lifts a purchase's
  allowance floor, ADR 038) and `readTrialGrant` (countdown, credit window, `everTrialed`).
- A trial resolves to the full `pro` row: 500 credits, in one non-renewing window from
  `granted_at`. A 90-day row would get 500 once, not 100 a month.
- ADR 038's override is keyed on the one product granting a plan; `lifetime_pro` already grants
  `pro`, and the loader refuses a second.

## Decision

**The founding offer grant IS the account's one trial row: `plan_id 'pro'`, `source 'trial'`,
no payment intent, `expires_at = claim + 90 days` on the database clock, marked
`plan_entitlements.offer_id = 'founding_20'`.** Migration `20260928120000_founding_offer.sql`.

- **The marker and its CHECK.** `offer_id` is a nullable `TEXT` referencing
  `founding_offers(id)`, with CHECK `offer_id IS NULL OR (source = 'trial' AND plan_id = 'pro'
  AND stripe_payment_intent_id IS NULL)`. An offer row stays a Pro trial nobody paid for; in
  particular the database refuses (23514) any rewrite of its `source`.
- **Claims and the lock.** `claim_founding_offer_spot(uuid)` is the only writer of an offer row.
  It checks eligibility and capacity without the lock (so that after sell-out no sign-in queues on
  it, and that pass only ever refuses), takes a blocking
  `pg_advisory_xact_lock(hashtextextended('founding_offer_capacity', 0))` — its own key, not
  `founding_agency_capacity`, so sign-ins never wait behind Stripe checkouts — re-checks both,
  then inserts the trial row **first** and the `founding_offer_claims` row second, never catching
  23505. A parallel 14-day fallback that lands first makes the whole claim roll back; a claim
  whose response is lost makes the caller's fallback hit the index and report a duplicate. Claim
  and grant succeed or fail together.
- **Eligibility** (decided in SQL, under the lock): `auth.users.created_at >=
  founding_offers.opened_at` (recorded by the migration; a NULL `created_at` fails closed), and
  no `plan_entitlements`, `billing_subscriptions` or `credit_purchases` row ever — revoked,
  expired, cancelled and spent rows included. Every refusal and every error falls back to
  today's 14-day trial in `ensureTrialStarted`, which never fails a sign-in.
- **Where the numbers live.** 20 spots and 90 days are SQL constants in the claim function,
  where the grant is written (precedent: 50 in `reserve_founding_agency_spot`); 20 is repeated
  in `get_founding_offer_availability`, which returns it as `spot_limit` so the application never
  restates it. 100 credits a month is `FOUNDING_OFFER_TERMS.founding_20.monthlyCredits` in
  `src/lib/billing/founding-offer.ts`: an allowance term, like `TRIAL_DURATION_DAYS` (ADR 014).
- **Held by the offer only.** The resolver meters the offer only when every live grant of the
  plan in force (`pro`) is an offer row and no live subscription bills `pro` — the same shape
  as ADR 038's "held by purchase only". Then `monthlyCredits` becomes the offer's 100 and
  `withAllowanceFloor` lifts it to anything higher the account holds through `otherHeldPlans`.
  Every other limit is Pro's. So: offer alone → 100; offer + Starter subscription → `pro`,
  max(100, Starter's); offer + Pro subscription or Lifetime Pro → 500; offer + Agency
  subscription → Agency, 1,000; offer + Founding Agency → Agency, 250 (a trial does not lift
  the floor). `readGrantedPlanIds` and `otherHeldPlans` needed no change.
- **Monthly windows for every trial.** An active trial's credit window becomes
  `startOfCurrentAllowanceWindow(granted_at)`: monthly windows anchored on the grant. A 14-day
  trial never reaches its first anniversary (the shortest gap between two is 28 days), so it
  keeps one window exactly as ADR 014 had it. The offer gets three windows in 90 days, and a
  partial fourth when three months after the anchor total 89 days (anchors Jan 31–Feb 28 of a
  non-leap year): about one day, at most 100 credits per account. **Accepted, not capped**: a cap
  would add a second window rule to the credit path every trial uses.
- **Release keeps `source`.** `release_founding_offer_spot(uuid, reason)` (service role, a
  non-blank reason, under the lock) marks the claim `released` and sets `revoked_at` on the
  linked row — nothing else. The released account resolves to "no plan", stays ineligible for a
  new claim, and cannot get a 14-day trial through the index. The spot goes back into the count.
  Release never goes through `revokeEntitlementForPayment`.
- **Migration first, then the application.** The resolver selects `offer_id`; deployed before
  the column exists, every entitlement read throws. The old application never reads the column
  or calls the functions, so the migration is safe alone. Merging to `main` is the production
  deploy here, so the migration is applied and verified BEFORE the PR merges. Runbook:
  `docs/operations/founding-offer.md`.

## Considered options

- **A new `plan_entitlements.source` for the offer** — rejected. It sits outside the one-trial
  index, so on the first sign-in after day 90 the 14-day insert succeeds and the account gets a
  second trial. Closing that needs a second unique index covering both sources, and each of the
  three trial readers has to learn the new value: missing `readGrantedPlanIds` sells Lifetime Pro
  as "already owned", missing `otherHeldPlans` gives a Founding Agency buyer 500 credits. ADR
  014's "Watch" names this blast radius.
- **A `plans` row for the offer** — rejected. A second one-time product granting `pro` makes
  `loadPlanCatalogue` throw (pricing, checkout and every gate down); an unknown id is filtered
  out and never resolves; a row the loader does parse is published on `/api/pricing`.
- **A synthetic payment intent on the row** — rejected. `grantTrialEntitlement` forbids it for
  the same reason, and ADR 038 would then read the row as a purchase.
- **A per-grant `monthly_credits` column** written by the claim — rejected. It is the
  per-entitlement limits column ADR 038 already rejected, for one number that is a term of the
  offer.
- **The calendar month as the offer's window** — rejected: sign up on the 28th, spend 100, get
  100 more on the 1st.
- **A try-lock** — rejected: it hands the 14-day trial to an account that arrived while spots
  remained.

## Consequences

- The first 20 eligible sign-ins after the migration get Pro for 90 days at 100 credits a month;
  purchased packs stack on top and are spent after the allowance, as before. After 20 claims,
  sign-in behaves exactly as it did.
- Every "no plan" sign-in now makes one extra service-role RPC before the 14-day insert. After
  sell-out it answers from the unlocked pass and never waits on the lock.
- `plan_entitlements` gains a column the resolver reads, which fixes the deploy order: schema
  first. Rolling the code back is safe and is the kill switch — old code reads offer rows as
  plain trials (500 credits in one window, "Trial — N days left"), which over-delivers but
  causes no outage. Never roll back the schema while claims exist.
- Watch: any future code that rewrites `plan_entitlements.source` hits the CHECK on an offer
  row, on purpose. Any future reader that branches on `source = 'trial'` inherits offer rows too
  — which is the point of this decision, and what to check first.
- The offer's copy on the badge, the billing card and the lapsed screen reads `trial.offerId`
  and `endedOfferId` from the entitlement and dashboard payloads (spread only when set, so every
  other account's payload is unchanged).
