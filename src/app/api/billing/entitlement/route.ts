/**
 * GET /api/billing/entitlement
 *
 * What the signed-in account is entitled to, and nothing else.
 *
 * This exists because the dashboard shell needs the answer on every page and
 * `/api/billing/dashboard` is far too expensive to ask: that route calls
 * Stripe for payment methods, pulls invoices, transactions and thirty days of
 * usage rows. Rendering a sidebar must not cost a Stripe round trip.
 *
 * It deliberately returns the *shape* of the entitlement rather than a
 * `canDoX` list. The client uses it to decide what to show; every gate that
 * decides what may actually happen resolves entitlement server-side for
 * itself. Nothing here is load-bearing for authorisation, and it must not
 * become so — a client can lie about what it renders, never about what the
 * server permits.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { isPaidPlanId } from "@/lib/stripe/plan-types";
import type { EntitlementSummary } from "@/types/billing";

const UNENTITLED_SUMMARY: EntitlementSummary = {
  kind: "none",
  planId: null,
  planName: null,
};

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const entitlement = await getEffectivePlan(user.id);

    if (entitlement.kind !== "plan") {
      return NextResponse.json({
        ...UNENTITLED_SUMMARY,
        kind: entitlement.kind,
      } satisfies EntitlementSummary);
    }

    // `free` is retired and never resolves to a plan any more, so anything
    // arriving here should be a paid id. Guarding rather than casting: an
    // unrecognised id means the catalogue and this union have drifted, and the
    // honest response is "no plan we can render" rather than a bad label.
    if (!isPaidPlanId(entitlement.planId)) {
      console.error(
        `[billing] entitlement resolved to an unrecognised plan id: ${entitlement.planId}`,
      );
      return NextResponse.json({
        kind: "plan",
        planId: null,
        planName: entitlement.plan.name ?? null,
      } satisfies EntitlementSummary);
    }

    return NextResponse.json({
      kind: "plan",
      planId: entitlement.planId,
      planName: entitlement.plan.name ?? null,
    } satisfies EntitlementSummary);
  } catch (error) {
    console.error("[billing] entitlement summary failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
