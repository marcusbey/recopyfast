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
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { SUBSCRIPTION_PLANS } from '@/lib/stripe/config';

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: string;
  onSuccess: () => void;
}

export function UpgradeDialog({
  open,
  onOpenChange,
  currentPlan,
  onSuccess,
}: UpgradeDialogProps) {
  const [selectedPlan, setSelectedPlan] = useState<'pro' | 'enterprise'>('pro');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plans = [
    { id: 'pro' as const, data: SUBSCRIPTION_PLANS.PRO },
    { id: 'enterprise' as const, data: SUBSCRIPTION_PLANS.ENTERPRISE },
  ];

  const handleUpgrade = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/billing/subscription', {
        method: currentPlan === 'free' ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planId: selectedPlan,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upgrade plan');
      }

      const data = await response.json();

      // Handle payment confirmation if needed
      if (data.clientSecret) {
        // In a real implementation, you would use Stripe Elements here
        alert('Payment confirmation required. Please complete the payment process.');
        return;
      }

      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Upgrade Your Plan</DialogTitle>
          <DialogDescription>
            Choose a plan that fits your needs and unlock powerful features.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {error && (
            <Alert className="border-red-200 bg-red-50">
              <p className="text-red-700">{error}</p>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`p-6 border-2 rounded-lg cursor-pointer transition-all ${
                  selectedPlan === plan.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setSelectedPlan(plan.id)}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-semibold">{plan.data.name}</h3>
                    <p className="text-gray-600 mt-1">{plan.data.description}</p>
                  </div>
                  {selectedPlan === plan.id && (
                    <Badge className="bg-blue-500">Selected</Badge>
                  )}
                </div>

                <div className="mb-4">
                  <span className="text-3xl font-bold">${plan.data.price}</span>
                  <span className="text-gray-600">/month</span>
                </div>

                <ul className="space-y-2">
                  {plan.data.features.map((feature, index) => (
                    <li key={index} className="flex items-center text-sm">
                      <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="font-medium mb-2">What's Included:</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <h5 className="font-medium text-blue-600">AI Features</h5>
                <p className="text-gray-600">
                  Smart content suggestions, auto-translations, and AI-powered optimizations
                </p>
              </div>
              <div>
                <h5 className="font-medium text-blue-600">Collaboration</h5>
                <p className="text-gray-600">
                  Team management, real-time editing, and permission controls
                </p>
              </div>
              <div>
                <h5 className="font-medium text-blue-600">Priority Support</h5>
                <p className="text-gray-600">
                  Faster response times and dedicated support channels
                </p>
              </div>
              <div>
                <h5 className="font-medium text-blue-600">Advanced Analytics</h5>
                <p className="text-gray-600">
                  Detailed insights, conversion tracking, and performance metrics
                </p>
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-500 space-y-1">
            <p>• Cancel anytime - no long-term contracts</p>
            <p>• 14-day free trial for new subscribers</p>
            <p>• Prorated billing when upgrading mid-cycle</p>
            <p>• Secure payment processing by Stripe</p>
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpgrade}
              disabled={loading}
              className="flex-1"
            >
              {loading 
                ? 'Processing...' 
                : currentPlan === 'free' 
                  ? `Start ${SUBSCRIPTION_PLANS[selectedPlan.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS].name} Plan`
                  : `Upgrade to ${SUBSCRIPTION_PLANS[selectedPlan.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS].name}`
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}