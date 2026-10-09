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

## Fix pass 2 — second review (2026-10-09)

The second review of `84d7b0c` found three minors. Rebased onto `origin/main` `fc5968b` first
(`docs/stories.md` append conflict with s73, both entries kept in id order).

### CTO decisions (fix pass 2)

14. **Checkout's catch answers through `billingErrorResponse`.** Every sentence Checkout writes for
    the customer is returned before the catch; what reaches it (grant, subscription or reservation
    read failures, Stripe, configuration) is logged under the same context as before and answered
    "Failed to start checkout. Please try again." This closes the follow-up recorded in the first
    pass.
15. **A grant's end reaches the dialog through the page's existing read.** `readGrantedPlans`
    (`effective-plan.ts`) is the query `readGrantedPlanIds` sent, now also selecting `expires_at`,
    one entry per plan: null when any live grant of the plan is undated, otherwise the latest end.
    `readGrantedPlanIds` is its ids, so every caller keeps one rule and one query. The billing page
    reads it instead of the bare ids and passes `lifetimeGrant.endsAt` (dated plans only); the
    dashboard passes it to the dialog as `grantEndsAt`. No new fetch.
16. **"For life" only for an undated grant.** The dialog decides per plan from the grants that
    include it: if any of them is undated, the plan is included for life and the submit names the
    highest *undated* one ("Included in your lifetime Pro"); if every one is dated, the price slot
    reads "Included until November 19, 2026" and the submit "Included in your plan until November
    19, 2026" (the latest end, in the card's long US date). The refusal itself is unchanged: the
    same plans are refused, by the same rank rule.

### Task 16 — Checkout errors stay generic (m1)

`checkout-lifetime-covered.test.ts`: a grant read failure answers 500 "Failed to start checkout.
Please try again.", never "connection reset", and the detail is logged under "Error creating
checkout session:". Red on `84d7b0c` (the body carried "Failed to read plan entitlements:
connection reset").

- [x] Task 16

### Task 17 — the included label names the highest grant (m2)

`UpgradeDialog.agency.test.tsx`: Lifetime Pro + Founding Agency, grants in database order
(`["agency", "pro"]`), Starter selected → "Included in your lifetime Agency". A pin of behaviour
already in place: green on `84d7b0c`, red under the review's surviving mutation (`.at(-1)` →
`.at(0)`).

- [x] Task 17

### Task 18 — a dated grant is never called lifetime (m3)

Failing tests first:
- `entitlements.test.ts`, `readGrantedPlans` over the filtering fake: an undated grant → no end; a
  dated one → its `expires_at`; undated beside dated → no end; two dated → the later; trial,
  revoked and expired rows excluded exactly as `getGrantedPlanIds` excludes them; the query asks
  for `expires_at` (the fake returns whole rows whatever is selected).
- `UpgradeDialog.agency.test.tsx`: a plan included only by a dated grant reads "Included until
  November 19, 2026", its submit "Included in your plan until November 19, 2026", disabled, no
  "for life"; several dated grants → the latest end; an undated Lifetime Pro beside a dated Agency
  grant → Starter and Pro "Included for life", submit "Included in your lifetime Pro".
- `BillingDashboard.plan-card.test.tsx`: Lifetime Pro paying for Agency, Pro grant dated → the
  dialog's Pro tile and submit say until when.
- `page.test.tsx`: the page hands the dashboard every granted plan and the end of the dated ones;
  no grant → `{ kind: "none" }`.

Change: `readGrantedPlans` + `GrantedPlan` in `effective-plan.ts` (`readGrantedPlanIds` delegates);
`LifetimeGrantStatus` gains optional `endsAt`; `page.tsx` reads `readGrantedPlans`;
`BillingDashboard` passes `grantEndsAt`; `UpgradeDialog` gains `grantEndsAt` and `grantInclusion`.

- [x] Task 18

### Fix pass 2 — existing tests changed (declared)

- `page.test.tsx`: the `@/lib/billing/effective-plan` mock factory gains `readGrantedPlans` (the
  page calls it now) with a `beforeEach` default of no grants, and the `BillingDashboard` stub also
  prints the `lifetimeGrant` it receives. No existing assertion changed.
- `UpgradeDialog.agency.test.tsx`: `renderFor` accepts an optional `grantEndsAt`. No existing
  assertion changed.

### Fix pass 2 — execution notes (deviations, declared)

