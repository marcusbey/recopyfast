import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getUserTickets,
  getTicketTransactions,
  getTicketPricing,
} from "@/lib/stripe/tickets";
import type { TicketTransaction } from "@/types/billing";

/**
 * GET /api/billing/tickets
 * Get user's ticket information and transaction history
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

    const tickets = await getUserTickets(user.id);
    const pricing = getTicketPricing();

    let transactions: TicketTransaction[] = [];
    if (includeTransactions) {
      transactions = await getTicketTransactions(user.id, limit);
    }

    return NextResponse.json({
      tickets,
      transactions,
      pricing,
    });
  } catch (error: unknown) {
    console.error("Error fetching tickets:", error);
    return NextResponse.json(
      { error: "Failed to fetch tickets" },
      { status: 500 },
    );
  }
}

/**
 * There is no POST here.
 *
 * Buying tickets goes through Stripe Checkout — POST /api/billing/checkout with
 * `{ intent: "tickets", quantity }`. The wallet is credited only by the
 * `payment_intent.succeeded` webhook, never by the client.
 */
