---
validated: yes
validated_by: 'operator decision 2026-09-26 — lifetime Founding Agency limited to 250 AI credits/month (spots stay at 50)'
validated_at: 2026-09-26
---

# Plan — Story s45-lifetime-ai-credits

Branch: `feature/s45-lifetime-ai-credits`
Research: `docs/research/s45-lifetime-ai-credits.md` — read it first; this plan does not repeat it.

## Target story

A lifetime Founding Agency owner gets every Agency capability and 250 monthly AI credits instead
of 1,000; Agency subscribers are unchanged; the offer says so wherever it is presented. Design
(research, "Design choice"): the `lifetime_agency` row's own `limits` carries
`{"monthly_credits": 250}` as an override of the plan it grants, applied only when that plan is
held by purchase alone (live grant(s) all carrying a Stripe payment intent, and no live
subscription on the same plan). No new plan id, no DB function change, no Stripe price change.

## Tasks (ordered)

1. [x] The migration, test-first. Extend `src/__tests__/lib/stripe/plan-seed.test.ts` with a
   `describe` over `supabase/migrations/20260926120000_lifetime_agency_monthly_credits.sql`.
   Red (file absent): it updates only `WHERE id = 'lifetime_agency'`; sets `limits` to exactly
   `{"monthly_credits": 250}`; features exactly `["Everything in Agency, with 250 AI credits a
   month", "One payment, no renewal", "Founding offer limited to 50 completed sales"]`; the
   description says "250 AI credits a month"; it never sets `price_monthly`, `grants_plan_id`,
   `is_active`, `sort_order` or any `stripe_*` column, never touches the `agency` row, inserts no
   `plans` row and defines no function; the applied `20260924065000` seed still holds `'{}'` and
   "Everything in Agency" for `lifetime_agency`. Green: write the migration (header states the
   design, the deploy order, the Stripe description sync and "keep the row active"). Then apply
   it to the local dev database inside `BEGIN … ROLLBACK` twice (idempotency, constraints) —
   never to production.
2. [x] The catalogue parses grant overrides, test-first, in `src/__tests__/lib/stripe/plans.test.ts`.
   Red: a `lifetime_agency` row with `limits {"monthly_credits": 250}` loads as
   `grantLimits: { monthlyCredits: 250 }`; `lifetime_pro` with `{}` loads `{}`; an unknown key
   and a mistyped value each make the load throw; two active one-time rows granting the same
   plan make the load throw; `findPurchasedPlanById("agency")` returns Agency's limits with
   `monthlyCredits: 250` while `findPlanById("agency")` still returns 1,000;
   `findPurchasedPlanById("pro")` is the very `findPlanById("pro")` object. Green:
   `OneTimeProduct.grantLimits?` + pure `findPlanHeldByPurchase(catalogue, planId)` in
   `plan-types.ts`; strict `toGrantLimits` (`Object.hasOwn` key table, reuses
   `requireNumber`/`requireBoolean`), the uniqueness check and `findPurchasedPlanById` in
   `plans.ts`.
3. [x] Entitlement and allowance, test-first. New
   `src/__tests__/lib/billing/lifetime-agency-allowance.test.ts`: the real `plans.ts` over a
   service-client stub serving production-shaped rows, the real `effective-plan.ts` and
   `credits/system.ts` over an in-memory payer client (ordering honoured). Red — the current
   1,000: a lifetime Founding Agency owner resolves to `agency` with every Agency limit and
   `monthlyCredits 250`, and `getUserCreditBalance(user, client).included` is 250 (plus
   purchased credits on top). Guards: Agency subscriber 1,000; lifetime owner whose Agency
   subscription is still live 1,000, and 250 once it is canceled; Agency comp without payment
   1,000; lifetime owner with a newer Pro trial still `agency` at 250 (ADR 029); Lifetime Pro
   owner Pro's 500; lifetime owner against the pre-migration row (`limits {}`) 1,000
   (deploy-order safety). Green: `readEffectivePlanBasis` in `effective-plan.ts` (selects
   `plan_id, stripe_payment_intent_id`; `readEffectivePlanId` becomes its `planId`; the Agency
   short-circuit is kept for any grant not purchase-only) and `resolveEntitlement` choosing
   `findPurchasedPlanById` for a purchase-only basis. Update any suite that mocks
   `@/lib/stripe/plans` and now reaches the new export (declared).
