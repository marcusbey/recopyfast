import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { readGrantedPlanIds } from "@/lib/billing/effective-plan";
import { BillingDashboard } from "@/components/billing/BillingDashboard";
import type { LifetimeGrantStatus } from "@/components/billing/LifetimeOfferCard";

/**
 * Does this account already hold a permanent plan grant?
 *
 * Read here rather than in the client, because the dashboard payload cannot
 * answer it: `effectivePlanId` says `pro` whether the plan came from a $199
 * lifetime grant or a $19 monthly subscription, and the whole point of the
 * question is to tell those two apart before offering to sell the grant again.
 *
 * Reads EVERY live grant, not the most recent one.
 *
 * `readEffectivePlanId` takes the newest because it only needs to answer "what
 * plan is in force". This question is different — "do they already own the
 * thing we are about to sell" — and the newest row is the wrong answer to it.
 * An account holding a lifetime Pro grant plus a later support-issued Starter
 * grant would report `starter`, which does not match what Lifetime Pro confers,
 * so the offer would reappear and take $199 for a grant they already hold.
 *
 * Read through the cookie-scoped client, so RLS keeps a session to its own rows.
 *
 * Every failure path answers `unknown`, which hides the offer. That is the safe
 * direction: not showing an upsell loses a sale we can make tomorrow, showing
 * one to someone who already bought it takes $199 twice.
 */
async function readLifetimeGrant(): Promise<LifetimeGrantStatus> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { kind: "unknown" };
    }

    // Shared with the checkout guard, so the card cannot offer something the
    // server will refuse — or hide something the server would allow.
    const planIds = await readGrantedPlanIds(supabase, user.id);

    return planIds.length > 0 ? { kind: "granted", planIds } : { kind: "none" };
  } catch (error) {
    console.error("[billing] could not read plan entitlements:", error);
    return { kind: "unknown" };
  }
}

/**
 * Kept as a nested async component rather than awaiting in the page itself so
 * the skeleton below still renders while the grant is being read.
 */
async function BillingDashboardSection() {
  return <BillingDashboard lifetimeGrant={await readLifetimeGrant()} />;
}

export default function BillingPage() {
  return (
    <div className="min-h-screen bg-surface-1">
      <Suspense
        fallback={
          <div className="container mx-auto px-4 py-8">
            <div className="animate-pulse space-y-6">
              <div className="h-8 bg-muted rounded w-1/4"></div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-48 bg-muted rounded-lg"></div>
                ))}
              </div>
            </div>
          </div>
        }
      >
        <BillingDashboardSection />
      </Suspense>
    </div>
  );
}
