import { NextRequest, NextResponse } from "next/server";
import { analytics } from "@/lib/analytics/tracker";
import { createClient } from "@/lib/supabase/server";
import {
  authorizeIngestRequest,
  authorizeSiteReadAccess,
} from "@/lib/security/ingest-auth";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  optionalMetadata,
  readJsonObject,
  requireEnum,
  requireFiniteNumber,
  requireUuid,
} from "@/lib/api/validation";
import type { PerformanceMetric } from "@/types";

/**
 * Performance metric ingest — same trust model as /api/analytics/track: public
 * by design for the embed script, but every write must be bound to a site the
 * caller can prove access to. See @/lib/security/ingest-auth.
 */

const METRIC_TYPES = [
  "load_time",
  "edit_time",
  "api_response_time",
] as const satisfies readonly PerformanceMetric["metric_type"][];

/** Metrics are durations in ms; anything outside this range is not a real timing. */
const MIN_METRIC_VALUE = 0;
const MAX_METRIC_VALUE = 24 * 60 * 60 * 1000;

const MAX_METRICS_PAGE_SIZE = 1000;

function withCors(response: NextResponse): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Site-Token",
  );
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return response;
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    if (!body.ok) {
      return withCors(
        NextResponse.json({ error: body.error }, { status: 400 }),
      );
    }

    const siteId = requireUuid(body.value, "siteId");
    if (!siteId.ok) {
      return withCors(
        NextResponse.json({ error: siteId.error }, { status: 400 }),
      );
    }

    const auth = await authorizeIngestRequest(req, siteId.value);
    if (!auth.ok) {
      return withCors(
        NextResponse.json({ error: auth.error }, { status: auth.status }),
      );
    }

    const limited = await enforceRateLimit(req, {
      limit: "API_CONTENT",
      endpoint: "analytics/performance",
      identifier: siteId.value,
      identifierType: "api_key",
      onStoreFailure: "allow",
      message: "Performance ingest rate limit exceeded for this site.",
    });
    if (limited) return withCors(limited);

    const metricType = requireEnum(body.value, "metricType", METRIC_TYPES);
    if (!metricType.ok) {
      return withCors(
        NextResponse.json({ error: metricType.error }, { status: 400 }),
      );
    }

    const value = requireFiniteNumber(body.value, "value", {
      min: MIN_METRIC_VALUE,
      max: MAX_METRIC_VALUE,
    });
    if (!value.ok) {
      return withCors(
        NextResponse.json({ error: value.error }, { status: 400 }),
      );
    }

    const metadata = optionalMetadata(body.value);
    if (!metadata.ok) {
      return withCors(
        NextResponse.json({ error: metadata.error }, { status: 400 }),
      );
    }

    await analytics.trackPerformance({
      siteId: siteId.value,
      metricType: metricType.value,
      value: value.value,
      metadata: metadata.value,
    });

    return withCors(NextResponse.json({ success: true }));
  } catch (error) {
    console.error("Performance tracking error:", error);
    return withCors(
      NextResponse.json(
        { error: "Failed to track performance" },
        { status: 500 },
      ),
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteIdParam = searchParams.get("siteId");
    const metricTypeParam = searchParams.get("metricType");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!siteIdParam) {
      return NextResponse.json(
        { error: "Missing required parameter: siteId" },
        { status: 400 },
      );
    }

    const siteId = requireUuid({ siteId: siteIdParam }, "siteId");
    if (!siteId.ok) {
      return NextResponse.json({ error: siteId.error }, { status: 400 });
    }

    const auth = await authorizeSiteReadAccess(siteId.value);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(req, {
      limit: "USER_GENERAL",
      endpoint: "analytics/performance:read",
      identifier: auth.userId!,
      identifierType: "user",
      onStoreFailure: "allow",
    });
    if (limited) return limited;

    let metricType: PerformanceMetric["metric_type"] | undefined;
    if (metricTypeParam) {
      const parsed = requireEnum(
        { metricType: metricTypeParam },
        "metricType",
        METRIC_TYPES,
      );
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      metricType = parsed.value;
    }

    const supabase = await createClient();
    let query = supabase
      .from("performance_metrics")
      .select("*")
      .eq("site_id", siteId.value)
      .order("recorded_at", { ascending: false });

    if (metricType) {
      query = query.eq("metric_type", metricType);
    }

    if (startDate) {
      query = query.gte("recorded_at", startDate);
    }

    if (endDate) {
      query = query.lte("recorded_at", endDate);
    }

    const { data: metrics, error } = await query.limit(MAX_METRICS_PAGE_SIZE);

    if (error) {
      throw error;
    }

    // Calculate aggregated statistics
    const stats = {
      total_records: metrics?.length || 0,
      average_value: 0,
      min_value: 0,
      max_value: 0,
      percentile_95: 0,
    };

    if (metrics && metrics.length > 0) {
      const values = metrics.map((m) => m.value).sort((a, b) => a - b);
      stats.average_value =
        values.reduce((sum, val) => sum + val, 0) / values.length;
      stats.min_value = values[0];
      stats.max_value = values[values.length - 1];
      stats.percentile_95 = values[Math.floor(values.length * 0.95)];
    }

    return NextResponse.json({
      metrics,
      stats,
    });
  } catch (error) {
    console.error("Performance fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch performance metrics" },
      { status: 500 },
    );
  }
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}
