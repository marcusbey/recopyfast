import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/config";
import { SUBSCRIPTION_PLANS } from "@/lib/stripe/config";

// 5-minute in-memory cache
let cachedResponse: { data: PricingResponse; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface PlanData {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  features: readonly string[] | string[];
  highlight: boolean;
  badge: string | null;
  cta: string;
}

interface PricingResponse {
  plans: PlanData[];
  fetchedAt: string;
  source: "stripe" | "fallback";
}

const PLAN_META: Record<
  string,
  { highlight: boolean; badge: string | null; cta: string }
> = {
  starter: { highlight: false, badge: null, cta: "Get started" },
  pro: { highlight: true, badge: "Popular", cta: "Start free trial" },
  enterprise: { highlight: false, badge: null, cta: "Contact sales" },
};

function buildFallbackResponse(): PricingResponse {
  const plans: PlanData[] = (["STARTER", "PRO", "ENTERPRISE"] as const).map(
    (key) => {
      const plan = SUBSCRIPTION_PLANS[key];
      const meta = PLAN_META[plan.id];
      return {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        monthlyPrice: plan.price,
        yearlyPrice: plan.yearlyPrice,
        currency: "usd",
        features: [...plan.features],
        highlight: meta.highlight,
        badge: meta.badge,
        cta: meta.cta,
      };
    },
  );

  return {
    plans,
    fetchedAt: new Date().toISOString(),
    source: "fallback",
  };
}

async function fetchStripePrices(): Promise<PricingResponse> {
  const planKeys = ["STARTER", "PRO", "ENTERPRISE"] as const;
  const plans: PlanData[] = [];

  for (const key of planKeys) {
    const plan = SUBSCRIPTION_PLANS[key];
    const meta = PLAN_META[plan.id];

    let monthlyPrice = plan.price;
    let yearlyPrice = plan.yearlyPrice;
    let currency = "usd";

    try {
      if (plan.priceId) {
        const monthlyStripePrice = await stripe.prices.retrieve(plan.priceId);
        if (monthlyStripePrice.unit_amount != null) {
          monthlyPrice = monthlyStripePrice.unit_amount / 100;
        }
        if (monthlyStripePrice.currency) {
          currency = monthlyStripePrice.currency;
        }
      }

      if (plan.yearlyPriceId) {
        const yearlyStripePrice = await stripe.prices.retrieve(
          plan.yearlyPriceId,
        );
        if (yearlyStripePrice.unit_amount != null) {
          // Yearly prices are stored as total annual amount; convert to monthly
          const yearlyTotal = yearlyStripePrice.unit_amount / 100;
          yearlyPrice = Math.round((yearlyTotal / 12) * 100) / 100;
        }
      }
    } catch {
      // If individual price fetch fails, keep config fallback values
    }

    plans.push({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      monthlyPrice,
      yearlyPrice,
      currency,
      features: [...plan.features],
      highlight: meta.highlight,
      badge: meta.badge,
      cta: meta.cta,
    });
  }

  return {
    plans,
    fetchedAt: new Date().toISOString(),
    source: "stripe",
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control":
      "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET() {
  try {
    // Return cached response if fresh
    if (
      cachedResponse &&
      Date.now() - cachedResponse.timestamp < CACHE_TTL_MS
    ) {
      return NextResponse.json(cachedResponse.data, { headers: corsHeaders() });
    }

    let data: PricingResponse;
    try {
      data = await fetchStripePrices();
    } catch {
      data = buildFallbackResponse();
    }

    cachedResponse = { data, timestamp: Date.now() };
    return NextResponse.json(data, { headers: corsHeaders() });
  } catch {
    // Last-resort fallback
    const fallback = buildFallbackResponse();
    return NextResponse.json(fallback, { headers: corsHeaders() });
  }
}
