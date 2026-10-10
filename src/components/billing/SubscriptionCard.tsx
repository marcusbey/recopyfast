"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  featuresWithMonthlyCredits,
  type SubscriptionPlan,
} from "@/lib/stripe/plan-types";
import type { Subscription } from "@/types/billing";

interface SubscriptionCardProps {
  subscription?: Subscription;
  /** Plan in force, resolved server-side from the `plans` table. */
  plan: SubscriptionPlan;
  /**
   * The plan in force is held through a permanent grant, so it has no monthly
   * price to show. A subscription may still be running out beside it — even
   * one on the same plan, bought before the grant (s71 review M-1) — and gets
   * its own named row; it never makes the plan in force a monthly one.
   */
  isLifetime: boolean;
  /**
   * s96, folded into s82 (Devin Review on PR #81, finding 3): when the grant
   * holding the plan in force is dated, when it ends (ISO). The card then says
   * "Included until <date>" where it would say lifetime: a dated grant ends,
   * and a subscription beside it is what keeps the plan afterwards. Read only
   * with `isLifetime`; absent for a plan held for life.
   */
  heldUntil?: string;
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
  /**
   * s82: the allowance this account keeps once `subscription` ends, sent by
   * the server only when it is lower than `monthlyCredits` — the subscription
   * is what raises it. Read only on the running-out row under a plan held for
   * life.
   */
  includedAfterSubscription?: number | null;
  onUpdate: () => void;
}

/**
 * s71 review m-3: a plan priced 0 printed "Free" here, one row below the badge
 * that had just stopped saying it. "Free" names a retired plan nobody is on;
 * a zero price is stated as a price, like any other.
 */
function priceLabel(
  plan: SubscriptionPlan,
  isLifetime: boolean,
  heldUntilDate: string | null,
): string {
  if (isLifetime) {
    return heldUntilDate
      ? `Included until ${heldUntilDate}`
      : "Lifetime access";
  }
  return `$${plan.price}/month`;
}

/** Who the running-out row is about when the catalogue cannot name its plan. */
const UNNAMED_SUBSCRIPTION = "Your previous subscription";

/**
 * s82 (s71 review N-1): appended to the running-out row and the cancel
 * confirmation when the subscription is what raises the allowance. A Founding
 * Agency owner running out an Agency subscription reads "1,000 AI credits /
 * month" — true while it runs — and nothing said it drops to 250 after
 * (ADR 038). Empty when the server sent no lower number.
 */
function allowanceWithoutSubscriptionText(
  includedAfterSubscription: number | null | undefined,
): string {
  return typeof includedAfterSubscription === "number"
    ? ` Without it, your plan includes ${includedAfterSubscription.toLocaleString(
        "en-US",
      )} AI credits a month.`
    : "";
}

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
  heldUntilDate: string | null,
): string {
  const subject = subscriptionPlanName
    ? `Your ${subscriptionPlanName} subscription`
    : UNNAMED_SUBSCRIPTION;
  // s96 (Devin finding 3): beside a dated grant the subscription is what keeps
  // the plan once the grant ends, so it is never "no longer needed".
  const noLongerNeeded = heldUntilDate
    ? `${heldPlanName} is included until ${heldUntilDate}.`
    : `you hold ${heldPlanName} for life, so you no longer need it.`;
  // A live row is active, trialing or past_due (getUserSubscription); only
  // "active" goes without saying.
  if (subscription.status === "active") {
    return subscription.cancel_at_period_end
      ? `${subject} ends ${periodEnd} — you won't be charged again.`
      : `${subject} renews ${periodEnd} — ${noLongerNeeded}`;
  }
  const status = subscription.status.replace("_", " ");
  // Review N-2: a past-due or trialing row not set to cancel is not said to
  // "renew" on its period end — a past-due invoice is being retried now.
  if (!subscription.cancel_at_period_end) {
    return `${subject} is ${status} — ${noLongerNeeded}`;
  }
  return subscription.status === "past_due"
    ? `${subject} is ${status} and ends ${periodEnd} — it will not renew.`
    : `${subject} is ${status} and ends ${periodEnd} — you won't be charged again.`;
}

export function SubscriptionCard({
  subscription,
  plan,
  isLifetime,
  heldUntil,
  subscriptionPlanName,
  monthlyCredits,
  includedAfterSubscription,
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
  // as a fallback. A plan held for life wins over any subscription still
  // running out its period, lower or the same plan: the badge speaks for the
  // plan in force, and the subscription's status moves to its named row. With
  // neither (a trial has no row), no badge beats a wrong one.
  const getStatusBadge = () => {
    // s96: a dated grant is "Included", as the dialog calls it — never Lifetime.
    if (isLifetime) {
      return (
        <Badge variant="default">{heldUntil ? "Included" : "Lifetime"}</Badge>
      );
    }
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

  // The plan in force's grant end, when the grant is dated (s96).
  const heldUntilDate = isLifetime && heldUntil ? formatDate(heldUntil) : null;

  // s71: under a plan held for life, cancelling the lower subscription ends
  // nothing the owner keeps — "You keep access until <period end>" was untrue.
  // s96: under a dated grant it ends nothing before the grant does.
  const cancelConfirmText = !subscription
    ? ""
    : isLifetime
      ? `Cancel ${
          subscriptionPlanName
            ? `your ${subscriptionPlanName} subscription`
            : UNNAMED_SUBSCRIPTION.toLowerCase()
        }? ${
          heldUntilDate
            ? `${plan.name} stays included until ${heldUntilDate}`
            : `You keep ${plan.name} for life`
        }, and you will not be charged again.${allowanceWithoutSubscriptionText(
          includedAfterSubscription,
        )}`
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
            {priceLabel(plan, isLifetime, heldUntilDate)}
          </p>
        </div>

        {subscription && isLifetime && (
          <p className="text-sm font-medium">
            {runningOutSubscriptionText(
              subscription,
              subscriptionPlanName,
              plan.name,
              formatDate(subscription.current_period_end),
              heldUntilDate,
            ) + allowanceWithoutSubscriptionText(includedAfterSubscription)}
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
            {/* s45 review, finding 3: a lifetime Founding Agency owner holds
                `agency` with 250 monthly credits (ADR 038), but this card
                printed the Agency row's bullets verbatim — "1,000 AI credits /
                month" beside a wallet saying 250. The number comes from the
                resolved allowance; the bullet is found by the plan's own
                limit, never by its wording (s82). */}
            {featuresWithMonthlyCredits(plan, monthlyCredits).map(
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
