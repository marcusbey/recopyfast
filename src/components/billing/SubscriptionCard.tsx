"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";
import type { Subscription } from "@/types/billing";

interface SubscriptionCardProps {
  subscription?: Subscription;
  /** Plan in force, resolved server-side from the `plans` table. */
  plan: SubscriptionPlan;
  /**
   * The plan in force is held through a permanent grant and no subscription
   * bills it, so it has no monthly price to show.
   */
  isLifetime: boolean;
  /**
   * Display name of the plan `subscription` bills, from the catalogue the page
   * already holds. Read only while the plan in force is held for life, to name
   * the subscription still running out beside it (s71 review M-2); undefined
   * when that plan is not in the catalogue.
   */
  subscriptionPlanName?: string;
  /**
   * The monthly AI-credit allowance this account actually gets — the credit
   * wallet's `included`, resolved server-side — or null when it is not known.
   */
  monthlyCredits: number | null;
  onUpdate: () => void;
}

/** How a plan's bullet states a monthly allowance: "1,000 AI credits". */
function allowanceText(credits: number): string {
  return `${credits.toLocaleString("en-US")} AI credits`;
}

/**
 * The plan's feature bullets, with the catalogue's allowance restated as the
 * one this account gets.
 *
 * s45 review, finding 3: a lifetime Founding Agency owner holds `agency` with
 * 250 monthly credits (ADR 038) — more if another plan they hold lifts it — but
 * this card printed the Agency row's bullets verbatim, "1,000 AI credits /
 * month" beside a wallet saying 250. The number now comes from the resolved
 * allowance; the wording stays the catalogue's. A bullet claiming the catalogue
 * allowance is dropped rather than left standing when the resolved one is not
 * known.
 */
function featuresWithAllowance(
  plan: SubscriptionPlan,
  monthlyCredits: number | null,
): readonly string[] {
  if (monthlyCredits === plan.limits.monthlyCredits) {
    return plan.features;
  }
  const claimed = allowanceText(plan.limits.monthlyCredits);
  return plan.features.flatMap((feature) => {
    if (!feature.includes(claimed)) {
      return [feature];
    }
    return monthlyCredits === null
      ? []
      : [feature.replace(claimed, allowanceText(monthlyCredits))];
  });
}

/**
 * s71 review m-3: a plan priced 0 printed "Free" here, one row below the badge
 * that had just stopped saying it. "Free" names a retired plan nobody is on;
 * a zero price is stated as a price, like any other.
 */
function priceLabel(plan: SubscriptionPlan, isLifetime: boolean): string {
  if (isLifetime) {
    return "Lifetime access";
  }
  return `$${plan.price}/month`;
}

/** Who the running-out row is about when the catalogue cannot name its plan. */
const UNNAMED_SUBSCRIPTION = "Your previous subscription";

/**
 * The one row a subscription still running out under a plan held for life
 * gets: its own plan, its end or renewal date, and its status.
 *
 * s71 review M-2: the card drew this subscription's period grid unlabelled
 * under the "Lifetime" badge, so "Next billing: Plan will be canceled" read as
 * the lifetime plan being cancelled. The badge now speaks for the plan in
 * force, so the row has to carry the subscription's status itself (review
 * m-1) — a past-due row hidden behind "Lifetime" is a card about to be retried
 * with no warning on the page.
 *
 * A past-due subscription set to cancel is not promised "you won't be charged
 * again": its failed invoice is still open, and Stripe's retries may yet
 * collect it. It is only promised what is certain — it will not renew.
 */
function runningOutSubscriptionText(
  subscription: Subscription,
  subscriptionPlanName: string | undefined,
  heldPlanName: string,
  periodEnd: string,
): string {
  const subject = subscriptionPlanName
    ? `Your ${subscriptionPlanName} subscription`
    : UNNAMED_SUBSCRIPTION;
  // A live row is active, trialing or past_due (getUserSubscription); only
  // "active" goes without saying.
  const status =
    subscription.status === "active"
      ? ""
      : ` is ${subscription.status.replace("_", " ")} and`;
  const outcome = !subscription.cancel_at_period_end
    ? `renews ${periodEnd} — you hold ${heldPlanName} for life, so you no longer need it.`
    : subscription.status === "past_due"
      ? `ends ${periodEnd} — it will not renew.`
      : `ends ${periodEnd} — you won't be charged again.`;
  return `${subject}${status} ${outcome}`;
}

