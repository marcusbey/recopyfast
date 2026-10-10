# The founding offer — deploy, prove, release

The first 20 accounts created after the offer opens get Pro free for 90 days, metered at 100 AI
credits a month, no card. Account 21 onward gets the 14-day trial. Design and trade-offs:
[ADR 039](../decisions/039-founding-offer-is-the-one-trial.md). Migration:
`supabase/migrations/20260928120000_founding_offer.sql`.

Commands below use the protected production DB service profile (`PGSERVICE=recopyfast-production`)
and an operator-supplied `APP_URL` (the production app origin). IDs are operator-supplied, not
credentials; never copy a secret key into a command argument.

## 1. Deploy order — migration first, then the application

The new resolver selects `plan_entitlements.offer_id`. If the application ships before the
column exists, every entitlement read throws: every gate and every route that resolves
entitlement fails, for every account (middleware only hides it by failing open). The old
application never reads the column or calls the new functions, so the migration is safe on its
own and the old code keeps granting 14-day trials until the new code ships.

**In this repository, merging to `main` IS the production deploy** (Vercel Git integration).
So the order is: apply the migration, verify it (below), and only then merge the PR. Never merge
first and migrate "right after" — the minutes in between take down every entitlement gate
(review finding M1, reproduced locally as PostgREST 42703).

From the reviewed release checkout, with the Supabase CLI linked to the intended production
project:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must list only reviewed pending migrations — `20260926120000` too if it is still
pending, then `20260928120000`. Stop if the project identity or the list differs. Then:

```bash
supabase db push --linked
```

Verify the functions exist and the count reads 20:

```bash
PGSERVICE=recopyfast-production psql -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT to_regprocedure('public.claim_founding_offer_spot(uuid)') IS NOT NULL AS claim,
       to_regprocedure('public.get_founding_offer_availability()') IS NOT NULL AS availability,
       to_regprocedure('public.release_founding_offer_spot(uuid,text)') IS NOT NULL AS release;
SELECT * FROM public.get_founding_offer_availability();
SELECT id, opened_at FROM public.founding_offers;
SQL
```

Expect three `t`, then `spot_limit 20, claimed 0, remaining 20, sold_out f`. `opened_at` is the
moment the offer opened: only accounts created at or after it are eligible. Then deploy the
application right away. An account created in the gap still gets the 14-day trial — the old code
never calls the claim — and cannot claim later, because it already has a trial row.

## 2. Live proof

1. Sign up a new QA account and complete the first sign-in.
2. The count endpoint is uncached (`Cache-Control: no-store`), so it moves at once:

   ```bash
   curl -s "$APP_URL/api/offers/founding"
   # {"limit":20,"remaining":19,"soldOut":false}
   ```

3. The dashboard shows the offer's countdown, and the billing page shows 100 AI credits.
4. Confirm the row the claim wrote (step 4 queries).

## 3. Release a QA account's spot

Service role only. Sets the claim to `released` and the grant's `revoked_at`, and nothing else —
never `source`, which would take the row out of the one-trial index and hand the account a new
14-day trial on its next sign-in. The database refuses a `source` rewrite on an offer row
anyway. Never use `revokeEntitlementForPayment` for this.

```bash
PGSERVICE=recopyfast-production psql -X -v ON_ERROR_STOP=1 -v user_id="$USER_ID" -v reason="qa" <<'SQL'
SELECT public.release_founding_offer_spot(:'user_id'::uuid, :'reason');
SQL
```

The result is one of `released`, `not_claimed` or `already_released`; a blank reason is refused.
Then the count reads 20 again, and the account resolves to no plan: it cannot re-claim (it has a
grant row) and cannot start a 14-day trial (the one-trial index).

```bash
curl -s "$APP_URL/api/offers/founding"
# {"limit":20,"remaining":20,"soldOut":false}
```

## 4. Inspection queries

```bash
PGSERVICE=recopyfast-production psql -X -v ON_ERROR_STOP=1 <<'SQL'
-- The ledger. user_id is NULL for a deleted account: its spot stays consumed.
SELECT c.id, c.user_id, c.status, c.claimed_at, c.released_at, c.release_reason,
       e.granted_at, e.expires_at, e.revoked_at
FROM public.founding_offer_claims c
LEFT JOIN public.plan_entitlements e ON e.id = c.entitlement_id
WHERE c.offer_id = 'founding_20'
ORDER BY c.claimed_at;

-- Every offer row has exactly one claim, and every live claim its row.
SELECT
  (SELECT COUNT(*) FROM public.plan_entitlements WHERE offer_id = 'founding_20') AS offer_rows,
  (SELECT COUNT(*) FROM public.founding_offer_claims
    WHERE offer_id = 'founding_20' AND entitlement_id IS NOT NULL) AS linked_claims;
SQL
```

`offer_rows` and `linked_claims` differ only for deleted accounts (their row cascades away,
their claim stays with `entitlement_id` NULL).

## 5. Rollback

Rolling the application back is the kill switch. Old code reads offer rows as plain trials: 500
credits in one window, "Trial — N days left". That over-delivers, but causes no outage, and the
old code stops making claims. **Never roll back the schema while claims exist**, and never deploy
code that reads `offer_id` to a database without the migration: that breaks every entitlement
read.
