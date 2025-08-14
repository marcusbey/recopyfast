'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SubscriptionCard } from './SubscriptionCard';
import { PaymentMethodsCard } from './PaymentMethodsCard';
import { InvoiceHistoryCard } from './InvoiceHistoryCard';
import { TicketBalanceCard } from './TicketBalanceCard';
import { UsageCard } from './UsageCard';
import { UpgradeDialog } from './UpgradeDialog';
import type { BillingDashboardData } from '@/types/billing';

export function BillingDashboard() {
  const [dashboardData, setDashboardData] = useState<BillingDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/billing/dashboard');
      
      if (!response.ok) {
        throw new Error('Failed to fetch billing data');
      }

      const data = await response.json();
      setDashboardData(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscriptionUpdate = () => {
    fetchDashboardData();
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-48 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="p-6 text-center">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Error Loading Billing Data</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={fetchDashboardData}>Try Again</Button>
        </Card>
      </div>
    );
  }

  const currentPlan = dashboardData?.subscription?.plan_id || 'free';
  const isPaidPlan = currentPlan !== 'free';

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Billing & Subscription</h1>
          <p className="text-gray-600 mt-2">
            Manage your subscription, payment methods, and billing information
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={isPaidPlan ? 'default' : 'secondary'} className="text-sm">
            {currentPlan.toUpperCase()} PLAN
          </Badge>
          {!isPaidPlan && (
            <Button onClick={() => setShowUpgradeDialog(true)}>
              Upgrade Plan
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 space-y-6">
          <SubscriptionCard
            subscription={dashboardData?.subscription}
            onUpdate={handleSubscriptionUpdate}
          />
          <PaymentMethodsCard
            paymentMethods={dashboardData?.paymentMethods || []}
            customerId={dashboardData?.customer?.id}
            onUpdate={handleSubscriptionUpdate}
          />
          <InvoiceHistoryCard invoices={dashboardData?.invoices || []} />
        </div>

        <div className="space-y-6">
          <TicketBalanceCard
            tickets={dashboardData?.tickets}
            recentTransactions={dashboardData?.recentTransactions || []}
            onUpdate={handleSubscriptionUpdate}
          />
          <UsageCard
            currentUsage={dashboardData?.currentUsage || {
              websites: 0,
              collaborators: 0,
              aiUsage: 0,
              translations: 0,
            }}
            subscription={dashboardData?.subscription}
          />
        </div>
      </div>

      <UpgradeDialog
        open={showUpgradeDialog}
        onOpenChange={setShowUpgradeDialog}
        currentPlan={currentPlan}
        onSuccess={handleSubscriptionUpdate}
      />
    </div>
  );
}