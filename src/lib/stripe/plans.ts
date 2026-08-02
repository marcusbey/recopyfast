import { createServiceRoleClient } from "@/lib/supabase/service";
import { selectByMode, stripeEnvVar } from "./mode";
import {
  isPaidPlanId,
  isSubscriptionPlanId,
  PAID_PLAN_IDS,
  type BillingPeriod,
  type CreditPackConfig,
  type OneTimeProduct,
  type OneTimeProductId,
  type PaidPlanId,
  type PlanCatalogue,
  type PlanLimits,
  type SubscriptionPlan,
  type SubscriptionPlanId,
} from "./plan-types";

/**
 * Loads the plan catalogue from the `plans` table.
 *
 * SERVER ONLY. It opens a Supabase client, so importing it from a client
 * component drags the SDK into the browser bundle. Client components take plan
 * data as props or fetch `/api/pricing`; the shapes and the price arithmetic
 * they need live in `./plan-types`, which is safe to import anywhere.
 *
 * Nothing here hardcodes a price, a limit or a feature bullet — those are rows.
 * See supabase/migrations/20260802000000_plans_catalog.sql for the schema and
 * for why Stripe price ids default to the environment.
 */

export * from "./plan-types";

/**
 * Plans change a few times a year and every checkout, pricing render and
 * feature gate reads them, so the catalogue is cached for the process rather
 * than re-queried per request. The TTL bounds how long a seed change takes to
 * appear without needing a deploy or a cache-busting endpoint.
 */
const CATALOGUE_TTL_MS = 5 * 60 * 1000;

interface CachedCatalogue {
  catalogue: PlanCatalogue;
  loadedAt: number;
}

let cache: CachedCatalogue | null = null;
/**
 * Concurrent callers share one query. Without this, a cold serverless instance
 * handling a burst would fire one SELECT per in-flight request.
 */
let inFlight: Promise<PlanCatalogue> | null = null;

/**
 * Environment variable holding each plan's Stripe price id.
 *
 * These are variable *names*, not pricing configuration: the amounts live in
 * the database, while the id that points at Stripe's copy of them belongs with
 * the secret key it has to match. A populated `stripe_*_price_id_*` column
 * overrides the environment — see the migration header for the reasoning.
 *
 * `STRIPE_TICKETS_PRICE_ID` keeps its name even though the product is now
 * called Credits: the variable is configured outside this repository, in Vercel
 * and in every developer's .env, and renaming it here would break checkout in
 * every environment the moment this deploys.
 */
const PRICE_ID_ENV_VARS = {
  starter: {
    monthly: {
      test: "STRIPE_STARTER_PRICE_ID",
      live: "STRIPE_STARTER_PRICE_ID_LIVE",
    },
    yearly: {
      test: "STRIPE_STARTER_YEARLY_PRICE_ID",
      live: "STRIPE_STARTER_YEARLY_PRICE_ID_LIVE",
    },
  },
  pro: {
    monthly: { test: "STRIPE_PRO_PRICE_ID", live: "STRIPE_PRO_PRICE_ID_LIVE" },
    yearly: {
      test: "STRIPE_PRO_YEARLY_PRICE_ID",
      live: "STRIPE_PRO_YEARLY_PRICE_ID_LIVE",
    },
  },
  credits: {
    monthly: {
      test: "STRIPE_TICKETS_PRICE_ID",
      live: "STRIPE_TICKETS_PRICE_ID_LIVE",
    },
  },
  lifetime_pro: {
    monthly: {
      test: "STRIPE_LIFETIME_PRICE_ID",
      live: "STRIPE_LIFETIME_PRICE_ID_LIVE",
    },
  },
} as const satisfies Record<
  PaidPlanId | OneTimeProductId,
  { monthly: EnvPair; yearly?: EnvPair }
>;

interface EnvPair {
  test: string;
  live: string;
}