4. [x] The /compare offer copy, test-first. `src/lib/compare/__tests__/comparison-pricing.test.ts`:
   `founding.monthlyCredits` is 250 from the product's override and Agency's 1,000 without one.
   `src/__tests__/integration/comparison-pages.test.tsx`: the pricing row and "Pricing context"
   say `Founding Agency is $411 lifetime: everything in Agency, with 250 AI credits a month; 9 of
   50 founding spots remain.`; sold-out and unknown-availability copy unchanged. Green:
   `comparison-pricing.ts` computes it with `findPlanHeldByPurchase`; `ComparisonPage.tsx`
   formats it (`en-US`). Existing fixtures gain the field (declared).
5. [x] Pricing API guard, `src/__tests__/api/pricing-agency.test.ts`: with the post-migration
   product (override + new copy), `/api/pricing` lists exactly the catalogue's sellable plans,
   passes the founding copy through verbatim and exposes no `grantLimits`. This passes on the
   unchanged route by construction (no row is added); proven non-vacuous by mutation (spreading
   the product into the payload must fail it). Declared.
6. [x] ADR 038 (`docs/decisions/038-lifetime-grant-limit-overrides.md`): the override model, the
   purchase marker, the overlap rule, uniqueness, "keep the row active", rejected options (new
   plan row; `source`-keyed; per-entitlement column). Tombstone comments at the resolver and the
   loader. Gates: `npm run precommit`, `format:check`, `type-check:build`, `build`. Tick
   `docs/stories.md`, fill the Execution log, one story commit.

## Run interdicts

- No applied migration edited; exactly one new migration; `git diff main -- supabase/` shows
  only that file. No DB function, RLS, grant or `plan_entitlements` change.
- No new plan id: `PaidPlanId`, `SubscriptionPlanId`, `OneTimeProductId`, `PRICE_ID_ENV_VARS`,
  `CATALOGUE_LOADER_KNOWN_IDS`, the webhook, checkout route, `LifetimeOfferCard`,
  `UpgradeDialog`, `Pricing.tsx`, `DashboardNavigation`, entitlement route and
  `/api/pricing` route have empty diffs.
- The $299 price, `grants_plan_id`, the 50-spot cap and Stripe price ids are untouched.
  `npm run check:stripe` is not run against live; no network call to Stripe.
- No other pricing copy changes (Agency/Pro/Starter/Credits/Lifetime Pro rows untouched; the
  SubscriptionCard follow-up in research is not fixed here).
- AGENTS.md and `docs/architecture.md` untouched. No push, PR, merge or production action;
  never `--no-verify`.

## The point everything turns on

Whether "held by purchase only" is decided correctly, because it is the only thing between a
lifetime owner and 1,000 credits, and between an Agency subscriber and 250.

- **Marker.** A live grant with `stripe_payment_intent_id IS NOT NULL` — the same predicate the
  DB uses for "owns the founding lifetime" (`20260924065000_…sql:144-151`). Trials and comps
  carry none.
- **Overlap.** A live subscription on the same plan wins over the override; compare with the
  offer card's promise (`LifetimeOfferCard.tsx:178-186`) and the cancel-at-period-end webhook.
- **Precedence.** ADR 029 is unchanged: the purchased Agency grant still beats a newer Pro
  grant; only the *limits* differ. A reviewer should check the Agency short-circuit still fires
  for a comp grant without the extra subscription read.

## Files touched

- `supabase/migrations/20260926120000_lifetime_agency_monthly_credits.sql` (new)
- `src/lib/stripe/plan-types.ts`, `src/lib/stripe/plans.ts`
- `src/lib/billing/effective-plan.ts`
- `src/lib/compare/comparison-pricing.ts`, `src/components/compare/ComparisonPage.tsx`
- Tests: `src/__tests__/lib/stripe/plan-seed.test.ts`, `src/__tests__/lib/stripe/plans.test.ts`,
  `src/__tests__/lib/billing/lifetime-agency-allowance.test.ts` (new),
  `src/lib/compare/__tests__/comparison-pricing.test.ts`,
  `src/__tests__/integration/comparison-pages.test.tsx`, `src/__tests__/api/pricing-agency.test.ts`,
  plus any `@/lib/stripe/plans` mock that reaches the new export
- `docs/decisions/038-lifetime-grant-limit-overrides.md` (new),
  `docs/research/s45-lifetime-ai-credits.md`, `docs/plans/s45-lifetime-ai-credits.md`,
  `docs/stories.md`

## Test strategy

