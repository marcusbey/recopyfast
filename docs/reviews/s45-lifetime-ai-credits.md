# Review — s45-lifetime-ai-credits

Reviewer: fresh-context `reviewer` subagent, 2026-09-26, on 0d1617d (base origin/main 2376209).
Returned as text (policy forbids report files); recorded by the orchestrator.

## Gates (reviewer, CI placeholder env)
type-check pass · lint 0 errors (38 pre-existing warnings) · full Jest 271 suites / 3,520 passed,
39 skipped · Prettier clean on touched `src/`. Build not run.

## Verified
- New references exist: `findPurchasedPlanById` (`plans.ts:585`), `findPlanHeldByPurchase`
  (`plan-types.ts:170`), `requireNumber`/`requireBoolean` (`plans.ts:247`, `:259`).
- Only `credits/system.ts:143` reads the monthly allowance, via `resolveEntitlement`; plan id stays
  `agency`; seat/site/feature limits unchanged.
- Migration: new file, one idempotent `UPDATE … WHERE id='lifetime_agency'`; the deployed loader
  (`plans.ts:327-350` on main) never reads `limits` on one-time rows → either apply order is safe.
- Offer surfaces read the row's text; `/api/pricing` gains no row and no `grantLimits`.
- `sync:stripe:live` without `--create` patches product name/description/metadata only
  (`sync-stripe-catalogue.mjs:695-733`), never prices — but every drifted product, so read the dry run.

## Mutations (each reverted, `git diff --exit-code` clean)
override dropped 4 red · override applied to subscribers 11 red · payment-intent check ignored 2 red.

## Findings
1. **critical** — `effective-plan.ts:379-381`: holding the lifetime by purchase ignores every other
   paid entitlement. A Lifetime Pro owner (500/month for life) who buys Founding Agency drops to 250
   permanently. Reachable: `LifetimeOfferCard.tsx:73-96` offers it to them; `checkout/route.ts:604`
   only refuses existing `agency` holders. Fix: allowance = max(250, any other live paid grant or
   subscription's allowance).
2. **major** — same lines: a Pro subscriber who buys the lifetime drops from 500 to 250 for the rest
   of the paid period, contradicting the card's "You keep the period you have already paid for"
   (`LifetimeOfferCard.tsx:178-186`). Same fix.
3. **major** — `SubscriptionCard.tsx:125,151` shows a lifetime owner "1,000 AI credits / month"
   beside a 250 wallet; s45 makes that bullet false. Fix before the first sale.
4. **minor** — re-running 20260924065000 (`:61` rewrites `limits`) silently restores 1,000; ADR 038
   only warns about deactivating the row.

## Not verified
Production `lifetime_pro.limits` (orchestrator checked 2026-09-26: `{}`); number of Lifetime Pro
owners (orchestrator: none real — only QA `pro` grants); migration on a real DB; rendered pages; a
real purchase vs `creditWallet.included`. Stripe not contacted.

_Verdict of the first pass: Max severity critical, ship not allowed — superseded below._

## Re-review — 2026-09-26, on 1c97f59

Gates (reviewer, CI placeholder env): type-check pass; lint 0 errors (38 pre-existing warnings);
Prettier clean; full Jest 272 suites passed / 2 skipped, 3,537 passed / 39 skipped. Build not run.

- **Findings 1 and 2 fixed.** `withAllowanceFloor` (`effective-plan.ts:475-487`) only raises
  `monthlyCredits`, to the highest live source; plan id and other limits unchanged. Probes on the
  real resolver + `getUserCreditBalance`: lifetime alone 250; Lifetime Pro + lifetime 500; Pro
  subscriber mid-period 500 (past-due 500) → 250 after period end; Agency subscriber 1,000; Pro trial
  + lifetime 250; Pro support comp + lifetime 500; Starter subscriber 250. Comp counts as a floor,
  trial does not — consistent with ADR 038 and ADR 014.
- **Finding 3 fixed.** The card reads the server-resolved `creditWallet.included`; "Lifetime access"
  when a non-trial grant holds the plan and no live subscription bills it (Lifetime Pro no longer
  shows "$19/month").
- **Finding 4 fixed.** ADR 038 names 20260924065000 line 61. No migration touched.

Mutations (restored, `git diff --exit-code` clean): floor dropped 5 red · trials counted 2 · comps
excluded 1 · subscription ignored 2 · card shows plan bullets 3 · lifetime price ignored 2 · card fed
catalogue allowance 3.

### New findings (minor — follow-ups)
1. `UpgradeDialog.tsx:245-264` still marks Agency "Current" with "$49/month" and "1,000 AI credits /
   month" for a lifetime owner.
2. `SubscriptionCard.tsx:52-54` finds the bullet to restate by matching "1,000 AI credits"; rewording
   it in `plans` silently brings the false 1,000 back.
3. Pre-existing: badge "Free" for a lifetime owner with no subscription (`:133`); "Reactivate
   Subscription" offered on the Pro plan a lifetime buyer is cancelling (`:235`).

### Not verified
No browser render; production `plans.features` wording; a real purchase vs the wallet; Stripe.
Human check: as a QA lifetime owner, compare `/dashboard/billing` card and Change-plan dialog with
the wallet.

Max severity: minor
Ship allowed: yes
