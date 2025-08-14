'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { SUBSCRIPTION_PLANS } from '@/lib/stripe/config';
import type { Subscription } from '@/types/billing';

interface SubscriptionCardProps {
  subscription?: Subscription;
  onUpdate: () => void;
}

export function SubscriptionCard({ subscription, onUpdate }: SubscriptionCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPlan = subscription?.plan_id || 'free';
  const planData = SUBSCRIPTION_PLANS[currentPlan.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];

  const handleCancelSubscription = async () => {
    if (!confirm('Are you sure you want to cancel your subscription? Your plan will remain active until the end of your billing period.')) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/billing/subscription', {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to cancel subscription');
      }

      onUpdate();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReactivateSubscription = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/billing/subscription/reactivate', {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reactivate subscription');
      }

      onUpdate();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = () => {
    if (!subscription) return <Badge variant="secondary">Free</Badge>;

    const variant = subscription.status === 'active' ? 'default' :
                   subscription.status === 'trialing' ? 'secondary' :
                   subscription.status === 'past_due' ? 'destructive' :
                   'outline';

    return <Badge variant={variant}>{subscription.status.replace('_', ' ').toUpperCase()}</Badge>;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <Card className="p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-semibold">Current Subscription</h3>
          <p className="text-gray-600 mt-1">{planData.description}</p>
        </div>
        {getStatusBadge()}
      </div>

      {error && (
        <Alert className="mb-4 border-red-200 bg-red-50">
          <p className="text-red-700">{error}</p>
        </Alert>
      )}

      <div className="space-y-4">
        <div>
          <h4 className="font-medium text-lg">{planData.name} Plan</h4>
          <p className="text-2xl font-bold text-blue-600">
            {planData.price === 0 ? 'Free' : `$${planData.price}/month`}
          </p>
        </div>

        {subscription && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-600">Current Period</p>
              <p className="font-medium">
                {formatDate(subscription.current_period_start)} - {formatDate(subscription.current_period_end)}
              </p>
            </div>
            <div>
              <p className="text-gray-600">Next Billing</p>
              <p className="font-medium">
                {subscription.cancel_at_period_end 
                  ? 'Plan will be canceled' 
                  : formatDate(subscription.current_period_end)
                }
              </p>
            </div>
          </div>
        )}

        <div>
          <h5 className="font-medium mb-2">Plan Features</h5>
          <ul className="space-y-1 text-sm text-gray-600">
            {planData.features.map((feature, index) => (
              <li key={index} className="flex items-center">
                <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {subscription && subscription.status === 'active' && (
          <div className="flex gap-3 pt-4 border-t">
            {subscription.cancel_at_period_end ? (
              <Button
                onClick={handleReactivateSubscription}
                disabled={loading}
                className="flex-1"
              >
                {loading ? 'Processing...' : 'Reactivate Subscription'}
              </Button>
            ) : (
              <Button
                onClick={handleCancelSubscription}
                disabled={loading}
                variant="outline"
                className="flex-1"
              >
                {loading ? 'Processing...' : 'Cancel Subscription'}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}