Behaviour at the boundaries that matter: the migration text (what production will hold), the
loader over PostgREST-shaped rows, the entitlement and the credit balance an owner actually gets
(real resolver, real catalogue parser, real credit arithmetic; only the database is a double),
and the rendered /compare text. Assertions are on limits, credits and copy, never on which
internal function ran.

## Definition of Done

- All tasks ticked; red observed before each green (Task 5 declared as a guard, proven by
  mutation).
- `lint`, `type-check`, `format:check`, full `jest`, `type-check:build`, `build` green.
- One commit `feat: lifetime Founding Agency includes 250 AI credits a month`.
- Operator, after merge: deploy, then apply `20260926120000_lifetime_agency_monthly_credits.sql`,
  then `npm run check:stripe:live` → `npm run sync:stripe:live` for the product description.

## Execution log

2026-09-26, worktree `.omx/worktrees/s45-lifetime-ai-credits`, base `origin/main` `2376209`.
Every command ran with the CI placeholder environment. Nothing touched production or Stripe.
Baseline full Jest: 270 suites passed / 2 skipped, 3,494 tests passed / 39 skipped.

- **Task 1**: red, 4 failed (ENOENT, migration absent). The "applied seed left as it was"
  assertion passed before the change by construction, since it guards the existing file. Green:
  22/22. Applied to the local dev database (`supabase_db_recopyfast`, not production) twice
  inside one `BEGIN … ROLLBACK`: `UPDATE 1` both times, no constraint error. The row read back
  as `limits {"monthly_credits": 250}` with the new description and bullets, while price 299.00,
  `grants_plan_id agency`, `is_active`, `sort_order 45` and the null live price column were
  unchanged. `agency` was untouched (1000). After the rollback the local row was back to `{}`.
- **Task 2**: red, 8 failed. Green: `plans.test.ts` 49/49, `src/__tests__/lib/stripe/` 112/112.
- **Task 3**: red, 4 failed, each receiving **1000** where 250 was due: owner limits, packs on
  top, overlap-then-canceled, newer Pro trial. The 5 guards passed before the change: Agency
  subscriber, comp, Lifetime Pro, pre-migration row, migration read. Green: 9/9. The full suite
  then passed without touching any `@/lib/stripe/plans` mock, because no existing suite drives a
  payment-intent grant through a factory mock. The plan's "update any mock" step therefore had
  nothing to update.
- **Task 4**: red, 5 failed: the 2 new page tests, the new override test, and the 2 existing
  `toEqual` expectations that now carry the field. Green: 5/5 + 20/20 + discovery 3/3.
- **Task 5**: the guard passed on the unchanged route, as the plan declared. Mutation: spreading
  the product into the payload made it fail (1 failed). The route was restored byte-identical,
  sha256 `12043338…0be660`, and `git diff` on it is empty. Incident: the first restore `cp` hit
  an interactive-overwrite alias and hung. It was killed and redone with `/bin/cp -f`, then
  verified by the hash above.
- **Mutation checks** (each applied alone, restored, hash asserted by script):
  - M2, a purchase-only Agency grant answering before the subscription read → 1 failed (overlap).
  - M3, payment intent ignored → 1 failed (comp).
  - M5, `in` instead of `Object.hasOwn` → 1 failed (`__proto__`).
  - M6, uniqueness check removed → 1 failed.
  - M7, /compare reading Agency's own allowance → 1 failed.
  - M8, overrides not parsed → 9 failed.

  All killed.
- **Task 6**: ADR 038 written. Tombstones are at `readEffectivePlanBasis` (subscription read),
  `resolveEntitlement`, `toGrantLimits`, `assertOneGrantingProductPerPlan`,
  `findPlanHeldByPurchase`, the /compare copy and the migration header.
  - `npm run lint`: 0 errors, 38 inherited warnings, touched files clean.
  - `npm run type-check`: clean after one fix. My test helper's parameter type was too narrow
    (`ReturnType<typeof planRow>`), and it became `Record<string, unknown>`.
  - `format:check`, `type-check:build`: clean.
  - Full Jest: 271 suites passed / 2 skipped, **3,520 tests passed** / 39 skipped (+26).
  - `npm run build`: compiled. The 5 `fetch failed` lines are the placeholder environment's
    catalogue reads (same as s37/s42/s44), and the build changed no tracked file.
