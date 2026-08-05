import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createCheckoutSession,
  getCheckoutSessionStatus,
  type CheckoutIntent,
} from "@/lib/stripe/checkout";
import { getUserSubscription } from "@/lib/stripe/subscription";
import {
  getCreditPackConfig,
  getLifetimeGrantPlanId,
  isBillingPeriod,
  isPaidPlanId,
} from "@/lib/stripe/plans";
import { getEffectivePlanId } from "@/lib/billing/entitlements";

/**
 * Stripe Checkout entry point.
 *
 * POST creates a hosted Checkout Session and returns its URL; the browser
 * redirects there. GET reads a finished session back so the UI can wait for the
 * Stripe webhook to reconcile our database before it claims success.
 */

interface CheckoutRequestBody {
  intent?: unknown;
  planId?: unknown;
  billingPeriod?: unknown;
  quantity?: unknown;
}

type ParsedIntent =
  | { ok: true; intent: CheckoutIntent }
  | { ok: false; error: string };

async function parseIntent(body: CheckoutRequestBody): Promise<ParsedIntent> {
  switch (body.intent) {
    case "subscription": {
      if (!isPaidPlanId(body.planId)) {
        return { ok: false, error: "Invalid plan ID" };
      }
      const billingPeriod = body.billingPeriod ?? "monthly";
      if (!isBillingPeriod(billingPeriod)) {
        return { ok: false, error: "Invalid billing period" };
      }
      return {
        ok: true,
        intent: { type: "subscription", planId: body.planId, billingPeriod },
      };
    }

    case "credits": {
      const { maxPacksPerPurchase } = await getCreditPackConfig();
      const quantity = body.quantity;
      if (
        typeof quantity !== "number" ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > maxPacksPerPurchase
      ) {
        return {
          ok: false,
          error: `Invalid quantity. Must be a whole number between 1 and ${maxPacksPerPurchase}.`,
        };
      }
      return { ok: true, intent: { type: "credits", quantity } };
    }

    case "lifetime":
      return { ok: true, intent: { type: "lifetime" } };

    case "payment_method":
      return { ok: true, intent: { type: "payment_method" } };

    default:
      return { ok: false, error: "Invalid checkout intent" };
  }
}

/**
 * POST /api/billing/checkout
 * Body: { intent: "subscription" | "credits" | "lifetime" | "payment_method", ... }
 * Returns: { url, sessionId }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as CheckoutRequestBody;
    const parsed = await parseIntent(body);

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    // A customer who already pays us changes plans through
    // PUT /api/billing/subscription (proration), not a second Checkout.
    if (parsed.intent.type === "subscription") {
      const existingSubscription = await getUserSubscription(user.id);
      if (existingSubscription) {
        return NextResponse.json(
          {
            error:
              "You already have a subscription. Use the upgrade flow to change plans.",
          },
          { status: 409 },
        );
      }
    }

    // Lifetime is bought once and never lapses, so a second purchase takes $199
    // for something the customer already owns outright — and the grant is
    // keyed on the payment intent, so the duplicate would not even be
    // deduplicated on the way back in: they would simply be $199 poorer.
    //
    // `LifetimeOfferCard` already hides the offer in this state, but that is a
    // rendering decision and this is a money decision. The subscription intent
    // above has always enforced its own precondition server-side rather than
    // trusting the dialog not to offer it; this is the same rule applied to the
    // more expensive product.
    if (parsed.intent.type === "lifetime") {
      const grantedPlanId = await getLifetimeGrantPlanId();
      const effectivePlanId = await getEffectivePlanId(user.id);

      if (grantedPlanId !== null && effectivePlanId === grantedPlanId) {
        return NextResponse.json(
          {
            error:
              "You already have lifetime access to this plan. There is nothing further to buy.",
          },
          { status: 409 },
        );
      }
    }

    const session = await createCheckoutSession(
      user.id,
      user.email!,
      parsed.intent,
      typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : undefined,
    );

    return NextResponse.json(session);
  } catch (error: unknown) {
    console.error("Error creating checkout session:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start checkout. Please try again.",
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/billing/checkout?session_id=cs_...
 * Read the outcome of a Checkout Session the current user started.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionId = new URL(req.url).searchParams.get("session_id");
    if (!sessionId) {
      return NextResponse.json(
        { error: "session_id is required" },
        { status: 400 },
      );
    }

    const status = await getCheckoutSessionStatus(user.id, sessionId);
    return NextResponse.json(status);
  } catch (error: unknown) {
    console.error("Error reading checkout session:", error);
    return NextResponse.json(
      { error: "Failed to read checkout session" },
      { status: 500 },
    );
  }
}
