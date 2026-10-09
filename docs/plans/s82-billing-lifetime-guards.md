---
validated: yes
---
# Plan — Story s82-billing-lifetime-guards

> CTO decision under the owner's 2026-10-09 directive.

Research: `docs/research/s82-billing-lifetime-guards.md`. Design:
`docs/designs/s82-billing-lifetime-guards.md`. Verified on `origin/main` `72f4cff`. No migration,
no embed change (0 bytes), nothing under `server/`, no new dependency, no Stripe call in any test
(Stripe is mocked).

## CTO decisions

1. **A lifetime grant refuses any subscription on its plan or a lower one — reactivated,
   bought through Checkout, or switched to — Founding Agency + Agency subscription included.**
   CTO decision: the Agency subscription does lift a Founding Agency owner to 1,000 credits while
   it runs (ADR 038), but the product never sells that pairing: the webhook sets it to cancel when
   the lifetime lands (`stopBillingForLifetimeOwner`) and the card never offers Reactivate under
   lifetime (s71). Restarting or starting it would be a recurring $49 for a plan already owned —
   the invisible-billing failure the webhook exists to prevent, and the webhook only acts when a
   lifetime is *bought*, never when a subscription starts beside one. Reactivation was not the only
   way in (this plan called it "the one back door" until the review): Checkout's subscription
   intent and the plan change (`PUT /api/billing/subscription`) never read grants either (review
   finding 1, fix pass below). An owner who wants more AI credits buys a credit pack. A
   subscription above every grant (Lifetime Pro + Agency) stays on sale and reactivatable, exactly
   as the webhook keeps it.
2. **"Covers" is a rank rule over `PAID_PLAN_IDS`, read through `readGrantedPlanIds`.** CTO
   decision: the same grant read the billing page and checkout use (non-trial, non-revoked, and —
   since the fix pass — not expired), and the same order the webhook's one exception
   (`route.ts:971`) encodes; a pure helper in `plan-types.ts` beside the order it relies on.
3. **Deliberate refusals are a typed error; everything else is generic.** CTO decision: returning
   only generic messages would lose "You are already on this plan" and "No active subscription
   found", which the dialog and card show today. `BillingRefusal` (message + 404/409) marks the
   sentences written for the customer; any other error is logged with `console.error` and answered
   with the route's existing fallback string. Refusals move from 500 to 404/409 (clients read only
   `ok` and `error`).
4. **The allowance bullet is the one carrying `limits.monthlyCredits` beside "credit".** CTO
   decision: a structural marker in `plans.features` (objects instead of strings) would need a
   catalogue migration, a loader change and every pricing surface — out of proportion to one
   number. Anchoring on the plan's own limit survives any rewording that keeps the number, which
   the current exact-phrase match does not (Pro's live bullet already fails it).
5. **Ops visibility for a failed AI refund goes through `logger.error`** (stdout + Sentry in
   production), with site id, usage id, owner id and amounts — no tokens, no emails. CTO decision:
   `console.error` never reaches Sentry for a handled 502 (research fact 8). Scope: `ai/suggest`
   (the route that claimed "not charged"); translate and A/B generate refund silently too and are a
   follow-up.
6. **`payment-methods` gets one per-IP limiter before authorisation, `API_GENERAL`, fail open.**
   CTO decision: AGENTS.md puts limiters before auth; checkout's IP bucket is the billing
   precedent and fails open. The existence oracle is closed by the uniform 404 itself, so the
   limiter is a flood guard, and a Redis blip must not stop a customer replacing a failing card.
7. **The post-subscription allowance is resolved only for an account with a live subscription and
   a permanent grant, and sent only when lower than the allowance in force.** CTO decision: the
   running-out row exists only in that state. Corrected in the fix pass (review finding 6): a plain
   subscriber does pay one extra read — the grant read that finds no grant; what is spared is the
   resolution's own reads. An account without a live subscription pays nothing, and that grant read
   and `isTrialling`'s are mutually exclusive, so a request makes at most one. Every other payload
   keeps its keys.
8. **Commits: the protocol's docs commit, then one story commit.** (The orchestrator's binding
   protocol asks for the docs first.)

## Task 1 — deliberate refusals vs generic errors on the subscription routes

Failing tests first:
- `src/__tests__/api/billing/subscription.test.ts`: PUT and DELETE answer a `BillingRefusal`'s own
  status and message; any other error (a Stripe-shaped "No such customer: 'cus_123'") answers 500
  with "Failed to update subscription" / "Failed to cancel subscription", the detail logged, not
  returned.
- New `src/__tests__/api/billing/subscription-reactivate.test.ts`: 401 unauthenticated; a refusal
  answers its status and message; any other error answers 500 "Failed to reactivate subscription"
  without Stripe's text; success unchanged.