- **Diff scope** (vs `origin/main`): `supabase/` = the one new migration. Empty diffs for
  `src/app/api`, `src/components/{billing,sections,dashboard}`, `src/types`, `src/middleware.ts`,
  `scripts`, `e2e`, `server`, `public`, AGENTS.md and `docs/architecture.md`. No plan id,
  `PRICE_ID_ENV_VARS` or loader known-id change.
- **Declared deviations / test changes**:
  1. Existing assertions changed for a behaviour change (AGENTS.md "Tests"). In
     `comparison-pricing.test.ts`, two `toEqual` expectations gain `monthlyCredits: 1000`. In
     `comparison-pages.test.tsx`, three `ComparisonPricing` literals gain `monthlyCredits: 250`,
     because the type now requires it. The `.*` regexes on the /compare copy are unchanged and
     still pass.
  2. Task 5 and Task 1's seed guard pass by construction. Task 5 was proven by mutation.
  3. `readEffectivePlanBasis` and `EffectivePlanBasis` are module-private. The plan did not say
     whether to export them, and nothing outside needs them. `readEffectivePlanId` keeps its
     signature.
  4. The ADR index table in `docs/README.md` was not updated. It already stops at 026, and
     027–037 are unlisted there too.
- **Behaviour changes**:
  - A purchase-only Agency holder resolves to `agency` with 250 monthly credits.
  - The resolver also selects `stripe_payment_intent_id`, and does one extra
    `billing_subscriptions` read for purchase-only Agency holders only.
  - The catalogue load now throws on a malformed grant override or on two active products
    granting one plan.
  - The /compare offer sentence states the allowance.
- **Delivery**: one story commit on `feature/s45-lifetime-ai-credits`. Not pushed, no PR.
  Operator, after merge:
  1. Deploy.
  2. Apply `20260926120000_lifetime_agency_monthly_credits.sql`. Either order is safe (see the
     research); deploy-then-apply switches the copy and the allowance together.
  3. Run `npm run check:stripe:live`. It reports only the `lifetime_agency` description drift.
  4. Run `npm run sync:stripe:live` to patch the product description; no price changes.
  5. Live check: a lifetime owner's `/api/billing/dashboard` shows `creditWallet.included` 250,
     and an Agency subscriber shows 1000.

  Follow-up, not fixed here: the billing page's SubscriptionCard lists the catalogue Agency
  bullets ("1,000 AI credits / month") and "$49/month" to a lifetime owner.

### Review fix

2026-09-26, fix mode on `0d1617d` after the blocked review (`docs/reviews/s45-lifetime-ai-credits.md`,
max severity critical). Same worktree and CI placeholder environment. Nothing touched production
or Stripe. Each finding went test-first. Every mutation below was applied alone, then restored
with `/bin/cp -f` and the file's sha256 checked by script.

