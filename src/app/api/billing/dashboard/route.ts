import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserSubscription } from "@/lib/stripe/subscription";
import { getCreditWallet, getCreditTransactions } from "@/lib/credits/system";
import { getPlanCatalogue } from "@/lib/stripe/plans";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { readTrialGrant } from "@/lib/billing/effective-plan";
import { trialDaysRemaining } from "@/lib/billing/trial";
import { listPaymentMethods } from "@/lib/stripe/payment-methods";
import type { BillingDashboardData, PaymentMethod } from "@/types/billing";

/**
 * GET /api/billing/dashboard
 * Get comprehensive billing dashboard data
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

    // Get customer information
    const { data: customer } = await supabase
      .from("billing_customers")
      .select("*")
      .eq("user_id", user.id)
      .single();

    // Get subscription
    const subscription = await getUserSubscription(user.id);

    // Payment methods come from Stripe, which is authoritative — cards are
    // attached by Checkout and never mirrored into our tables.
    let paymentMethods: PaymentMethod[] = [];
    if (customer) {
      try {
        paymentMethods = await listPaymentMethods(
          customer.id,
          customer.stripe_customer_id,
        );
      } catch (stripeError: unknown) {
        // A Stripe outage should degrade the cards panel, not the whole page.
        console.error("Failed to list payment methods:", stripeError);
      }
    }

    // Get recent invoices
    const { data: invoices } = await supabase
      .from("billing_invoices")
      .select("*")
      .eq("customer_id", customer?.id)
      .order("created_at", { ascending: false })
      .limit(10);

    const creditWallet = await getCreditWallet(user.id);
    const recentTransactions = await getCreditTransactions(user.id, 10);

    // Get current usage statistics
    const { data: usageData } = await supabase
      .from("usage_tracking")
      .select("feature_type, count")
      .eq("user_id", user.id)
      .gte(
        "created_at",
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      ); // Last 30 days

    // Calculate current usage
    const currentUsage = {
      websites: 0,
      collaborators: 0,
      aiUsage: 0,
      translations: 0,
    };

    // Sites have no owner column — ownership is an 'admin' row in
    // site_permissions. Counting sites.user_id returned a PostgREST 42703 that
    // was discarded along with the count, so this always reported 0.
    const { count: websiteCount, error: websiteCountError } = await supabase
      .from("site_permissions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("permission", "admin");

    if (websiteCountError) {
      throw new Error(
        `Failed to count owned sites: ${websiteCountError.message}`,
      );
    }

    currentUsage.websites = websiteCount || 0;

    // Aggregate usage from tracking data
    usageData?.forEach((usage) => {
      switch (usage.feature_type) {
        case "ai_suggestion":
          currentUsage.aiUsage += usage.count;
          break;
        case "translation":
          currentUsage.translations += usage.count;
          break;
        case "collaboration":
          currentUsage.collaborators = Math.max(
            currentUsage.collaborators,
            usage.count,
          );
          break;
      }
    });

    // The catalogue ships with the dashboard payload so the client components
    // render prices, limits and feature lists from the database without each
    // one fetching the plans separately.
    // `entitlement.planId` is null for an account that has not paid, and for
    // one whose recorded plan no longer has an active catalogue row. Either way
    // the client renders the unentitled state; neither is an error, and this
    // route used to 500 on both because resolving the plan threw.
    const [catalogue, entitlement] = await Promise.all([
      getPlanCatalogue(),
      getEffectivePlan(user.id),
    ]);

    // The trial, and whether there has ever been one.
    //
    // `everTrialed` survives expiry on purpose: it is the only thing that tells
    // "never subscribed" apart from "trial just ran out" on the unentitled
    // branch of this page, where both are `effectivePlanId: null` and the right
    // thing to say is completely different.
    //
    // `trial` is withheld the moment a subscription is live, even though the
    // grant itself may still have days on it. Conversion does not revoke the
    // trial — it is left to lapse on its own clock, which is exactly what makes
    // conversion seamless — so "unexpired" stops meaning "still trialling" at
    // the moment someone starts paying, and the card has to disappear then.
    const trialGrant = await readTrialGrant(supabase, user.id);
    const isTrialling = Boolean(trialGrant?.isActive) && !subscription;

    const dashboardData: BillingDashboardData = {
      customer: customer || undefined,
      subscription: subscription || undefined,
      paymentMethods,
      invoices: invoices || [],
      creditWallet,
      recentTransactions,
      currentUsage,
      catalogue,
      effectivePlanId: entitlement.planId,
      trial:
        isTrialling && trialGrant
          ? {
              daysRemaining: trialDaysRemaining(trialGrant.expiresAt),
              endsAt: trialGrant.expiresAt,
              creditsUsed: creditWallet.usedThisMonth,
              creditsLimit: creditWallet.included,
            }
          : null,
      everTrialed: trialGrant !== null,
    };

    return NextResponse.json(dashboardData);
  } catch (error: unknown) {
    console.error("Error fetching billing dashboard:", error);
    return NextResponse.json(
      { error: "Failed to fetch billing dashboard" },
      { status: 500 },
    );
  }
}
