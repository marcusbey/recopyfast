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
import { TICKET_CONFIG } from "@/lib/stripe/plans";
import { useCheckout } from "./useCheckout";

/**
 * There is no `onSuccess` here: the purchase completes on Stripe's page, and
 * the wallet is refreshed by CheckoutStatusBanner once the customer is
 * redirected back and the webhook has credited the tickets.
 */
interface PurchaseTicketsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TICKETS_PER_PACK = TICKET_CONFIG.TICKETS_PER_PURCHASE;
const PRICE_PER_PACK =
  TICKET_CONFIG.TICKETS_PER_PURCHASE * TICKET_CONFIG.PRICE_PER_TICKET;
const MAX_PACKS = TICKET_CONFIG.MAX_PACKS_PER_PURCHASE;

export function PurchaseTicketsDialog({
  open,
  onOpenChange,
}: PurchaseTicketsDialogProps) {
  const [quantity, setQuantity] = useState(1);
  const { startCheckout, isRedirecting, error } = useCheckout();

  const totalTickets = quantity * TICKETS_PER_PACK;
  const totalPrice = quantity * PRICE_PER_PACK;

  const handleQuantityChange = (value: string) => {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      setQuantity(1);
      return;
    }
    setQuantity(Math.min(MAX_PACKS, Math.max(1, parsed)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Purchase AI Tickets</DialogTitle>
          <DialogDescription>
            Buy tickets to use AI-powered features like suggestions and
            translations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert className="border-red-200 bg-red-50">
              <p className="text-red-700">{error}</p>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="quantity">Number of Ticket Packs</Label>
            <Input
              id="quantity"
              type="number"
              min="1"
              max={MAX_PACKS}
              value={quantity}
              disabled={isRedirecting}
              onChange={(e) => handleQuantityChange(e.target.value)}
              placeholder="1"
            />
            <p className="text-sm text-gray-600">
              Each pack contains {TICKETS_PER_PACK} tickets for $
              {PRICE_PER_PACK}
            </p>
          </div>

          <div className="bg-blue-50 p-4 rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span>Ticket Packs:</span>
              <span>{quantity}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Total Tickets:</span>
              <span>{totalTickets}</span>
            </div>
            <div className="flex justify-between font-semibold border-t pt-2">
              <span>Total Price:</span>
              <span>${totalPrice}</span>
            </div>
          </div>

          <div className="text-xs text-gray-500 space-y-1">
            <p>• 1 ticket = 1 AI suggestion or translation</p>
            <p>• Tickets never expire</p>
            <p>• Unused tickets are refunded if features fail</p>
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
              onClick={() => startCheckout({ intent: "tickets", quantity })}
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
