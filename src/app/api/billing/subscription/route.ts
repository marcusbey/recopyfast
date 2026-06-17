import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createSubscription,
  updateSubscription,
  cancelSubscription,
  reactivateSubscription,
  getUserSubscription,
} from "@/lib/stripe/subscription";

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
 * POST /api/billing/subscription
 * Create a new subscription.
 *
 * Accepted body fields: { planId, paymentMethodId }
 * The `trialDays` field is intentionally NOT accepted from the client —
 * trial periods are derived server-side from plan configuration only.
 */
export async function POST(req: NextRequest) {
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
    // Destructure only the fields we accept; trialDays is explicitly excluded
    // so a client cannot grant themselves a free trial.
    const { planId, paymentMethodId } = body;

    // Validate plan
    if (!planId || !["starter", "pro", "enterprise"].includes(planId)) {
      return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
    }

    // Check if user already has an active subscription
    const existingSubscription = await getUserSubscription(user.id);
    if (existingSubscription && existingSubscription.status === "active") {
      return NextResponse.json(
        { error: "User already has an active subscription" },
        { status: 400 },
      );
    }

    // trialDays is NOT forwarded — createSubscription no longer accepts it.
    const result = await createSubscription(
      user.id,
      user.email!,
      planId,
      paymentMethodId,
    );

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Error creating subscription:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create subscription",
      },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/billing/subscription
 * Update an existing subscription
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
    const { planId, paymentMethodId } = body;

    // Validate plan
    if (!planId || !["starter", "pro", "enterprise"].includes(planId)) {
      return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
    }

    const subscription = await updateSubscription(user.id, {
      planId,
      paymentMethodId,
    });

    return NextResponse.json({ subscription });
  } catch (error: unknown) {
    console.error("Error updating subscription:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update subscription",
      },
      { status: 500 },
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
    console.error("Error canceling subscription:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to cancel subscription",
      },
      { status: 500 },
    );
  }
}
