# Research — Story s49-buy-credits-anywhere

> Read against local `main` at `f4cef65`, 2026-09-28. Every file:line below is on that commit
> unless it names a branch. Baseline: `BillingDashboard.trial.test.tsx` and
> `BillingDashboard.plan-card.test.tsx` pass, 13 of 13 (`npx jest` on the two files).
>
> **Pipeline warning.** `docs/reviews/stories.md:263` says `Stories ready: no`. That review covers
> revision `6f11b3f`, which predates s49. s49 is an operator decision logged directly into
> `docs/stories.md:1858-1877`, and the team lead ordered this research. The warning is recorded here
> and does not block the work.

## The five structuring facts

1. **All three screens are one early return, so one button row covers them.** The no-plan panel is
   `BillingDashboard.tsx:159-206`. It picks one of three states: `holdsCredits` (`:130-131`,
   wallet balance > 0) wins first, then `hasExpiredTrial` (`:157`), then the never-trialled
   default. Headings are at `:164-168`, bodies at `:171-175`, and the single button at `:177-179`.
   The plan-holder layout (`:232-307`) is the only place `CreditBalanceCard` renders (`:279`).
2. **The purchase path is complete and needs no plan. Only the button is missing.**
   - `PurchaseCreditsDialog` takes `{open, onOpenChange, creditPack}` (`PurchaseCreditsDialog.tsx:26-30`).
   - `creditPack` is already in the no-plan payload as `dashboardData.catalogue.creditPack`.
   - The `credits` intent has no plan check (`checkout/route.ts:102-116`, `:186-191`).
   - Stripe returns the buyer to `/dashboard/billing` (`lib/stripe/checkout.ts:181`). The
     no-plan branch already renders `CheckoutStatusBanner` there (`:182`).
3. **Credits are not "AI only" in behaviour. They reopen the whole dashboard, editing included.**
   - `middleware.ts:28-49` lets any `credits` entitlement through.
   - The nav shows Sites, Content and Analytics to "Credits only" (`DashboardNavigation.tsx:112-128,139`).
   - Editing an existing site checks no plan anywhere (`EditWebsiteButton.tsx:67` →
     `edit-sessions/create/route.ts:11-48`).
   - Only three things refuse `credits`:
     - new sites (`permissions.ts:138-148`);
     - collaborators and editors (`:313-323`, via `canShareSite`);
     - A/B generation (`ab-tests/generate/route.ts:68-83`).

   So the new button sits beside "editing … need Pro" (`:174`) and sells a $19 way back to
   editing. This was read from the code, not executed.
