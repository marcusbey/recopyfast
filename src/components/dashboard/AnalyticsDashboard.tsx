"use client";

import React, { useState, useEffect, useCallback, useId } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsDashboardData, Site } from "@/types";
import {
  BarChart3,
  Users,
  Clock,
  TrendingUp,
  Download,
  Eye,
  Edit3,
  Globe,
  Activity,
  AlertCircle,
} from "lucide-react";

interface AnalyticsDashboardProps {
  siteId?: string;
  sites?: Site[];
}

/**
 * Pull the server's error message out of a failed response so the user sees
 * "Forbidden" rather than a generic failure. Falls back to the status text when
 * the body is not the JSON error envelope (e.g. an HTML error page).
 */
async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: unknown }).error;
    if (typeof message === "string" && message) return message;
  } catch {
    // Body was not JSON — fall through to the status-based message.
  }
  return `${fallback} (${response.status})`;
}

export function AnalyticsDashboard({ siteId, sites }: AnalyticsDashboardProps) {
  const [data, setData] = useState<AnalyticsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const [selectedSite, setSelectedSite] = useState(siteId || "all");
  const siteSelectId = useId();
  const startDateId = useId();
  const endDateId = useId();
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    end: new Date().toISOString().split("T")[0],
  });

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const params = new URLSearchParams({
        startDate: dateRange.start,
        endDate: dateRange.end,
      });

      if (selectedSite !== "all") {
        params.append("siteId", selectedSite);
      }

      const response = await fetch(`/api/analytics/track?${params}`);
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to load analytics"),
        );
      }

      const analyticsData: AnalyticsDashboardData = await response.json();
      setData(analyticsData);
    } catch (error) {
      // An outage must not render as an empty account — keep the previous data
      // on screen if we have it and show the failure explicitly.
      setLoadError(
        error instanceof Error ? error.message : "Failed to load analytics",
      );
    } finally {
      setLoading(false);
    }
  }, [selectedSite, dateRange]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const exportData = async (format: "json" | "csv") => {
    setExporting(format);
    setExportError(null);
    try {
      const params = new URLSearchParams({
        format,
        startDate: dateRange.start,
        endDate: dateRange.end,
      });

      if (selectedSite !== "all") {
        params.append("siteId", selectedSite);
      }

      const response = await fetch(`/api/analytics/export?${params}`);
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "Failed to export analytics"),
        );
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analytics-${dateRange.start}-${dateRange.end}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Failed to export analytics",
      );
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-6">
              <div className="animate-pulse">
                <div className="h-4 bg-surface-3 rounded w-3/4 mb-2"></div>
                <div className="h-8 bg-surface-3 rounded w-1/2"></div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // A failed load with nothing cached is an error, not an empty account. Only
  // claim "no data" when the request actually succeeded and came back empty.
  if (!data && loadError) {
    return (
      <div className="text-center py-12" role="alert">
        <AlertCircle className="mx-auto h-12 w-12 text-tone-danger-text" />
        <h3 className="mt-2 text-sm font-medium text-foreground">
          Couldn&apos;t load analytics
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={fetchAnalytics}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-2 text-sm font-medium text-foreground">
          No analytics data
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Start using ReCopyFast to see analytics.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Analytics Dashboard
          </h2>
          <p className="text-muted-foreground">
            Monitor your site performance and user engagement
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {/* Site Selector */}
          {sites && sites.length > 0 && (
            <div>
              <label htmlFor={siteSelectId} className="sr-only">
                Filter by site
              </label>
              <select
                id={siteSelectId}
                value={selectedSite}
                onChange={(e) => setSelectedSite(e.target.value)}
                className="px-3 py-2 border border-input rounded-md text-sm"
              >
                <option value="all">All Sites</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.domain}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date Range */}
          <div className="flex gap-2">
            <div>
              <label htmlFor={startDateId} className="sr-only">
                Start date
              </label>
              <input
                id={startDateId}
                type="date"
                value={dateRange.start}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, start: e.target.value }))
                }
                className="px-3 py-2 border border-input rounded-md text-sm"
              />
            </div>
            <div>
              <label htmlFor={endDateId} className="sr-only">
                End date
              </label>
              <input
                id={endDateId}
                type="date"
                value={dateRange.end}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, end: e.target.value }))
                }
                className="px-3 py-2 border border-input rounded-md text-sm"
              />
            </div>
          </div>

          {/* Export */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={exporting !== null}
              onClick={() => exportData("json")}
            >
              <Download className="h-4 w-4 mr-2" />
              {exporting === "json" ? "Exporting..." : "JSON"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={exporting !== null}
              onClick={() => exportData("csv")}
            >
              <Download className="h-4 w-4 mr-2" />
              {exporting === "csv" ? "Exporting..." : "CSV"}
            </Button>
          </div>
        </div>
      </div>

      {/* A refresh that failed while earlier data is still on screen: say so,
          otherwise the stale numbers read as current. */}
      {loadError && (
        <p
          role="alert"
          className="text-sm text-tone-danger-text bg-tone-danger-surface border border-tone-danger-border rounded-md px-3 py-2"
        >
          Showing the last loaded data — refresh failed: {loadError}
        </p>
      )}

      {exportError && (
        <p
          role="alert"
          className="text-sm text-tone-danger-text bg-tone-danger-surface border border-tone-danger-border rounded-md px-3 py-2"
        >
          {exportError}
        </p>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Total Sites
              </p>
              <p className="text-3xl font-bold text-foreground">
                {data.overview.total_sites}
              </p>
            </div>
            <Globe className="h-8 w-8 text-tone-info-text" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Active Users
              </p>
              <p className="text-3xl font-bold text-foreground">
                {data.overview.total_users}
              </p>
            </div>
            <Users className="h-8 w-8 text-tone-success-text" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Page Views
              </p>
              <p className="text-3xl font-bold text-foreground">
                {data.overview.total_page_views.toLocaleString()}
              </p>
            </div>
            <Eye className="h-8 w-8 text-tone-accent-text" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Content Edits
              </p>
              <p className="text-3xl font-bold text-foreground">
                {data.overview.total_edits.toLocaleString()}
              </p>
            </div>
            <Edit3 className="h-8 w-8 text-tone-warning-text" />
          </div>
        </Card>
      </div>

      {/* Performance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Avg Load Time
              </p>
              <p className="text-2xl font-bold text-foreground">
                {data.performance.avg_load_time}ms
              </p>
            </div>
            <Clock className="h-6 w-6 text-tone-info-text" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Avg Edit Time
              </p>
              <p className="text-2xl font-bold text-foreground">
                {data.performance.avg_edit_time.toFixed(0)}ms
              </p>
            </div>
            <Activity className="h-6 w-6 text-tone-success-text" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Conversion Rate
              </p>
              <p className="text-2xl font-bold text-foreground">
                {(data.overview.conversion_rate * 100).toFixed(1)}%
              </p>
            </div>
            <TrendingUp className="h-6 w-6 text-tone-accent-text" />
          </div>
        </Card>
      </div>

      {/* Detailed Analytics */}
      <Tabs defaultValue="trends" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="sites">Top Sites</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Page Views Trend</h3>
              <SimpleChart
                data={data.trends.page_views}
                color="blue"
                label="Page Views"
              />
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">
                Content Edits Trend
              </h3>
              <SimpleChart
                data={data.trends.edits}
                color="green"
                label="Edits"
              />
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Active Users Trend</h3>
              <SimpleChart
                data={data.trends.users}
                color="purple"
                label="Users"
              />
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sites" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Top Performing Sites</h3>
            <div className="space-y-4">
              {data.top_sites.map((site, index) => (
                <div
                  key={site.site_id}
                  className="flex items-center justify-between p-4 bg-surface-1 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-muted-foreground">
                      #{index + 1}
                    </span>
                    <div>
                      <p className="font-medium">{site.domain}</p>
                      <p className="text-sm text-muted-foreground">
                        {site.page_views} views • {site.edits} edits
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">{site.page_views}</p>
                    <p className="text-sm text-muted-foreground">page views</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">
                Load Time Distribution
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Average</span>
                  <span>{data.performance.avg_load_time}ms</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Edit Time</span>
                  <span>{data.performance.avg_edit_time.toFixed(0)}ms</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Error Rate</span>
                  <span>{(data.performance.error_rate * 100).toFixed(2)}%</span>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Performance Score</h3>
              <div className="flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl font-bold text-tone-success-text">
                    {Math.max(
                      0,
                      Math.min(100, 100 - data.performance.avg_load_time / 20),
                    ).toFixed(0)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Performance Score
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Bar fills must be written as complete literal class names. Tailwind scans
 * source text at build time and never sees an interpolated `bg-${color}-200`,
 * so the class is absent from the stylesheet and every bar renders unstyled.
 */
const CHART_BAR_CLASSES = {
  blue: "bg-tone-info-border",
  green: "bg-tone-success-border",
  purple: "bg-tone-accent-border",
} as const;

type ChartColor = keyof typeof CHART_BAR_CLASSES;

// Simple Chart Component (would be replaced with actual charting library)
function SimpleChart({
  data,
  color,
  label,
}: {
  data: Array<{ date: string; value: number }>;
  color: ChartColor;
  label: string;
}) {
  const maxValue = Math.max(...data.map((d) => d.value));

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <span>Last 30 days</span>
      </div>
      <div className="h-32 flex items-end gap-1">
        {data.slice(-30).map((point, index) => (
          <div
            key={index}
            className={`flex-1 rounded-t ${CHART_BAR_CLASSES[color]}`}
            style={{
              height: `${maxValue > 0 ? (point.value / maxValue) * 100 : 0}%`,
              minHeight: point.value > 0 ? "4px" : "2px",
            }}
            title={`${point.date}: ${point.value}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{data[data.length - 30]?.date || "Start"}</span>
        <span>{data[data.length - 1]?.date || "End"}</span>
      </div>
    </div>
  );
}
