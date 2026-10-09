"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  featuresWithMonthlyCredits,
  findSubscriptionPlan,
  isPaidPlanId,
  isPlanCoveredByGrants,
  PAID_PLAN_IDS,
  planCyclePrice,
  planDisplayPrice,
  sellablePlans,
  type BillingPeriod,
  type OneTimeProduct,
  type PaidPlanId,
  type PlanCatalogue,
} from "@/lib/stripe/plan-types";
import { useCheckout } from "./useCheckout";
import type { FoundingAgencyAvailability } from "@/lib/billing/founding-agency";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The plan the account keeps — through a subscription or a permanent grant —
   * or null. Never a plan held only by a trial or the founding offer: that plan
   * is exactly what the account is here to buy, so it must stay selectable.
   */
  currentPlan: string | null;
  /**
   * Whether a live Stripe subscription exists to change in place. Passed in,
   * never inferred from `currentPlan`: a trialling or founding offer account
   * holds `pro` with no subscription at all, and inferring one sent its plan
   * change to `PUT /api/billing/subscription`, which answered "No active
   * subscription found" (PR #49 review, finding 1).
   */
  hasSubscription: boolean;
  /** Plan catalogue, resolved server-side from the `plans` table. */
  catalogue: PlanCatalogue;
  /**
   * The buy-once alternative to a subscription, or null when this account must
   * not be offered it. Resolved by `resolveLifetimeOffer` in the dashboard so
   * the dialog and the sidebar card cannot disagree about who may see it.
   */
  lifetimeOffers: readonly OneTimeProduct[];
  foundingAgencyAvailability: FoundingAgencyAvailability | null;
  agencyCheckoutEnabled?: boolean;
  /**
   * The plan in force when a permanent grant covers it, with the monthly AI
   * credits the account actually gets (the wallet's `included`). Its tile
   * reads "Lifetime access" with that allowance, never a monthly price, and
   * cannot be bought. Absent for every account without one.
   */
  heldForLife?: { planId: string; monthlyCredits: number | null };
  /**
   * Every plan the account holds through a live, non-revoked, non-trial grant
   * (the page's `readGrantedPlanIds`). A plan one of them includes — the same
   * plan or a lower one, `isPlanCoveredByGrants` — reads "Included" and cannot
   * be bought: Checkout and the plan change refuse it too (s82 review,
   * finding 1). Absent or empty for every account without one.
   */
  grantedPlanIds?: readonly string[];
  /**
   * For a granted plan held only through dated grants, when that holding ends
   * (ISO); a granted plan absent here is held without an end date. The page
   * reads it with `grantedPlanIds`, in the same query (`readGrantedPlans`).
   */
  grantEndsAt?: Readonly<Partial<Record<string, string>>>;
  onSuccess: () => void;
}

const BILLING_PERIODS: ReadonlyArray<{ id: BillingPeriod; label: string }> = [
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly (save ~17%)" },
];

/**
 * How the account's grants include a plan: for life, through the highest
 * undated grant that includes it, or — only when every grant that includes it
 * has an end date — until the latest of those ends.
 */
type GrantInclusion =
  | { kind: "for_life"; planId: PaidPlanId }
  | { kind: "until"; endsAt: string };

/**
 * s82 review (second pass), m3: every included plan read "Included for life",
 * including one held only through a dated grant (production holds one, the QA
 * recovery grant `qa_recovery_20260919`). A dated grant ends, so it is never
 * called lifetime here. Null when no grant includes the plan.
 */
