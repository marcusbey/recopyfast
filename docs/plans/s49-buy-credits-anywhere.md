---
validated: yes
---
# Plan — Story s49-buy-credits-anywhere

Branch: `feature/s49-buy-credits-anywhere`
Research: `docs/research/s49-buy-credits-anywhere.md`. Read it first: this plan does not repeat it.

## Target story

`docs/stories.md:1858-1877`, complexity 2. The owner decided anyone may buy an AI credit pack. The
API already allows it (`checkout/route.ts:102-116`, unchanged). The screens do not.

| AC | Named test(s) | Task |
|---|---|---|
| 1. The lapsed and no-plan screens offer "Buy AI credits ($19 for 1,000)" beside the plan options, and it opens the existing purchase dialog and checkout | T1, T2, T4, T5, T6 | 1, 2 |
| 2. "You're on credits" offers a top-up through the same dialog | T3 | 1, 2 |
| 3. The copy says what credits unlock and what still needs a plan, matching `resolveEntitlement` `credits` | T7, T8, T9, T10 | 3 |
| 4. Tests updated (`BillingDashboard.trial.test.tsx:116` and the credits screen); local gates green; one commit | T1 + the gate | 4 |

**No design phase.** The story reuses components already on the billing page: `Button` (the
design system's `outline` variant for the second action, `docs/design-system.md:150`) and
`PurchaseCreditsDialog`, which plan holders already open from `CreditBalanceCard.tsx:71-73`.
No mockup is made and `docs/designs/` is not touched. Here is exactly what goes where, all inside
the existing no-plan `Card` (`BillingDashboard.tsx:162-180`):

| Screen (condition) | Heading | Body | Action row (`flex flex-wrap justify-center gap-3`) | Line under the actions (`mt-4 text-sm text-muted-foreground`) |
|---|---|---|---|---|
| **You're on credits** (`holdsCredits`) | unchanged | "You have {N} credits to spend on AI rewrite suggestions. New sites and collaborators need a plan." | `Button size="lg"` "See plans" (unchanged) · `Button size="lg" variant="outline"` "Buy AI credits ($19 for 1,000)" | none (the body already says both halves) |
| **Your trial has ended** (`hasExpiredTrial`) | unchanged | unchanged (`:174`, s01 AC 4, and s47a's area) | "Upgrade to Pro" (unchanged) · the same outline button | "A credit pack pays for AI rewrite suggestions and needs no plan." |
| **Choose a plan to continue** (otherwise) | unchanged | "ReCopyFast needs a plan before you can add sites and invite collaborators." | "See plans" (unchanged) · the same outline button | the same line as the lapsed screen |

- **The label comes from the catalogue.** "Buy AI credits ($19 for 1,000)" is built from
  `dashboardData.catalogue.creditPack` as
  `Buy AI credits ($${pricePerPack} for ${creditsPerPack.toLocaleString("en-US")})`, the same
  formatting the dialog uses (`PurchaseCreditsDialog.tsx:84-86`).
- **One label on all three screens.** It is the top-up on the credits screen too.
- **The dialog is rendered beside `UpgradeDialog`** in the no-plan branch as
  `<PurchaseCreditsDialog open={showPurchaseDialog} onOpenChange={setShowPurchaseDialog} creditPack={dashboardData.catalogue.creditPack} />`.
- **The plan-holder layout does not change.** `CreditBalanceCard` keeps its own button there.

**Decisions this plan takes. The validator confirms or overrules them** (research, Open questions):
- **A/B testing and translation are left out of the copy.** The AC lists "sites, collaborators,
  A/B testing". Per s50's evidence (B2, B3), neither A/B testing nor translation reaches a customer.
  The copy names only what does: AI rewrite suggestions, new sites, and collaborators. If
  overruled, T7 and T10 flip to assert the AC's literal words.
- **The copy says nothing about editing.** Credits reopen the dashboard and editing (research
  Fact 3). Whether that is intended is the owner's call, and gating it is a separate story, not s49.
- **The dialog's copy is unchanged**, even though it mentions translations
  (`PurchaseCreditsDialog.tsx:59-60,107`).

## Tasks (ordered)

0. **Setup (not a task, no test).**
   - **Worktree.** From the repo root, run
     `git worktree add .omx/worktrees/s49-buy-credits-anywhere -b feature/s49-buy-credits-anywhere main`.
     This branches from local `main` (`f4cef65`), which carries the s49 story. Then run
     `npm run setup` in the worktree.
   - **What to copy in.** Copy only `docs/research/s49-buy-credits-anywhere.md` and this plan.
     Leave out:
     - the root `.env`: its production `NEXT_PUBLIC_APP_URL` breaks the origin suites;
     - the root's uncommitted `AGENTS.md` edit;
     - every other untracked doc (s47, s48, s50).
   - **Environment.** Export the CI placeholder environment for every command: the `env:` block of
     the `Lint, Test & Build` job, `.github/workflows/ci.yml:35-80`.
   - **No database.** This story adds no migration, and no DB suite has to run for real.

1. [ ] **The credit-pack button on all three no-plan screens, test-first.**
   - **Red, in `src/components/billing/__tests__/BillingDashboard.trial.test.tsx`.** Rewrite
     `:116-123` "offers one action and nothing beside it" as **T1** "offers the upgrade and a credit
     pack, and nothing else" (lapsed account):
     - the panel's buttons, by text, equal exactly `["Upgrade to Pro", "Buy AI credits ($19 for 1,000)"]`;
     - `:122`'s "no See plans" assertion is kept.

     This is the only test changed in that file. It is changed because the behaviour changes (s49
     supersedes s01's single upgrade action), and the PR must say so (AGENTS.md "Tests").
   - **Red, in the new `src/components/billing/__tests__/BillingDashboard.credits.test.tsx`.** Its
     harness copies `BillingDashboard.trial.test.tsx:16-100`, as `BillingDashboard.plan-card.test.tsx`
     does. Three tests:
     - **T2** "offers a credit pack beside the plans to an account that never trialled": "See plans"
       and "Buy AI credits ($19 for 1,000)" are both present.
     - **T3** "lets a credit holder top up through the same dialog": balance 250, purchased 250.
       The button is present, and clicking it shows `role="dialog"` named "Purchase AI credits". This
       stays red until Task 2.
     - **T4** "names the pack from the catalogue, never a literal": with
       `creditPack {creditsPerPack: 500, pricePerPack: 9, maxPacksPerPurchase: 10}`, the button reads
       "Buy AI credits ($9 for 500)" and no `$19` appears.
   - **Green, in `BillingDashboard.tsx`:**
     - a `showPurchaseDialog` state beside `:46`;
     - the action row around `:177-179`, with the existing primary `Button` unchanged and the outline
       button beside it, labelled from `catalogue.creditPack`;
     - an `onClick` that opens the dialog state.

     T1, T2 and T4 go green here.

2. [ ] **The button opens the existing dialog and starts a credits checkout, test-first.**
   - **Red, T5, in `BillingDashboard.credits.test.tsx`:** "opens the purchase dialog and starts a
     credits checkout". On the lapsed screen, clicking the button with `userEvent` opens the dialog
     "Purchase AI credits". Clicking "Purchase $19" then leads to:
     ```ts
     expect(global.fetch).toHaveBeenCalledWith(
       "/api/billing/checkout",
       expect.objectContaining({
         method: "POST",
         body: JSON.stringify({ intent: "credits", quantity: 1 }),
       }),
     );
     ```
     Assert the call, not a redirect. The harness answers every fetch with the dashboard payload,
     which has no `url` (research, Traps).
   - **Guard, T6, in `src/__tests__/api/billing/checkout-concurrency.test.ts`**, beside `:1139`:
     "opens a credits checkout for an account with no plan or grant". On the default harness (no
     subscription, `mockGetGrantedPlanIds` → `[]`):
     - the response is 200;
     - `mockCreateCheckoutSession` is called with
       `(USER_ID, "buyer@example.com", { type: "credits", quantity: 1 }, undefined)`;
     - neither `mockGetUserSubscription` nor `mockGetGrantedPlanIds` is called.

     It passes on its first run. It pins the owner decision the button now depends on, against the
     "restrict credit purchases" fix QA defect 4 offered as the alternative.
   - **Green:** render `PurchaseCreditsDialog` in the no-plan branch beside `UpgradeDialog`
     (`:194-203`), wired to `showPurchaseDialog`. Import it from `./PurchaseCreditsDialog`. T3 and T5
     go green.

3. [ ] **Copy that matches what credits do, test-first.** Every test is in
   `BillingDashboard.credits.test.tsx`.
   - **Red:**
     - **T7** "tells a credit holder what credits pay for and what needs a plan". The body contains
       "AI rewrite suggestions" and "New sites and collaborators need a plan".
     - **T8** "no longer tells a never-trialled account that AI credits need a subscription":
       - `queryByText(/before your sites, editors and AI credits become available/i)` is null;
       - "needs a plan before you can add sites and invite collaborators" is present;
       - "A credit pack pays for AI rewrite suggestions and needs no plan" is present.
     - **T9** "tells a lapsed trialist what a credit pack buys, and keeps the site-still-serving line".
       The pack line is present, and "your site keeps serving its current content" is still present.
     - **T10** "names no A/B testing or translation on any no-plan panel". Across the three states,
       `queryByText(/a\/b/i)` and `queryByText(/translat/i)` are null. Run it with the dialog closed:
       the dialog's own copy is out of scope.
   - **Green, in `BillingDashboard.tsx`:**
     - `:172`: the credits body, as in the table above;
     - `:175`: the never-trialled body, as in the table above;
     - a `<p className="mt-4 text-sm text-muted-foreground">` under the action row, rendered when
       `!holdsCredits`.

     `:164-168` (headings) and `:174` (lapsed body) keep empty diffs. Leave a short tombstone
     comment at the pack line:
     - credits reopen the dashboard (middleware), but pay only for AI;
     - the three plan-only gates are `permissions.ts:138-148,313-323` and
       `ab-tests/generate/route.ts:68-83`;
     - A/B testing and translation are omitted because neither has a customer surface (s50 B2, B3).

4. [ ] **Gates, mutations, delivery.**
   - **The gate.** Run the full gate below in the worktree.
   - **Mutations.** Apply each one alone, then restore it with `/bin/cp -f` and a sha256 check. Each
     must fail at least one named test:
     - **M1.** Hardcode the label as `"Buy AI credits ($19 for 1,000)"` → T4.
     - **M2.** Render the credits button only when `hasExpiredTrial` → T2, T3.
     - **M3.** Drop the `PurchaseCreditsDialog` render → T3, T5.
     - **M4.** Restore the old `:175` body → T8.
     - **M5.** In `checkout/route.ts`, refuse `credits` when `getGrantedPlanIds` is empty and there is
       no subscription → T6.
   - **Wrap-up:**
     - tick the s49 ACs in `docs/stories.md`;
     - add an Execution log to this plan in the s45 format (red and green counts per task, mutations,
       declared deviations, diff scope);
     - make one commit, `feat: anyone can buy an AI credit pack from the billing page`, carrying the
       research and this plan.

     No push, PR or merge.

**Gate (in the worktree, CI placeholder env exported, never at the repo root):**

```bash
npx jest src/components/billing src/__tests__/api/billing/checkout-concurrency.test.ts  # T1-T10 green
npm run precommit        # lint + type-check + full jest
npm run format:check
npm run type-check:build
npm run build
```

## Run interdicts

- **Paths with empty diffs:**
  - `src/app/**` (the checkout route is unchanged, as the story says);
  - `src/lib/**`, `src/middleware.ts`, `src/types/**`;
  - `supabase/**`, `public/**`, `e2e/**`.
- **In `src/components/**`, only `billing/BillingDashboard.tsx` changes.** These keep empty diffs:
  `PurchaseCreditsDialog.tsx`, `CreditBalanceCard.tsx`, `UpgradeDialog.tsx`, `useCheckout.ts`,
  `CheckoutStatusBanner.tsx`, `LifetimeOfferCard.tsx`, `TrialStatusCard.tsx`. No new component or
  primitive file.
- **Inside `BillingDashboard.tsx`, these stay byte-identical:**
  - the heading ternary `:164-168`;
  - the lapsed body string at `:174`;
  - everything from `:208` onward (the plan-holder layout).
- **No price or pack size in source.** `grep -nE '\$19|1,000|1000' src/components/billing/BillingDashboard.tsx`
  prints nothing.
- **Test files:**
  - `BillingDashboard.trial.test.tsx`: only the `:116-123` test changes;
  - `checkout-concurrency.test.ts`: one added test, no existing line changed.
- **Docs:**
  - no `docs/designs/**` change (no design phase; the s01 design doc is not edited);
  - `AGENTS.md` and `docs/architecture.md` untouched;
  - the root's uncommitted `AGENTS.md` edit is not part of this story.
- **Out of scope, however adjacent:**
  - no plan gate on editing and no middleware change (research, open question 1: a separate story);
  - no change to `CreditBalanceCard` totals (s48, defect 7) or `UsageCard` (defect 5).
- **Commands.** Gates never run at the repo root, and `.env` is never copied into the worktree. No
  `check:stripe`, no Stripe network call.
- **Process.** No `test.skip`/`.only`, no `--no-verify`. No push, PR or merge.

## The point everything turns on

**The copy has to tell the truth about what $19 buys, and the code says more than the story does.**
The button and the dialog are mechanical: the dialog exists, the payload carries the pack, and the
API takes the intent. What can be wrong is the copy. It could be wrong in three ways:

1. **Editing.**
   - A credits balance lets the account through `middleware.ts:39-49` and into editing
     (`edit-sessions/create/route.ts:11-48`, no plan check).
   - This plan's copy is silent on editing and leaves the lapsed body's "editing … need Pro" alone.
     So a lapsed buyer may find editing back after paying $19.
   - The reviewer compares the copy with `DashboardNavigation.tsx:112-128` and the edit-session route.
   - If the owner wants editing to need a plan, the follow-up story ships before s49 goes live. If
     the owner accepts it, the lapsed body changes in s47a's pass.
2. **The AC's list against what customers can reach.**
   - Dropping A/B testing and translation departs from the AC's wording.
   - Compare with `docs/research/s50-homepage-truth.md` B2, B3, C9, and with
     `ab-tests/generate/route.ts:68-83`: the gate exists, but no page does.
3. **Which screen state shows.**
   - "You're on credits" keys off the wallet balance (`BillingDashboard.tsx:130-131`), and the
     entitlement keys off the purchased balance. Those two agree today.
   - After s48, entitlement reads paid credits only, so they can disagree for legacy `refund_`
     rows. Compare with s48's `readPaidCreditBalance`.
   - It is accepted at 0 users, and nothing in s49 changes it.

## Files touched

- `src/components/billing/BillingDashboard.tsx`
- `src/components/billing/__tests__/BillingDashboard.trial.test.tsx` (the `:116-123` test only)
- `src/components/billing/__tests__/BillingDashboard.credits.test.tsx` (new)
- `src/__tests__/api/billing/checkout-concurrency.test.ts` (one guard test)
- Docs: `docs/stories.md` (s49 ACs ticked), `docs/research/s49-buy-credits-anywhere.md`, this plan.

## Test strategy

- **Component tests** (Jest, Testing Library, jsdom) on the real `BillingDashboard` with
  `global.fetch` mocked. This is the harness the trial suite already uses.
  - Buttons are found by role and accessible name.
  - The dialog is found by `role="dialog"` and its title.
  - Checkout is proven by the POST body, not by a redirect. `useCheckout.test.tsx` already covers
    the redirect.
- **One route guard** in the existing checkout harness pins "a credits checkout needs no plan".
- **No Playwright.** No signed-in billing spec exists, and one would need seeded users and Stripe
  test mode. The component tests reach the same branch.
- **Proof the tests have teeth:** mutations M1–M5.

## Definition of Done

- T1–T10 green. The four ACs are ticked in `docs/stories.md`.
- `lint`, `type-check`, `format:check`, `type-check:build`, `build` and the full `jest` all green in
  `.omx/worktrees/s49-buy-credits-anywhere` with the CI placeholder env.
- M1–M5 each fail a named test and are restored.
- One commit on `feature/s49-buy-credits-anywhere`, carrying the research and the plan.
- The eventual PR says that `BillingDashboard.trial.test.tsx:116` changed because the behaviour
  changed (it supersedes s01's single upgrade action).
- Review passed, with no open critical.
- **Ship order.** s48 goes live first, because it makes the dialog's "refunded if a feature fails"
  line true. Then s49 merges. Then s47a task 9 rebases onto s49's action row: its lapsed-offer
  heading and body sit above the row, and its tests must not assert "one action".
- Deployed after the owner has answered open question 1.
