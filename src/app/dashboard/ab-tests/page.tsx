"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, FlaskConical, AlertCircle } from "lucide-react";
import { useSites } from "@/hooks/useSites";
import { useContentElements } from "@/hooks/useContentElements";
import { SiteSelectorBar } from "@/components/dashboard/SiteSelectorBar";
import ABTestManager from "@/components/dashboard/ABTestManager";
import ABTestCreateFlow from "@/components/dashboard/ABTestCreateFlow";
import ABTestResults from "@/components/dashboard/ABTestResults";

type View = "list" | "create" | "results";

export default function ABTestsPage() {
  const searchParams = useSearchParams();
  const siteIdParam = searchParams.get("siteId");

  const {
    sites,
    selectedSiteId,
    setSelectedSiteId,
    loading,
    error: sitesError,
    refetch: refetchSites,
  } = useSites(siteIdParam || undefined);
  const {
    elements,
    loading: elementsLoading,
    error: elementsError,
    refetch: refetchElements,
  } = useContentElements(selectedSiteId);

  const [view, setView] = useState<View>("list");
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">A/B Tests</h1>
          <p className="mt-1 text-muted-foreground">
            Test copy variations to optimize conversions
          </p>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // A failed site list is not an empty account — say which one it is.
  if (sitesError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">A/B Tests</h1>
          <p className="mt-1 text-muted-foreground">
            Test copy variations to optimize conversions
          </p>
        </div>
        <Card>
          <CardContent className="py-12">
            <div className="text-center" role="alert">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-tone-danger-surface">
                <AlertCircle className="h-8 w-8 text-tone-danger-text" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                Couldn&apos;t load your sites
              </h3>
              <p className="mx-auto mb-6 max-w-sm text-muted-foreground">
                {sitesError}
              </p>
              <Button variant="outline" onClick={refetchSites}>
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (sites.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">A/B Tests</h1>
          <p className="mt-1 text-muted-foreground">
            Test copy variations to optimize conversions
          </p>
        </div>
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <FlaskConical className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                No sites found
              </h3>
              <p className="mx-auto mb-6 max-w-sm text-muted-foreground">
                Register a site first to start running A/B tests on your copy.
              </p>
              <Button
                onClick={() => (window.location.href = "/dashboard/sites")}
              >
                Go to Sites
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">A/B Tests</h1>
          <p className="mt-1 text-muted-foreground">
            Test copy variations to optimize conversions
          </p>
        </div>
        {view !== "list" && (
          <Button
            variant="outline"
            onClick={() => {
              setView("list");
              setSelectedTestId(null);
            }}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Tests
          </Button>
        )}
      </div>

      {/* Site Selector */}
      {view === "list" && (
        <SiteSelectorBar
          sites={sites}
          selectedSiteId={selectedSiteId}
          onSiteChange={setSelectedSiteId}
        />
      )}

      {/* Main Content */}
      {view === "list" && selectedSiteId && (
        <ABTestManager
          siteId={selectedSiteId}
          onCreateTest={() => setView("create")}
          onViewResults={(testId) => {
            setSelectedTestId(testId);
            setView("results");
          }}
        />
      )}

      {view === "create" && selectedSiteId && (
        <Card>
          <CardContent className="p-6">
            <ABTestCreateFlow
              siteId={selectedSiteId}
              elements={elements}
              elementsLoading={elementsLoading}
              elementsError={elementsError}
              onRetryElements={refetchElements}
              onComplete={(testId) => {
                setSelectedTestId(testId);
                setView("results");
              }}
              onCancel={() => setView("list")}
            />
          </CardContent>
        </Card>
      )}

      {view === "results" && selectedTestId && (
        <ABTestResults testId={selectedTestId} />
      )}
    </div>
  );
}
