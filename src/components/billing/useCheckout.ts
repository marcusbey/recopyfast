"use client";

import { useRef, useState } from "react";
import type {
  BillingPeriod,
  OneTimeProductId,
  PaidPlanId,
} from "@/lib/stripe/plan-types";
import { formatRetryTime, rateLimitRetrySentence } from "./rate-limit-retry";

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
  const retryTime = formatRetryTime(retryAt);
  return retryTime ? `You can start a new checkout at ${retryTime}.` : null;
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
      const redirectUrl =
        typeof data?.resumeUrl === "string" && data.resumeUrl.length > 0
          ? data.resumeUrl
          : data?.url;
      const canResumeOpenCheckout =
        response.status === 409 &&
        typeof redirectUrl === "string" &&
        redirectUrl.length > 0;

      if (!response.ok && !canResumeOpenCheckout) {
        const responseError = data?.error || "Failed to start checkout";
        const retryMessage =
          response.status === 429
            ? rateLimitRetrySentence(response)
            : formatRetrySentence(data?.retryAt);

        throw new Error(
          retryMessage ? `${responseError} ${retryMessage}` : responseError,
        );
      }

      if (!redirectUrl) {
        throw new Error("Stripe did not return a checkout page");
      }

      // Full navigation, not router.push — Checkout is hosted on Stripe.
      window.location.assign(redirectUrl);
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
