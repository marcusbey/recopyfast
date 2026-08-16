# Research — Story s01-trial-signup

> **WARNING — carried forward from the story-breakdown review.**
> [`docs/reviews/stories.md`](../reviews/stories.md) ends with `Max severity: major` and
> **`Stories ready: no`**. The backlog was *not* signed off. The operator confirmed
> proceeding with `s01` anyway. One of that review's open majors lands directly on this
> story: **m8 — `s01` AC 8 defers the trial credit allowance**, i.e. the size of the trial
> credit grant is unstated and is a pricing decision. It is still unstated. See
> [Open questions](#open-questions).

> Method note: every claim below was checked by opening the file, not by recall. Line
> numbers are from `main` at `a23aca0`. Nothing here proposes an implementation — that is
> `/ks-plan`'s job.

---

## The five structuring facts

1. **The "mechanism `lifetime_pro` already uses" is a *permanent* grant.** `plan_entitlements`
   has no expiry column at all (`supabase/migrations/20260802000000_plans_catalog.sql:220-235`)
   and `readEffectivePlanId` filters it on `revoked_at IS NULL` and nothing else
   (`src/lib/billing/effective-plan.ts:158-178`) — so reusing it means *changing* the
   chokepoint, not calling it.
2. **A trial `pro` row in `plan_entitlements` silently blocks the $199 Lifetime sale.**
   `readGrantedPlanIds` (`src/lib/billing/effective-plan.ts:130-152`) cannot tell a trial
   from a purchase; its two consumers then refuse checkout with 409
   (`src/app/api/billing/checkout/route.ts:187-197`) and hide the offer card
   (`src/app/dashboard/billing/page.tsx:45-47`).
3. **Modelling the trial as a `billing_subscriptions` row is a dead end.** `status='trialing'`
   already entitles (`src/lib/billing/effective-plan.ts:19-23`), but the row makes conversion
   return 409 (`src/app/api/billing/checkout/route.ts:113-122`) and the upgrade path throw on
   a null `stripe_subscription_id` (`src/lib/stripe/subscription.ts:129-131`).
4. **There is no signup route and no "email confirmation" event.** Signup is passwordless
   `signInWithOtp` (`src/contexts/AuthContext.tsx:88-97`); the only server touchpoints are
   `/auth/callback` (`src/app/auth/callback/route.ts:20`) and `/auth/confirm`
   (`src/app/auth/confirm/route.ts:96-99`), and **both run on every sign-in, not just the first.**
5. **A trial granting `pro` already grants 500 credits — per *calendar* month.**
   `getUserCreditBalance` reads `plan.limits.monthlyCredits` (`src/lib/credits/system.ts:123-125`)
   and, with no subscription row, resets the period at the start of the calendar month
   (`:144-145`, `:171-176`), so a 14-day trial crossing a month boundary draws 1,000 credits.

---

## Target story

`s01-trial-signup` — *14-day Pro trial without a card* (`docs/stories.md:107-151`).
Complexity as written: **4**. Dependencies: none. Gates `s03`, and entitlement in `s09`,
`s11`, `s13`.

> **As a** web agency evaluating RecopyFast **I want** to use the full product for 14 days
> without entering a card **so that** I can prove it works on a real client site before
> asking anyone to pay.

### Acceptance criteria, restated with what the code says about each

| # | Criterion (abridged) | Current code position |
|---|---|---|
| 1 | New account has Pro entitlements, no Stripe customer, no payment method | Nothing grants anything. `resolveEntitlement` returns `UNENTITLED` (`effective-plan.ts:229`) and `middleware.ts:151-171` bounces the account to `/dashboard/billing?checkout=required`. |
| 2 | `getEffectivePlan` returns an entitled result whose limits equal `pro`'s | Reachable today only via a `plan_entitlements` row or a live `billing_subscriptions` row. Limits come from the `plans` row verbatim (`plans.ts:191-203`). |
| 3 | Expires at 14 days; then unentitled, site/editor creation refused with `upgradeRequired: true` | No expiry mechanism exists anywhere. **Naming note:** the gate object field is `upgradeRequired` (`permissions.ts:33`) but `/api/sites/register` serialises it as `upgrade_required` (`route.ts:98`). |
| 4 | After expiry content stays readable and the embed keeps serving | Already true and untouched by entitlement: the widget's content paths authorise on a site token via `authorizeIngestRequest`, never on a user plan. No entitlement call exists under `src/app/api/content/`. |
| 5 | Subscribing during the trial converts with no unentitled observation | Falls out for free **if** the trial lives in `plan_entitlements`: `readEffectivePlanId` ranks a grant above a subscription (`effective-plan.ts:158-198`), so the grant covers the whole checkout window. See [Traps](#traps--constraints) for when this stops being free. |
| 6 | An account that has trialled cannot start a second trial | No marker exists. Supabase keys `auth.users` on email, so a re-signup with the same address returns the same `user_id` — a `user_id`-keyed marker survives. Deleting sites touches nothing in `plan_entitlements`. |
| 7 | Dashboard shows days remaining, and an expired state with one upgrade action | No carrier: `EntitlementSummary` is `{kind, planId, planName}` (`src/types/billing.ts:29-33`) and `BillingDashboardData.effectivePlanId` is a bare string (`/api/billing/dashboard/route.ts:136`). |
| 8 | AI during the trial draws on a granted allowance and stops at zero | Partially free, wrongly: see structuring fact 5. **The allowance size is undecided** — review m8. |

---

## Current state of the code

### The catalogue is closed, and adding a row to it breaks everything

`plans.ts` maps *every* active row and throws on an id outside the TypeScript union:
`toSubscriptionPlan` throws when `!isSubscriptionPlanId(row.id)` (`plans.ts:206-210`), and
`toOneTimeProduct` throws when the id is not `credits`/`lifetime_pro` (`plans.ts:228-236`).
Because `loadPlanCatalogue` maps all rows before returning (`plans.ts:283-288`), **a single
`trial` row of either kind makes the whole catalogue load throw** — which takes down
`/api/pricing`, every checkout, and every feature gate, since all of them resolve limits
through `getPlanCatalogue`. The database agrees independently: `plans_only_one_time_grants`
forbids `grants_plan_id` on a `subscription` row (`plans_catalog.sql:148-156`), so a trial
row would have to be `kind='one_time'`, which is exactly the branch that throws.

The story's *"do not add a `trial` plan row"* is therefore correct and **stronger than it
says** — it is not a style preference, it is a total outage.

There is also a test that reads the migration text and asserts the seed's exact shape:
`plan-seed.test.ts:29` — *"ships exactly the three subscription plans"*.

### The grant table is built for permanence

```sql
-- supabase/migrations/20260802000000_plans_catalog.sql:220-235
CREATE TABLE IF NOT EXISTS plan_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  source TEXT NOT NULL DEFAULT 'lifetime_purchase',
  stripe_payment_intent_id TEXT UNIQUE,
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

No `expires_at`. Its purpose is documented as the opposite of a trial:
*"a permanent grant from a one-time purchase (Lifetime Pro) or a support comp. No period,
never renews, never lapses"* (`effective-plan.ts:100-103`). The index is partial on
`revoked_at IS NULL` (`plans_catalog.sql:237-238`). RLS: `authenticated` may SELECT own rows
only; writes are service-role, deliberately (`plans_catalog.sql:242-260`).

`source` is free text with a documented convention: `lifetime_purchase` on grant
(`entitlements.ts:72`), `revoked:<reason>` on revocation (`entitlements.ts:80-84`). Only
`revoked:dispute` is reversible (`entitlements.ts:198-205`). A trial would add a third value
to that vocabulary and must not collide with the revocation prefix.

### `billing_subscriptions` already has trial columns — and they are a trap

The table carries `trial_start`, `trial_end` and a nullable `stripe_subscription_id`
(`20250817000000_complete_database_setup.sql:143-151`); `status` admits `'trialing'`
(`20260731009000:66-79`); and `trialing` is in `LIVE_SUBSCRIPTION_STATUSES`
(`effective-plan.ts:19-23`). So a hand-written row `{plan:'pro', status:'trialing',
stripe_subscription_id: NULL}` would entitle **with zero chokepoint changes**.

It would also break conversion in two places, and both fail loudly only after money has
moved or not at all:

- `POST /api/billing/checkout` reads `getUserSubscription` first and returns **409 "You
  already have a subscription. Use the upgrade flow to change plans."**
  (`checkout/route.ts:113-122`) — `getUserSubscription` selects on the same three statuses
  (`subscription.ts:324-339`).
- The "upgrade flow" it points at is `updateSubscription`, whose second act is
  `stripe.subscriptions.retrieve(currentSubscription.stripe_subscription_id)`
  (`subscription.ts:129-131`) — `null` for a card-less trial, so it throws.

Neither the `plan` CHECK (`starter|pro` after `20260803000000:55-57`) nor the `status` CHECK
would object. The failure is behavioural, not constraint-level.

### There is no signup event to hang a trial on

`AuthContext` exposes only `signInWithMagicLink` → `supabase.auth.signInWithOtp`
(`AuthContext.tsx:79-104`). There is no `signUp`, no password, no server-side registration
route. Supabase creates the user; our first server-side sight of them is one of:

- `/auth/callback` → `exchangeCodeForSession(code)` (`callback/route.ts:20`)
- `/auth/confirm` → `verifyOtp({type, token_hash})` (`confirm/route.ts:96-99`), which exists
  precisely because the PKCE path fails cross-device (`confirm/route.ts:8-14`)

Both are **sign-in** routes, entered on every subsequent login, and the default Supabase
email templates currently point at `/auth/callback` (`confirm/route.ts:24-27`). Neither
distinguishes first sign-in from tenth.

### Credits already flow from the plan

`getUserCreditBalance` derives `included` from `entitlement.plan.limits.monthlyCredits`
(`system.ts:123-125`), i.e. **500 for `pro`** (`plans_catalog.sql:295`). With no
`billing_subscriptions` row the period start is `startOfCurrentMonth()`
(`system.ts:144-145`, `:171-176`). Spending is gated by `canUseAIFeatures`
(`permissions.ts:335-372`) and deducted CAS-style (`system.ts:201-270`).

### The marketing copy was deliberately removed and is tombstoned

Three sites carry comments recording that the trial claims were pulled *because the product
did not honour them*. This story restores them, and the comments are the checklist:

- `src/components/sections/Pricing.tsx:55-58` — `TRUST_POINTS` lost *"14-day free trial"* and
  *"No credit card required"*.
- `src/components/sections/FinalCTA.tsx:96-100` — *"there is no `trial_period_days` anywhere
  and subscription Checkout always collects a card, so both were claims the product broke."*
- `src/components/sections/Hero.tsx:115-124` — CTA is *"Get started"*, not *"Start editing for
  free"*, and the comment names the same class of claim.

---

## Anchor points

| Concern | File:line |
|---|---|
| **The chokepoint** — plan id resolution | `src/lib/billing/effective-plan.ts:154-199` |
| The one entitlement computation | `src/lib/billing/effective-plan.ts:211-230` |
| Grants-only read (money-critical, 2 consumers) | `src/lib/billing/effective-plan.ts:130-152` |
| Server-client binding of the chokepoint | `src/lib/billing/entitlements.ts:34-58` |
| Grant writer | `src/lib/billing/entitlements.ts:98-123` |
| Grant table DDL + RLS | `supabase/migrations/20260802000000_plans_catalog.sql:220-260` |
| Catalogue loader that throws on an unknown id | `src/lib/stripe/plans.ts:206-236`, `:283-288` |
| `grants_plan_id` reader (the story's `plans.ts:462`) | `src/lib/stripe/plans.ts:459-465` |
| The stale-comment target | `src/lib/feature-gating/permissions.ts:19-25` |
| Routing paywall | `src/middleware.ts:38-48`, `:151-171` |
| Checkout serialization | `src/app/api/billing/checkout/route.ts:112-166` |
| Lifetime duplicate guard | `src/app/api/billing/checkout/route.ts:178-198` |
| Lifetime offer visibility | `src/app/dashboard/billing/page.tsx:30-52` |
| Entitlement summary (dashboard shell) | `src/app/api/billing/entitlement/route.ts:31-76` |
| Entitlement summary type | `src/types/billing.ts:29-33` |
| Site-creation gate (AC 3) | `src/app/api/sites/register/route.ts:88-104` |
| Seat gate (AC 3, editor half) | `src/app/api/sites/[siteId]/share/route.ts:191`, `src/app/api/editor/editors/route.ts:167` |
| Credit allowance derivation (AC 8) | `src/lib/credits/system.ts:111-176` |
| Expiry-filter precedent worth copying | `src/lib/credits/spendable.ts:14-23` |
| Auth entry points | `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts` |
| Marketing copy to restore | `Pricing.tsx:55-58`, `FinalCTA.tsx:96-100`, `Hero.tsx:115-124` |
| Cron config (only one job scheduled) | `vercel.json` |

---

## Verified APIs / functions

Read from source, not recalled.

```ts
// src/lib/billing/effective-plan.ts:154
export async function readEffectivePlanId(
  supabase: SupabaseClient, userId: string,
): Promise<string | null>
```
Queries `plan_entitlements` (`eq user_id`, `is revoked_at null`, `order granted_at desc`,
`limit 1`, `maybeSingle`); returns its `plan_id` unless retired; otherwise queries
`billing_subscriptions` (`in status LIVE_SUBSCRIPTION_STATUSES`, `order created_at desc`,
`limit 1`). **Behaviour on this story's case:** a trial row in `plan_entitlements` is returned
forever — there is no expiry predicate and the entitlement branch never falls through once a
row is found. Both reads throw on error rather than downgrading.

```ts
// src/lib/billing/effective-plan.ts:211
export async function resolveEntitlement(
  supabase: SupabaseClient, userId: string,
): Promise<Entitlement>
```
`Entitlement = {kind:"plan",planId,plan} | {kind:"credits",…} | {kind:"none",…}`
(`:61-68`). Reads the wallet only after a plan is ruled out. A plan id with no *active*
catalogue row falls through to the wallet (`:217-222`).

```ts
// src/lib/billing/effective-plan.ts:130
export async function readGrantedPlanIds(
  supabase: SupabaseClient, userId: string,
): Promise<string[]>
```
All non-revoked, non-retired `plan_id`s, deduped. **Behaviour on this story's case:** returns
`["pro"]` for a trialling account, which is indistinguishable from a $199 purchase. Consumers:
`checkout/route.ts:187` and `dashboard/billing/page.tsx:45`.

```ts
// src/lib/billing/entitlements.ts:56
export async function getEffectivePlan(userId: string): Promise<Entitlement>
// src/lib/billing/entitlements.ts:44
export async function getGrantedPlanIds(userId: string): Promise<string[]>
// src/lib/billing/entitlements.ts:34
export async function getEffectivePlanId(userId: string): Promise<string | null>
```
Thin bindings of the above to the cookie-scoped client. `getEffectivePlan` has **7 non-test
call sites**: `permissions.ts:104,272,339,380,473`, `credits/system.ts:123`,
`stripe/subscription.ts:358`, `ab-tests/generate/route.ts:70`,
`billing/dashboard/route.ts:125`, `billing/entitlement/route.ts:43`. `resolveEntitlement` is
additionally called directly by `middleware.ts:43`.

```ts
// src/lib/billing/entitlements.ts:98
export async function grantPlanEntitlement(
  userId: string,
  planId: string,
  stripePaymentIntentId: string,        // required, non-nullable in TS
  source: string = "lifetime_purchase",
): Promise<{ granted: boolean; duplicate: boolean }>
```
Service-role insert. Relies on the UNIQUE on `stripe_payment_intent_id` for idempotency;
`23505` → `{granted:false, duplicate:true}`. **Behaviour on this story's case:** a trial has
no payment intent, so this signature does not fit as-is. Precedent for a synthetic key exists
in `refundCredits` (`credits/system.ts:409`), which writes
`` `refund_${reason}_${userId}_${randomUUID()}_${Date.now()}` ``.

```ts
// src/lib/stripe/plans.ts:459
export async function getLifetimeGrantPlanId(): Promise<SubscriptionPlanId | null>
```
Returns `oneTimeProducts.find(p => p.id === "lifetime_pro")?.grantsPlanId ?? null` — line 462
is exactly the `grantsPlanId` read the story cites. **It is hardcoded to `lifetime_pro` and
has one caller** (`checkout/route.ts:179`).

```ts
// src/lib/billing/checkout-reservation.ts:17
export async function claimSubscriptionReservation(
  supabase: SupabaseClient, userId: string,
): Promise<boolean>
export const SUBSCRIPTION_CHECKOUT_TTL_MS = 30 * 60 * 1000;   // :8
// src/lib/billing/user-lock.ts:10
export async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T>
```
`withUserLock` is a **process-local** promise-chain mutex — it serialises one isolate only,
by design (`user-lock.ts:1-7`). The cross-isolate guarantee is the PRIMARY KEY on
`checkout_reservations.user_id` (`20260813130000:13`, with `CHECK (intent = 'subscription')`
at `:14`). Composed at `checkout/route.ts:124-152`, and **only around subscription checkout** —
the `lifetime`, `credits` and `payment_method` intents run outside it (`:200-207`).

```ts
// src/lib/credits/spendable.ts:21
export function spendableFilter(): string   // "expires_at.is.null,expires_at.gt.<iso now>"
```
The house pattern for "not expired yet", applied as a PostgREST `.or()` inside the query
(`spendable.ts:41`). Directly transferable to an expiring grant.

```ts
// src/lib/feature-gating/permissions.ts:99 / :266 / :335 / :377
canCreateWebsite(userId)              // narrows kind !== "plan" -> NO_ENTITLEMENT
canAddCollaborator(userId, siteId)    // same
canUseAIFeatures(userId, creditsRequired = 1)
canUseTranslation(userId)
```
All read `plan.limits.*` straight from the catalogue row; nothing hardcodes a plan's
contents. A trial resolving to `plan:"pro"` therefore gets Pro's limits with no gate changes.

---

## Traps & constraints

### T1 — The trial grant blocks the $199 sale *(highest value; not in the story)*

`readGrantedPlanIds` answers *"what have they already paid for outright"*. A trial grant of
`pro` makes it answer `["pro"]`, and `getLifetimeGrantPlanId()` returns `"pro"`. So
`checkout/route.ts:189-197` refuses the lifetime purchase with **409 "You already have
lifetime access to this plan"**, and `dashboard/billing/page.tsx:47` hides the offer card.

This is the *identical* defect the codebase already tombstoned once:

> *"a Pro **monthly subscriber** resolved to `pro`, matched the plan Lifetime Pro confers,
> and was refused with 'You already have lifetime access' for something they had never
> bought. That refused exactly the customer most likely to buy it."*
> — `src/lib/billing/effective-plan.ts:113-129`

Re-committing it via a different door would be a straight regression of a documented fix,
against the highest-margin product in the catalogue. Any trial living in `plan_entitlements`
must be invisible to `readGrantedPlanIds` — and the test at
`checkout-concurrency.test.ts:269` (*"refuses a lifetime purchase the customer already holds
a grant for"*) is the guard that must keep passing while the trial case is added beside it.

### T2 — The chokepoint's entitlement branch never falls through

`readEffectivePlanId:175-177` is `if (entitlement && !isRetired(...)) return entitlement.plan_id;`.
A post-query expiry check would make an expired trial return **`null` outright**, skipping the
`billing_subscriptions` read below it — which un-entitles a converted customer who *does* have
a live subscription. The expiry predicate has to be **inside the query** (the `spendableFilter`
shape), so an expired row is simply not selected and `.limit(1)` picks the next live grant or
falls through to the subscription. This is the difference between AC 5 working for free and
AC 5 failing for paying customers.

The existing test mock already stubs `.or()` in its chain
(`src/__tests__/lib/billing/entitlements.test.ts:29-40`), so adding one does not break it.

### T3 — Clock source *(story-named, confirmed)*

Expiry must come from a stored server timestamp. Note that `spendableFilter()` builds its
boundary from `new Date()` **in the Node process**, not from `now()` in Postgres — acceptable
precedent, but it means a skewed serverless clock shifts an authorization boundary. `granted_at`
already defaults to `NOW()` server-side (`plans_catalog.sql:230`); deriving expiry from it is
strictly safer than storing a client-supplied end date.

### T4 — The flicker *(story-named; real only conditionally)*

`withUserLock` + `claimSubscriptionReservation` wrap **only** the subscription branch
(`checkout/route.ts:124-152`). If the trial lives in `plan_entitlements` and is left to lapse
on its own clock, conversion needs no revocation and **no request can observe a gap** — the
grant outranks the subscription for the whole window, which is the same property
`stopBillingForLifetimeOwner` relies on (`webhooks/stripe/route.ts:638-646`). The flicker the
story warns about materialises **only if the plan chooses to revoke the trial at conversion
time.** Stated plainly so `/ks-plan` decides deliberately rather than inheriting a warning
about a race it may not create.

### T5 — Both auth routes fire on every sign-in

Trial-start cannot be "on confirmation" because there is no such event (structuring fact 4).
Whatever writes the grant must be idempotent under repeat sign-in *and* must not re-grant
after expiry — AC 6 is a **uniqueness constraint**, not a code check. The UNIQUE on
`plan_entitlements.stripe_payment_intent_id` is the only unique key on that table today; a
`user_id`-scoped uniqueness for trials has to come from somewhere (partial unique index, or a
synthetic value in that column). Two entry points (`/auth/callback`, `/auth/confirm`) mean a
code-level guard has to be written twice or placed below both.

### T6 — AC 8 is over-satisfied and under-specified at once

A trial resolving to `pro` inherits `monthlyCredits: 500` automatically
(`system.ts:123-125`, `plans_catalog.sql:295`) — nobody has to grant anything for the trial to
have AI. But with no subscription row the period start is the **calendar month**
(`system.ts:144-145`, `:171-176`), so a trial started on the 25th draws 500 credits, then 500
more on the 1st: **1,000 credits of OpenAI spend on a 14-day card-less trial.** "Stop at zero"
is satisfied by `canUseAIFeatures`; "a trial never grants uncapped OpenAI spend" is not, and
the number to cap it at is the review's open m8.

### T7 — Never add a plan row *(story-named; consequence is larger than stated)*

Confirmed and escalated: any row outside the `SubscriptionPlanId`/`OneTimeProductId` unions
makes `loadPlanCatalogue` throw, taking down pricing, checkout and every feature gate — not
just `resolveStripePriceId` and the pricing feed. See [Current state](#current-state-of-the-code).

### T8 — The comment at `permissions.ts:21` does not actually go stale

Verified verbatim (`permissions.ts:19-25`):

> *"An account with no plan is denied outright, before any quota arithmetic. There is no free
> tier to fall through to: `getEffectivePlan` returns an `Entitlement`, and the union does not
> expose `.limits` until the caller has checked `entitled`…"*

Every clause of that stays true after this story: a trial **is** a plan entitlement, not a free
tier, and the union mechanism it describes is untouched. The story's instruction to update it is
still worth honouring — a reader arriving at "no free tier" while a card-less trial ships will
reasonably wonder — but it should be an *addition* naming the trial, not a correction. Rewriting
it as though the old statement were wrong would delete a load-bearing explanation of why the
union is a union.

### T9 — Existing tests in the blast radius

| Test | Why it is in range |
|---|---|
| `src/__tests__/lib/billing/entitlements.test.ts` (266 L) | Ten cases pinning `readEffectivePlanId`/`resolveEntitlement` precedence, including *"lets a lifetime entitlement win over a live subscription"* (`:121`) and *"falls through a free grant to a real subscription underneath it"* (`:142`). The last is the closest existing analogue to expiry fall-through. |
| `src/__tests__/api/billing/checkout-concurrency.test.ts:269` | *"refuses a lifetime purchase the customer already holds a grant for"* — the T1 guard. |
| `src/__tests__/lib/stripe/plan-seed.test.ts:29` | *"ships exactly the three subscription plans"* — reads the migration text; a seed change breaks it. |
| `src/__tests__/lib/feature-gating/permissions.test.ts` (573 L) | Every gate's unentitled/credits/plan branch. |
| `src/__tests__/middleware.test.ts` (234 L) | The paywall redirect an entitled trial must now skip. |
| `src/__tests__/api/billing/dashboard-unentitled.test.ts`, `entitlement.test.ts` | The two surfaces AC 7 extends. |

Repo rule, binding: *"Do not modify a test to accommodate a change in behaviour. Change the
behaviour, or change the test **and say so in the PR**"* (`AGENTS.md:204`).

### T10 — Migration and RLS constraints

`AGENTS.md:113-116`: never edit an applied migration (forward-only,
`YYYYMMDDHHMMSS_snake_case.sql`); every tenant-scoped table gets an RLS policy in the same
migration that creates it. `plan_entitlements` already has SELECT-own for `authenticated` and
no INSERT/UPDATE policy — deliberately, *"the row is worth $199"* (`plans_catalog.sql:249-251`).
A trial write must therefore be service-role, from a server route, never from the browser.

### T11 — Only one cron is scheduled

`vercel.json` schedules `generate-blog-post` and nothing else; `/api/cron/ab-test-lifecycle`
exists as a route but is **not** wired. If the design leans on a sweeper to expire trials,
that is a new `vercel.json` entry plus its auth pattern — and it makes expiry eventually
consistent, which is wrong for an authorization boundary. A read-time predicate (T2) needs no
cron at all.

---

## Open questions

1. **How large is the trial credit allowance?** (review m8, PRD open decision 5). Pro's 500
   is inherited by default and doubles across a month boundary (T6). This is a COGS decision,
   not an engineering one, and one AC cannot be verified until it is answered. **Flagging, not
   guessing.**
2. **Where does the uniqueness for "one trial per account" live?** A partial unique index on
   `plan_entitlements(user_id) WHERE source = '<trial>'` and a synthetic
   `stripe_payment_intent_id` are both consistent with the codebase's idempotency habits
   (`entitlements.ts:114`, `credits/system.ts:409`). Overloading a Stripe-named column for a
   non-Stripe grant is a readability cost the plan should take a position on.
3. **Is the trial "consumed" on grant or on expiry?** AC 6 says a second trial is impossible.
   If the marker is the grant row and the row is ever hard-deleted for any reason, the guard
   evaporates. Soft-revocation is already the house pattern (`entitlements.ts:126-131`).
4. **Does the trial start at signup or at first sign-in?** With magic-link auth these are the
   same click, but a user who requests a link and opens it three days later has already burned
   three days if the clock starts at request. Unknown which the PRD intends; `prd.md:164-168`
   says only *"14-day Pro trial without a card"*.
5. **Does an expired trial keep its `middleware.ts` bounce to `/dashboard/billing`?** AC 7 wants
   an expired state *with an upgrade action*, and `/dashboard/billing` is the one ungated page
   (`middleware.ts:22`). Whether "expired" is a distinct dashboard state or just the existing
   paywall redirect with different copy is a design question for `/ks-design`.
6. **Does `/api/billing/entitlement` carry the days-remaining, or does a new route?** It is
   explicitly the cheap per-page call (`entitlement/route.ts:5-9`) and explicitly *"must not
   become load-bearing for authorisation"* (`:13-16`). Adding a countdown to it is natural;
   adding anything a gate reads is forbidden.
7. **Unverifiable here:** `docs/stories.md:11` claims *"1954 passing"*. Not re-run — the same
   gap `docs/reviews/stories.md` records under "Could not verify".

---

## Real complexity

**Re-scored: 4.** Same as `docs/stories.md:114`, but the reasons differ from the story's, so
the difference is worth stating.

**What the story got right.** Its stated risk — *"this story edits the single function every
authorization gate calls… a defect in `getEffectivePlan` does not fail loudly in one feature —
it silently grants or denies across the whole product, including on accounts that are paying"*
— is precisely correct and is confirmed by the call graph: 10 non-test call sites plus
`middleware.ts`, all reading one function whose predicate this story changes.

**What the story understated.** It scopes the blast radius to `getEffectivePlan`. The reading
above finds a second chokepoint the story does not mention at all — `readGrantedPlanIds` — whose
failure mode is commercially worse (blocks a $199 sale silently, for every trialling account,
with a 409 that reads as intentional) and which is a documented past incident being re-committed
through a new door. Add the credit-period defect (T6), the two auth entry points (T5), and the
fall-through subtlety at T2, and the surface is broader than "one function".

**Why it is still not a 5.** The breadth is in *reads of one table*, not in new systems. There
is no external service, no wire protocol, no deployment, no statistics, no byte budget. Each
individual change is small — a query predicate, a source filter, a migration, a summary field,
three copy restorations. The concentration of risk is high; the volume of novel engineering is
not. A 5 on this backlog means "an integration whose arithmetic does not close" (`s06`) or "a
second deployed service" (`s07`); this is neither.

**Where the 4 sits.** High. The undecided credit allowance (open question 1) leaves AC 8
unverifiable at plan time, and open questions 2–4 are all decisions that change the schema.
`/ks-plan` should resolve 1, 2 and 4 before sequencing tasks; 3, 5 and 6 can be settled inside
the plan.

**No split proposed** — a split is required only at 5, and the acceptance criteria here are one
coherent slice: a trial that is granted, resolves, expires, converts and is visible. Splitting
"grant + resolve" from "expire" would ship an account state that never ends, which is worse than
shipping nothing.
