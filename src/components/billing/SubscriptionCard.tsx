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
  onUpdate: () => void;
}

export function SubscriptionCard({
  subscription,
  plan,
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

  const getStatusBadge = () => {
    if (!subscription) return <Badge variant="secondary">Free</Badge>;

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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

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
            {plan.price === 0 ? "Free" : `$${plan.price}/month`}
          </p>
        </div>

        {subscription && (
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
            {plan.features.map((feature, index) => (
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
            ))}
          </ul>
        </div>

        {subscription && subscription.status === "active" && (
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
                <p className="text-sm text-foreground">
                  Cancel your subscription? You keep access until{" "}
                  {formatDate(subscription.current_period_end)}, and you will
                  not be charged again.
                </p>
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