- The orchestrator gave the submit's sentence for a dated grant ("Included in your plan until
  <date>"); the price slot's "Included until <date>" is its parallel to "Included for life"
  (decision 16, design table).
- The submit now names the highest *undated* grant, not the highest grant: with a dated Agency
  grant beside Lifetime Pro, naming Agency would call the grant that ends lifetime. Identical to
  before whenever every grant is undated (m2's pin holds).
- `isSelectedIncluded` is now derived from `grantInclusion`, which applies `isPlanCoveredByGrants`
  per granted plan — the same plans are refused as before.
- `readGrantedPlanIds`' query selects `plan_id, expires_at` instead of `plan_id` for every caller;
  its result is unchanged.
- Two pins beyond the brief (latest end across dated grants; the query asks for `expires_at`),
  added because mutations M6 and M10 would otherwise have survived.

## Devin fix pass — Devin Review on PR #81 (2026-10-09)

Three findings on `d08b967`: a Checkout opened before a lifetime grant still bills the owner
(red), an allowed plan change keeps a scheduled cancellation (yellow), and the plan in force held
only by a dated grant is called lifetime (yellow — the queued follow-up s96, folded in here).

> CTO decision under the owner's 2026-10-09 directive.

### CTO decisions (Devin fix pass)

17. **A Checkout opened before a lifetime grant never bills the owner: belt and braces.**
    - (a) When a lifetime grant lands (`grantLifetime`, a fresh grant only — not a duplicate, not a
      refunded second Founding Agency), the customer's open subscription-mode Checkout Sessions
      whose `metadata.plan_id` the new grant covers (`isPlanCoveredByGrants(plan, [grantsPlanId])`,
      so an Agency Checkout beside Lifetime Pro stays open) are expired through the race-safe
      `expireCheckoutSession` Checkout already uses; every page of open sessions is read. The
      Stripe customer is the `billing_customers` row of the user. Never throws, like
      `stopBillingForLifetimeOwner` and for its reason (a retry would never come back: the grant
      short-circuits on its duplicate); failures go to `logger.error` (Sentry). A session without
      our `plan_id` was not opened by this app and is left to (b). The expiry fires
      `checkout.session.expired`, which releases the checkout reservation as for any abandoned
      Checkout.
    - (b) A subscription that starts while an **undated**, non-trial, non-revoked grant covers its
      plan is refused: cancelled now (`prorate: false`, `invoice_now: false`,
      `cancellation_details.comment = "covered_by_lifetime"`), every payment its latest — for so new
      a subscription, its first — invoice collected refunded in full, recorded cancelled (never
      live, so it confers nothing), and reported through `logger.error` with ids only. Both event
      orderings:
      - recorded after the grant → `handleSubscriptionCreated` (reached from
        `customer.subscription.created` and from `checkout.session.completed` in subscription
        mode) refuses before writing the row. Retryable, as that handler always is: a grant-read,
        cancellation or refund failure throws → 500 → Stripe redelivers, nothing recorded live
        meanwhile, and each failure is reported to Sentry so a stuck refusal is never silent.
      - recorded before the grant's event → `stopBillingForLifetimeOwner`: a live subscription on a
        covered plan that Stripe created at or after the lifetime payment intent
        (`subscription.created >= paymentIntent.created`, the intent read once, only when needed)
        was bought with the plan already paid for and is refused the same way; one created before
        keeps the existing cancel-at-period-end (its period was paid for before the grant). A
        failed refusal falls back to that period-end cancellation so it never renews, and is
        reported. Failures there stay logged, never thrown (unchanged convention), now through
        `logger.error` so a customer billed for a plan they own reaches Sentry.
    - Idempotency: the `billing_events` ledger short-circuits a replayed event; a redelivery after a
      partial failure finds its own cancellation by the marker and only finishes the refund; a
      refund is found by metadata (`reason_code: covered_by_lifetime`, `subscription_id`) before one
      is created, and created under an idempotency key — so two events recording the same
      subscription (Checkout completion and `customer.subscription.created`) refund once. A
      subscription the webhook set to cancel for a lifetime purchase
      (`metadata.cancelled_reason = lifetime_purchase`) predates the grant and is never refused
      afterwards.
    - Dated grants and trials never trigger (b): a dated grant ends and the subscription is what
      keeps the plan after it. Checkout and the plan change still refuse a plan a live dated grant
      covers (decision 10) — the purchase guard is unchanged.
    - A payment still in flight on that invoice (an `open` invoice payment, e.g. a bank debit)
      cannot be refunded yet; the cancellation stops collection of what is not yet attempted, and
      the report says to refund it by hand once it settles.
    - No migration: the record is Stripe's (cancellation comment, refund metadata), the cancelled
      `billing_subscriptions` row, the `billing_events` row and the Sentry event.
18. **A plan change applied to a subscription scheduled to cancel keeps it.** Buying another plan
    means keeping it: `updateSubscription` sends `cancel_at_period_end: false` when Stripe's
    subscription is set to cancel at period end, and `cancel_at: ""` when a cancellation date was set
    elsewhere (the Stripe dashboard) — the card and the dialog read both as "scheduled to cancel"
    (`cancel_at` on the row), so clearing only one would make the dialog's promise untrue. The
    dialog says it before the click: "Your subscription is set to end on <date>. Switching plans
    keeps it: it will renew instead of ending." The date is the period end the card already prints.
19. **A dated grant on the plan in force says until when, never "for life" (s96, folded in).** The
    page already reads each granted plan's end (`lifetimeGrant.endsAt`, decision 15);
    `BillingDashboard` passes the plan in force's end to the card (`heldUntil`) and to the dialog
    (`heldForLife.endsAt`). The card: badge "Included" (not "Lifetime"), price slot "Included until
    <date>", running-out row "<plan> is included until <date>." (never "you no longer need it" —
    the subscription is what keeps the plan after the grant), cancel confirmation "<plan> stays
    included until <date>, and you will not be charged again." The dialog's held tile: badge
    "Included", price "Included until <date>", submit "Included in your plan until <date>" — the
    included tiles' wording. The purchase guard is unchanged: the tile stays disabled, Reactivate
    stays hidden, and the server refuses both while the dated grant is live.

