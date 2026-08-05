"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface CheckoutStatusBannerProps {
  /** Refetches the billing dashboard once Stripe's webhook has landed. */
  onReconciled: () => void;
}

type BannerState =
  | { kind: "hidden" }
  | { kind: "pending" }
  /** Stripe took the money but our webhook has not caught up yet. */
  | { kind: "slow"; paid: boolean }
  | { kind: "success"; message: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

interface CheckoutSessionStatus {
  mode: "payment" | "setup" | "subscription";
  status: "open" | "complete" | "expired" | null;
  paymentStatus: "paid" | "unpaid" | "no_payment_required";
  reconciled: boolean;
  paymentMethodId: string | null;
}

const SUCCESS_MESSAGES: Record<CheckoutSessionStatus["mode"], string> = {
  subscription: "Your subscription is active. Welcome aboard.",
  payment: "Payment received. Your purchase has been applied to your account.",
  setup: "Card saved. It is now your default payment method.",
};

// The Stripe webhook usually lands within a second or two of the redirect, but
// it is asynchronous — poll rather than assume.
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 10;

/**
 * Handles the leg of a Checkout flow that happens after Stripe redirects the
 * customer back to /dashboard/billing.
 *
 * It never grants anything itself: it reads the session from Stripe, waits for
 * the webhook-driven database write to appear, and then refreshes the page data.
 */
export function CheckoutStatusBanner({
  onReconciled,
}: CheckoutStatusBannerProps) {
  const [state, setState] = useState<BannerState>({ kind: "hidden" });
  const hasStarted = useRef(false);
  const isMounted = useRef(true);

  const finishSetupSession = useCallback(
    async (paymentMethodId: string): Promise<void> => {
      const response = await fetch("/api/billing/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethodId, setAsDefault: true }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.error ||
            "Your card was saved but could not be made the default. Try setting it manually.",
        );
      }
    },
    [],
  );

  useEffect(() => {
    isMounted.current = true;

    // Strict Mode mounts effects twice in development. The flow must start
    // exactly once, and the first run's poll must survive the throwaway
    // cleanup — hence the mounted ref rather than a per-run `cancelled` flag.
    if (hasStarted.current) {
      return () => {
        isMounted.current = false;
      };
    }

    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("checkout");
    const sessionId = params.get("session_id");

    if (!outcome) {
      return;
    }
    hasStarted.current = true;

    // Strip the Stripe params so a refresh does not replay the banner.
    window.history.replaceState({}, "", window.location.pathname);

    if (outcome === "cancelled") {
      setState({ kind: "cancelled" });
      return;
    }

    if (outcome !== "success" || !sessionId) {
      return;
    }

    setState({ kind: "pending" });

    let attempts = 0;

    const poll = async (): Promise<void> => {
      attempts += 1;

      try {
        const response = await fetch(
          `/api/billing/checkout?session_id=${encodeURIComponent(sessionId)}`,
        );

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "Could not confirm your payment");
        }

        const session = (await response.json()) as CheckoutSessionStatus;
        if (!isMounted.current) {
          return;
        }

        if (session.status === "expired") {
          setState({
            kind: "error",
            message:
              "That checkout session expired before it was paid. Nothing was charged — please try again.",
          });
          return;
        }

        // `reconciled` means the Stripe webhook has already written the
        // subscription, credit top-up or lifetime grant, so a refetch will show
        // real data.
        if (!session.reconciled) {
          if (attempts >= MAX_POLL_ATTEMPTS) {
            setState({
              kind: "slow",
              paid: session.paymentStatus === "paid",
            });
            return;
          }
          setTimeout(() => void poll(), POLL_INTERVAL_MS);
          return;
        }

        if (session.mode === "setup" && session.paymentMethodId) {
          await finishSetupSession(session.paymentMethodId);
        }

        if (!isMounted.current) {
          return;
        }

        setState({ kind: "success", message: SUCCESS_MESSAGES[session.mode] });
        onReconciled();
      } catch (err: unknown) {
        if (!isMounted.current) {
          return;
        }
        setState({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Could not confirm your payment. Refresh in a moment — if you were charged, it will appear here.",
        });
      }
    };

    void poll();

    return () => {
      isMounted.current = false;
    };
  }, [finishSetupSession, onReconciled]);

  if (state.kind === "hidden") {
    return null;
  }

  if (state.kind === "pending") {
    return (
      <Alert variant="info" className="mb-6">
        <p>
          Confirming your payment with Stripe. This usually takes a few seconds
          — you can safely stay on this page.
        </p>
      </Alert>
    );
  }

  if (state.kind === "slow") {
    return (
      <Alert variant="warning" className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <p>
            {state.paid
              ? "Your payment went through, but it is taking longer than usual to appear on this page. Nothing is lost — refresh in a minute, and contact support if it still looks wrong."
              : "We could not confirm this payment. If your card was charged it will show up here shortly; otherwise nothing was taken."}
          </p>
          <Button size="sm" variant="outline" onClick={onReconciled}>
            Refresh
          </Button>
        </div>
      </Alert>
    );
  }

  if (state.kind === "success") {
    return (
      <Alert variant="success" className="mb-6">
        <p>{state.message}</p>
      </Alert>
    );
  }

  if (state.kind === "cancelled") {
    return (
      <Alert className="mb-6">
        <p className="text-muted-foreground">
          Checkout was cancelled. You have not been charged.
        </p>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <p>{state.message}</p>
        <Button size="sm" variant="outline" onClick={onReconciled}>
          Refresh
        </Button>
      </div>
    </Alert>
  );
}
