import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import {
  UserActivityLog,
  PerformanceMetric,
  ConversionEvent,
  AnalyticsDashboardData,
} from "@/types";

/**
 * Subset of UserActivityLog columns returned by the dashboard SELECT query.
 * Only the three columns actually selected from user_activity_logs are present;
 * keeping a narrow type avoids fabricating fields that were never fetched.
 */
type ActivityRow = Pick<
  UserActivityLog,
  "action_type" | "user_id" | "site_id" | "timestamp"
>;

/** Subset of performance_metrics columns selected by the dashboard query. */
type PerformanceRow = Pick<PerformanceMetric, "metric_type" | "value"> & {
  recorded_at?: string;
};

export class AnalyticsTracker {
  private _supabase: ReturnType<typeof createServerClient> | null = null;

  // Lazy: construct the Supabase client on first use, not at instantiation. This
  // module exports a singleton at import time, and createServerClient throws on
  // empty url/key — which crashed Vercel's "Collecting page data" build phase when
  // Supabase env vars are absent. Deferring avoids the import-time throw.
  private get supabase() {
    if (!this._supabase) {
      this._supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          cookies: {
            get: () => "",
            set: () => {},
            remove: () => {},
          },
        },
      );
    }
    return this._supabase;
  }

  /**
   * The site ids a dashboard call is allowed to aggregate over.
   *
   * One site when the caller named one — the route has already authorised it
   * via `authorizeSiteReadAccess`, so no second check is owed here. Otherwise
   * every site the caller holds a permission row for, which is the same
   * predicate `/api/sites` uses.
   *
   * An empty result is meaningful and is honoured: no identity and no site
   * means aggregate nothing. This class holds a SERVICE-ROLE client, which
   * bypasses row-level security, so the scoping has to be explicit here — an
   * unfiltered query would return every tenant's rows.
   */
  private async resolveScopedSiteIds(
    siteId?: string,
    ownerUserId?: string,
  ): Promise<string[]> {
    if (siteId) {
      return [siteId];
    }
    if (!ownerUserId) {
      return [];
    }

    const { data, error } = await this.supabase
      .from("site_permissions")
      .select("site_id")
      .eq("user_id", ownerUserId);

    if (error) {
      console.error("Failed to resolve the caller's sites:", error);
      return [];
    }

    const rows = (data ?? []) as Array<{ site_id: string | null }>;
    const ids = rows
      .map((row) => row.site_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    return Array.from(new Set(ids));
  }

  /**
   * Track user activity with detailed metadata
   */
  async trackActivity(params: {
    userId?: string;
    siteId: string;
    actionType: UserActivityLog["action_type"];
    resourceType?: UserActivityLog["resource_type"];
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  }): Promise<void> {
    try {
      await this.supabase.from("user_activity_logs").insert({
        user_id: params.userId,
        site_id: params.siteId,
        action_type: params.actionType,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        metadata: params.metadata || {},
        ip_address: params.ipAddress,
        user_agent: params.userAgent,
        session_id: params.sessionId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to track activity:", error);
    }
  }

  /**
   * Track performance metrics
   */
  async trackPerformance(params: {
    siteId: string;
    metricType: PerformanceMetric["metric_type"];
    value: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.supabase.from("performance_metrics").insert({
        site_id: params.siteId,
        metric_type: params.metricType,
        value: params.value,
        metadata: params.metadata || {},
        recorded_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to track performance:", error);
    }
  }

  /**
   * Track conversion events
   */
  async trackConversion(params: {
    siteId: string;
    userId?: string;
    eventType: ConversionEvent["event_type"];
    value?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.supabase.from("conversion_events").insert({
        site_id: params.siteId,
        user_id: params.userId,
        event_type: params.eventType,
        value: params.value,
        metadata: params.metadata || {},
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to track conversion:", error);
    }
  }

  /**
   * Get analytics dashboard data
   */
  async getDashboardData(
    siteId?: string,
    dateRange?: {
      start: string;
      end: string;
    },
    ownerUserId?: string,
  ): Promise<AnalyticsDashboardData> {
    try {
      const startDate =
        dateRange?.start ||
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = dateRange?.end || new Date().toISOString();

      // Which sites this call covers.
      //
      // The "all sites" view passes no siteId, and every query below used to
      // fall back to `.eq("id", "")` — a filter that matches nothing. That was
      // a deliberate stopgap (a cross-tenant leak is far worse than an empty
      // chart), but it meant the whole dashboard read zero for anyone who did
      // not pick a single site, which is what the register recorded as
      // "Analytics reports Total Sites 0" with two sites registered.
      //
      // Scoping it to the caller's own sites is what the route's comment says
      // belongs here, and `site_permissions` is the same table `/api/sites`
      // authorises through, so the two views cannot disagree about which sites
      // someone owns.
      const scopedSiteIds = await this.resolveScopedSiteIds(
        siteId,
        ownerUserId,
      );

      // No identity and no site: keep the old behaviour of returning nothing
      // rather than every tenant's data.
      if (scopedSiteIds.length === 0) {
        return this.getEmptyDashboardData();
      }

      // Get overview statistics — select all columns used by calculateTrends/calculateTopSites
      const { data: activityRaw } = await this.supabase
        .from("user_activity_logs")
        .select("action_type, user_id, site_id, timestamp")
        .gte("timestamp", startDate)
        .lte("timestamp", endDate)
        .in("site_id", scopedSiteIds);
      // Supabase infers a loose row type from the select string; cast to the
      // precise picked type — all four selected columns match ActivityRow exactly.
      const activityData = activityRaw as ActivityRow[] | null;

      // Get site analytics
      const { data: siteAnalytics } = await this.supabase
        .from("site_analytics")
        .select("*")
        .gte("date", startDate.split("T")[0])
        .lte("date", endDate.split("T")[0])
        .in("site_id", scopedSiteIds);

      // Get performance metrics
      const { data: performanceData } = await this.supabase
        .from("performance_metrics")
        .select("metric_type, value, recorded_at")
        .gte("recorded_at", startDate)
        .lte("recorded_at", endDate)
        .in("site_id", scopedSiteIds);

      // Calculate overview statistics
      const totalPageViews =
        activityData?.filter((a) => a.action_type === "page_view").length || 0;
      const totalEdits =
        activityData?.filter((a) => a.action_type === "content_edit").length ||
        0;
      const uniqueUsers = new Set(
        activityData?.map((a) => a.user_id).filter(Boolean),
      ).size;
      // Sites in scope, NOT sites that happened to log activity in this window.
      // Counting distinct site_ids out of user_activity_logs is what made the
      // dashboard say "Total Sites 0" next to a sidebar listing two sites: a
      // site nobody visited this month is still a site you own.
      const uniqueSites = scopedSiteIds.length;

      // Guard against performanceData being null/undefined: default numerator to 0
      // so the division always produces a number rather than undefined/NaN.
      const typedPerformanceData = (performanceData || []) as PerformanceRow[];
      const loadTimeRows = typedPerformanceData.filter(
        (p) => p.metric_type === "load_time",
      );
      const avgLoadTime =
        loadTimeRows.reduce((sum, p) => sum + p.value, 0) /
        (loadTimeRows.length || 1);

      // Calculate trends (group by date)
      const trendData = this.calculateTrends(activityData || []);

      // Get top sites
      const topSites = this.calculateTopSites(activityData || []);

      return {
        overview: {
          total_sites: uniqueSites,
          total_users: uniqueUsers,
          total_page_views: totalPageViews,
          total_edits: totalEdits,
          avg_load_time: Number(avgLoadTime.toFixed(2)),
          conversion_rate: 0, // Calculate from conversion events
        },
        trends: trendData,
        top_sites: topSites,
        performance: {
          avg_load_time: Number(avgLoadTime.toFixed(2)),
          avg_edit_time: (() => {
            // Guard against performanceData being null/undefined; default to 0.
            const editRows = typedPerformanceData.filter(
              (p) => p.metric_type === "edit_time",
            );
            return (
              editRows.reduce((sum, p) => sum + p.value, 0) /
                (editRows.length || 1) || 0
            );
          })(),
          error_rate: 0, // Calculate from error logs
        },
      };
    } catch (error) {
      console.error("Failed to get dashboard data:", error);
      return this.getEmptyDashboardData();
    }
  }

  /**
   * Calculate trends from activity data
   */
  private calculateTrends(activityData: ActivityRow[]) {
    const dateMap = new Map();

    // Process activity data
    activityData.forEach((activity) => {
      const date = activity.timestamp.split("T")[0];
      if (!dateMap.has(date)) {
        dateMap.set(date, { date, page_views: 0, edits: 0, users: new Set() });
      }

      const dayData = dateMap.get(date);
      if (activity.action_type === "page_view") dayData.page_views++;
      if (activity.action_type === "content_edit") dayData.edits++;
      if (activity.user_id) dayData.users.add(activity.user_id);
    });

    // Convert to arrays and sort by date
    const trends = Array.from(dateMap.values())
      .map((day) => ({
        ...day,
        users: day.users.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      page_views: trends.map((t) => ({ date: t.date, value: t.page_views })),
      edits: trends.map((t) => ({ date: t.date, value: t.edits })),
      users: trends.map((t) => ({ date: t.date, value: t.users })),
    };
  }

  /**
   * Calculate top sites from activity data
   */
  private calculateTopSites(activityData: ActivityRow[]) {
    const siteMap = new Map();

    activityData.forEach((activity) => {
      if (!siteMap.has(activity.site_id)) {
        siteMap.set(activity.site_id, {
          site_id: activity.site_id,
          domain: `Site ${activity.site_id}`, // Would need to join with sites table
          page_views: 0,
          edits: 0,
        });
      }

      const siteData = siteMap.get(activity.site_id);
      if (activity.action_type === "page_view") siteData.page_views++;
      if (activity.action_type === "content_edit") siteData.edits++;
    });

    return Array.from(siteMap.values())
      .sort((a, b) => b.page_views - a.page_views)
      .slice(0, 10);
  }

  /**
   * Get empty dashboard data structure
   */
  private getEmptyDashboardData(): AnalyticsDashboardData {
    return {
      overview: {
        total_sites: 0,
        total_users: 0,
        total_page_views: 0,
        total_edits: 0,
        avg_load_time: 0,
        conversion_rate: 0,
      },
      trends: {
        page_views: [],
        edits: [],
        users: [],
      },
      top_sites: [],
      performance: {
        avg_load_time: 0,
        avg_edit_time: 0,
        error_rate: 0,
      },
    };
  }

  /**
   * Batch update site analytics (called by cron job)
   */
  async updateSiteAnalytics(
    date: string = new Date().toISOString().split("T")[0],
  ): Promise<void> {
    try {
      // This would typically be called by a cron job
      await this.supabase.rpc("update_site_analytics");
    } catch (error) {
      console.error("Failed to update site analytics:", error);
    }
  }

  /**
   * Track API usage for rate limiting and analytics
   */
  async trackAPIUsage(params: {
    apiKeyId: string;
    endpoint: string;
    method: string;
    statusCode?: number;
    responseTime?: number;
    requestSize?: number;
    responseSize?: number;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      await this.supabase.from("api_usage").insert({
        api_key_id: params.apiKeyId,
        endpoint: params.endpoint,
        method: params.method,
        status_code: params.statusCode,
        response_time: params.responseTime,
        request_size: params.requestSize,
        response_size: params.responseSize,
        ip_address: params.ipAddress,
        user_agent: params.userAgent,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to track API usage:", error);
    }
  }
}

/**
 * Client-side analytics tracking utilities
 */
export class ClientAnalytics {
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  /**
   * Track page view from client
   */
  async trackPageView(
    siteId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const startTime = performance.now();

      await fetch(`${this.baseUrl}/api/analytics/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "page_view",
          siteId,
          metadata: {
            ...metadata,
            url: window.location.href,
            referrer: document.referrer,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            load_time: performance.now() - startTime,
          },
        }),
      });
    } catch (error) {
      console.error("Failed to track page view:", error);
    }
  }

  /**
   * Track content edit from client
   */
  async trackContentEdit(
    siteId: string,
    elementId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/analytics/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "content_edit",
          siteId,
          resourceType: "content_element",
          resourceId: elementId,
          metadata,
        }),
      });
    } catch (error) {
      console.error("Failed to track content edit:", error);
    }
  }

  /**
   * Track performance metrics from client
   */
  async trackPerformance(
    siteId: string,
    metrics: {
      loadTime?: number;
      editTime?: number;
      apiResponseTime?: number;
    },
  ): Promise<void> {
    try {
      const promises = [];

      if (metrics.loadTime) {
        promises.push(
          fetch(`${this.baseUrl}/api/analytics/performance`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              siteId,
              metricType: "load_time",
              value: metrics.loadTime,
            }),
          }),
        );
      }

      if (metrics.editTime) {
        promises.push(
          fetch(`${this.baseUrl}/api/analytics/performance`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              siteId,
              metricType: "edit_time",
              value: metrics.editTime,
            }),
          }),
        );
      }

      if (metrics.apiResponseTime) {
        promises.push(
          fetch(`${this.baseUrl}/api/analytics/performance`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              siteId,
              metricType: "api_response_time",
              value: metrics.apiResponseTime,
            }),
          }),
        );
      }

      await Promise.all(promises);
    } catch (error) {
      console.error("Failed to track performance:", error);
    }
  }
}

// Middleware helper function
export function getClientInfo(req: NextRequest) {
  // NextRequest no longer exposes .ip (removed in Next 15+); derive from headers.
  const forwarded = req.headers.get("x-forwarded-for");
  const ipAddress = forwarded
    ? forwarded.split(",")[0]
    : (req.headers.get("x-real-ip") ?? undefined);
  const userAgent = req.headers.get("user-agent") ?? undefined;

  return {
    ipAddress,
    userAgent,
    sessionId: req.cookies.get("session-id")?.value,
  };
}

// Export singleton instance
export const analytics = new AnalyticsTracker();
