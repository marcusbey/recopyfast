import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reactivateSubscription } from "@/lib/stripe/subscription";
import { billingErrorResponse } from "@/lib/billing/billing-refusal";

/**
 * POST /api/billing/subscription/reactivate
 * Reactivate a canceled subscription
 */
export async function POST() {
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

    const subscription = await reactivateSubscription(user.id);

    return NextResponse.json({ subscription });
  } catch (error: unknown) {
    // Only a `BillingRefusal` keeps its words — the lifetime refusal (409) and
    // "not scheduled for cancellation" among them; Stripe's text stays in the
    // log (s82, s69 L5). See billing-refusal.ts.
    return billingErrorResponse(
      error,
      "Error reactivating subscription",
      "Failed to reactivate subscription",
    );
  }
}