### Task 19 — a subscription a lifetime grant covers is refused when it starts (finding 1b)

New `src/__tests__/api/billing/stripe-webhook-lifetime-covered.test.ts`: the real route, grant
reader and grant writer over a filtering fake; Stripe mocked. Recorded after the grant: cancelled at
once without proration, first invoice refunded in full (no amount, idempotency key), row
cancelled, reported with ids; same from a completed subscription Checkout (reservation still
completes); Founding Agency + Agency subscription refused. Idempotency: replayed event, a second
event for the same subscription, refund failure → 500 then the retry finishes only the refund,
cancellation failure → 500 and nothing recorded, grant read failure → 500. Not triggered: Agency
beside Lifetime Pro, dated grant, trial, revoked grant, another account's grant, a subscription the
lifetime purchase set to end. Recorded before the grant: refused when Stripe created it after the
lifetime payment, period-end cancellation kept when it predates it, Agency beside Lifetime Pro
untouched, a failed refusal keeps the grant and is reported.

- [x] Task 19

### Task 20 — a lifetime grant expires the open Checkouts it covers (finding 1a)

Same file: Lifetime Pro expires an open Pro subscription Checkout; a Starter one too, not an Agency
one nor a one-off payment; Founding Agency expires Pro and Agency; every page is read; a session
that cannot be expired keeps the grant and is reported; a redelivered grant does not run it again.

- [x] Task 20

### Task 21 — a plan change keeps a subscription scheduled to cancel (finding 2)

Failing tests first:
- `subscription-rls.test.ts`: Stripe set to cancel at period end → the update sends
  `cancel_at_period_end: false` and the row's `cancel_at` is cleared; a cancellation date set
  elsewhere → `cancel_at: ""`; a subscription not scheduled → neither key (unchanged).
- `BillingDashboard.plan-change.test.tsx`: a subscriber set to cancel reads "Your subscription is
  set to end on October 10, 2026. Switching plans keeps it: it will renew instead of ending."; one
  renewing reads the description unchanged.

- [x] Task 21

### Task 22 — a dated grant on the plan in force says until when (finding 3, s96)

Failing tests first:
- `SubscriptionCard.badge.test.tsx`: a plan held through a dated grant → badge "Included", price
  "Included until November 19, 2026", no "Lifetime"; running-out row and cancel confirmation say
  until when, never "for life"; no Reactivate. Undated → unchanged.
