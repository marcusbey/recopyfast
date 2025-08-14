'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

interface PurchaseTicketsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function PurchaseTicketsDialog({
  open,
  onOpenChange,
  onSuccess,
}: PurchaseTicketsDialogProps) {
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ticketsPerPack = 10;
  const pricePerPack = 5;
  const totalTickets = quantity * ticketsPerPack;
  const totalPrice = quantity * pricePerPack;

  const handlePurchase = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/billing/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quantity,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to purchase tickets');
      }

      const data = await response.json();

      // Handle payment confirmation if needed
      if (data.paymentIntent && data.paymentIntent.status === 'requires_confirmation') {
        // In a real implementation, you would use Stripe Elements here
        // For now, we'll assume the payment is handled externally
        alert('Payment confirmation required. Please complete the payment process.');
        return;
      }

      onSuccess();
      onOpenChange(false);
      setQuantity(1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Purchase AI Tickets</DialogTitle>
          <DialogDescription>
            Buy tickets to use AI-powered features like suggestions and translations.
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
              max="100"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              placeholder="1"
            />
            <p className="text-sm text-gray-600">
              Each pack contains {ticketsPerPack} tickets for ${pricePerPack}
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
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePurchase}
              disabled={loading}
              className="flex-1"
            >
              {loading ? 'Processing...' : `Purchase $${totalPrice}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}