# Research — Story s13-agency-plan

> **WARNING — the backlog is not signed off.** `docs/reviews/stories.md` ends with
> `Max severity: major` / `Stories ready: no`. Six majors are open, one of which
> (**M4**) is about this very story. The operator confirmed proceeding anyway.
> Everything below is verified context only: no code, no plan, no design.

> **Second warning — a hard blocker.** PRD open decision **7** (`prd.md:444-446`)
> is unresolved and the PRD itself says *"Confirm before `s13` reaches `/ks-plan`."*
> See [Open questions](#open-questions). Research can complete; planning cannot.

---

## False premises found

The story's **central premise is true and verified**: there is no `agency` plan
anywhere in the repository. But three supporting claims in the story and in the code
it points at are wrong, and two of them would let an implementer believe they had
verified something they had not.

**1. The `permissions.ts:150` citation is wrong.** `stories.md` says
*"`countOwnedSites` (`permissions.ts:79`) whose comment at `:150` records that a
previous `sites.user_id` filter silently returned 0."* `countOwnedSites` is at
`src/lib/feature-gating/permissions.ts:79` ✅, but the incident is recorded in its
own docblock at **`:71-74`**:

```
 * site_permissions, which is what POST /api/sites/register writes. The previous
 * `sites.user_id` filter returned a PostgREST 42703 that was discarded with the
 * count, so every quota check saw 0 sites and passed unconditionally.
```

Line `:150` is inside `resolveSiteOwnerId`'s docblock and says only *"Ownership is an
`admin` row in site_permissions, the same definition `countOwnedSites` uses."* The
substance of the story's note is correct; only the line number is not.

**2. AC 9 names a command that cannot satisfy AC 9.** The criterion reads
*"`npm run check:stripe` passes against the new plan in both test and live mode."*
`package.json:33` defines `check:stripe` as `--mode=test` **only**; live mode is a
separate script, `check:stripe:live` (`package.json:34`), and it requires
`STRIPE_SECRET_KEY_LIVE` plus `*_PRICE_ID_LIVE` values that
`sync-stripe-catalogue.mjs:186-193` refuses to run without. One command cannot cover
both modes.

**3. `scripts/sync-stripe-catalogue.mjs:51` claims a test that does not exist.** The
script duplicates `PRICE_ID_ENV_VARS` as its own `PRICE_ENV` literal (`:53`) and
says the two are *"checked against each other by `scripts/__tests__` rather than by
the type system."* **`scripts/__tests__` does not exist** (`ls scripts/` returns
eight files, no directory), and `jest.config.js` collects only from `src/`
(`collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}']`). Nothing enforces parity. This
is the single most dangerous thing in the story's blast radius — see
[Traps](#traps--constraints) T1.

---

## The five structuring facts

1. **`agency` exists nowhere.** `PRICE_ID_ENV_VARS` holds exactly `starter`, `pro`, `credits`, `lifetime_pro` — `src/lib/stripe/plans.ts:66-99` — and the identity union is `export type PaidPlanId = "starter" | "pro"` at `src/lib/stripe/plan-types.ts:29`.
2. **A database CHECK will reject the new plan before any code does.** `CHECK (plan = ANY (ARRAY['starter'::text, 'pro'::text]))` — `supabase/migrations/20260803000000_retire_free_plan.sql:56-57` — and the last time that CHECK disagreed with the catalogue, cards were charged and no subscription row was ever written (`20260802020000_plan_constraint_and_credit_collapse.sql:6-17`).
3. **`npm run check:stripe` iterates the script's own literal, not the catalogue.** `for (const [planId, periods] of Object.entries(PRICE_ENV))` — `scripts/sync-stripe-catalogue.mjs:214` — so a plan seeded into `plans` but absent from `PRICE_ENV` is never inspected and the check exits 0.
4. **Proration already works; the downgrade refusal does not exist.** `updateSubscription` goes `getPaidPlan` → `resolveStripePriceId` → `stripe.subscriptions.update(..., proration_behavior: "always_invoice")` with no site-count check anywhere between them — `src/lib/stripe/subscription.ts:126-149`.
5. **The branded subdomain is greenfield.** The embed origin is one process-wide env var — `getPublicAppUrl()` at `src/lib/sites/embed-script.ts:42-45` — with a hardcoded `recopyfa.st` → `www.recopyfa.st` rewrite at `:26-38`, and AGENTS.md non-negotiable 2 makes `/embed/recopyfast.js` a **permanent** public URL that can never move.

---

## Target story

**`s13-agency-plan` — one subscription for all my client sites.**
*As a web agency I want a plan priced for many sites under one bill so that adding a
client site is a decision I make in seconds, not a purchase I justify.*

`docs/stories.md:644-702`. Complexity as written: **4**. Dependency: `s01-trial-signup`
(shares the entitlement resolution path). Gates `s14-agency-client-handoff` →
`s15-agency-digest`.

### Acceptance criteria, as written

| # | Criterion | Verdict from the code |
|---|---|---|
| 1 | An `agency` plan exists in the catalogue with its own site limit, editor limit and monthly credit allowance. | Greenfield. Migration + `PaidPlanId` widening + env vars. |
| 2 | Appears in the public pricing feed with live Stripe amounts, alongside existing plans. | Nearly free — `/api/pricing` is catalogue-driven and `PLAN_META[plan.id] ?? DEFAULT_META` (`route.ts:153`) degrades safely for an unknown id. |
| 3 | An agency account can create sites up to its limit, enforced by the existing site-count gate. | Free — `canCreateWebsite` reads `plan.limits.websites` from the row (`permissions.ts:110-125`) and is already wired into `POST /api/sites/register:93`. |
| 4 | Exceeding the limit **offers** additional sites at the plan's per-site price rather than a hard refusal, when `additional_site_price` is configured. | **Ambiguous — see Open questions Q2.** Today `canCreateWebsite` returns `allowed: false` regardless; `additionalSitePrice` only changes the denial *text* (`permissions.ts:130-143`). Pro already has `additional_site_price = 5` and still hard-refuses. |
| 5 | Upgrading Pro → Agency preserves all sites, content and grants, and prorates through Stripe. | Proration already works (`subscription.ts:146`). "Preserves sites/content/grants" is free — nothing about a plan change touches `sites`, `content_elements` or `site_permissions`. This is an assertion to test, not work to do. |
| 6 | Downgrading below the current site count is refused **before** the Stripe call, naming how many sites must be removed first. | **New behaviour.** No such guard exists on any path. |
| 7 | One invoice covers all sites on the account. | Already true under answer A of decision 7, and **false by construction** under answer B. Not implementable until decision 7 lands. |
| 8 | An agency can serve its sites from a branded subdomain, content identical to the default origin. | **Greenfield, second external-systems axis. This is M4.** See [M4](#m4--the-branded-subdomain-criterion). |
| 9 | `npm run check:stripe` passes against the new plan in both test and live mode. | Command is test-mode only (false premise 2), and can pass vacuously (trap T1). |

### Stated risk (story, verbatim)

> this changes the plan catalogue, which is mirrored in Stripe and read by the public
> pricing feed. A mismatch between the two shows up as a price changing at checkout —
> the failure mode the codebase already removed a hardcoded fallback to prevent.

---

## Current state of the code

### The catalogue is database-driven, but the plan *identity* is a compile-time union

`plans` is the source of truth for prices, limits and feature bullets
(`supabase/migrations/20260802000000_plans_catalog.sql`). But the ids themselves are a
closed TypeScript union, and the migration header says why:

> Adding a plan is a code change *and* a seed change; changing what a plan costs or
> includes is a seed change alone, which is the split this refactor is about.
> — `src/lib/stripe/plan-types.ts:17-27`

So `agency` is **on the code side of that split**. Widening `PaidPlanId` is the
entry point and the compiler then does most of the discovery work for free (see
Anchor points).

Loader guarantees worth knowing:

- `loadPlanCatalogue` throws if the `plans` table is empty, and throws again if any
  member of `PAID_PLAN_IDS` has no active row (`plans.ts:290-297`). Adding `agency` to
  `PAID_PLAN_IDS` without seeding the row **hard-fails every pricing render, every
  checkout and every feature gate**, in every environment, at once.
- The catalogue is cached for 5 minutes per process (`CATALOGUE_TTL_MS`, `plans.ts:37`),
  with `clearPlanCatalogueCache()` (`plans.ts:349`) for tests.
- `toPlanLimits` (`plans.ts:187-204`) requires all six keys; the DB CHECK
  `plans_subscription_limits_complete` enforces the same at write time
  (`20260802000000:125-135`). A seed missing one key fails loudly on both sides.
- `resolveStripePriceId` precedence is **DB column first, env second** (`plans.ts:465-509`),
  and throws with the exact env var name when neither is set.

### Site ownership and the quota gate

- `sites` has **no owner column** — `id, domain (UNIQUE), name, api_key, timestamps`
  (`20250817000000_complete_database_setup.sql:16-23`). Ownership is an `admin` row in
  `site_permissions`.
- `countOwnedSites` (`permissions.ts:79-94`) counts exactly that, and **throws** rather
  than defaulting to 0 — because the previous `sites.user_id` filter returned a
  PostgREST 42703 that was discarded with the count, so every quota check saw 0 sites
  and passed unconditionally (`:71-77`).
- `canCreateWebsite` (`permissions.ts:99-144`) is the only meter, called from
  `POST /api/sites/register:93` after the rate limit and before any write.
- `-1` means unlimited (`UNLIMITED`, `permissions.ts:38`), handled at `:117-119`.
- `countOwnedSites` is **module-private**. AC 6 needs it (or an equivalent) from
  `src/lib/stripe/subscription.ts`.

### Plan changes and proration

`updateSubscription` (`subscription.ts:104-190`) is the *only* plan-change path — new
subscriptions go through Stripe Checkout instead (`subscription/route.ts:38-45`
documents why: server-side creation produced `incomplete` rows Stripe auto-cancelled).

Its order today:

1. Read the live subscription under the caller's RLS client (`:107-118`).
2. `await getPaidPlan(updates.planId)` — throws on unknown plan (`:126`).
3. `resolveStripePriceId` — throws if no price configured (`:127`).
4. Retrieve the Stripe subscription, refuse if already on the price (`:129-140`).
5. **`stripe.subscriptions.update(..., proration_behavior: "always_invoice")`** (`:142-152`).
6. Write `billing_subscriptions` via the **service-role** client, keyed on both row id
   and `user_id` (`:165-183`; `createSubscriptionWriteClient` at `:60-62` explains that
   `authenticated` has SELECT only, and that a silent zero-row UPDATE once threw *after*
   Stripe had invoiced the proration — card charged, UI says failed).

There is **no site-count check at any step**. AC 6's "before the Stripe call" means
between step 3 and step 5.

`always_invoice` also means a downgrade issues an immediate credit note. A refused
downgrade must therefore happen before step 5, not be rolled back after it.

### The public pricing feed

`src/app/api/pricing/route.ts`. Header comment, verbatim:

> There is deliberately no hardcoded fallback catalogue. The previous version kept one,
> which meant a database outage served stale prices to customers with no indication
> anything was wrong — and it was that duplicate copy that had silently drifted from
> the real plan config in the first place.

Verified: no fallback array exists. On failure it serves the last in-process cache
(`:243-247`) or 503 (`:249-253`). `PLAN_META` (`:67-74`) has entries only for `free`,
`starter`, `pro`, and unknown ids fall to `DEFAULT_META` (`:153`) — so `agency` renders
with no badge and "Get started" unless an entry is added. `readStripeAmounts` returns
`{}` for anything failing `isPaidPlanId` (`:92-94`), so the feed reports
`source: "database"` for a plan whose price ids are missing rather than erroring.

CORS on this route is pinned to `NEXT_PUBLIC_APP_URL` exactly (`:219-223`) — relevant
to AC 8, not to AC 2.

### Branded subdomains: nothing exists

Repo-wide grep for `subdomain|custom_domain|customDomain|branded` across `src/`,
`supabase/`, `public/`, `server/` (excluding `node_modules`) returns:

- `src/types/index.ts:472` — `custom_domain?: string` on `interface WhiteLabelConfig`.
  **Dead type.** Nothing imports or constructs it.
- `supabase/analytics-schema.sql:230` — `custom_domain TEXT` on `white_label_configs`.
  **Not a migration.** It sits in `supabase/`, not `supabase/migrations/`, so it is not
  in the applied history.
- Three test files, all about `normalizeDomain` accepting `subdomain.example.com` as a
  *customer's* domain — nothing to do with our serving origin.
- `src/lib/auth/editor-request.ts:39` — a comment about accepting customer subdomains.

There is no serving path, no host routing, no origin registration, no DNS handling and
no certificate handling. The PRD rules it in scope
(`prd.md:159-160`: *"White-label full domain (a branded subdomain in the Agency plan is
in scope; a full white-label product is not)"*) — it is simply not built.

What a branded serving origin would have to move:

| Surface | File | Why it blocks today |
|---|---|---|
| Snippet origin | `src/lib/sites/embed-script.ts:42-45` | One process-wide `NEXT_PUBLIC_APP_URL`, no per-account variant |
| Apex canonicalisation | `embed-script.ts:26-38` | Hardcodes `recopyfa.st` → `www.recopyfa.st`, because *"Browser CORS preflights cannot follow that redirect"* |
| Snippet emission | `api/sites/route.ts:108`, `api/sites/register/route.ts:190`, `components/dashboard/SiteDetailView.tsx:100` | Three call sites, all defaulting to the global origin |
| Content CORS grant | `api/content/[siteId]/route.ts:172-188` | Falls back to `NEXT_PUBLIC_APP_URL`; a second origin is invisible to it |
| Our CSP | `src/middleware.ts:196-256` | `connect-src` derived from env; `default-src 'self'` is per-serving-origin |
| Auth redirect origin | `src/app/auth/public-origin.ts:69-110` | `NEXT_PUBLIC_APP_URL` outranks the request host; a session set on a branded host would redirect to the canonical one and land signed out |
| Stripe return URLs | `src/lib/stripe/checkout.ts:68-83` | Same resolver, same single canonical origin |
| Permanent-URL rule | AGENTS.md non-negotiable 2 | Every branded subdomain becomes a **permanent** public URL for the installs baked against it |

The `Origin` pin in `src/lib/security/site-auth.ts` is worth being precise about: it
checks the **customer's** origin against `sites.domain` (`:151-158`, `:263-266`), not
our serving origin. A branded subdomain does **not** by itself break that pin — the
widget's `Origin` is still the client site. What it does break is everything that
assumes our origin is a single constant.

---

## Anchor points

Ordered by the sequence the compiler will force.

1. **`src/lib/stripe/plan-types.ts:29,33`** — `PaidPlanId` and `PAID_PLAN_IDS`. Changing
   these is the entry point; `tsc --noEmit` then enumerates the rest.
2. **`src/lib/stripe/plans.ts:66-99`** — `PRICE_ID_ENV_VARS`. `satisfies Record<PaidPlanId | OneTimeProductId, …>` makes this a **compile error** until `agency` is added. This is the one duplication the type system does catch.
3. **`src/components/dashboard/DashboardNavigation.tsx:72-75`** — `PLAN_RANK: Record<PaidPlanId, number>`. Also a compile error. Decide where `agency` ranks (3, above `pro`).
4. **New migration** — seed the `agency` row **and** widen `billing_subscriptions_plan_valid` to `('starter','pro','agency')`. Forward-only; never edit `20260803000000`.
5. **`src/lib/stripe/subscription.ts:126-142`** — insert the AC 6 downgrade guard here, between `resolveStripePriceId` and `stripe.subscriptions.update`.
6. **`src/lib/feature-gating/permissions.ts:79`** — `countOwnedSites`, needed by (5); currently module-private.
7. **`scripts/sync-stripe-catalogue.mjs:53-68`** — `PRICE_ENV`. **Not type-checked, not tested.** Silent if forgotten.
8. **`src/app/api/pricing/route.ts:67-74`** — `PLAN_META`, for the Agency card's badge/CTA.
9. **Environment** — `STRIPE_AGENCY_PRICE_ID{,_LIVE}` and `STRIPE_AGENCY_YEARLY_PRICE_ID{,_LIVE}` in `.env.example` (which still lists retired `STRIPE_ENTERPRISE_*` at `:72-77`), `docs/operations/stripe-setup.md`, `docs/operations/deployment-checklist.md:29-31`, `docs/operations/deployment-env.md`, plus Vercel test **and** live.
10. **`src/app/dashboard/teams/page.tsx:149`** — `data.planId !== "pro"` would lock an Agency account out of a page. Teams is graveyard (`prd.md:136-138`), so this is a note, not a task — but leaving it silently denies the plan's own buyer.

Untouched by design: `src/lib/billing/effective-plan.ts` and `entitlements.ts` resolve
by plan **id string** against the catalogue, so a new row flows through unchanged.
`RETIRED_PLAN_IDS` (`effective-plan.ts:37`) stays `['free']`.

---

## Verified APIs / functions

Signatures read from source, not memory.

```ts
// src/lib/stripe/plan-types.ts
type PaidPlanId = "starter" | "pro";                    // :29
type SubscriptionPlanId = "free" | PaidPlanId;          // :30 — `free` is still in the union
const PAID_PLAN_IDS: readonly PaidPlanId[];             // :33
function isPaidPlanId(value: unknown): value is PaidPlanId;
interface PlanLimits {                                  // :60-70
  websites: number;        // -1 = unlimited
  collaborators: number;
  aiFeatures: boolean;
  translations: number;
  abTesting: boolean;
  monthlyCredits: number;
}
interface SubscriptionPlan {                            // :71-82
  id: SubscriptionPlanId; name: string; description: string;
  price: number; yearlyPrice: number; features: readonly string[];
  limits: PlanLimits; additionalSitePrice: number | null; sortOrder: number;
}

// src/lib/stripe/plans.ts   (SERVER ONLY — opens a Supabase client on import)
getPlanCatalogue(): Promise<PlanCatalogue>;                                  // :330
clearPlanCatalogueCache(): void;                                             // :349
getPaidPlan(planId: PaidPlanId): Promise<SubscriptionPlan>;                  // :404 throws on unknown
findPlanById(planId: string | null): Promise<SubscriptionPlan | null>;       // :443 null, never `free`
resolveStripePriceId(planId: PaidPlanId, period: BillingPeriod): Promise<string>; // :476
resolveOneTimePriceId(productId: OneTimeProductId): Promise<string>;         // :514
getLifetimeGrantPlanId(): Promise<SubscriptionPlanId | null>;                // :456

// src/lib/feature-gating/permissions.ts
async function countOwnedSites(supabase, userId): Promise<number>;   // :79 — PRIVATE, throws on error
export async function canCreateWebsite(userId: string): Promise<FeaturePermission>; // :99

// src/lib/stripe/subscription.ts
export async function updateSubscription(
  userId: string,
  updates: { planId: PaidPlanId; billingPeriod?: BillingPeriod },
): Promise<{ subscription: Subscription; requiresAction: boolean; hostedInvoiceUrl: string | null }>; // :104

// src/lib/billing/effective-plan.ts
export async function resolveEntitlement(supabase, userId): Promise<Entitlement>; // :198
export type Entitlement =
  | { kind: "plan"; planId: string; plan: SubscriptionPlan }
  | { kind: "credits"; planId: null; plan: null }
  | { kind: "none";    planId: null; plan: null };

// src/lib/sites/embed-script.ts
export function getPublicAppUrl(): string;                              // :42
export function canonicalizePublicAppUrl(origin: string): string;       // :29
export function buildEmbedScript(p: { siteId; siteToken; appUrl?; wsUrl? }): string; // :83
```

### `npm run check:stripe`, precisely

`package.json:33-36`:

```
check:stripe       → node scripts/sync-stripe-catalogue.mjs --mode=test
check:stripe:live  → node scripts/sync-stripe-catalogue.mjs --mode=live
sync:stripe        → …--mode=test --apply
sync:stripe:live   → …--mode=live --apply
```

What it **asserts** (`sync-stripe-catalogue.mjs:214-283`), per entry in its own
`PRICE_ENV` literal:

- an active `plans` row exists for that id → else **blocker** (`:216-219`);
- the env var is set → else **blocker** (`:223-227`);
- `price.livemode` matches `--mode` → else **blocker** (`:233-236`);
- `price.unit_amount === expected` → else **blocker**, never auto-fixed, because Stripe
  amounts are immutable and the remedy is a new price id (`:238-247`);
- Stripe product `name` is `RecopyFast <plans.name>`, `description` equals
  `plans.description`, and `metadata.catalogue_id` equals the row id → **drift**,
  auto-corrected only under `--apply` (`:252-267`).

Yearly expectation is `monthly_equivalent × 12` in cents (`:170-177`).
Exit codes: `1` on any blocker or (dry-run) any drift; `2` on a missing/invalid
`--mode`; `0` only when everything it looked at matched.

**What it does not assert:** that every active subscription row in `plans` has a price
configured. It walks `PRICE_ENV`, not the catalogue.

---

## Traps & constraints

**T1 — `check:stripe` can pass while the Agency plan is entirely unverified. (Most important.)**
The script iterates `Object.entries(PRICE_ENV)` (`:214`), a literal duplicated inside
the `.mjs` and — contrary to its own comment at `:51` — guarded by no test, because
`scripts/__tests__` does not exist and jest only collects from `src/`. `PRICE_ID_ENV_VARS`
in `plans.ts` **is** compiler-enforced via `satisfies`; `PRICE_ENV` is not. An
implementer who widens `PaidPlanId`, seeds the row, sets the env vars and forgets the
`.mjs` gets `Stripe matches the catalogue.` and exit 0 — AC 9 passes vacuously, and the
first thing anyone learns about the Agency price being wrong is a customer paying it.

**T2 — the database CHECK rejects the plan before any code does, and the failure is silent-then-infinite.**
`billing_subscriptions_plan_valid` is `('starter','pro')`
(`20260803000000_retire_free_plan.sql:56-57`). The Stripe webhook writes
`plan: subscription.metadata?.plan_id || "pro"`
(`api/webhooks/stripe/route.ts:385`, `:417`). Without a widening migration, an Agency
checkout produces `plan='agency'` → 23514 → `assertWritten` throws → 500 → Stripe
retries forever, **card already charged on the first attempt, subscription row never
written, customer on nothing.** This is not hypothetical: it is verbatim what happened
to Starter, recorded at `20260802020000_plan_constraint_and_credit_collapse.sql:6-17`.
The migration must land **before or with** the code, never after.

**T3 — `PAID_PLAN_IDS` without a seeded row is a total outage.**
`loadPlanCatalogue:290-297` throws *"The plans table is missing active row(s)"* when any
`PAID_PLAN_IDS` member has no active row, and `getPlanCatalogue` is behind every pricing
render, every checkout and every feature gate. Deploying the type change ahead of the
migration takes the whole billing surface down at once, in every environment.
This is the code-before-schema inversion `20260803000000:5-11` was written to avoid.

**T4 — the downgrade guard must go before the Stripe call, and `always_invoice` is why.**
`proration_behavior: "always_invoice"` (`subscription.ts:146`) bills or credits
immediately. A guard placed after `stripe.subscriptions.update` would have to reverse a
completed invoice. The insertion point is between `:127` and `:142`. It must also treat
`limits.websites === -1` as always-allowed, and it must count via `site_permissions`
(`permission = 'admin'`), never `sites.user_id` — `permissions.ts:71-74` records that
the latter returned 42703, was discarded with the count, and let every quota check pass.
The guard must **throw rather than default to 0** for the same reason.

**T5 — `always_invoice` is also the reason "preserves grants" is nearly free but worth a test.**
Nothing in `updateSubscription` touches `sites`, `content_elements` or
`site_permissions`. AC 5 is an assertion about what *doesn't* happen; the value is in
the regression test, not the implementation.

**T6 — no hardcoded fallback catalogue. Ever.**
AGENTS.md non-negotiable 7 and `api/pricing/route.ts:18-23`. A previous fallback silently
served drifted prices at checkout. The temptation during this story is to add
`agency` to some client-side default so the pricing page renders before the seed lands.
Do not.

**T7 — the `plans` seed pattern is `ON CONFLICT DO UPDATE`, and it excludes price-id columns.**
`20260802000000:257-320`. A new migration must follow the same shape: repairing drift on
replay, while leaving `stripe_*_price_id_*` overrides intact.

**T8 — every tenant-scoped table needs RLS in the same migration that creates it.**
AGENTS.md non-negotiable 6; twelve migrations exist only to repair this. If the Agency
plan introduces any new table (it should not need one under decision 7 answer A), the
policy ships in the same file.

**T9 — the Stripe price *amount* is immutable.**
`sync-stripe-catalogue.mjs:238-247`. Getting the Agency price wrong in Stripe means
creating a new price and repointing the env var, in both accounts. Get the number from
decision 7 before creating anything at Stripe.

**T10 — `SubscriptionPlanId` still contains `free`.**
`plan-types.ts:30`. The row is deactivated (`20260803000000:24`) and normalised to
unentitled (`effective-plan.ts:37`), but the union member survives. Any exhaustive
`switch` on `SubscriptionPlanId` added by this story still has to handle it.

**T11 — checkout is serialized and credit spend is compare-and-swap.**
`src/lib/billing/checkout-reservation.ts`, `user-lock.ts`, per `architecture.md:272`
and commit `aca2eb2`. A new plan flows through the existing path; do not add a second
one.

**T12 — `sites.domain` is globally `UNIQUE`.**
`20250817000000_complete_database_setup.sql:18`. An agency registering many client sites
is fine; two accounts claiming the same domain is not, and `register/route.ts:107-118`
already refuses it. Worth knowing before anyone models "agency owns N sites".

---

## Open questions

### Q1 — **BLOCKING.** PRD open decision 7: who is billed?

`prd.md:444-446`, verbatim:

> **Agency plan shape.** Who is billed — agency only, or agency with client-paid
> upgrades? `s13-agency-plan` assumes agency-only, single invoice. Confirm before `s13`
> reaches `/ks-plan`.

This is not a detail. The two answers produce different data models and different
acceptance criteria.

**Answer A — agency-only, single invoice (what s13 assumes).**
No structural change. One `plans` row, one widened CHECK, one Stripe customer, one
subscription on the agency's `auth.users` id. Entitlement stays a per-**user** question:
`resolveEntitlement(supabase, userId)` (`effective-plan.ts:198`) is unchanged, `countOwnedSites`
is unchanged, `canCreateWebsite` is unchanged. **AC 7 is satisfied by doing nothing** —
billing is already per-user and sites are never invoiced individually. s13 stays a
catalogue-and-quota story.

**Answer B — agency with client-paid upgrades.** Every one of these changes:

1. **A payer identity distinct from the site owner must be recorded.** Today nothing
   answers "which subscription pays for this site". It needs either a
   `billing_subscription_id` column on `sites` or a join table
   (`subscription_sites`) — plus its RLS policy in the same migration (T8).
2. **Entitlement stops being a per-user question.** `resolveEntitlement(supabase, userId)`
   becomes `(userId, siteId)`. That function is the *shared* path named in s13's own
   Dependencies (`s01-trial-signup`) and is called from `src/middleware.ts` with a
   request-scoped client — so the change propagates into the router, not just the gates.
3. **`canCreateWebsite` loses its meaning.** It counts a user's `admin` rows against
   *one* plan's `limits.websites` (`permissions.ts:110-125`). Under B there is no single
   plan to count against.
4. **`getUserSubscription` picks the wrong row.** It takes the most recent live row for
   a user (`subscription.ts:301-313`); with two live subscriptions of different scope
   that is a coin flip. `billing_subscriptions` has no uniqueness on (user, scope).
5. **`resolveSiteOwnerId` (`permissions.ts:155`) answers the wrong question.** It resolves
   "whose plan pays for a seat"; under B that becomes "whose subscription covers this
   site", a different lookup with a different failure mode.
6. **AC 7 becomes false by construction.** "One invoice covers all sites" cannot hold if
   a client pays for their own upgrade. The criterion would have to be rewritten.
7. **Dunning, refunds and downgrade all need per-site resolution.** A client's card
   failing must not take the agency's other sites offline.

Under B, s13 is no longer complexity 4 or 5 under any reading — it is a re-architecture
of the entitlement path. **Planning must not start until this is answered.**

### Q2 — AC 4: does "offers additional sites" mean a message, or actual metered billing?

Today `canCreateWebsite` returns `allowed: false` at the limit **regardless** of
`additionalSitePrice`; the field only changes the denial text
(`permissions.ts:126-143`), and Pro already carries `additional_site_price = 5` and
still hard-refuses. So either:

- **(a)** AC 4 is already satisfied by the existing message — in which case it is a
  no-op and does not belong as an acceptance criterion; or
- **(b)** it means actually provisioning and billing the extra site, which requires
  Stripe subscription-item quantity sync, a webhook path to reconcile it, and a
  decrement on site delete. That is a third axis of Stripe work, not covered anywhere
  in the story's notes.

The wording *"rather than a hard refusal"* points at (b). If (b), s13 gains scope the
complexity score does not reflect, on top of M4.

### Q3 — Agency limits and price are unspecified.

The story says *"its own site limit, editor limit and monthly credit allowance"* and
names no numbers. `prd.md:387` says only *"N sites, client sub-accounts, branded
subdomain, bulk seat handoff, consolidated billing"*. Stripe amounts are immutable
(T9), so the number must be decided before anything is created at Stripe. Also needed:
`additional_site_price`, `sort_order` (Pro is 20, `credits` 30 — Agency likely 25 or a
renumber), the feature bullet list, and whether a yearly price exists (if not,
`price_yearly_monthly_equivalent` may be NULL and `toSubscriptionPlan:216-219` falls back
to the monthly price, but `PRICE_ID_ENV_VARS.agency.yearly` must then be omitted — which
`resolveStripePriceId:497-500` would dereference as `undefined` for a yearly request).

### Q4 — AC 9's live-mode half: is `check:stripe:live` runnable in this pipeline?

It needs `STRIPE_SECRET_KEY_LIVE` and live price ids present wherever the check runs
(`sync-stripe-catalogue.mjs:186-193` refuses a key whose prefix does not match the mode).
Is that an operator step outside CI, or is AC 9 expected to be automated? As written the
criterion cannot be closed by a test run.

### Q5 — the review's own cross-reference is off by two.

`docs/reviews/stories.md:152` says to fold the branded-subdomain split *"into the PRD's
open decision 5"*. Open decision 5 is the A/B conversion definition (`prd.md:427-429`);
the Agency-plan decision is **7** (`prd.md:444-446`). Cosmetic, but it will send a reader
to the wrong paragraph.

---

## Real complexity

**Re-scored: 5.** Up from the 4 in `stories.md:649`.

Under the PRD's own scale (`prd.md:129`): *"4 integrations, payments, roles · 5
real-time, migrations, external systems."*

The billing half alone is a defensible 4: payments plus an integration, on a live path.
It needs a migration, but so do several stories scored 4 here, so the migration is not
by itself what tips it.

What tips it is that AC 8 adds a **second, independent external-systems axis** with no
existing foundation:

- **Two external systems, not one.** Stripe (catalogue, immutable prices, proration,
  webhooks) and DNS + TLS + host routing. They fail differently and roll back
  differently: a wrong plan row is an `UPDATE`; a wrong wildcard certificate is an
  outage across every client site of every agency.
- **Zero foundation for the second axis.** Verified above: no serving path, no host
  routing, no origin registration, no cert handling. Two dead references and three
  tests about a *customer's* domain is the entire prior art.
- **A permanent, irreversible commitment per agency.** AGENTS.md non-negotiable 2 makes
  `/embed/recopyfast.js` a URL that can never move. A branded subdomain multiplies that
  promise by the number of agencies — and it survives the agency churning, because the
  snippet is on their clients' pages, not theirs.
- **AC 8 is not closable by a test in CI.** *"Content delivered through it is identical
  to content delivered through the default origin"* is a cross-origin equivalence
  assertion that needs a real second host with a real certificate. There is no way to
  make it green in `jest` or against `localhost:3000`. A story with a criterion that
  cannot be tested is not one shippable slice.
- **Blast radius on shared code.** The origin threading touches
  `src/lib/security/site-auth.ts`'s neighbourhood and `src/lib/sites/embed-script.ts`,
  both of which `s02` and `s07` build on. Two stories editing the origin model
  concurrently is the kind of collision the pipeline exists to prevent.

The reviewer reached the same 5 by a different route (`reviews/stories.md:144-152`).
Independently checking the code, I agree, and a 5 must be split.

---

## Split proposal

**Cut line: exactly at AC 8.** Everything else in the story is one coherent slice about
money and quotas; AC 8 is a different problem wearing the same plan's name.

### `s13-agency-plan` — one subscription for all my client sites · complexity **4**

Keeps AC 1, 2, 3, 4, 5, 6, 7, 9. Dependency unchanged: `s01-trial-signup`.

**Closes on its own as:** an agency buys the Agency plan from the public pricing page at
a live Stripe amount; registers sites up to its limit, enforced by the existing gate;
upgrades from Pro with all sites, content and grants intact and Stripe prorating the
difference; is refused a downgrade below its site count *before* anything is charged,
with the number of sites to remove named; and receives one invoice for the account.
That is a complete, sellable, demonstrable outcome — it is the thing the PRD calls
*"the single largest GTM gap in the product today"* (`prd.md:392-393`) — and every
criterion is testable with `jest` plus a Stripe test-mode key.

**Risk (revised):** unchanged from the story, plus T2 — the `billing_subscriptions`
CHECK must widen in the same deploy, or an Agency checkout charges the card and never
writes the subscription, exactly as happened to Starter.

### `s20-agency-branded-subdomain` — serve a client's site from the agency's own name · complexity **4**

Takes AC 8 alone. **Depends on `s13-agency-plan`** (there is no plan to attach a
subdomain to until s13 lands). Graph edge: `s13 ──> s20`, parallel to `s13 ──> s14`.

**Closes on its own as:** an agency on the Agency plan claims a subdomain; new snippets
issued for that agency's sites point at it; a client page loading the widget from the
branded origin renders and saves content byte-identical to the same page loaded from the
default origin; and the default origin keeps working for every snippet already issued.

**Why 4, not the 3 the review floated** (`reviews/stories.md:152` says "3-4"): the
permanent-URL non-negotiable makes every issued subdomain irreversible, the origin has
to be threaded through three snippet call sites plus the content-route CORS grant plus
the auth-redirect resolver, and the acceptance test needs live wildcard DNS and a
wildcard certificate. It is not real-time and it is not a second payments integration,
so it is not a 5 — but it is not a 3 either.

**Must be recorded in its notes:**
- Wildcard host + wildcard TLS is an operator/Vercel decision, not code. Settle it before `/ks-plan`.
- `canonicalizePublicAppUrl` (`embed-script.ts:26-38`) exists because *"Browser CORS
  preflights cannot follow that redirect"* — any branded host must be canonical from the
  first byte, never a redirect target.
- Under the *customer's* CSP, a site with `script-src https://www.recopyfa.st` breaks the
  moment its snippet moves to a branded host. Existing installs must not be rewritten
  silently.
- The `Origin` pin in `site-auth.ts:151-158` is against `sites.domain` — the customer's
  domain — and is **not** what changes here. Say so, or an implementer will "fix" a
  control that is working.

### What the split does **not** change

- `s14-agency-client-handoff` continues to depend on `s13`, not on `s20`.
- The "client sub-accounts are deliberately not in this story" note stays with `s13`
  (`stories.md:684-687`) — that decision is about the org-teams graveyard and is unrelated
  to the subdomain.
- PRD open decision 7 blocks **both** halves. `s20` inherits the blocker because it
  attaches to whatever the Agency plan turns out to be.

---

## M4 — the branded subdomain criterion

**Verdict: M4 is correct. `s13` as written is a 5. The split is mandatory, and the cut
line is AC 8.**

I reached this from the code rather than from the review, and the code is
unambiguous. The grep the reviewer ran reproduces exactly: `subdomain|custom_domain|
customDomain` across `src/` returns `src/types/index.ts:472` and three test files —
and extending the search to `supabase/`, `public/` and `server/` adds only
`supabase/analytics-schema.sql:230`, which is not in `supabase/migrations/` and is
therefore not applied. There is no serving path, no DNS handling, no certificate
handling and no origin registration anywhere in the repository.

Three things make it a second axis rather than one more criterion:

1. **The embed origin is a process-wide constant.** `getPublicAppUrl()`
   (`embed-script.ts:42-45`) reads one env var; `canonicalizePublicAppUrl` (`:26-38`)
   hardcodes a single apex→www rewrite whose comment records that *"Browser CORS
   preflights cannot follow that redirect, so a snippet that points at recopyfa.st makes
   the widget look dead on every customer site."* Making that per-account is not a
   parameter change; it is a new concept — a tenant-scoped serving origin — threaded
   through three snippet call sites, the content route's CORS grant
   (`api/content/[siteId]/route.ts:172-188`), our CSP (`middleware.ts:196-256`), the
   auth-redirect resolver (`auth/public-origin.ts:69-110`) and the Stripe return-URL
   builder (`stripe/checkout.ts:68-83`).

2. **It is irreversible in a way the billing half is not.** AGENTS.md non-negotiable 2:
   `/embed/recopyfast.js` *"is already baked into every snippet ever issued. It can never
   move or break for existing installs."* Every branded subdomain issued inherits that
   promise, and it outlives the agency's subscription, because the snippet lives on their
   clients' pages. A wrong plan row is one `UPDATE`; a wrong or withdrawn wildcard
   certificate is silent breakage across every client site of every agency, on domains
   we do not control, with — by design — no error surface (`architecture.md:298-300`).

3. **The criterion cannot be made green in CI.** *"Content delivered through it is
   identical to content delivered through the default origin"* requires a second real
   host with a real certificate. Nothing in `jest`, and nothing pointed at
   `localhost:3000`, can assert it. A criterion that cannot become a test violates the
   backlog's own standard (`reviews/stories.md:39`) and would be signed off on a
   reviewer's judgement rather than on evidence.

**One correction to M4's remediation.** It says to *"fold it into the PRD's open decision
5"*. The Agency-plan decision is **7** (`prd.md:444-446`); decision 5 is the A/B
conversion definition. The instruction is right, the pointer is not.

**One refinement.** M4 suggests the new story is "complexity 3-4". I score it **4**, for
the reasons in the split proposal: irreversible per-tenant URLs, five surfaces to thread
the origin through, and an acceptance test that needs live infrastructure.

The other half of the prior M5 fix — recording client sub-accounts as deliberately
dropped — is sound and stays with `s13`.