- `UpgradeDialog.agency.test.tsx`: the held tile with an end → "Included", "Included until November
  19, 2026", submit "Included in your plan until November 19, 2026", disabled; undated unchanged.
- `BillingDashboard.plan-card.test.tsx`: Pro in force through a dated Pro grant → the card and the
  dialog say until when; undated Lifetime Pro unchanged.

- [x] Task 22

### Devin fix pass — existing tests changed (declared)

- `stripe-webhook-ordering.test.ts`, `stripe-webhook-stale-writes.test.ts`: the fake client gains
  `is` / `neq` (applied as filters) and `or` (pass-through) — the grant read's methods, now sent by
  `customer.subscription.created`. No grant row is seeded there, so it answers none. No assertion
  changed.
- `stripe-webhook-write-failures.test.ts`: the fake answers `plan_entitlements` with no rows (the
  `subscription-rls.test.ts` pattern). No assertion changed.
- New cases appended to existing files (no existing case touched): `subscription-rls.test.ts`
  (one describe), `BillingDashboard.plan-change.test.tsx`, `SubscriptionCard.badge.test.tsx`,
  `UpgradeDialog.agency.test.tsx`, `BillingDashboard.plan-card.test.tsx` (one describe each).

### Devin fix pass — execution notes (deviations, declared)

- The refusal and the Checkout expiry live in a new `src/lib/stripe/lifetime-covered-billing.ts`
  (the route is already 1,800+ lines); the route keeps the decisions (when to refuse, how to
  report, retry or swallow).
- `handleSubscriptionCreated` resolves the plan before the upsert instead of inside it: the
  refusal needs it. Same call, after the customer read as before.
- `stopBillingForLifetimeOwner`'s two existing `console.error` reports now go through
  `logger.error` (Sentry), and a failed refusal falls back to the existing period-end
  cancellation. Neither was spelled out by the brief; both follow "never leave the user billed
  silently".
- In the grant-first ordering the refused subscription's row is written cancelled at once; in the
  subscription-first ordering it is left to `customer.subscription.deleted` (which the
  cancellation emits) to mark it cancelled, as `stopBillingForChargeback` does — so for those
  seconds a row Stripe has already cancelled still reads live.
- Decision 18 clears a dashboard-set `cancel_at` too, beyond the brief's `cancel_at_period_end`,
  for the reason given there.
- The dated-grant wording of the card's running-out row ("<plan> is included until <date>.") and
  cancel confirmation ("<plan> stays included until <date>, …") is mine; the brief asked for
  "Included until <date>" style without fixing those two sentences.
- `UpgradeDialog`'s local `formatGrantEnd` is renamed `formatLongDate`: it now formats the
  subscription's end as well.
- One pin beyond the brief: the one-off session in the expiry case names a plan, because mutation
  M15 (session mode ignored) survived when it did not.

## Review fix pass (verification of 6cac2ea)

The fresh review of `6cac2ea` (Devin fix pass) found two majors and seven minors: the branch did
not merge onto `main`, and eight of its 29 mutations survived — among them the guard against
refunding a subscription already ended for another reason and the refund idempotency key. Rebased
onto `origin/main` `122ad2e` (s74 + s75) first: `docs/stories.md` append conflict, s74, s75 and
s82 kept in id order.

> CTO decision under the owner's 2026-10-09 directive.

### CTO decisions (review fix pass)

20. **One rule for both orderings (m-1).** A subscription a lifetime grant covers is refused —
    cancelled now, refunded — only when Stripe created it at or after the covering lifetime was
    paid: `wasBoughtWithPlanAlreadyOwned(created, paidAt)` (`created >= paidAt`), the one
    function both orderings call. Paid-at is the grant's payment intent's `created` (what
    `stopBillingForLifetimeOwner` already read), or for a grant with no payment (a support comp)
    its `granted_at`; with several covering grants, the earliest. An older subscription whose own
    event is processed after the grant (a Stripe retry, a dashboard resend) gets the period-end
    cancellation `stopBillingForLifetimeOwner` gives it in the other ordering — the same call
    (`endAtPeriodEndForLifetime`, same metadata) — and is recorded as Stripe then holds it. A
    failure there throws (retryable) and alerts. The grants are read by `readLifetimeGrants`
    (`effective-plan.ts`), the same filtered query as `readGrantedPlans` (one private builder for
    both), undated rows only.