4. **The copy the story names includes two features customers cannot reach, and one current
   sentence becomes false.**
   - A/B testing: the page lives in the unrouted `src/app/dashboard/_ab-tests/`, and the nav entry
     was removed (`DashboardNavigation.tsx:47-49`).
   - Translation: the only UI is used by tests alone, and `/api/ai/translate` has no caller.
   - Both findings come from `docs/research/s50-homepage-truth.md` (B2, B3, C9).
   - The never-trialled body (`:175`, "…before your sites, editors and AI credits become
     available") is false once s49 ships.
5. **Conflicts: s48 shares no files with s49; s47a's UI task will touch the same lines.**
   - s47a's commit `f952fdd` does not touch `src/components/**`.
   - s47a's UI task 9 is not done and is waiting on a design doc. It will edit
     `BillingDashboard.tsx:157-178` and the trial test file.
   - s48 lists `src/components/**` as out of scope (`docs/plans/s48-credit-integrity.md:483`).
   - `BillingDashboard.trial.test.tsx:116-123` pins "offers one action and nothing beside it".

## Target story

`docs/stories.md:1858-1877`, complexity 2, branch `feature/s49-buy-credits-anywhere`. It
supersedes the s01 rule "trial ended offers only Upgrade to Pro" (`docs/designs/s01-trial-signup.md:53-55`,
AC `docs/stories.md:280`), for the credits action only.

- [ ] The lapsed "trial ended" screen and the no-plan screen offer "Buy AI credits ($19 for 1,000)"
  beside the plan options. It opens the existing purchase dialog and checkout.
- [ ] The "You're on credits" screen offers a top-up through the same dialog.
- [ ] The copy on those screens says what credits unlock and what still needs a plan (sites,
  collaborators, A/B testing), matching how `resolveEntitlement` treats `credits`.
- [ ] Tests updated: `BillingDashboard.trial.test.tsx:116` and the credits-screen tests assert the
  new action. Required local gates pass; one story commit. No push, PR, merge or production.

The PRD agrees with the premise: "Credits | Anyone | AI rewrite + translate, metered"
(`docs/prd.md:390`). It also says "credits cover AI only" (`:381`), and Fact 3 contradicts that in
code.

## Current state of the code

**The no-plan panel** (`src/components/billing/BillingDashboard.tsx`):

| State | Condition | Heading (`:164-168`) | Body (`:171-175`) | Action (`:177-179`) |
|---|---|---|---|---|
| Credits | `effectivePlanId === null && balance > 0` | "You're on credits" | "You have N credits to spend on AI suggestions and translations. Sites, collaborators and A/B testing need a plan." | "See plans" |
| Lapsed trial | `everTrialed && !holdsCredits` | "Your trial has ended" | "Your 14-day Pro trial has ended. Your site keeps serving its current content — editing, new sites and collaborators need Pro." | "Upgrade to Pro" |
| Never trialled | otherwise | "Choose a plan to continue" | "ReCopyFast needs an active subscription before your sites, editors and AI credits become available." | "See plans" |

- The only action on all three screens is one `Button size="lg"` that opens `UpgradeDialog`
  (`:194-203`).
- Below the card come `CheckoutStatusBanner` (`:182`) and one `LifetimeOfferCard` per lifetime
  offer (`:184-192`).
- No credits button renders anywhere on these screens, which matches QA
  (`.omx/qa-20260927/REPORT.md` step 8: `buyCreditsButtonCountBefore: 0`).

**Plan holders buy through `CreditBalanceCard`:**
- The "Buy credits" `Button size="sm"` (`CreditBalanceCard.tsx:71-73`) opens `PurchaseCreditsDialog`
  (`:158-162`).
- The card renders only in the plan layout (`BillingDashboard.tsx:279-283`).
- It shows "Low credit balance" when the balance is below 5 (`:17-18`, `:95-115`). A lapsed account
  at 0 would see that warning, so the card is the wrong thing to reuse on the no-plan screens.

**The dialog** (`PurchaseCreditsDialog.tsx`):
- Title "Purchase AI credits" (`:57`).
- A quantity input clamped to `1..maxPacksPerPurchase` (`:44-51`).
- Submit reads `Purchase $${totalPrice}` and calls
  `startCheckout({ intent: "credits", quantity })` (`:121-129`).
- `useCheckout` POSTs to `/api/billing/checkout` and redirects with `window.location.assign`
  (`useCheckout.ts:81-127`).
- There is no `onSuccess`: the banner refreshes the wallet when the buyer returns (`:18-24`).

**How the screen state relates to entitlement:**
- `holdsCredits` reads `creditWallet.balance` (`BillingDashboard.tsx:130`).
- For a no-plan account `included` is 0 (`credits/system.ts:141-142`), so the balance equals
  `readPurchasedCreditBalance` (`credits/spendable.ts:32-53`).
- That is the same read `resolveEntitlement` uses to return `credits` (`effective-plan.ts:527-529`).
- Today, "You're on credits" ⇔ `kind === "credits"`. See Traps for s48's change to that.

## Anchor points

- `BillingDashboard.tsx:46`: add a `showPurchaseDialog` state beside `showUpgradeDialog`.
- `BillingDashboard.tsx:177-179`: wrap the existing primary `Button` in an action row and add the
  credits `Button` (`variant="outline"`, `size="lg"`) beside it. The design system allows
  `outline` for a non-primary action (`docs/design-system.md:150`). `UpgradeDialog.tsx:292` uses
  the `flex flex-wrap … gap-3` idiom.
- `BillingDashboard.tsx:171-175`: copy (see Traps for which lines s47a also rewrites).
- `BillingDashboard.tsx:194-203`: render `<PurchaseCreditsDialog open onOpenChange
  creditPack={dashboardData.catalogue.creditPack} />` beside `UpgradeDialog` in the no-plan branch.
- The label comes from `creditPack.pricePerPack` and `creditPack.creditsPerPack` (`plan-types.ts:118-122`),
  formatted the way the dialog formats them (`$${pricePerPack}`, `toLocaleString("en-US")`,
  `PurchaseCreditsDialog.tsx:84-86`). It gives "Buy AI credits ($19 for 1,000)" from the live
  catalogue. Nothing is hardcoded (AGENTS.md non-negotiable 7).

## Verified APIs / functions

| Symbol | Location | Behaviour on the story's case |
|---|---|---|
| `PurchaseCreditsDialog({open, onOpenChange, creditPack})` | `components/billing/PurchaseCreditsDialog.tsx:32` | Self-contained. Owns `useCheckout`. Reusable as is |
| `useCheckout().startCheckout({intent:"credits", quantity})` | `components/billing/useCheckout.ts:18-22,71` | POST `/api/billing/checkout`. A response with no `url` shows "Stripe did not return a checkout page" (`:122-123`) |
| `POST /api/billing/checkout`, `credits` intent | `app/api/billing/checkout/route.ts:102-116` | Requires sign-in, checks quantity `1..maxPacksPerPurchase`, never reads a plan. The only plan reads are for `subscription` and `lifetime_pro` (`:186-191`) |
| `PlanCatalogue.creditPack: CreditPackConfig` | `lib/stripe/plan-types.ts:118-132` | `{creditsPerPack, maxPacksPerPurchase, pricePerPack}`, from the `plans` row (`lib/stripe/plans.ts:643-645`) |
| `resolveEntitlement` → `{kind:"credits"}` | `lib/billing/effective-plan.ts:508-532` | Returned when there is no plan and the purchased balance is > 0 |
| `hasAnyEntitlement` | `effective-plan.ts:177-179` | `kind !== "none"`, so `credits` passes the middleware (`middleware.ts:39-49`) |
| `canUseAIFeatures`, `canUseTranslation` | `lib/feature-gating/permissions.ts:384-392,432-455` | `credits` is allowed and spends purchased credits |
| `canCreateWebsite`, `canAddCollaborator` | `permissions.ts:138-148,313-323` | `credits` is refused with "Your credits cover AI features. Creating sites and inviting collaborators needs a plan." (`:71-76`) |
| A/B generate | `app/api/ab-tests/generate/route.ts:68-83` | `credits` is refused with "A/B testing requires a plan…" |
| `POST /api/edit-sessions/create` | `app/api/edit-sessions/create/route.ts:11-48` | Checks auth and rate limit, then the site permission. **No plan check** |

## Traps & constraints

- **`BillingDashboard.trial.test.tsx:116-123` pins s01's "single upgrade action".** Its name is
  "offers one action and nothing beside it". It asserts "Upgrade to Pro" is present and "See plans"
  is absent. It has to be rewritten. AGENTS.md "Tests" says a test changed for a behaviour change
  is said so in the PR. The `:122` "no See plans" half stays true and should be kept.
- **The other tests on these screens pin headings only:**
  - `:103-114`: lapsed heading and "your site keeps serving";
  - `:125-134`: never-trialled heading;
  - `:136-147`: the "You're on credits" heading.

  None of them asserts a body or a button, so the copy change breaks none of them. No credits-screen
  test exists besides `:136`. No Playwright spec reaches the billing page signed in
  (`e2e/auth.spec.ts:26`, `e2e/dashboard.spec.ts:21`: unauthenticated redirects only).
- **The test harness answers every fetch with the dashboard payload** (`:80-91`). A checkout POST
  made from a test therefore gets back a payload with no `url`, and `useCheckout` shows an error
  instead of redirecting. Assert the `fetch` call (URL, method, body) and not a redirect.
  `CheckoutStatusBanner` is mocked to `null` (`:16-18`). The Radix dialog is not in the DOM until
  it opens.
- **s47a (branch `feature/s47a-founding-20-grant`, `f952fdd`, worktree `.omx/worktrees/s47a-founding-20-grant`).**
  - What is committed covers backend, payload and migration only. `git show --stat f952fdd` lists
    no `src/components` file. Its plan task 9 is unticked and "blocked until the design doc exists"
    (`docs/plans/s47a-founding-20-grant.md:348-363` on that branch).
  - When task 9 runs it will:
    - add an `endedOfferId` branch to the heading and body ternaries (`BillingDashboard.tsx:157-178`);
    - add tests to `BillingDashboard.trial.test.tsx`;
    - keep `:107,165,168` unchanged, and assert "the plans button still opens the upgrade dialog".
  - Any s49 edit to `:171-179` sits next to those hunks. Whichever branch lands second gets a
    textual conflict, which is mechanical to resolve.
  - s47a's lapsed-offer state is a sub-case of the no-plan branch, so it picks up s49's button row
    without a change of its own. s47a's new tests must not assert "one action".
- **s48 (in progress, worktree `.omx/worktrees/s48-credit-integrity`, no commit yet).**
  - Files: `credits/system.ts`, `spendable.ts`, `permissions.ts`, `effective-plan.ts:527`, the AI
    routes and a migration. `src/components/**` is declared empty (`s48 plan:483`), so s48 and s49
    share no files.
  - Behaviour: after s48, entitlement reads `readPaidCreditBalance`, which excludes legacy
    `refund_` rows (`s48 plan:371-377`). The wallet's spendable balance still counts those rows
    (its guard test, `:368-369`).
  - Consequence: a no-plan account whose only credits are pre-s48 refund rows would see "You're on
    credits" while the middleware treats it as `none`.
  - Production has 0 users. Only QA and local data can carry such rows. s49 should not chase this.
  - s48 also makes the dialog's "Unused credits are refunded if a feature fails"
    (`PurchaseCreditsDialog.tsx:108`) true. s49 shows that dialog to more buyers, so s48 should be
    live first.
- **A $19 path back to editing (Fact 3).**
  - The QA report already said "$19 opens the dashboard" (`REPORT.md` defect 4). Defect 2 says
    "raise to high if a credits-only account can edit its existing site … I didn't test editing".
  - Reading the code, it can: middleware, nav and `edit-sessions/create` apply no plan check to
    `credits`.
  - The PRD gives Starter "inline editing" (`prd.md:387`), and says "credits cover AI only" (`:381`).
  - s49 does not create this gap (it dates from `ed639fb`), but it puts it one click from the
    lapsed screen, beside copy that says editing needs Pro.
  - Separately, even a `none` account is kept from editing only by the middleware's page redirect.
    The edit-session API itself never checks a plan. This predates s49, is outside its scope, and is
    noted for completeness.
- **Copy truth.**
  - s50's research, adopted by the owner for the homepage, marks "translation" and "A/B testing"
    as having no customer surface.
  - The current credits body (`:172`) and the story's AC list both name them.
  - The dialog says "suggestions and translations" (`PurchaseCreditsDialog.tsx:59-60,107`) and is
    reused unchanged.
- **The nav can stay stale after a purchase.** `dashboard/layout.tsx:56` fetches
  `/api/billing/entitlement` once. A buyer who returns before the webhook lands keeps the
  locked-out nav until the next navigation. This is not new: every purchase type works this way,
  and s49 does not change it.
- **Gates must run in a worktree.** The root's untracked `.env` sets a production
  `NEXT_PUBLIC_APP_URL`, which breaks the origin suites. The gates run in
  `.omx/worktrees/s49-buy-credits-anywhere` with the CI placeholder env
  (`.github/workflows/ci.yml:35-80`). That worktree does not exist yet.

## Open questions

1. **Is "$19 buys back the dashboard and editing" intended?** The owner decided "anyone may buy
   credits", but the decision does not say whether a credits-only account may edit. There are
   three ways to answer:
   - (a) accept it, and change the lapsed body so it stops saying editing needs Pro;
   - (b) gate editing on a plan for credits-only accounts, as a separate story before s49 goes live;
   - (c) ship s49 as scoped, with copy that makes no claim about editing, and decide later.

   Recommendation: (c) for s49, plus a follow-up story for (b), which the PRD supports (`:381,387`).
   The owner confirms this at plan validation.
2. **Should A/B testing and translation appear in s49's copy?** The AC lists A/B testing. s50's
   evidence says neither feature reaches a customer. Recommendation: the copy names what a customer
   can actually reach: credits pay for AI rewrite suggestions; new sites and collaborators need a
   plan. The validator accepts or rejects this departure from the AC's wording.
3. **The dialog's own copy** also mentions translations (`PurchaseCreditsDialog.tsx:59-60,107`).
   Recommendation: leave the dialog unchanged in s49 (the story says "the existing dialog") and put
   its wording in s50 or a follow-up.
4. **Label on the credits screen:** the same "Buy AI credits ($19 for 1,000)" or a "Buy more"
   variant. Recommendation: the same label. One string and one test query cover all three states.

## Real complexity

**2, the same as `docs/stories.md`.**
- The code change is one component (`BillingDashboard.tsx`, about 20 lines) plus its tests.
- It reuses one existing dialog and one existing button variant.
- No API, no migration, no new primitive.

The work that does not show in the line count is two product decisions (open questions 1 and 2) and
the ship order with s47a. Neither changes the code's size. If the owner picks 1(b), that is its own
story on the editing surface, the highest-consequence one in the product
(`docs/architecture.md:364`), and not part of s49.

## Split proposal

Not required at 2. If open question 1 resolves to (b), the follow-up is a separate story:
"credits-only accounts cannot edit". It would gate `edit-sessions/create` and the dashboard's
editing entry points on `kind === "plan"`. s49 should not absorb it.
