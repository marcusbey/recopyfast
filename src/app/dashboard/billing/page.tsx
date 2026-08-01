import { Suspense } from "react";
import { BillingDashboard } from "@/components/billing/BillingDashboard";

export default function BillingPage() {
  return (
    <div className="min-h-screen bg-surface-1">
      <Suspense
        fallback={
          <div className="container mx-auto px-4 py-8">
            <div className="animate-pulse space-y-6">
              <div className="h-8 bg-muted rounded w-1/4"></div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-48 bg-muted rounded-lg"></div>
                ))}
              </div>
            </div>
          </div>
        }
      >
        <BillingDashboard />
      </Suspense>
    </div>
  );
}
