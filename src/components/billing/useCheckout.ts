"use client";

import { useRef, useState } from "react";
import type {
  BillingPeriod,
  OneTimeProductId,
  PaidPlanId,
} from "@/lib/stripe/plan-types";

/**
 * Starts a Stripe Checkout Session and hands the browser over to Stripe.
 *
 * Duplicate submits are swallowed: a ref guard blocks a second request while
 * one is in flight, and the guard is deliberately never released on success so
 * a click during the redirect cannot open a second session.
 */

export type CheckoutRequest =
  | { intent: "subscription"; planId: PaidPlanId; billingPeriod: BillingPeriod }
  | { intent: "credits"; quantity: number }
  | { intent: "lifetime"; productId?: OneTimeProductId }
  | { intent: "payment_method" };

interface UseCheckoutResult {
  startCheckout: (request: CheckoutRequest) => Promise<void>;
  isRedirecting: boolean;
  error: string | null;
  clearError: () => void;
}

const GENERIC_ERROR =
  "We could not reach the payment service. Check your connection and try again.";

function formatRetrySentence(retryAt: unknown): string | null {
  if (typeof retryAt !== "string") {
    return null;
  }

  const retryDate = new Date(retryAt);
  if (Number.isNaN(retryDate.getTime())) {
    return null;
  }

  const retryTime = new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(retryDate);

  return `You can start a new checkout at ${retryTime}.`;
}

export function useCheckout(): UseCheckoutResult {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const startCheckout = async (request: CheckoutRequest): Promise<void> => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setIsRedirecting(true);
    setError(null);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      const data = await response.json().catch(() => null);

      // A pending-intent conflict can carry the still-open Stripe URL. Treat
      // that one response as a resumable handoff: the customer may have used
      // Stripe's cancel link, and discarding the URL here previously trapped
      // them on the billing page until the hour-long intent expired.
      const canResumeOpenCheckout =
        response.status === 409 &&
        typeof data?.url === "string" &&
        data.url.length > 0;

      if (!response.ok && !canResumeOpenCheckout) {
        const responseError = data?.error || "Failed to start checkout";
        const retrySentence =
          response.status === 409 ? formatRetrySentence(data?.retryAt) : null;

        throw new Error(
          retrySentence ? `${responseError} ${retrySentence}` : responseError,
        );
      }

      if (!data?.url) {
        throw new Error("Stripe did not return a checkout page");
      }

      // Full navigation, not router.push — Checkout is hosted on Stripe.
      window.location.assign(data.url);
    } catch (err: unknown) {
      inFlight.current = false;
      setIsRedirecting(false);
      setError(err instanceof Error ? err.message : GENERIC_ERROR);
    }
  };

  return {
    startCheckout,
    isRedirecting,
    error,
    clearError: () => setError(null),
  };
}
