import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/config";
import {
  getPlanCatalogue,
  resolveOneTimePriceId,
  resolveStripePriceId,
  isPaidPlanId,
} from "@/lib/stripe/plans";
import type { OneTimeProduct, SubscriptionPlan } from "@/lib/stripe/plans";

/**
 * Public pricing feed.
 *
 * The database is the source of truth for what a plan costs and includes. Live
 * Stripe prices are layered on top when they can be read, because Stripe is
 * what the customer is actually charged and a drift between the two would show
 * up as a price change at checkout.
 *
 * There is deliberately no hardcoded fallback catalogue. The previous version
 * kept one, which meant a database outage served stale prices to customers with
 * no indication anything was wrong — and it was that duplicate copy that had
 * silently drifted from the real plan config in the first place.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedResponse: { data: PricingResponse; timestamp: number } | null = null;

interface PlanPayload {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  features: string[];
  limits: SubscriptionPlan["limits"];
  additionalSitePrice: number | null;
  highlight: boolean;
  badge: string | null;
  cta: string;
}

interface OneTimeProductPayload {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  features: string[];
  grantsPlanId: string | null;
}

interface PricingResponse {
  plans: PlanPayload[];
  oneTimeProducts: OneTimeProductPayload[];
  fetchedAt: string;
  /** "stripe" when live amounts were read, "database" when the seed was used. */
  source: "stripe" | "database";
}

/**
 * Presentation only — which card is emphasised and what its button says. These
 * are not prices, limits or features, so they stay in the layer that renders
 * them rather than in the billing catalogue.
 */
const PLAN_META: Record<
  string,
  { highlight: boolean; badge: string | null; cta: string }
> = {
  free: { highlight: false, badge: null, cta: "Get started" },
  starter: { highlight: false, badge: null, cta: "Get started" },
  pro: { highlight: true, badge: "Most popular", cta: "Get started" },
};

const DEFAULT_META = {
  highlight: false,
  badge: null,
  cta: "Get started",
} as const;

const DEFAULT_CURRENCY = "usd";

interface StripeAmounts {
  monthlyPrice?: number;
  yearlyPrice?: number;
  currency?: string;
}

/**
 * Live amounts for one plan, or an empty object if Stripe cannot answer.
 *
 * A failure here is not fatal: the seeded price is what we advertise and what
 * the checkout session is built from, so falling back to it is correct rather
 * than merely convenient.
 */
async function readStripeAmounts(
  plan: SubscriptionPlan,
): Promise<StripeAmounts> {
  if (!isPaidPlanId(plan.id)) {
    return {};
  }

  const amounts: StripeAmounts = {};

  try {
    const monthly = await stripe.prices.retrieve(
      await resolveStripePriceId(plan.id, "monthly"),
    );
    if (monthly.unit_amount != null) {
      amounts.monthlyPrice = monthly.unit_amount / 100;
    }
    if (monthly.currency) {
      amounts.currency = monthly.currency;
    }
  } catch {
    // Keep the database value.
  }

  try {
    const yearly = await stripe.prices.retrieve(
      await resolveStripePriceId(plan.id, "yearly"),
    );
    if (yearly.unit_amount != null) {
      // Stripe stores the annual total; the UI shows the monthly equivalent.
      amounts.yearlyPrice =
        Math.round((yearly.unit_amount / 100 / 12) * 100) / 100;
    }
  } catch {
    // Keep the database value.
  }

  return amounts;
}

async function readStripeOneTimeAmount(
  product: OneTimeProduct,
): Promise<number | undefined> {
  try {
    const price = await stripe.prices.retrieve(
      await resolveOneTimePriceId(product.id),
    );
    return price.unit_amount != null ? price.unit_amount / 100 : undefined;
  } catch {
    return undefined;
  }
}

function toPlanPayload(
  plan: SubscriptionPlan,
  amounts: StripeAmounts,
): PlanPayload {
  const meta = PLAN_META[plan.id] ?? DEFAULT_META;
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    monthlyPrice: amounts.monthlyPrice ?? plan.price,
    yearlyPrice: amounts.yearlyPrice ?? plan.yearlyPrice,
    currency: amounts.currency ?? DEFAULT_CURRENCY,
    features: [...plan.features],
    limits: plan.limits,
    additionalSitePrice: plan.additionalSitePrice,
    highlight: meta.highlight,
    badge: meta.badge,
    cta: meta.cta,
  };
}

async function buildPricingResponse(): Promise<PricingResponse> {
  const catalogue = await getPlanCatalogue();

  // The free plan is the absence of a subscription, not something to sell.
  const sellablePlans = catalogue.subscriptions.filter(
    (plan) => plan.id !== "free",
  );

  const planAmounts = await Promise.all(sellablePlans.map(readStripeAmounts));
  const productAmounts = await Promise.all(
    catalogue.oneTimeProducts.map(readStripeOneTimeAmount),
  );

  const sawStripePrice =
    planAmounts.some((amounts) => amounts.monthlyPrice !== undefined) ||
    productAmounts.some((amount) => amount !== undefined);

  return {
    plans: sellablePlans.map((plan, index) =>
      toPlanPayload(plan, planAmounts[index]),
    ),
    oneTimeProducts: catalogue.oneTimeProducts.map((product, index) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      price: productAmounts[index] ?? product.price,
      currency: DEFAULT_CURRENCY,
      features: [...product.features],
      grantsPlanId: product.grantsPlanId,
    })),
    fetchedAt: new Date().toISOString(),
    source: sawStripePrice ? "stripe" : "database",
  };
}

/**
 * Allowed origins for the pricing feed.
 *
 * Was `*`. The response is public, non-personalised marketing data, so the
 * wildcard leaked nothing — but it also let any site embed our live pricing,
 * and a wildcard is the kind of default that gets copied onto the next endpoint
 * that does carry customer data.
 *
 * Restricted to this app's own origin. The embed script does NOT consume this
 * route (it talks to /api/content and the socket server), so nothing
 * cross-origin breaks; if a customer-domain consumer ever appears it needs an
 * explicit entry here rather than a wildcard.
 */
function allowedOrigin(request: Request): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const origin = request.headers.get("origin");

  if (!origin) return configured ?? null;
  return configured && origin === configured ? origin : null;
}

function corsHeaders(request: Request) {
  const origin = allowedOrigin(request);

  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control":
      "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export async function GET(request: Request) {
  const headers = corsHeaders(request);

  if (cachedResponse && Date.now() - cachedResponse.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cachedResponse.data, { headers });
  }

  try {
    const data = await buildPricingResponse();
    cachedResponse = { data, timestamp: Date.now() };
    return NextResponse.json(data, { headers });
  } catch (error: unknown) {
    console.error("Failed to build the pricing response:", error);

    // Serving a stale catalogue beats serving nothing on the marketing page,
    // and the cached copy came from the same database.
    if (cachedResponse) {
      return NextResponse.json(cachedResponse.data, { headers });
    }

    return NextResponse.json(
      { error: "Pricing is temporarily unavailable" },
      { status: 503, headers },
    );
  }
}
