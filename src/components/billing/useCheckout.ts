"use client";

import { useRef, useState } from "react";
import type { BillingPeriod, PaidPlanId } from "@/lib/stripe/plans";

/**
 * Starts a Stripe Checkout Session and hands the browser over to Stripe.
 *
 * Duplicate submits are swallowed: a ref guard blocks a second request while
 * one is in flight, and the guard is deliberately never released on success so
 * a click during the redirect cannot open a second session.
 */

export type CheckoutRequest =
  | { intent: "subscription"; planId: PaidPlanId; billingPeriod: BillingPeriod }
  | { intent: "tickets"; quantity: number }
  | { intent: "payment_method" };

interface UseCheckoutResult {
  startCheckout: (request: CheckoutRequest) => Promise<void>;
  isRedirecting: boolean;
  error: string | null;
  clearError: () => void;
}

const GENERIC_ERROR =
  "We could not reach the payment service. Check your connection and try again.";

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

      if (!response.ok) {
        throw new Error(data?.error || "Failed to start checkout");
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
