/**
 * GET /api/offers/founding
 *
 * The public "X of 20 spots left" count for the founding offer (s47a): the
 * first 20 accounts get Pro free for 90 days. Aggregate only — `{limit,
 * remaining, soldOut}` and nothing about who took a spot.
 *
 * UNCACHED, ON PURPOSE. The count has to be right the moment a spot is claimed
 * or an operator releases one, with no redeploy. `/api/pricing` carries the
 * Founding Agency count behind a 5-minute in-process cache plus a 5-minute CDN
 * `s-maxage` (up to ~15 minutes stale, which that runbook accepts); this count
 * cannot ride there. So: `force-dynamic`, `Cache-Control: no-store`, and no
 * module-level memo — the staleness bound is zero, every request reads the
 * database. Adding a cache here breaks s47a AC 8.
 *
 * That makes the per-IP limiter the only brake on a public route that costs a
 * service-role read per hit, so it runs first. It fails OPEN on a store outage:
 * this is a public read of a public number, and a denied read would only turn
 * the landing page's count into the 14-day trial line (AGENTS.md "API routes").
 *
 * On any failure — RPC error, no row, a count outside the offer's own bounds —
 * the answer is 503 with no number, and the landing shows the trial line. A
 * guessed count on a scarcity claim is worse than no count.
 */

import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { getFoundingOfferAvailability } from "@/lib/billing/founding-offer";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, {
    limit: "IP_GENERAL",
    endpoint: "offers/founding:ip",
    // A public read of a public aggregate: failing open costs nothing.
    onStoreFailure: "allow",
  });
  if (limited) return limited;

  try {
    const { limit, remaining, soldOut } = await getFoundingOfferAvailability();
    return NextResponse.json(
      { limit, remaining, soldOut },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[offers] founding offer availability failed:", error);
    return NextResponse.json(
      { error: "Founding offer availability is unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
}
