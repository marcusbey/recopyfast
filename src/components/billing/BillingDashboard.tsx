"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import {
  LifetimeOfferCard,
  resolveLifetimeOffer,
  type LifetimeGrantStatus,
} from "./LifetimeOfferCard";
import { findSubscriptionPlan } from "@/lib/stripe/plan-types";
import type { BillingDashboardData } from "@/types/billing";

interface BillingDashboardProps {
  /**
   * Whether a permanent plan grant is already in force, resolved server-side by
   * the page. It cannot be derived from the dashboard payload — see
   * LifetimeOfferCard for why — and it decides whether Lifetime Pro is offered.
   */
  lifetimeGrant: LifetimeGrantStatus;
}

export function BillingDashboard({ lifetimeGrant }: BillingDashboardProps) {
  const router = useRouter();
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
    // `lifetimeGrant` is a server prop, so refetching the dashboard payload
    // alone would leave it stale — and stale here means still offering Lifetime
    // Pro to someone who has just this second bought it. `router.refresh()`
    // re-runs the page's grant read and replaces the prop.
    router.refresh();
  }, [fetchDashboardData, router]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-surface-2 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-48 bg-surface-2 rounded-lg"></div>
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
          <h2 className="text-xl font-semibold text-tone-danger-text mb-2">
            Error loading billing data
          </h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={fetchDashboardData}>Try again</Button>
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

  // Credits entitle their holder to spend them and to nothing else, so they
  // have no plan and land here too — but telling them their credits are
  // unavailable would be false, and they can reach this page under their own
  // steam rather than being bounced to it.
  const creditBalance = dashboardData.creditWallet?.balance ?? 0;
  const holdsCredits = creditBalance > 0;

  // Lifetime Pro is a way *in* for an account with no plan and a way *out* of a
  // subscription for one that has one, so it is resolved before the unentitled
  // branch below and offered in both.
  const lifetimeOffer = resolveLifetimeOffer(
    dashboardData.catalogue,
    lifetimeGrant,
  );
  // `subscription` only ever holds a live row (see getUserSubscription), so its
  // presence is exactly "something is still billing this card every month".
  const hasLiveSubscription = Boolean(dashboardData.subscription);

  // This is the whole page for an account with no plan. Every other dashboard
  // route redirects a wholly unentitled session here (see src/middleware.ts),
  // so it has to stand on its own rather than assume the reader arrived by
  // choice.
  if (currentPlan === null) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="mx-auto max-w-lg p-8 text-center">
          <h1 className="mb-2 text-2xl font-semibold">
            {holdsCredits ? "You're on credits" : "Choose a plan to continue"}
          </h1>
          <p className="mb-6 text-muted-foreground">
            {holdsCredits
              ? `You have ${creditBalance.toLocaleString("en-US")} credits to spend on AI suggestions and translations. Sites, collaborators and A/B testing need a plan.`
              : "ReCopyFast needs an active subscription before your sites, editors and AI credits become available."}
          </p>
          <Button size="lg" onClick={() => setShowUpgradeDialog(true)}>
            See plans
          </Button>
        </Card>

        <CheckoutStatusBanner onReconciled={handleSubscriptionUpdate} />

        {lifetimeOffer && (
          <div className="mx-auto mt-6 max-w-lg">
            <LifetimeOfferCard
              product={lifetimeOffer}
              hasLiveSubscription={hasLiveSubscription}
            />
          </div>
        )}

        <UpgradeDialog
          open={showUpgradeDialog}
          onOpenChange={setShowUpgradeDialog}
          currentPlan={null}
          catalogue={dashboardData.catalogue}
          lifetimeOffer={lifetimeOffer}
          onSuccess={handleSubscriptionUpdate}
        />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="p-6 text-center">
          <h2 className="text-xl font-semibold text-tone-danger-text mb-2">
            Plan catalogue unavailable
          </h2>
          <p className="text-muted-foreground mb-4">
            We could not load the plan you are on. Please try again.
          </p>
          <Button onClick={fetchDashboardData}>Try again</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-display">Billing & subscription</h1>
          <p className="text-muted-foreground mt-2">
            Manage your subscription, payment methods, and billing information
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="default" className="text-sm">
            {currentPlan.toUpperCase()} PLAN
          </Badge>
          <Button onClick={() => setShowUpgradeDialog(true)}>
            Change plan
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
          {lifetimeOffer && (
            <LifetimeOfferCard
              product={lifetimeOffer}
              hasLiveSubscription={hasLiveSubscription}
            />
          )}
        </div>
      </div>

      <UpgradeDialog
        open={showUpgradeDialog}
        onOpenChange={setShowUpgradeDialog}
        currentPlan={currentPlan}
        catalogue={dashboardData.catalogue}
        lifetimeOffer={lifetimeOffer}
        onSuccess={handleSubscriptionUpdate}
      />
    </div>
  );
}
