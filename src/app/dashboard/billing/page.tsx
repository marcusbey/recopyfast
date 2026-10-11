import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { readGrantedPlans } from "@/lib/billing/effective-plan";
import { getFoundingAgencyAvailability } from "@/lib/billing/founding-agency";
import { isAgencyCheckoutEnabled } from "@/lib/stripe/plans";
import { BillingDashboard } from "@/components/billing/BillingDashboard";
import { BILLING_PAGE_COPY } from "@/components/billing/billing-page-copy";
import { TrialStatusCard } from "@/components/billing/TrialStatusCard";
import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import type { LifetimeGrantStatus } from "@/components/billing/LifetimeOfferCard";
import type { FoundingAgencyAvailability } from "@/lib/billing/founding-agency";

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

    // Shared with the checkout guard (`readGrantedPlanIds` is this read's
    // ids), so the card cannot offer something the server will refuse — or
    // hide something the server would allow. The same query says when a
    // dated grant ends, so the plan dialog never calls it lifetime (s82
    // review, second pass, m3).
    const grants = await readGrantedPlans(supabase, user.id);
    if (grants.length === 0) {
      return { kind: "none" };
    }

    return {
      kind: "granted",
      planIds: grants.map((granted) => granted.planId),
      endsAt: Object.fromEntries(
        grants.flatMap((granted) =>
          granted.expiresAt === null
            ? []
            : [[granted.planId, granted.expiresAt]],
        ),
      ),
    };
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
  const [lifetimeGrant, foundingAgencyAvailability] = await Promise.all([
    readLifetimeGrant(),
    readFoundingAgencyAvailability(),
  ]);

  return (
    <BillingDashboard
      lifetimeGrant={lifetimeGrant}
      foundingAgencyAvailability={foundingAgencyAvailability}
      agencyCheckoutEnabled={isAgencyCheckoutEnabled()}
    />
  );
}

async function readFoundingAgencyAvailability(): Promise<FoundingAgencyAvailability | null> {
  try {
    return await getFoundingAgencyAvailability();
  } catch (error) {
    // This is a sales-cap guard, not decorative scarcity copy. If the aggregate
    // cannot be read, the dashboard must withhold checkout rather than invent
    // spots and risk offering the fifty-first founding purchase.
    console.error(
      "[billing] could not read founding Agency availability:",
      error,
    );
    return null;
  }
}

export default function BillingPage() {
  // No wrapper of its own (ADR 053: never wrap PageShell). This was a
  // `min-h-screen bg-surface-1` div: once the page container went (s66b1) it
  // drew a darker band flush at the content's edge and forced ~120px of empty
  // scroll on short states. The layout owns the canvas; the frame is the
  // page's outermost element, in the fallback and after the hand-off alike.
  return (
    <>
      <Suspense
        fallback={
          // The same frame BillingDashboard renders in its own loading state,
          // header and body, so nothing moves when the client takes over
          // (s66b1, ADR 053). The copy comes from a plain module both sides
          // import; the trial skeleton is here because the client's loading
          // state opens with it, and without it the body shifted down on
          // hand-off (s66b1 review m-4).
          <PageShell
            title={BILLING_PAGE_COPY.title}
            description={BILLING_PAGE_COPY.description}
          >
            <TrialStatusCard trial={null} isLoading />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          </PageShell>
        }
      >
        <BillingDashboardSection />
      </Suspense>
    </>
  );
}