/** Row shape of `plans`, as PostgREST returns it. */
interface PlanRow {
  id: string;
  kind: string;
  name: string;
  description: string;
  price_monthly: string | number;
  price_yearly_monthly_equivalent: string | number | null;
  stripe_price_id_test: string | null;
  stripe_price_id_live: string | null;
  stripe_yearly_price_id_test: string | null;
  stripe_yearly_price_id_live: string | null;
  limits: Record<string, unknown>;
  features: unknown;
  additional_site_price: string | number | null;
  grants_plan_id: string | null;
  is_active: boolean;
  sort_order: number;
}

/**
 * NUMERIC columns arrive as strings from PostgREST — `9.00`, not `9` — because
 * JavaScript numbers cannot represent every NUMERIC exactly. Every price is
 * well inside float range, so parsing is safe, but doing it implicitly is not:
 * `"9.00" * 12` works while `"9.00" + 12` yields `"9.0012"`.
 */
function toNumber(value: string | number | null, field: string): number {
  if (value === null) {
    throw new Error(`plans.${field} is null where a number is required`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`plans.${field} is not a finite number: ${String(value)}`);
  }
  return parsed;
}

function toOptionalNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFeatures(value: unknown, planId: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`plans.features for "${planId}" is not an array`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(
        `plans.features for "${planId}" contains a non-string entry`,
      );
    }
    return entry;
  });
}

function requireNumber(
  limits: Record<string, unknown>,
  key: string,
  planId: string,
): number {
  const value = limits[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`plans.limits.${key} for "${planId}" is not a number`);
  }
  return value;
}

function requireBoolean(
  limits: Record<string, unknown>,
  key: string,
  planId: string,
): boolean {
  const value = limits[key];
  if (typeof value !== "boolean") {
    throw new Error(`plans.limits.${key} for "${planId}" is not a boolean`);
  }
  return value;
}

/**
 * The `limits` JSON uses snake_case (SQL convention); the gates read camelCase
 * (TypeScript convention). This is the single translation point.
 */
function toPlanLimits(
  limits: Record<string, unknown>,
  planId: string,
): PlanLimits {
  return {
    websites: requireNumber(limits, "websites", planId),
    collaborators: requireNumber(limits, "collaborators", planId),
    aiFeatures: requireBoolean(limits, "ai_features", planId),
    translations: requireNumber(limits, "translations", planId),
    abTesting: requireBoolean(limits, "ab_testing", planId),
    monthlyCredits: requireNumber(limits, "monthly_credits", planId),
  };
}

function toSubscriptionPlan(row: PlanRow): SubscriptionPlan {
  if (!isSubscriptionPlanId(row.id)) {
    throw new Error(
      `plans row "${row.id}" is kind=subscription but is not a known plan id`,
    );
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: toNumber(row.price_monthly, `price_monthly (${row.id})`),
    // A subscription with no annual option falls back to its monthly price so
    // the yearly toggle degrades to "same price" rather than to NaN.
    yearlyPrice:
      toOptionalNumber(row.price_yearly_monthly_equivalent) ??
      toNumber(row.price_monthly, `price_monthly (${row.id})`),
    features: toFeatures(row.features, row.id),
    limits: toPlanLimits(row.limits, row.id),
    additionalSitePrice: toOptionalNumber(row.additional_site_price),
    sortOrder: row.sort_order,
  };
}

function isOneTimeProductId(value: string): value is OneTimeProductId {
  return value === "credits" || value === "lifetime_pro";
}

function toOneTimeProduct(row: PlanRow): OneTimeProduct {
  if (!isOneTimeProductId(row.id)) {
    throw new Error(
      `plans row "${row.id}" is kind=one_time but is not a known product id`,
    );
  }
  if (
    row.grants_plan_id !== null &&
    !isSubscriptionPlanId(row.grants_plan_id)
  ) {
    throw new Error(
      `plans."${row.id}".grants_plan_id points at unknown plan "${row.grants_plan_id}"`,
    );
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: toNumber(row.price_monthly, `price_monthly (${row.id})`),
    features: toFeatures(row.features, row.id),
    grantsPlanId: row.grants_plan_id,
    sortOrder: row.sort_order,
  };
}

/**
 * Raw rows, kept alongside the parsed catalogue so `resolveStripePriceId` can
 * consult the per-plan overrides without a second query.
 */
