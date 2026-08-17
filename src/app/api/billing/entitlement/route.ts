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
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { readTrialGrant } from "@/lib/billing/effective-plan";
import { trialDaysRemaining } from "@/lib/billing/trial";
import { getUserSubscription } from "@/lib/stripe/subscription";
import { isPaidPlanId } from "@/lib/stripe/plan-types";
import type { EntitlementSummary, TrialSummary } from "@/types/billing";

const UNENTITLED_SUMMARY: EntitlementSummary = {
  kind: "none",
  planId: null,
  planName: null,
};

/**
 * The countdown the dashboard badge draws, or nothing.
 *
 * Two things have to be true for a trial to be worth showing, and only the
 * first is about the grant itself:
 *
 *   * it has not expired — a lapsed trial has nothing to count down;
 *   * nothing is being billed yet — conversion is reflected by the badge
 *     disappearing, and because the grant is deliberately left to lapse on its
 *     own clock rather than being revoked at payment, an unexpired trial row
 *     survives underneath a live subscription for up to fourteen days. Without
 *     this check a paying customer would be told their trial is running out.
 *
 * Both reads are skipped entirely for an account with no plan: an active trial
 * always resolves to `kind: "plan"`, so anything else cannot be trialling, and
 * this route is asked on every page render.
 */
async function readTrialCountdown(
  supabase: SupabaseClient,
  userId: string,
): Promise<TrialSummary | null> {
  const trial = await readTrialGrant(supabase, userId);
  if (!trial?.isActive) {
    return null;
  }

  const subscription = await getUserSubscription(userId);
  if (subscription) {
    return null;
  }

  return {
    daysRemaining: trialDaysRemaining(trial.expiresAt),
    endsAt: trial.expiresAt,
  };
}

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
    const trial = await readTrialCountdown(supabase, user.id);

    if (!isPaidPlanId(entitlement.planId)) {
      console.error(
        `[billing] entitlement resolved to an unrecognised plan id: ${entitlement.planId}`,
      );
      return NextResponse.json({
        kind: "plan",
        planId: null,
        planName: entitlement.plan.name ?? null,
        ...(trial ? { trial } : {}),
      } satisfies EntitlementSummary);
    }

    return NextResponse.json({
      kind: "plan",
      planId: entitlement.planId,
      planName: entitlement.plan.name ?? null,
      // Spread rather than `trial: null` so an account that is not trialling
      // gets byte-for-byte the payload this route has always returned.
      ...(trial ? { trial } : {}),
    } satisfies EntitlementSummary);
  } catch (error) {
    console.error("[billing] entitlement summary failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