export function SubscriptionCard({
  subscription,
  plan,
  isLifetime,
  subscriptionPlanName,
  monthlyCredits,
  onUpdate,
}: SubscriptionCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  const handleCancelSubscription = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/billing/subscription", {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to cancel subscription");
      }

      setIsConfirmingCancel(false);
      onUpdate();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to cancel subscription",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleReactivateSubscription = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/billing/subscription/reactivate", {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to reactivate subscription");
      }

      onUpdate();
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to reactivate subscription",
      );
    } finally {
      setLoading(false);
    }
  };

  // s71: this printed "Free" whenever there was no subscription row — and a
  // lifetime grant has none, so every lifetime owner read "Free" beside the plan
  // they paid for ("it says FRee on the right and PRO on the left", owner,
  // 2026-10-08). "Free" names a retired plan nobody is on; never reintroduce it
  // as a fallback. A plan held for life wins over a lower subscription still
  // running out its period: that row bills a different plan, not this one. With
  // neither (a trial has no row), no badge beats a wrong one.
  const getStatusBadge = () => {
    if (isLifetime) return <Badge variant="default">Lifetime</Badge>;
    if (!subscription) return null;

    const variant =
      subscription.status === "active"
        ? "default"
        : subscription.status === "trialing"
          ? "secondary"
          : subscription.status === "past_due"
            ? "destructive"
            : "outline";

    return (
      <Badge variant={variant}>
        {subscription.status.replace("_", " ").toUpperCase()}
      </Badge>
    );
  };

  // s71 review M-2: never offer Reactivate under a plan held for life. The
  // subscription was set to cancel because the grant replaced it
  // (stopBillingForLifetimeOwner in the Stripe webhook); reactivating it
  // restarts monthly billing for a plan the owner already holds.
  const shouldOfferSubscriptionActions =
    subscription?.status === "active" &&
    !(isLifetime && subscription.cancel_at_period_end);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // s71: under a plan held for life, cancelling the lower subscription ends
  // nothing the owner keeps — "You keep access until <period end>" was untrue.
  const cancelConfirmText = !subscription
    ? ""
    : isLifetime
      ? `Cancel ${
          subscriptionPlanName
            ? `your ${subscriptionPlanName} subscription`
            : UNNAMED_SUBSCRIPTION.toLowerCase()
        }? You keep ${plan.name} for life, and you will not be charged again.`
      : `Cancel your subscription? You keep access until ${formatDate(
          subscription.current_period_end,
        )}, and you will not be charged again.`;

  return (
    <Card className="p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-semibold">Current subscription</h3>
          <p className="text-muted-foreground mt-1">{plan.description}</p>
        </div>
        {getStatusBadge()}
      </div>

      {error && (
        <Alert className="mb-4 border-tone-danger-border bg-tone-danger-surface">
          <p className="text-tone-danger-text">{error}</p>
        </Alert>
      )}

      <div className="space-y-4">
        <div>
          <h4 className="font-medium text-lg">{plan.name} plan</h4>
          <p className="text-2xl font-semibold text-primary tabular">
            {priceLabel(plan, isLifetime)}
          </p>
        </div>

        {subscription && isLifetime && (
          <p className="text-sm font-medium">
            {runningOutSubscriptionText(
              subscription,
              subscriptionPlanName,
              plan.name,
              formatDate(subscription.current_period_end),
            )}
          </p>
        )}

        {subscription && !isLifetime && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Current period</p>
              <p className="font-medium">
                {formatDate(subscription.current_period_start)} -{" "}
                {formatDate(subscription.current_period_end)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Next billing</p>
              <p className="font-medium">
                {subscription.cancel_at_period_end
                  ? "Plan will be canceled"
                  : formatDate(subscription.current_period_end)}
              </p>
            </div>
          </div>
        )}

        <div>
          <h5 className="font-medium mb-2">Plan features</h5>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {featuresWithAllowance(plan, monthlyCredits).map(
              (feature, index) => (
                <li key={index} className="flex items-center">
                  <svg
                    className="w-4 h-4 text-tone-success-text mr-2"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {feature}
                </li>
              ),
            )}
          </ul>
        </div>

        {subscription && shouldOfferSubscriptionActions && (
          <div className="pt-4 border-t">
            {subscription.cancel_at_period_end ? (
              <Button
                onClick={handleReactivateSubscription}
                disabled={loading}
                className="w-full"
              >
                {loading ? "Processing..." : "Reactivate Subscription"}
              </Button>
            ) : isConfirmingCancel ? (
              <div className="space-y-3">
                <p className="text-sm text-foreground">{cancelConfirmText}</p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setIsConfirmingCancel(false)}
                    disabled={loading}
                    className="flex-1"
                  >
                    Keep Subscription
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleCancelSubscription}
                    disabled={loading}
                    className="flex-1"
                  >
                    {loading ? "Cancelling..." : "Confirm Cancellation"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={() => setIsConfirmingCancel(true)}
                disabled={loading}
                variant="outline"
                className="w-full"
              >
                Cancel Subscription
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
