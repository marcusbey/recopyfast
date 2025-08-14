'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface PaymentMethod {
  id: string;
  type: string;
  card?: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
  is_default: boolean;
  created: number;
}

interface PaymentMethodsCardProps {
  paymentMethods: PaymentMethod[];
  customerId?: string;
  onUpdate: () => void;
}

export function PaymentMethodsCard({ paymentMethods, customerId, onUpdate }: PaymentMethodsCardProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleDelete = async (paymentMethodId: string) => {
    if (!confirm('Are you sure you want to remove this payment method?')) {
      return;
    }

    try {
      setLoading(paymentMethodId);

      const response = await fetch(`/api/billing/payment-methods?paymentMethodId=${paymentMethodId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to remove payment method');
      }

      onUpdate();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(null);
    }
  };

  const getBrandIcon = (brand: string) => {
    switch (brand?.toLowerCase()) {
      case 'visa':
        return '💳';
      case 'mastercard':
        return '💳';
      case 'amex':
        return '💳';
      default:
        return '💳';
    }
  };

  const formatCardBrand = (brand: string) => {
    return brand.charAt(0).toUpperCase() + brand.slice(1);
  };

  return (
    <Card className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">Payment Methods</h3>
        <Button size="sm" variant="outline">
          Add New Card
        </Button>
      </div>

      {paymentMethods.length > 0 ? (
        <div className="space-y-3">
          {paymentMethods.map((pm) => (
            <div
              key={pm.id}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{getBrandIcon(pm.card?.brand || '')}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {formatCardBrand(pm.card?.brand || '')} •••• {pm.card?.last4}
                    </span>
                    {pm.is_default && (
                      <Badge variant="secondary" className="text-xs">
                        Default
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">
                    Expires {pm.card?.exp_month}/{pm.card?.exp_year}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!pm.is_default && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={loading === pm.id}
                  >
                    Set Default
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(pm.id)}
                  disabled={loading === pm.id || pm.is_default}
                  className="text-red-600 hover:text-red-700"
                >
                  {loading === pm.id ? 'Removing...' : 'Remove'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <p>No payment methods added yet</p>
          <p className="text-sm">Add a payment method to start your subscription</p>
        </div>
      )}
    </Card>
  );
}