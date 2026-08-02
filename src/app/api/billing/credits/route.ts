import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCreditWallet, getCreditTransactions } from "@/lib/credits/system";
import { getCreditPackConfig } from "@/lib/stripe/plans";
import type { CreditTransaction } from "@/types/billing";

/**
 * GET /api/billing/credits
 * Get the user's credit wallet and transaction history.
 */
export async function GET(req: NextRequest) {
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
    const includeTransactions =
      url.searchParams.get("includeTransactions") === "true";
    const limit = parseInt(url.searchParams.get("limit") || "50");

    const creditWallet = await getCreditWallet(user.id);
    const pricing = await getCreditPackConfig();

    let transactions: CreditTransaction[] = [];
    if (includeTransactions) {
      transactions = await getCreditTransactions(user.id, limit);
    }

    return NextResponse.json({
      creditWallet,
      transactions,
      pricing,
    });
  } catch (error: unknown) {
    console.error("Error fetching credits:", error);
    return NextResponse.json(
      { error: "Failed to fetch credits" },
      { status: 500 },
    );
  }
}

/**
 * There is no POST here.
 *
 * Buying credits goes through Stripe Checkout — POST /api/billing/checkout with
 * `{ intent: "credits", quantity }`. The wallet is credited only by the
 * `payment_intent.succeeded` webhook, never by the client.
 */
