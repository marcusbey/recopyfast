import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  updateSubscription,
  cancelSubscription,
  getUserSubscription,
} from "@/lib/stripe/subscription";
import {
  isAgencyCheckoutEnabled,
  isBillingPeriod,
  isPaidPlanId,
} from "@/lib/stripe/plans";
import { billingErrorResponse } from "@/lib/billing/billing-refusal";

/**
 * GET /api/billing/subscription
 * Get user's current subscription
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Get the current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const subscription = await getUserSubscription(user.id);

    return NextResponse.json({ subscription });
  } catch (error: unknown) {
    console.error("Error fetching subscription:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscription" },
      { status: 500 },
    );
  }
}

/**
 * There is no POST here.
 *
 * A first subscription is bought through Stripe Checkout — POST
 * /api/billing/checkout with `{ intent: "subscription" }`. Creating the
 * subscription server-side produced `incomplete` rows that Stripe auto-cancelled
 * ~23h later because no client ever confirmed the payment.
 */

/**
 * PUT /api/billing/subscription
 * Change the plan on an existing subscription (prorated, charged immediately).
 *
 * Returns { subscription, requiresAction, hostedInvoiceUrl }. When
 * `requiresAction` is true the customer must finish a 3DS challenge or supply a
 * different card at `hostedInvoiceUrl`.
 */
export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient();

    // Get the current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { planId, billingPeriod = "monthly" } = body;

    if (!isPaidPlanId(planId)) {
      return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
    }

    if (!isBillingPeriod(billingPeriod)) {
      return NextResponse.json(
        { error: "Invalid billing period" },
        { status: 400 },
      );
    }

    if (planId === "agency" && !isAgencyCheckoutEnabled()) {
      return NextResponse.json(
        { error: "Agency checkout is temporarily unavailable." },
        { status: 503 },
      );
    }

    const result = await updateSubscription(user.id, {
      planId,
      billingPeriod,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    // A `BillingRefusal` ("You are already on this plan", "No active
    // subscription found") keeps its words; anything else — Stripe's text
    // included — stays in the log (s82, s69 L5). See billing-refusal.ts.
    return billingErrorResponse(
      error,
      "Error updating subscription",
      "Failed to update subscription",
    );
  }
}

/**
 * DELETE /api/billing/subscription
 * Cancel a subscription
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();

    // Get the current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const immediate = url.searchParams.get("immediate") === "true";

    const subscription = await cancelSubscription(user.id, immediate);

    return NextResponse.json({ subscription });
  } catch (error: unknown) {
    // Same rule as PUT: only a `BillingRefusal` reaches the client as written.
    return billingErrorResponse(
      error,
      "Error canceling subscription",
      "Failed to cancel subscription",
    );
  }
}