- `src/__tests__/lib/stripe/subscription-rls.test.ts`: the existing refusals ("You are already on
  this plan", "No active subscription found", "Subscription is not scheduled for cancellation")
  are `BillingRefusal`s with 409/404.

Change: new `src/lib/billing/billing-refusal.ts` (`BillingRefusal`, `billingErrorResponse`);
`subscription.ts` throws `BillingRefusal` for the four deliberate refusals; the three handlers
answer through `billingErrorResponse`.

Test changed (declared): `subscription.test.ts` "should return 500 with the underlying reason when
the change fails" asserted the leak — a plain error's text in the response. It becomes the two
cases above.

- [x] Task 1

## Task 2 — reactivation refused when a lifetime grant covers the subscription

Failing tests first:
- `isPlanCoveredByGrants` unit cases: same plan, higher grant, lower grant, retired/unknown ids.
- New `src/__tests__/lib/stripe/reactivate-lifetime.test.ts`, the real `reactivateSubscription`
  and the real `readGrantedPlanIds` over a fake client that applies the query's filters: Lifetime
  Pro + Pro subscription → `BillingRefusal` 409, Stripe never called, row untouched; Founding
  Agency + Agency subscription → 409 (decision 1); Agency grant + Pro subscription → 409; Lifetime
  Pro + Agency subscription → reactivated; trial-only Pro + Pro subscription → reactivated; revoked
  grant → reactivated; no grant → reactivated; grant read error → throws before Stripe.
- Route test: the 409 reaches the client with the message.

Change: `isPlanCoveredByGrants` in `src/lib/stripe/plan-types.ts`; `reactivateSubscription` reads
`readGrantedPlanIds` through its RLS client after the `cancel_at` check and before Stripe.

Test fixture changed (declared): the `subscription-rls.test.ts` harness answers `plan_entitlements`
(no grants) so its reactivate cases reach Stripe as before. No assertion changes.

- [x] Task 2

## Task 3 — payment methods: one 404, generic errors, a limiter

Failing tests first, new `src/__tests__/api/billing/payment-methods.test.ts`:
- POST and DELETE with an unknown id (Stripe `resource_missing`) answer 404 "Payment method not
  found" — the same as a foreign id — and never echo Stripe.
- Any other failure answers 500 with the route's fallback; the detail is logged.
- GET, POST and DELETE are limited per IP before `getUser()`; a 429 never reaches auth; the
  limiter is `API_GENERAL`, `onStoreFailure: "allow"`.
- Regression: own card set as default and removed as before; default card removal refused as
  before.

Change: `payment-methods/route.ts`.

- [x] Task 3

## Task 4 — "You were not charged" only when it is true

Failing tests first, `src/__tests__/api/ai/suggest/route.test.ts`:
- provider failure + refund `{ success: false }` → 502 with the truthful message (no "not
  charged"), and `logger.error` called with ids only;
- provider failure + refund that throws → same;
- provider failure + partial refund → same;
- thrown model error after the charge with a failed refund → 500 unchanged, failure reported;
- regression: refund succeeded → "You were not charged." unchanged.

Change: `refundOwner` returns whether the whole charge came back and reports a failure through
`@/lib/monitoring/logger`.

- [x] Task 4

## Task 5 — translation is charged to the site owner

Failing tests first, `src/__tests__/api/ai/translate/route.test.ts`:
- a non-owner `edit` member: `consumeFeatureUsage` charges the owner id through the service
  client; refunds use that receipt;
- the owner calling: charged to the owner (themselves) through the service client;
- a refusal shows the owner the gate's sentence and a non-owner the "ask the site owner" one.

Change: `consumeFeatureUsage(ownerCanEdit.ownerId, "translation", { …, editor: user.id }, writer)`.

- [x] Task 5

## Task 6 — the allowance bullet, found structurally

Failing tests first:
- helper unit tests (design table): Agency wording, Pro's real wording, a reworded bullet, an
  unrelated number, null drops, equal leaves the list untouched;
- `SubscriptionCard`: a founding-offer holder on Pro's real bullets (100) reads "AI rewrite
  suggestions, 100 credits a month", never 500 (red on main).

Change: `featuresWithMonthlyCredits` in `src/lib/stripe/plan-types.ts`; `SubscriptionCard` uses it
(its local exact-phrase matcher goes).

- [x] Task 6

## Task 7 — the running-out row says what the allowance becomes

Failing tests first:
- `effective-plan` (`resolveMonthlyCreditsWithoutSubscription`): bought Agency + Agency
  subscription → 250; Pro subscription + bought Agency → 250; comped Agency + Agency subscription
  → 1,000; Lifetime Pro + Pro subscription → 500; Lifetime Pro + bought Agency + Agency
  subscription → 500; no grant → null (the subscription was everything).
- Dashboard route: `includedAfterSubscription` present only with a live subscription, a permanent
  grant and a lower number; absent otherwise (payload keys unchanged).
- `SubscriptionCard`: the row and the cancel confirmation append "Without it, your plan includes
  250 AI credits a month." when given it; every s71 sentence unchanged without it.
- `BillingDashboard`: the payload's number reaches the card.

Change: `readEffectivePlanBasis` takes an `ignoreSubscription` option (default unchanged);
`resolveMonthlyCreditsWithoutSubscription` exported; dashboard route; `BillingDashboardData`;
`BillingDashboard`; `SubscriptionCard`.

- [x] Task 7

## Task 8 — the plan dialog shows a plan held for life

Failing tests first, `src/components/billing/__tests__/UpgradeDialog.agency.test.tsx`:
- `heldForLife: { planId: "agency", monthlyCredits: 250 }` → the Agency tile reads "Lifetime" and
  "Lifetime access", no "$49", no "Current", no annual line in yearly view, "250 AI credits /
  month", and submit is disabled with it selected;
- regression: without `heldForLife`, "Current" and "$49" as before;
- `BillingDashboard`: a lifetime Founding Agency owner's dialog shows the Agency tile as held.

Change: `UpgradeDialog` optional `heldForLife` prop; `BillingDashboard` passes it when
`isPlanHeldForLife`.

- [x] Task 8

## Gates

Full jest, `type-check`, `type-check:build`, `lint`, `format:check`, `build:embed -- --check`,
Playwright `--list`. Mutations: neutralise each guard (reactivate check, rank rule, refusal
typing, payment-method 404 mapping, limiter, refund-success check, owner payer, structural
matcher, post-subscription sentence, held-for-life tile), see its test red, restore.

## Fix pass — review findings (2026-10-09)

The review of `c02df19` found one major and six minors. Each fix is pinned by a test seen red for
the right reason before the change, or — for the two pins of behaviour already in place (findings
4 and 5) — by the mutation the review saw survive, now red.

### CTO decisions (fix pass)

9. **Checkout's subscription intent and the plan change refuse a plan a live grant covers, 409,
   before any Stripe call, and fail closed on a grant read error.** Same reader
   (`getGrantedPlanIds` → `readGrantedPlanIds`) and rank rule (`isPlanCoveredByGrants`) as
   reactivation. Checkout decides before `getRecoverableSubscriptionCheckout`, its first Stripe
   call; the plan change decides in `updateSubscription` — after the subscription read, before the
   price lookup and `stripe.subscriptions.retrieve` — through the caller's RLS client, where
   reactivation already decides. Messages: Checkout "Your lifetime plan already includes this one.
   There is nothing further to buy." (the lifetime intent's wording); plan change "Your lifetime
   plan already includes this one. Cancel your subscription instead of switching to it." (the
   plan stays held for life; cancelling is what stops the bill).
10. **A grant is held while it is not revoked and its `expires_at` is null or ahead — one rule for
    every reader.** `readGrantedPlanIds` sends the entitlement resolver's own
    `.or(spendableFilter())` predicate. Every caller (billing page, dashboard route, entitlement
    badge, checkout, reactivation, plan change) reads through it, so none can disagree with the
    plan in force.
11. **The dialog refuses every plan the account's grants include and says why.** It receives the
    page's `lifetimeGrant.planIds` as `grantedPlanIds`; an included tile (not the one held for
    life) reads badge "Included" and price slot "Included for life", and its submit is disabled,
    labelled "Included in your lifetime <highest granted plan>". The held-for-life tile is
    unchanged.