21. **A refused subscription's late payment is refunded when it settles (m-2).**
    `invoice.payment_succeeded` for a subscription whose row is over (`canceled`,
    `incomplete_expired`) re-reads it from Stripe; if it carries the `covered_by_lifetime`
    comment, every paid payment of that invoice goes through the same idempotent refund (same
    metadata lookup, same key), so a payment the refusal already refunded is found, never refunded
    twice. Gated on the row being over, so a live subscription's renewal costs no Stripe call.
    Success is logged at info (stdout); a failure alerts and answers 500 so Stripe redelivers. The
    refusal report's pending sentence now says such payments are refunded when they settle, and to
    refund by hand only if no refund follows.
22. **Cancelled but not refunded is its own failure (m-3).** `refuseSubscriptionCoveredByLifetime`
    throws `CoveredRefundFailed` (carrying the stopped subscription) when the refund fails after
    the subscription is stopped. `stopBillingForLifetimeOwner` then alerts "…was cancelled, but its
    payment could not be refunded — refund it by hand." and skips the period-end fallback; the
    subscription webhook's retry alert says "refund it by hand" instead of "cancel and refund it".
    A subscription Stripe already ended for another reason but still live in our table is skipped
    by `stopBillingForLifetimeOwner`: nothing bills, an update would fail with a false "could not
    be cancelled" alert, and it must not be refunded — the rule M21's guard keeps in the other
    ordering.
