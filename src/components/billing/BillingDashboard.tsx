"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SubscriptionCard } from "./SubscriptionCard";
import { PaymentMethodsCard } from "./PaymentMethodsCard";
import { InvoiceHistoryCard } from "./InvoiceHistoryCard";
import { CreditBalanceCard } from "./CreditBalanceCard";
import { UsageCard } from "./UsageCard";
import { UpgradeDialog } from "./UpgradeDialog";
import { CheckoutStatusBanner } from "./CheckoutStatusBanner";
import { findSubscriptionPlan } from "@/lib/stripe/plan-types";
import type { BillingDashboardData } from "@/types/billing";

export function BillingDashboard() {
  const [dashboardData, setDashboardData] =
    useState<BillingDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/billing/dashboard");

      if (!response.ok) {
        throw new Error("Failed to fetch billing data");
      }

      const data = await response.json();
      setDashboardData(data);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch billing data",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboardData();
  }, [fetchDashboardData]);

  const handleSubscriptionUpdate = useCallback(() => {
    void fetchDashboardData();
  }, [fetchDashboardData]);

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
          <h2 className="text-xl font-semibold text-red-600 mb-2">
            Error Loading Billing Data
          </h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={fetchDashboardData}>Try Again</Button>
        </Card>
      </div>
    );
  }

  // Both early returns above cover the null case; this narrows the type and
  // keeps a future refactor from rendering an empty dashboard silently.
  if (!dashboardData) {
    return null;
  }

  // The plan in force counts lifetime entitlements, not just subscriptions, so
  // it comes from the server rather than from the subscription row. Null means
  // the account has not paid; there is no free plan for it to be on.
  const currentPlan = dashboardData.effectivePlanId;
  const plan = findSubscriptionPlan(dashboardData.catalogue, currentPlan);

  // This is the whole page for an unpaid account. Every other dashboard route
  // redirects here (see src/middleware.ts), so it has to stand on its own
  // rather than assume the reader arrived by choice.
  if (currentPlan === null) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="mx-auto max-w-lg p-8 text-center">
          <h1 className="mb-2 text-2xl font-bold">Choose a plan to continue</h1>
          <p className="mb-6 text-gray-600">
            ReCopyFast needs an active subscription before your sites, editors
            and AI credits become available.
          </p>
          <Button size="lg" onClick={() => setShowUpgradeDialog(true)}>
            See plans
          </Button>
        </Card>

        <CheckoutStatusBanner onReconciled={handleSubscriptionUpdate} />

        <UpgradeDialog
          open={showUpgradeDialog}
          onOpenChange={setShowUpgradeDialog}
          currentPlan={null}
          catalogue={dashboardData.catalogue}
          onSuccess={handleSubscriptionUpdate}
        />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="p-6 text-center">
          <h2 className="text-xl font-semibold text-red-600 mb-2">
            Plan Catalogue Unavailable
          </h2>
          <p className="text-gray-600 mb-4">
            We could not load the plan you are on. Please try again.
          </p>
          <Button onClick={fetchDashboardData}>Try Again</Button>
        </Card>
      </div>
    );
  }

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
          <Badge variant="default" className="text-sm">
            {currentPlan.toUpperCase()} PLAN
          </Badge>
          <Button onClick={() => setShowUpgradeDialog(true)}>
            Change Plan
          </Button>
        </div>
      </div>

      <CheckoutStatusBanner onReconciled={handleSubscriptionUpdate} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 space-y-6">
          <SubscriptionCard
            subscription={dashboardData.subscription}
            plan={plan}
            onUpdate={handleSubscriptionUpdate}
          />
          <PaymentMethodsCard
            paymentMethods={dashboardData.paymentMethods}
            onUpdate={handleSubscriptionUpdate}
          />
          <InvoiceHistoryCard invoices={dashboardData.invoices} />
        </div>

        <div className="space-y-6">
          <CreditBalanceCard
            wallet={dashboardData.creditWallet}
            recentTransactions={dashboardData.recentTransactions}
            creditPack={dashboardData.catalogue.creditPack}
          />
          <UsageCard currentUsage={dashboardData.currentUsage} plan={plan} />
        </div>
      </div>

      <UpgradeDialog
        open={showUpgradeDialog}
        onOpenChange={setShowUpgradeDialog}
        currentPlan={currentPlan}
        catalogue={dashboardData.catalogue}
        onSuccess={handleSubscriptionUpdate}
      />
    </div>
  );
}