12. **Only "no row" is a refusal on the subscription reads.** PGRST116 or no data → the 404
    `BillingRefusal`; any other read error → a plain `Error` the route logs and answers 500.
13. **A rate-limited card action reads like checkout's.** The card shows the limiter's `message`
    then checkout's "Try again at HH:MM." (from `X-RateLimit-Reset`). The retry helpers move out of
    `useCheckout` into `src/components/billing/rate-limit-retry.ts` with `useCheckout`'s output
    unchanged; the route's message drops its own "Please try again shortly." so the sentence and
    the time do not repeat each other.

### Task 9 — Checkout never sells a subscription a grant covers (finding 1)

New `src/__tests__/api/billing/checkout-lifetime-covered.test.ts`: the real
`getGrantedPlanIds`/`readGrantedPlanIds` over a filtering fake. Refused (409, no recovery lookup,
no session): Lifetime Pro → Pro and Starter; Founding Agency → Agency and Pro; comped grant;
unexpired dated grant. Read failure → 500, nothing sold. Sold (200): Lifetime Pro → Agency; trial
only; revoked; expired dated grant; another account's grant; no grant.

- [x] Task 9

### Task 10 — the plan change never switches into a covered plan (finding 1)

`reactivate-lifetime.test.ts`, the real `updateSubscription`: refused before Stripe (Lifetime Pro +
Agency subscription → Pro and Starter; Founding Agency + Agency subscription → Pro; unexpired dated
grant); read failure → plain `Error` before Stripe; switched (Lifetime Pro + Pro subscription →
Agency; trial only; expired dated grant; no grant).