- **Findings 1 (critical) and 2 (major): the 250 never lowers an allowance already held.**
  Tests were added to `lifetime-agency-allowance.test.ts` with the real `plans.ts`,
  `effective-plan.ts` and `credits/system.ts`: a table asserting `planId agency`, every other
  Agency limit, and the allowance (entitlement and `getUserCreditBalance().included`).
  - Red: 5 of 18 failed, each receiving **250**:
    - Lifetime Pro + lifetime (500 due);
    - Pro subscriber mid-period + lifetime (500 due);
    - past-due Pro subscriber + lifetime (500 due);
    - unpaid support comp of Pro + lifetime (500 due);
    - another purchased grant counted at what it confers (300 due; hypothetical `lifetime_pro`
      override `{"monthly_credits": 300}`).
  - Guards that passed before the change: the lifetime alone 250, the Pro subscription once
    canceled 250, an Agency subscriber who bought it 1,000, and a buyer inside a Pro trial 250.
  - Green: `readEffectivePlanBasis` also selects `source` and, for a purchase-only basis, lists
    every other plan held through a live non-trial grant or the live subscription (each "as
    held": purchased view or full row). `resolveEntitlement` then lifts `monthlyCredits` to the
    highest of those (`withAllowanceFloor`, only ever up; the plan id and other limits are
    unchanged). Result: 18/18.
  - Mutations:
    - F1, floor removed → 5 failed.
    - F2, trials counted → 2 failed.
    - F3, subscription ignored → 2 failed.
    - F4, other grants at their full row → 1 failed.
    - F5, floor applied even when lower → **survived**. The guard "a Starter subscriber who buys
      it gets 250" was added; it passes on the fix and kills F5 (1 failed). Final: 19/19.
- **Finding 3 (major): the billing plan card.**
  - Checked first: today the card shows a lifetime Founding Agency owner **"$49/month"** and
    "1,000 AI credits / month". It shows a Lifetime Pro owner "$19/month".
  - New `src/components/billing/__tests__/BillingDashboard.plan-card.test.tsx` renders the
    dashboard (and so the card) from a `/api/billing/dashboard` payload.
  - Red: 5 of 6 failed:
    - the owner's card states "250 AI credits / month" and no "1,000";
    - no "$49/month" and "Lifetime access";
    - "500 AI credits / month" when the wallet says 500;
    - lifetime price kept while a lower Pro subscription runs out;
    - no allowance restated when the wallet is absent.
  - The Agency subscriber guard ("1,000 AI credits / month", "$49/month") passed before and
    after.
  - Green: `SubscriptionCard` takes `isLifetime` and `monthlyCredits`.
    - The price line reads "Lifetime access" for a plan held by a permanent grant that no
      subscription bills.
    - A bullet stating the catalogue allowance ("1,000 AI credits") is restated with the
      resolved one, or dropped if that is unknown.
    - `BillingDashboard` derives both. `isLifetime` comes from the page's `lifetimeGrant` and
      the live subscription's `plan_id`. `monthlyCredits` is `creditWallet.included`, which the
      server resolves through `resolveEntitlement`.
  - Mutations:
    - C1, lifetime price ignored → 2 failed.
    - C2, catalogue bullets verbatim → 3 failed.
    - C3, unknown allowance kept → 1 failed.
    - C4, wallet ignored → 3 failed.
    - C5, "no subscription" instead of "no subscription on this plan" → 1 failed.
    - C6, any granted plan counts as this one → **survived**. The guard "a Pro trial with a
      Starter comp is not called lifetime" was added and kills it (1 failed). Final: 7/7.
- **Finding 4 (minor):** ADR 038 now names 20260924065000 (`limits = EXCLUDED.limits`, line 61).
  Re-running it would write `lifetime_agency.limits` back to `{}` and restore 1,000.
- **Docs:**
  - ADR 038 gains the floor rule and the re-run warning. Its Consequences now describe the plan
    card instead of deferring it.
  - `docs/stories.md` s45 states the floor and the card.
- **Gates:**
  - `npm run precommit`: lint 0 errors (38 inherited warnings, none in touched files),
    type-check clean. Full Jest: 272 suites passed / 2 skipped, **3,537 tests passed** / 39
    skipped (+17).
  - `format:check` and `type-check:build`: clean.
  - `npm run build`: compiled. The `fetch failed` lines are the placeholder environment's
    catalogue reads, as before, and the build changed no tracked file.
- **Declared deviations and interpretations:**
  1. **"Live paid entitlement".** Read as every live **non-trial** grant, bought *or comped*,
     plus the live subscription. A support comp of Pro therefore keeps its 500 after a
     Founding Agency purchase. This is consistent with ADR 038's "a support comp confers the
     full plan". Trials stay excluded, as the fix instruction and the existing ADR 029 test
     require. Both behaviours are pinned by tests.
  2. **Other purchased grants count at what their purchase confers**
     (`findPurchasedPlanById`), not at their plan's full row. Today this changes nothing,
     because `lifetime_pro.limits` is `{}`. It is pinned by a hypothetical-catalogue test.
  3. **Only `monthlyCredits` is floored.** It is the only key any product overrides; other
     limits are untouched.
  4. **The plan interdicts no longer hold for billing.** They said `src/components/billing` has
     an empty diff and the SubscriptionCard follow-up is not fixed here. Finding 3 and the
     fix-mode instruction override both. The execution log's "Follow-up, not fixed here" line
     above is superseded by this section. Lifetime Pro holders also stop seeing "$19/month",
     under the same rule. Starter and Pro bullets state no allowance, so their cards are
     unchanged.
  5. **Existing test file edits.** In `lifetime-agency-allowance.test.ts`, the helper
     `agencySubscription(status)` became `subscriptionRow(status, plan = "agency")`, and
     `catalogue()` takes an optional `lifetime_pro` limits argument. No existing assertion
     changed.
  6. **ADR 038 was edited in place.** It is this story's ADR and has not reached `main`. The
     fix instruction asked for the re-run note, and the floor rule changes what the ADR
     decides.
  7. **The migration was not touched.** Its header still describes the purchase-only rule,
     which remains true; the floor lives in code.