23. **Alerts in words (m-4).** Every alert of this backstop that asks a person to act goes through
    `alertOps` (new `src/lib/monitoring/ops-alert.ts`): `logger.error(sentence, undefined, context,
    { ...metadata, cause })`, so the logger sends `Sentry.captureMessage(sentence, "error")` and the
    error rides in the event's `log_metadata` context. The logger is unchanged: `logger.error(msg,
    err)` keeps `captureException` for every other caller.
24. **A chargeback's cancellation is not the customer's to undo (m-5).** `updateSubscription`
    refuses — `BillingRefusal` 409, "This subscription is ending after a disputed payment, so its
    plan can't be changed. Contact support if you'd like to keep it." — a subscription whose
    metadata says `cancelled_reason: chargeback` while it is still set to end, before any Stripe
    write. When a plan change clears any other cancellation it also unsets `cancelled_reason`
    (`""`, Stripe's unset).
25. **A refusal is reported once (m-6).** The delivery whose cancellation succeeded reports it
    (Sentry). A delivery that finds the subscription already cancelled by the refusal — the
    comment on the subscription it read, or on a re-read after its own cancel failed because a
    concurrent delivery cancelled first — finishes the refund if one is missing and logs at info.
    A failed cancel the re-read does not explain still throws and alerts. Residual, stated: what
    Stripe answers to cancelling an already cancelled subscription is not verified here (no Stripe
    access); if it answered success rather than an error, two deliveries racing inside the
    milliseconds between their read and their cancel could each report once.
26. **One terminal-status list (m-7).** New `src/lib/stripe/subscription-status.ts` exports
    `TERMINAL_SUBSCRIPTION_STATUSES`, `isTerminalSubscriptionStatus` and `CANCELLED_REASON` (the
    webhook's `metadata.cancelled_reason` values, now also read by the plan change); the webhook,
    the backstop and checkout recovery import it.
27. **Concurrent refusals refund once (M01).** The refund key stays
    `covered_by_lifetime-refund-<subscription>-<payment intent or charge>`: two deliveries that
    both miss the metadata lookup send the same key with the same parameters, and Stripe answers
    the second with the first refund. Pinned by a test that holds both deliveries past the lookup.
    There is no lock, so both may call `refunds.create`; the guarantee is one refund, not one call.

### Task 23 — the branch merges onto main (M-1)

Rebase onto `122ad2e`. `unauthenticated.test.ts` (s75) called `paymentMethodsRoute.GET()` with no
request; the branch's GET reads the request for its per-IP limiter, so two cases failed. The test
now passes a request to GET and mocks the limiter (`enforceRateLimit` → `null`) for the whole file.

- [x] Task 23

### Task 24 — every money guard pinned (M-2)

`stripe-webhook-lifetime-covered.test.ts`, each red under the review's surviving mutation:
M21 a subscription already cancelled for another reason is recorded as is, never refunded; M01
the exact refund key, and two deliveries (`checkout.session.completed` and
`customer.subscription.created`) held past the lookup together → one refund under that key; M17
an earlier failed refund is refunded again under `…-after-<failed id>`; M13/M14 an `open` payment
is reported as pending and a `canceled` one ignored, only the `paid` one refunded; M03/M08 a
Starter subscription beside Lifetime Pro is refused in both orderings; M06 a subscription created
in the same second as the lifetime payment is refused in both orderings.

- [x] Task 24

### Task 25 — one rule for both orderings (m-1)

Failing tests first: recorded after the grant, a subscription created before the lifetime was
paid is set to cancel at period end (metadata `lifetime_purchase` + the grant's payment intent),
never cancelled or refunded; a support comp dates from its `granted_at`; a failed period-end update
answers 500 and alerts.

- [x] Task 25

### Task 26 — a late payment is refunded when it settles (m-2)

Failing tests first: a refusal with an `open` payment reports it as refunded when it settles; its
`invoice.payment_succeeded` then refunds it in full under the same key; an over subscription not
refused by us is not refunded; a live subscription's invoice reads nothing from Stripe.

- [x] Task 26

### Task 27 — cancelled but not refunded (m-3)

Failing tests first: subscription-first, cancel succeeds and the refund fails → no period-end
update, one alert "refund it by hand", never "could not be cancelled"; a subscription Stripe
already cancelled for another reason → no update, no refund, no alert.

- [x] Task 27

### Task 28 — alerts in words (m-4)

Failing tests first: new `src/__tests__/lib/monitoring/ops-alert.test.ts` (the real logger, Sentry
mocked, production env): the sentence is the captured message at level `error`, no
`captureException`, the error in `log_metadata.cause`. The webhook's failure alerts pass no `Error`
and carry `cause`.

- [x] Task 28

### Task 29 — a chargeback's cancellation is kept (m-5)

Failing tests first, `subscription-rls.test.ts`: a subscription set to end after a chargeback →
`BillingRefusal` 409 with the sentence, Stripe never updated; clearing a lifetime-purchase
cancellation unsets `cancelled_reason`; a renewing subscription's metadata gains no
`cancelled_reason`.

- [x] Task 29

### Task 30 — a refusal is reported once (m-6)

Failing tests first: a second event for a refused subscription reports nothing more to Sentry;
the two concurrent deliveries of Task 24 report once and raise no "could not be cancelled".

- [x] Task 30

### Task 31 — one terminal-status list (m-7)

Refactor under the existing tests (chargeback, checkout recovery, refusal); a mutation of the
shared list turns them red.

- [x] Task 31

### Review fix pass — existing tests changed (declared)

- `unauthenticated.test.ts` (from `main`, s75): GET receives a request, and `@/lib/api/rate-limit`
  is mocked to let every call through (Task 23). The 401 and "reaches billing work" assertions are
  unchanged.
- `stripe-webhook-lifetime-covered.test.ts`: the Stripe fake now behaves like Stripe in two places
  — `refunds.create` answers a reused idempotency key with the refund it first made (and errors on
  the same key with other parameters), and `subscriptions.cancel` / `subscriptions.update` refuse a
  subscription already cancelled; the fake database gains `billing_invoices`. No existing case
  depended on the old behaviour: before any code change, under the new fake, the only red cases
  were the 10 new ones and the two assertions changed below. Two
  existing assertions changed because the alert now carries the error as metadata (m-4): "keeps the
  grant and reports it when the refusal fails" and "keeps the grant and reports it when a session
  cannot be expired" expected `expect.any(Error)` as the logger's second argument; they now expect
  `undefined` there and the error's message in `cause` (stricter: the sentence is also asserted).

### Review fix pass — execution notes (deviations, declared)

- M01: the brief asked for "exactly one refund call with the same key". There is no lock, so two
  deliveries that both miss the lookup both call `refunds.create`; the test asserts what the key
  guarantees — one refund at Stripe, both calls under the exact key (decision 27).
- m-3 goes one step beyond the brief: `stopBillingForLifetimeOwner` also skips a covered
  subscription Stripe already ended for another reason (decision 22), the other way the period-end
  fallback ran against a cancelled subscription.
- m-4 is a helper (`alertOps`), not a logger change, and covers every actionable alert of the
  backstop: the refusal failures, the period-end failures, the Checkout-expiry failures and the
  subscription-lookup failure. The refusal report itself already had no `Error` attached.
- m-2: a late refund that succeeds is logged at info, not Sentry, so the first invoice's own
  `invoice.payment_succeeded` (which finds the refusal's refund) never raises a second report;
  failures alert. The refusal report's pending sentence changed accordingly.
- m-1 adds an alert of its own: a predating subscription that cannot be set to end answers 500 and
  says "set it to cancel at period end by hand".
- m-5 has no UI change: the dialog still offers a switch on a subscription ending after a
  chargeback, and shows the server's refusal sentence as its error (`UpgradeDialog` prints the
  response's `error`). m-5 unsets `cancelled_reason` only, as briefed; the companion keys the webhook writes beside it
  (`paymentIntentId`, `disputeId`) stay as history.
- `readLifetimePlanIds` is gone: its one caller now reads `readLifetimeCover`, which keeps the same
  rule (undated, non-trial, non-revoked, not expired, rank rule) and adds when it was paid.
- M03 now lives in `readLifetimeCover`'s filter (the rank rule moved there with m-1).

Mutations (each neutralised, its test red, restored with `git checkout --`):

| # | Neutralised | Red |
|---|---|---|
| M01 | refund idempotency key made random | 4 |
| M03 | grant-first rank rule → exact plan match | 1 |
| M06 | `>=` → `>` on paid-at (one rule, both orderings) | 2 |
| M08 | subscription-first rank rule → exact plan match | 1 |
| M13 | non-paid payments refunded too | 1 |
| M14 | `open` payment branch dropped | 2 |
| M17 | an earlier failed refund treated as done | 1 |
| M21 | "already ended, not by us" guard dropped (grant-first) | 1 |
| N01 | m-1 grant-first timing rule dropped | 3 |
| N02 | m-1 comp dated "always" (granted_at ignored) | 1 |
| N03 | m-2 late-payment refund not run | 2 |
| N04 | m-2 refusal marker check dropped on the invoice path | 1 |
| N05 | m-2 live-row gate dropped (Stripe read on every invoice) | 1 |
| N06 | m-3 cancelled-only branch dropped (subscription-first) | 1 |
| N07 | m-3 terminal skip dropped (subscription-first) | 1 |
| N08 | m-3 grant-first alert ignores cancelled-only | 1 |
| N09 | m-4 alert sends the `Error` (captureException) | 7 |
| N10 | m-5 chargeback refusal dropped | 1 |
| N11 | m-5 stale `cancelled_reason` kept | 1 |
| N12 | m-6 re-read after a failed cancel dropped | 1 |
| N13 | m-6 report regardless of who cancelled | 2 |
| N14 | m-7 shared terminal list loses `canceled` | 8 |

## Follow-ups (not this story)

- Translate and A/B generate refunds report failures to `console.error` only (decision 5).
- `reactivateSubscription` reads the newest row whatever its status (research, Traps).
- ~~Checkout's catch still answers `error.message`~~ — done in fix pass 2 (decision 14).
- `useCheckout` shows checkout's 429 as `error` ("Rate limit exceeded") plus the time; checkout's
  own limiter sentence is never shown either (decision 13 keeps its output unchanged).
- **Owner (Stripe dashboard or live API access):** verify the billing-portal configuration in use
  has subscription updates disabled — `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` when set, otherwise
  the account's default configuration (`src/lib/stripe/subscription.ts`, the paused-subscription
  recovery portal). If the portal lets a customer switch plans, a lifetime owner could switch down
  into a plan their grant covers there, past every guard of this story. Not checked here: no
  Stripe access from this environment.
- ~~A plan held through a *dated* grant is still shown as held for life where it is the plan in
  force~~ — done in the Devin fix pass (decision 19; queued as s96, folded into s82).
- Reactivation (`reactivateSubscription`) clears a cancellation the same way a plan change did
  before m-5, so it can undo a chargeback's cancellation too (pre-existing, outside this review's
  findings). Same rule to apply: refuse while `cancelled_reason` is `chargeback`.
- `stopBillingForLifetimeOwner` destructures `{ data }` off its subscription read and drops the
  error, so a failed read reads as "no subscriptions" (pre-existing).
- Stripe test mode (no access here): what `subscriptions.cancel` answers for a subscription already
  cancelled (decision 25's residual), and whether a canceled subscription's metadata can be read
  with `cancellation_details.comment` intact on retrieve.

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