let priceIdOverrides: Map<string, PlanRow> = new Map();

async function loadPlanCatalogue(): Promise<PlanCatalogue> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<PlanRow[]>();

  if (error) {
    throw new Error(`Failed to load the plan catalogue: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(
      "The plans table is empty. Run the migrations — pricing, checkout and " +
        "feature gating all read from it.",
    );
  }

  const subscriptions = data
    .filter((row) => row.kind === "subscription")
    .map(toSubscriptionPlan);
  const oneTimeProducts = data
    .filter((row) => row.kind === "one_time")
    .map(toOneTimeProduct);

  // The PaidPlanId union is what every API boundary validates against, so a
  // seed that no longer contains one of them has to fail loudly here rather
  // than at the moment a customer clicks Upgrade.
  const seededIds = new Set(subscriptions.map((plan) => plan.id));
  const missing = PAID_PLAN_IDS.filter((id) => !seededIds.has(id));
  if (missing.length > 0) {
    throw new Error(
      `The plans table is missing active row(s): ${missing.join(", ")}`,
    );
  }

  priceIdOverrides = new Map(data.map((row) => [row.id, row]));

  const creditsRow = data.find((row) => row.id === "credits");
  if (!creditsRow) {
    throw new Error('The plans table has no active "credits" product row');
  }

  const creditsProduct = oneTimeProducts.find(
    (product) => product.id === "credits",
  );

  return {
    subscriptions,
    oneTimeProducts,
    creditPack: {
      creditsPerPack: requireNumber(
        creditsRow.limits,
        "credits_per_pack",
        "credits",
      ),
      maxPacksPerPurchase: requireNumber(
        creditsRow.limits,
        "max_packs_per_purchase",
        "credits",
      ),
      pricePerPack: creditsProduct?.price ?? 0,
    },
  };
}

export async function getPlanCatalogue(): Promise<PlanCatalogue> {
  if (cache && Date.now() - cache.loadedAt < CATALOGUE_TTL_MS) {
    return cache.catalogue;
  }

  // A failed load must not poison the next attempt, so `inFlight` is cleared in
  // both directions and the stale cache (if any) is left untouched.
  inFlight ??= loadPlanCatalogue()
    .then((catalogue) => {
      cache = { catalogue, loadedAt: Date.now() };
      return catalogue;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Drops the cached catalogue. Used by tests and after a seed change. */
export function clearPlanCatalogueCache(): void {
  cache = null;
  inFlight = null;
  priceIdOverrides = new Map();
}

export async function getSubscriptionPlans(): Promise<
  readonly SubscriptionPlan[]
> {
  return (await getPlanCatalogue()).subscriptions;
}

export async function getOneTimeProducts(): Promise<readonly OneTimeProduct[]> {
  return (await getPlanCatalogue()).oneTimeProducts;
}

/**
 * Any subscription plan by id, including `free`.
 */
export async function getSubscriptionPlan(
  planId: SubscriptionPlanId,
): Promise<SubscriptionPlan> {
  const plans = await getSubscriptionPlans();
  const plan = plans.find((candidate) => candidate.id === planId);
  if (!plan) {
    throw new Error(`Unknown plan: ${planId}`);
  }
  return plan;
}

/**
 * The active catalogue row a subscription or entitlement names, or null.
 *
 * Takes a plain string because `billing_subscriptions.plan` is free text at the
 * database level — a plan retired years ago can still be sitting in an old row.
 * Such a row resolves to null rather than to `free`: there is no free plan to
 * fall back to, and inventing one is how an account that had never paid ended
 * up holding a real-looking SubscriptionPlan.
 */
export async function findPlanById(
  planId: string | null | undefined,
): Promise<SubscriptionPlan | null> {
  if (!planId) {
    return null;
  }
  const plans = await getSubscriptionPlans();
  return plans.find((plan) => plan.id === planId) ?? null;
}

/**
 * Plan config for a paid plan id. Throws on unknown ids so callers never
 * silently fall through to the FREE plan.
 */
export async function getPaidPlan(
  planId: PaidPlanId,
): Promise<SubscriptionPlan> {
  if (!isPaidPlanId(planId)) {
    throw new Error(`Unknown plan: ${planId}`);
  }
  return getSubscriptionPlan(planId);
}

/**
 * Monthly-equivalent display price for a plan/period pair.
 */
export async function getPlanDisplayPrice(
  planId: PaidPlanId,
  billingPeriod: BillingPeriod,
): Promise<number> {
  const plan = await getPaidPlan(planId);
  return billingPeriod === "yearly" ? plan.yearlyPrice : plan.price;
}

/**
 * Total charged per billing cycle (yearly plans bill 12x the monthly-equivalent
 * price once per year).
 */
export async function getPlanCyclePrice(
  planId: PaidPlanId,
  billingPeriod: BillingPeriod,
): Promise<number> {
  const plan = await getPaidPlan(planId);
  return billingPeriod === "yearly"
    ? Math.round(plan.yearlyPrice * 12 * 100) / 100
    : plan.price;
}

export async function getOneTimeProduct(
  productId: OneTimeProductId,
): Promise<OneTimeProduct> {
  const products = await getOneTimeProducts();
  const product = products.find((candidate) => candidate.id === productId);
  if (!product) {
    throw new Error(`Unknown one-time product: ${productId}`);
  }
  return product;
}

/**
 * Credit-pack sizing and price, for the purchase dialog and checkout.
 */
export async function getCreditPackConfig(): Promise<CreditPackConfig> {
  return (await getPlanCatalogue()).creditPack;
}

/**
 * Subscription plan that Lifetime Pro confers, or null if it is not on sale.
 */
export async function getLifetimeGrantPlanId(): Promise<SubscriptionPlanId | null> {
  const products = await getOneTimeProducts();
  return (
    products.find((product) => product.id === "lifetime_pro")?.grantsPlanId ??
    null
  );
}

/**
 * Stripe price id for a plan/period pair.
 *
 * Precedence is database column first, environment second: the column exists so
 * a single price can be repointed without a deploy, but the environment is the
 * normal home for it because a price id is scoped to one Stripe account and
 * every developer and preview deployment has a different one.
 *
 * Which mode's column/variable is read is decided by ./mode, never by NODE_ENV.
 */
export async function resolveStripePriceId(
  planId: PaidPlanId,
  billingPeriod: BillingPeriod,
): Promise<string> {
  // Ensures priceIdOverrides is populated even on a cache hit path that has
  // never loaded in this process.
  const plan = await getPaidPlan(planId);
  const row = priceIdOverrides.get(planId);

  const override =
    billingPeriod === "yearly"
      ? selectByMode({
          test: row?.stripe_yearly_price_id_test,
          live: row?.stripe_yearly_price_id_live,
        })
      : selectByMode({
          test: row?.stripe_price_id_test,
          live: row?.stripe_price_id_live,
        });

  const envPair =
    billingPeriod === "yearly"
      ? PRICE_ID_ENV_VARS[planId].yearly
      : PRICE_ID_ENV_VARS[planId].monthly;

  const { name, value } = stripeEnvVar(envPair);
  const priceId = override || value;

  if (!priceId) {
    throw new Error(
      `No Stripe price configured for the ${plan.name} plan (${billingPeriod}). ` +
        `Set ${name}, or populate the matching column on plans."${planId}".`,
    );
  }
  return priceId;
}

/**
 * Stripe price id for a one-time product. Same precedence as above.
 */
export async function resolveOneTimePriceId(
  productId: OneTimeProductId,
): Promise<string> {
  const product = await getOneTimeProduct(productId);
  const row = priceIdOverrides.get(productId);

  const override = selectByMode({
    test: row?.stripe_price_id_test,
    live: row?.stripe_price_id_live,
  });

  const envPair = PRICE_ID_ENV_VARS[productId].monthly;
  const { name, value } = stripeEnvVar(envPair);
  const priceId = override || value;

  if (!priceId) {
    throw new Error(
      `No Stripe price configured for ${product.name}. Set ${name}, or ` +
        `populate the matching stripe_price_id column on plans."${productId}".`,
    );
  }
  return priceId;
}
