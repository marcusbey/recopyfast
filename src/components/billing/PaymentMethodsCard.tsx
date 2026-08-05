"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { useCheckout } from "./useCheckout";
import type { PaymentMethod } from "@/types/billing";

interface PaymentMethodsCardProps {
  paymentMethods: PaymentMethod[];
  onUpdate: () => void;
}

/** Which row currently has a request in flight, and what it is doing. */
type PendingAction = { id: string; kind: "default" | "remove" } | null;

function formatCardBrand(brand: string): string {
  if (!brand) return "Card";
  if (brand === "amex") return "Amex";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function formatExpiry(month?: number, year?: number): string | null {
  if (!month || !year) return null;
  return `${String(month).padStart(2, "0")}/${year}`;
}

export function PaymentMethodsCard({
  paymentMethods,
  onUpdate,
}: PaymentMethodsCardProps) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(
    null,
  );

  const { startCheckout, isRedirecting, error: checkoutError } = useCheckout();

  const isBusy = pending !== null || isRedirecting;
  const visibleError = error ?? checkoutError;

  const runAction = async (
    action: NonNullable<PendingAction>,
    request: () => Promise<Response>,
    fallbackMessage: string,
  ) => {
    if (isBusy) {
      return;
    }

    setPending(action);
    setError(null);

    try {
      const response = await request();

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || fallbackMessage);
      }

      setConfirmingRemoval(null);
      onUpdate();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : fallbackMessage);
    } finally {
      setPending(null);
    }
  };

  const handleSetDefault = (paymentMethodId: string) =>
    runAction(
      { id: paymentMethodId, kind: "default" },
      () =>
        fetch("/api/billing/payment-methods", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentMethodId, setAsDefault: true }),
        }),
      "Could not set this card as your default.",
    );

  const handleRemove = (paymentMethodId: string) =>
    runAction(
      { id: paymentMethodId, kind: "remove" },
      () =>
        fetch(
          `/api/billing/payment-methods?paymentMethodId=${encodeURIComponent(paymentMethodId)}`,
          { method: "DELETE" },
        ),
      "Could not remove this payment method.",
    );

  return (
    <Card className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">Payment methods</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={isBusy}
          onClick={() => startCheckout({ intent: "payment_method" })}
        >
          {isRedirecting ? "Redirecting…" : "Add new card"}
        </Button>
      </div>

      {visibleError && (
        <Alert variant="destructive" className="mb-4">
          <p>{visibleError}</p>
        </Alert>
      )}

      {paymentMethods.length > 0 ? (
        <div className="space-y-3">
          {paymentMethods.map((pm) => {
            const expiry = formatExpiry(pm.exp_month, pm.exp_year);
            const isConfirming = confirmingRemoval === pm.id;
            const isSettingDefault =
              pending?.id === pm.id && pending.kind === "default";
            const isRemoving =
              pending?.id === pm.id && pending.kind === "remove";

            return (
              <div key={pm.id} className="p-3 border rounded-lg">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {formatCardBrand(pm.brand || "")} •••• {pm.last4}
                      </span>
                      {pm.is_default && (
                        <Badge variant="secondary" className="text-xs">
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {expiry ? `Expires ${expiry}` : "Saved card"}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {!pm.is_default && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSetDefault(pm.id)}
                        disabled={isBusy}
                      >
                        {isSettingDefault ? "Saving…" : "Set default"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setConfirmingRemoval(isConfirming ? null : pm.id)
                      }
                      disabled={isBusy}
                      className="text-destructive hover:text-destructive"
                    >
                      {isRemoving ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                </div>

                {isConfirming && (
                  <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
                    <p className="text-sm text-muted-foreground">
                      Remove this card? Any subscription billed to it will need
                      another card before it renews.
                    </p>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmingRemoval(null)}
                        disabled={isBusy}
                      >
                        Keep
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRemove(pm.id)}
                        disabled={isBusy}
                      >
                        {isRemoving ? "Removing…" : "Remove card"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <p>No payment methods added yet</p>
          <p className="text-sm">
            Add a card to start a subscription or buy AI credits
          </p>
        </div>
      )}
    </Card>
  );
}
