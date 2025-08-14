'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SUBSCRIPTION_PLANS } from '@/lib/stripe/config';
import type { Subscription } from '@/types/billing';

interface UsageCardProps {
  currentUsage: {
    websites: number;
    collaborators: number;
    aiUsage: number;
    translations: number;
  };
  subscription?: Subscription;
}

export function UsageCard({ currentUsage, subscription }: UsageCardProps) {
  const planId = subscription?.plan_id || 'free';
  const plan = SUBSCRIPTION_PLANS[planId.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];

  const getUsageStatus = (current: number, limit: number) => {
    if (limit === -1) return 'unlimited';
    if (current >= limit) return 'exceeded';
    if (current >= limit * 0.8) return 'warning';
    return 'normal';
  };

  const getUsageBadge = (current: number, limit: number) => {
    const status = getUsageStatus(current, limit);
    
    if (limit === -1) {
      return <Badge variant="secondary">Unlimited</Badge>;
    }
    
    const variant = status === 'exceeded' ? 'destructive' :
                   status === 'warning' ? 'secondary' :
                   'default';

    return (
      <Badge variant={variant}>
        {current} / {limit}
      </Badge>
    );
  };

  const getProgressBarColor = (current: number, limit: number) => {
    const status = getUsageStatus(current, limit);
    
    return status === 'exceeded' ? 'bg-red-500' :
           status === 'warning' ? 'bg-yellow-500' :
           'bg-blue-500';
  };

  const getProgressPercentage = (current: number, limit: number) => {
    if (limit === -1) return 0;
    return Math.min((current / limit) * 100, 100);
  };

  const usageItems = [
    {
      label: 'Websites',
      current: currentUsage.websites,
      limit: plan.limits.websites,
      icon: '🌐',
    },
    {
      label: 'AI Usage (this month)',
      current: currentUsage.aiUsage,
      limit: plan.limits.aiFeatures ? -1 : 0,
      icon: '🤖',
    },
    {
      label: 'Translations (this month)',
      current: currentUsage.translations,
      limit: plan.limits.translations,
      icon: '🌍',
    },
  ];

  return (
    <Card className="p-6">
      <h3 className="text-xl font-semibold mb-4">Current Usage</h3>

      <div className="space-y-4">
        {usageItems.map((item) => (
          <div key={item.label} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </div>
              {getUsageBadge(item.current, item.limit)}
            </div>
            
            {item.limit !== -1 && (
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${getProgressBarColor(item.current, item.limit)}`}
                  style={{ width: `${getProgressPercentage(item.current, item.limit)}%` }}
                ></div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <h4 className="font-medium text-blue-900 mb-2">
          {plan.name} Plan Benefits
        </h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• {plan.limits.websites === -1 ? 'Unlimited' : plan.limits.websites} website{plan.limits.websites !== 1 ? 's' : ''}</li>
          <li>• {plan.limits.aiFeatures ? 'AI features included' : 'No AI features (use tickets)'}</li>
          <li>• {plan.limits.translations === -1 ? 'Unlimited' : plan.limits.translations === 0 ? 'No' : plan.limits.translations} translation{plan.limits.translations !== 1 ? 's' : ''}</li>
          <li>• {plan.limits.collaborators === -1 ? 'Unlimited' : plan.limits.collaborators} collaborator{plan.limits.collaborators !== 1 ? 's' : ''} per site</li>
        </ul>
      </div>
    </Card>
  );
}