function grantInclusion(
  planId: string,
  grantedPlanIds: readonly string[],
  grantEndsAt: Readonly<Partial<Record<string, string>>>,
): GrantInclusion | null {
  // Ascending rank, so the last plan in any filtered list is the highest.
  const including = PAID_PLAN_IDS.filter(
    (granted) =>
      grantedPlanIds.includes(granted) &&
      isPlanCoveredByGrants(planId, [granted]),
  );
  if (including.length === 0) return null;

  const highestForLife = including
    .filter((granted) => grantEndsAt[granted] === undefined)
    .at(-1);
  if (highestForLife) return { kind: "for_life", planId: highestForLife };

  // No undated grant includes the plan, so every one of `including` is dated.
  const endsAt = including
    .flatMap((granted) => grantEndsAt[granted] ?? [])
    .reduce((latest, end) =>
      Date.parse(end) > Date.parse(latest) ? end : latest,
    );
  return { kind: "until", endsAt };
}

/** The same long US date the subscription card prints. */
function formatGrantEnd(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function UpgradeDialog({
  open,
  onOpenChange,
  currentPlan,
  hasSubscription,
  catalogue,
  lifetimeOffers,
  foundingAgencyAvailability,
  agencyCheckoutEnabled = true,
  heldForLife,
  grantedPlanIds = [],
  grantEndsAt = {},
  onSuccess,
}: UpgradeDialogProps) {
  // Only paid plans are ever selectable, so a `free` row still sitting in the
  // catalogue for grandfathered accounts cannot be bought.
  const plans = sellablePlans(catalogue).filter(
    (plan) =>
      isPaidPlanId(plan.id) && (agencyCheckoutEnabled || plan.id !== "agency"),
  );
  const visibleLifetimeOffers = lifetimeOffers.filter(
    (product) => agencyCheckoutEnabled || product.id !== "lifetime_agency",
  );
  const [selectedPlan, setSelectedPlan] = useState<PaidPlanId>("pro");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [isChangingPlan, setIsChangingPlan] = useState(false);
  const [planChangeError, setPlanChangeError] = useState<string | null>(null);
  const [actionUrl, setActionUrl] = useState<string | null>(null);

  const { startCheckout, isRedirecting, error: checkoutError } = useCheckout();

  // No subscription means nothing to prorate, so the submit below opens
  // Checkout rather than changing a plan in place. A credit holder, a trial, the
  // founding offer and a lifetime owner are all in that position.
  const isBusy = isRedirecting || isChangingPlan;
  const error = planChangeError ?? checkoutError;
  const selectedPlanData = plans.find((plan) => plan.id === selectedPlan);
  const isSelectedHeldForLife = heldForLife?.planId === selectedPlan;
  const selectedInclusion = grantInclusion(
    selectedPlan,
    grantedPlanIds,
    grantEndsAt,
  );
  const isSelectedIncluded = selectedInclusion !== null;

  /**
   * No subscription yet → hand off to Stripe Checkout.
   * Already subscribed → change the plan in place so Stripe prorates it.
   */
  const handleSubmit = async () => {
    if (isBusy) {
      return;
    }

    setPlanChangeError(null);
    setActionUrl(null);

    if (!hasSubscription) {
      await startCheckout({
        intent: "subscription",
        planId: selectedPlan,
        billingPeriod,
      });
      return;
    }

    setIsChangingPlan(true);

    try {
      const response = await fetch("/api/billing/subscription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: selectedPlan, billingPeriod }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Failed to change plan");
      }

      // Stripe could not collect the prorated charge without a 3DS challenge or
      // a working card. Send the customer to the hosted invoice to finish.
      if (data?.requiresAction && data?.hostedInvoiceUrl) {
        setActionUrl(data.hostedInvoiceUrl);
        onSuccess();
        return;
      }

      onSuccess();
      onOpenChange(false);
    } catch (err: unknown) {
      setPlanChangeError(
        err instanceof Error
          ? err.message
          : "We could not change your plan. Please try again.",
      );
    } finally {
      setIsChangingPlan(false);
    }
  };

  // The highest undated grant includes every lower plan, so it is the one the
  // submit names when it refuses an included plan; a plan included only by
  // dated grants is refused with their end instead.
  const includedLabel = (inclusion: GrantInclusion) => {
    if (inclusion.kind === "until")
      return `Included in your plan until ${formatGrantEnd(inclusion.endsAt)}`;
    const lifetimePlanName = findSubscriptionPlan(
      catalogue,
      inclusion.planId,
    )?.name;
    return lifetimePlanName
      ? `Included in your lifetime ${lifetimePlanName}`
      : "Included in your lifetime plan";
  };

  const submitLabel = () => {
    if (isRedirecting) return "Redirecting to Stripe…";
    if (isChangingPlan) return "Updating your plan…";
    if (!selectedPlanData) return "Select a plan";
    if (isSelectedHeldForLife)
      return `You hold ${selectedPlanData.name} for life`;
    if (selectedInclusion) return includedLabel(selectedInclusion);
    return hasSubscription
      ? `Switch to ${selectedPlanData.name}`
      : `Continue to payment — $${planCyclePrice(selectedPlanData, billingPeriod)}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {hasSubscription ? "Change your plan" : "Choose your plan"}
          </DialogTitle>
          <DialogDescription>
            {hasSubscription
              ? "Switch plans at any time. Stripe prorates the difference and charges your card on file straight away."
              : "Pick a plan and complete payment on Stripe's secure checkout page."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6">
          {error && (
            <Alert className="border-tone-danger-border bg-tone-danger-surface">
              <p className="text-tone-danger-text">{error}</p>
            </Alert>
          )}

          {actionUrl && (
            <Alert className="border-tone-warning-border bg-tone-warning-surface">
              <p className="text-tone-warning-text">
                Your plan was changed, but the prorated charge still needs
                confirmation — your bank asked for verification, or the card was
                declined.
              </p>
              <a
                href={actionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block font-medium text-tone-warning-text underline"
              >
                Complete the payment on Stripe
              </a>
            </Alert>
          )}

          <div
            role="radiogroup"
            aria-label="Billing period"
            className="inline-flex rounded-control border p-1"
          >
            {BILLING_PERIODS.map((period) => (
              <button
                key={period.id}
                type="button"
                role="radio"
                aria-checked={billingPeriod === period.id}
                onClick={() => setBillingPeriod(period.id)}
                disabled={isBusy}
                className={`rounded-control px-4 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                  billingPeriod === period.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {period.label}
              </button>
            ))}
          </div>

          <div
            role="radiogroup"
            aria-label="Subscription plan"
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {plans.map((plan) => {
              const isSelected = selectedPlan === plan.id;
              const isCurrent = currentPlan === plan.id;
              // s82 (s45 review #1): the plan a lifetime grant covers read
              // "Current" at "$49/month" with Agency's 1,000 credits — a
              // subscription's price and semantics for a plan paid for once,
              // beside a card saying "Lifetime access" and 250. It reads the
              // way the card does: Lifetime, no price, the account's own
              // allowance.
              const isHeldForLife = heldForLife?.planId === plan.id;
              // s82 review, finding 1: a plan below the one held for life —
              // or below a lifetime grant while a higher subscription runs —
              // was still priced and buyable here; the server refuses it now.
              // Its tile says it is included instead of what it would cost —
              // for life, or until a dated grant ends (second pass, m3).
              const inclusion = isHeldForLife
                ? null
                : grantInclusion(plan.id, grantedPlanIds, grantEndsAt);
              const isIncluded = inclusion !== null;
              const features = isHeldForLife
                ? featuresWithMonthlyCredits(plan, heldForLife.monthlyCredits)
                : plan.features;

              return (
                <button
                  key={plan.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setSelectedPlan(plan.id as PaidPlanId)}
                  disabled={isBusy}
                  // 1px, like every option toggle (design system, Borders):
                  // selection is the accent border, the accent surface and
                  // the tick on the badge, never a thicker border. These
                  // tiles were `border-2` until s66b2.
                  className={`p-6 border rounded-control text-left transition-colors disabled:opacity-60 ${
                    isSelected
                      ? "border-primary bg-tone-accent-surface"
                      : "border-input hover:border-foreground/40"
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-semibold">{plan.name}</h3>
                      <p className="text-muted-foreground mt-1">
                        {plan.description}
                      </p>
                    </div>
                    {isHeldForLife ? (
                      <Badge variant="secondary">Lifetime</Badge>
                    ) : isIncluded ? (
                      <Badge variant="secondary">Included</Badge>
                    ) : isCurrent ? (
                      <Badge variant="secondary">Current</Badge>
                    ) : (
                      isSelected && (
                        <Badge>
                          <Check className="mr-1 h-3 w-3" aria-hidden="true" />
                          Selected
                        </Badge>
                      )
                    )}
                  </div>

                  {isHeldForLife ? (
                    <div className="mb-4">
                      <span className="text-xl font-semibold">
                        Lifetime access
                      </span>
                    </div>
                  ) : inclusion ? (
                    <div className="mb-4">
                      <span className="text-xl font-semibold">
                        {inclusion.kind === "until"
                          ? `Included until ${formatGrantEnd(inclusion.endsAt)}`
                          : "Included for life"}
                      </span>
                    </div>
                  ) : (
                    <div className="mb-4">
                      <span className="text-3xl font-semibold tabular">
                        ${planDisplayPrice(plan, billingPeriod)}
                      </span>
                      <span className="text-muted-foreground">/month</span>
                      {billingPeriod === "yearly" && (
                        <p className="text-sm text-muted-foreground mt-1">
                          Billed ${planCyclePrice(plan, "yearly")} once a year
                        </p>
                      )}
                    </div>
                  )}

                  <ul className="space-y-2">
                    {features.map((feature) => (
                      <li key={feature} className="flex items-center text-sm">
                        <svg
                          className="w-4 h-4 text-tone-success-text mr-2 shrink-0"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>

          {visibleLifetimeOffers.map((lifetimeOffer) => (
            <div
              key={lifetimeOffer.id}
              className="rounded-container border border-border bg-surface-1 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    Prefer to pay once? {lifetimeOffer.name} — $
                    <span className="tabular">{lifetimeOffer.price}</span>, once
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {lifetimeOffer.description}
                    {hasSubscription &&
                      " Your current subscription stops renewing once the purchase completes."}
                  </p>
                  {lifetimeOffer.id === "lifetime_agency" && (
                    <p className="mt-1 text-sm font-medium text-primary">
                      {foundingAgencyAvailability == null
                        ? "Availability temporarily unavailable"
                        : foundingAgencyAvailability.soldOut
                          ? "Sold out"
                          : `${foundingAgencyAvailability.remaining} of ${foundingAgencyAvailability.limit} founding spots left`}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    startCheckout({
                      intent: "lifetime",
                      ...(lifetimeOffer.id === "lifetime_agency"
                        ? { productId: lifetimeOffer.id }
                        : {}),
                    })
                  }
                  disabled={
                    isBusy ||
                    (lifetimeOffer.id === "lifetime_agency" &&
                      (foundingAgencyAvailability == null ||
                        foundingAgencyAvailability.soldOut))
                  }
                >
                  {lifetimeOffer.id === "lifetime_agency" &&
                  foundingAgencyAvailability == null
                    ? "Availability unavailable"
                    : lifetimeOffer.id === "lifetime_agency" &&
                        foundingAgencyAvailability?.soldOut
                      ? "Sold out"
                      : "Buy once"}
                </Button>
              </div>
            </div>
          ))}

          <div className="text-xs text-muted-foreground space-y-1">
            <p>• Cancel anytime — no long-term contracts</p>
            <p>• Prorated billing when you change plans mid-cycle</p>
            <p>
              • Card details are handled entirely by Stripe — we never see them
            </p>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isBusy ||
              currentPlan === selectedPlan ||
              isSelectedHeldForLife ||
              isSelectedIncluded
            }
          >
            {submitLabel()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
