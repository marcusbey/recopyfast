"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import type { CreditPackConfig } from "@/lib/stripe/plan-types";
import { useCheckout } from "./useCheckout";

/**
 * There is no `onSuccess` here: the purchase completes on Stripe's page, and
 * the wallet is refreshed by CheckoutStatusBanner once the customer is
 * redirected back and the webhook has credited the account.
 *
 * Pack size and price arrive as props from the server-resolved plan catalogue —
 * nothing about the product is compiled into this component.
 */
interface PurchaseCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creditPack: CreditPackConfig;
}

export function PurchaseCreditsDialog({
  open,
  onOpenChange,
  creditPack,
}: PurchaseCreditsDialogProps) {
  const [quantity, setQuantity] = useState(1);
  const { startCheckout, isRedirecting, error } = useCheckout();

  const { creditsPerPack, pricePerPack, maxPacksPerPurchase } = creditPack;
  const totalCredits = quantity * creditsPerPack;
  const totalPrice = Math.round(quantity * pricePerPack * 100) / 100;

  const handleQuantityChange = (value: string) => {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      setQuantity(1);
      return;
    }
    setQuantity(Math.min(maxPacksPerPurchase, Math.max(1, parsed)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Purchase AI credits</DialogTitle>
          <DialogDescription>
            Buy credits to use AI-powered features like suggestions and
            translations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert className="border-tone-danger-border bg-tone-danger-surface">
              <p className="text-tone-danger-text">{error}</p>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="quantity">Number of credit packs</Label>
            <Input
              id="quantity"
              type="number"
              min="1"
              max={maxPacksPerPurchase}
              value={quantity}
              disabled={isRedirecting}
              onChange={(e) => handleQuantityChange(e.target.value)}
              placeholder="1"
            />
            <p className="text-sm text-muted-foreground">
              Each pack contains {creditsPerPack.toLocaleString("en-US")}{" "}
              credits for ${pricePerPack}
            </p>
          </div>

          <div className="bg-surface-2 p-4 rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span>Credit packs:</span>
              <span className="tabular">{quantity}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Total credits:</span>
              <span className="tabular">
                {totalCredits.toLocaleString("en-US")}
              </span>
            </div>
            <div className="flex justify-between font-semibold border-t pt-2">
              <span>Total price:</span>
              <span className="tabular">${totalPrice}</span>
            </div>
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>• 1 credit = 1 AI suggestion; translations cost more</p>
            <p>• Unused credits are refunded if a feature fails</p>
            <p>• Payment is completed on Stripe&apos;s secure checkout page</p>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isRedirecting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => startCheckout({ intent: "credits", quantity })}
              disabled={isRedirecting}
              className="flex-1"
            >
              {isRedirecting
                ? "Redirecting to Stripe…"
                : `Purchase $${totalPrice}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