- [x] Task 10

### Task 11 — the dialog refuses included plans and says why (findings 1 and 5)

`UpgradeDialog.agency.test.tsx`: included tile and disabled submit for a Lifetime Pro owner paying
for Agency (Pro, Starter) and a Founding Agency owner (Pro); Agency still sold to a Lifetime Pro
owner; the held-for-life submit stays disabled when the held plan is not `currentPlan` (finding 5).
`BillingDashboard.plan-card.test.tsx`: the page passes the grants (Lifetime Pro + Agency
subscription → Pro refused).

- [x] Task 11

### Task 12 — expired grants are not held (finding 2)

`entitlements.test.ts`: an expired dated non-trial grant is not held, and agrees with the plan in
force; an unexpired one is held. The checkout, reactivation and plan-change cases cover both sides.

- [x] Task 12

### Task 13 — a failed subscription read is an error, not "no subscription" (finding 3)

`subscription-rls.test.ts`: a non-PGRST116 read error makes change, cancel and reactivate throw a
plain `Error` before Stripe; the existing PGRST116 case stays a 404 refusal.

- [x] Task 13

### Task 14 — pins and comments (findings 4 and 6)

`features-with-monthly-credits.test.ts`: a bullet carrying the allowance's number but not about
credits is neither rewritten nor dropped (mutation M14). The dashboard route comment and decision
7 are corrected; the `isPlanCoveredByGrants` and reactivation comments name every path and the
expiry rule.

- [x] Task 14

### Task 15 — the card shows the limiter's sentence (finding 7)

New `PaymentMethodsCard.rate-limit.test.tsx`: set-default and remove 429s read "Too many payment
method requests. Try again at HH:MM."; a 404 keeps its own error. `payment-methods.test.ts` pins
the limiter's message.

- [x] Task 15

### Fix pass — existing tests changed (declared)

- `subscription-rls.test.ts`: the `plan_entitlements` stub answers `.or()` (the reader now sends
  it) and its comment names `updateSubscription` too; a `readFails` switch is added. No existing
  assertion changed.
- `reactivate-lifetime.test.ts`: the grant fake applies `.or()` and rows carry `expires_at`; the
  Stripe mock gains `retrieve` and the plans mock resolves a price, for the plan-change cases; the
  header and the Founding Agency comment no longer call reactivation "the one back door". No
  existing assertion changed.
- `payment-methods.test.ts`: the limiter expectation also pins `message` (stricter, not looser).

## Follow-ups (not this story)

- Translate and A/B generate refunds report failures to `console.error` only (decision 5).
- `reactivateSubscription` reads the newest row whatever its status (research, Traps).
- Checkout's catch still answers `error.message` (pre-existing): a grant or subscription read
  failure reaches the client as PostgREST's text. Same hygiene as decision 3, not done here.
- `useCheckout` shows checkout's 429 as `error` ("Rate limit exceeded") plus the time; checkout's
  own limiter sentence is never shown either (decision 13 keeps its output unchanged).

## Execution notes (deviations, declared)

- Task 1: the lib-level refusal cases live in `subscription-rls.test.ts` as planned; its harness
  gained a `rowMissing` switch (the "no subscription" state) and its Stripe defaults moved into one
  `armStripeDefaults()` both describes call — fixture only, no existing assertion changed.
- Task 2: the route-level 409 case is in `subscription-reactivate.test.ts` (written in Task 1).
- Task 6: after mutation M8b survived (identification by "credit" alone), a case was added: with
  no resolved allowance, only the allowance bullet is dropped, never another bullet about credits.
- Task 7: the resolver cases were added to the existing s45 harness
  (`lifetime-agency-allowance.test.ts`, real resolver and catalogue parser over a filtering
  double) rather than a new file.
- Task 8: the disabled submit for a plan held for life reads "You hold Agency for life" instead of
  "Continue to payment — $49" (not in the plan; recorded in the design's dialog table).
