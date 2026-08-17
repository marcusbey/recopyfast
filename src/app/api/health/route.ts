/**
 * Health Check API Endpoint
 * Provides comprehensive system health status for monitoring
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/monitoring/logger";
import * as Sentry from "@sentry/nextjs";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  environment: string;
  uptime: number;
  checks: {
    database: ServiceCheck;
    storage: ServiceCheck;
    cache?: ServiceCheck;
    external?: ServiceCheck;
    /**
     * The Socket.io service in `server/`. Optional because it is optional in
     * production: no `NEXT_PUBLIC_WS_URL` means realtime is off, which is a
     * supported configuration (ADR 004 rule 2), not a failing check.
     */
    realtime?: ServiceCheck;
  };
  metrics?: {
    memory: MemoryMetrics;
    cpu?: CPUMetrics;
  };
}

interface ServiceCheck {
  status: "ok" | "error" | "timeout";
  latency?: number;
  error?: string;
  details?: Record<string, unknown>;
}

interface MemoryMetrics {
  used: number;
  total: number;
  percentage: number;
}

interface CPUMetrics {
  usage: number;
  loadAverage: number[];
}

// Track server start time
const serverStartTime = Date.now();

async function checkDatabase(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const supabase = await createClient();

    // Simple query to check database connectivity
    const { error } = await supabase
      .from("sites")
      .select("id")
      .limit(1)
      .single();

    const latency = Date.now() - start;

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned (which is fine)
      throw error;
    }

    return {
      status: "ok",
      latency,
      details: {
        connected: true,
        responseTime: `${latency}ms`,
      },
    };
  } catch (error) {
    logger.error("Database health check failed", error as Error, undefined, {
      component: "health-check",
      service: "database",
    });

    return {
      status: "error",
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function checkStorage(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const supabase = await createClient();

    // Check if storage bucket exists
    const { data, error } = await supabase.storage.getBucket("assets");

    const latency = Date.now() - start;

    if (error) {
      throw error;
    }

    return {
      status: "ok",
      latency,
      details: {
        connected: true,
        bucket: data?.name || "assets",
        public: data?.public || false,
      },
    };
  } catch (error) {
    logger.error("Storage health check failed", error as Error, undefined, {
      component: "health-check",
      service: "storage",
    });

    return {
      status: "error",
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function checkExternalServices(): Promise<ServiceCheck> {
  const start = Date.now();
  const services: Record<string, boolean> = {};

  try {
    // Check Sentry connectivity
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      try {
        // Sentry SDK provides isEnabled method
        services.sentry = Sentry.isEnabled();
      } catch {
        services.sentry = false;
      }
    }

    // Check other external services as needed
    // Add checks for Stripe, email services, etc.

    const latency = Date.now() - start;
    const allHealthy = Object.values(services).every((status) => status);

    return {
      status: allHealthy ? "ok" : "error",
      latency,
      details: services,
    };
  } catch (error) {
    return {
      status: "error",
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * How long we are willing to wait on the realtime service before calling it
 * down. Short on purpose: `/api/health` is polled, and a check on an optional
 * dependency must never be the reason the endpoint itself is slow.
 */
const REALTIME_PROBE_TIMEOUT_MS = 2000;

/**
 * The realtime service's `/health`, as an https URL, or `null` when realtime is
 * switched off.
 *
 * `NEXT_PUBLIC_WS_URL` is a *websocket* origin — that is what the widget's
 * `data-ws-url` and the CSP `connect-src` need (`src/middleware.ts:233`). `fetch`
 * does not speak `wss:`; handing it one throws before a packet leaves, so the
 * check would report the service down permanently while the service was
 * perfectly healthy. Swap the scheme rather than assuming the env value is
 * already an http one.
 */
function getRealtimeHealthUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (url.protocol === "wss:") url.protocol = "https:";
    else if (url.protocol === "ws:") url.protocol = "http:";
    url.pathname = "/health";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    // A malformed value tells us nothing about a running service, and it is not
    // this endpoint's job to fail over a typo in an unrelated variable.
    return null;
  }
}

/**
 * Probe the Socket.io service in `server/`.
 *
 * Deliberately reports `error`/`timeout` rather than throwing: the caller caps
 * this check's contribution at `degraded`, and that cap is only meaningful if
 * the check always returns.
 */
async function checkRealtime(url: string): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(REALTIME_PROBE_TIMEOUT_MS),
    });

    const latency = Date.now() - start;

    if (!response.ok) {
      return {
        status: "error",
        latency,
        error: `Realtime service responded ${response.status}`,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
      connections?: number;
      supabase?: string;
    };

    return {
      status: "ok",
      latency,
      details: {
        connections: payload.connections ?? 0,
        supabase: payload.supabase ?? "unknown",
        reported: payload.status ?? "unknown",
      },
    };
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");

    // Logged at warn, not error. A realtime outage is a degradation of an
    // additive feature (ADR 004 rule 2) — logging it at the same level as a
    // database failure is how a real outage gets lost in the noise later.
    logger.warn("Realtime health check failed", undefined, {
      component: "health-check",
      service: "realtime",
      reason: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      status: isTimeout ? "timeout" : "error",
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * How long one realtime probe answers for.
 *
 * `/api/health` is public, unauthenticated and deliberately **not** rate
 * limited: uptime monitors poll it, and denying them is a worse outcome than
 * what this bounds. Since the realtime check landed, every GET also issues an
 * outbound request to `recopyfast-ws.fly.dev` — which turns an endpoint anyone
 * can call into a small amplifier, one request in and two out, at whatever rate
 * the caller likes. The destination is fixed and the timeout is 2 s, so it is
 * mild; it is still a network side effect the endpoint did not have before, and
 * AGENTS.md's "rate limit before authorization" rule has no coverage here.
 *
 * Memoizing is the answer rather than a limiter, because it costs the monitors
 * nothing: what they lose is freshness, not an answer. Ten seconds is short
 * enough that an outage — or a recovery, which is the direction that reads
 * wrong for longer — surfaces within a poll or two, and Fly's own check on the
 * service runs every 15 s (`server/fly.toml`), so this memo is not the slowest
 * link in the chain. It is long enough that the traffic this endpoint can
 * generate downstream stops depending on the traffic it receives.
 */
const REALTIME_PROBE_MEMO_TTL_MS = 10_000;

/**
 * The last probe, held as the **in-flight promise** rather than as its settled
 * result. Storing the result only would leave N simultaneous callers each
 * starting their own fetch before the first one lands — precisely the burst an
 * unlimited public endpoint invites. Keyed on the URL so that a changed
 * `NEXT_PUBLIC_WS_URL` is never answered from a memo about the old origin.
 */
let realtimeProbeMemo: {
  at: number;
  url: string;
  result: Promise<ServiceCheck>;
} | null = null;

function probeRealtime(url: string): Promise<ServiceCheck> {
  const now = Date.now();
  if (
    realtimeProbeMemo &&
    realtimeProbeMemo.url === url &&
    now - realtimeProbeMemo.at < REALTIME_PROBE_MEMO_TTL_MS
  ) {
    return realtimeProbeMemo.result;
  }

  // Recorded before the await, so concurrent callers find it. `checkRealtime`
  // is written never to reject — it reports `error`/`timeout` instead — which
  // is what makes a stored promise safe to hand to every one of them.
  const result = checkRealtime(url);
  realtimeProbeMemo = { at: now, url, result };
  return result;
}

function getMemoryMetrics(): MemoryMetrics {
  const memoryUsage = process.memoryUsage();
  const totalMemory = memoryUsage.heapTotal;
  const usedMemory = memoryUsage.heapUsed;

  return {
    used: Math.round(usedMemory / 1024 / 1024), // MB
    total: Math.round(totalMemory / 1024 / 1024), // MB
    percentage: Math.round((usedMemory / totalMemory) * 100),
  };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Get detail level from query params
    const { searchParams } = new URL(request.url);
    const detailed = searchParams.get("detailed") === "true";
    const quick = searchParams.get("quick") === "true";

    // Quick health check - just return OK without checks
    if (quick) {
      return NextResponse.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
      });
    }

    // Run all health checks in parallel
    const realtimeUrl = getRealtimeHealthUrl();
    const [database, storage, external, realtime] = await Promise.allSettled([
      checkDatabase(),
      checkStorage(),
      detailed ? checkExternalServices() : Promise.resolve(undefined),
      realtimeUrl ? probeRealtime(realtimeUrl) : Promise.resolve(undefined),
    ]);

    // Process results
    const checks: HealthStatus["checks"] = {
      database:
        database.status === "fulfilled"
          ? database.value
          : {
              status: "error",
              error: "Check failed",
            },
      storage:
        storage.status === "fulfilled"
          ? storage.value
          : {
              status: "error",
              error: "Check failed",
            },
    };

    if (detailed && external.status === "fulfilled") {
      checks.external = external.value;
    }

    // Determine overall health status.
    //
    // Computed BEFORE realtime is attached to `checks`, and that ordering is the
    // whole point: this counts errors across the object and turns two of them
    // into `unhealthy`, which answers 503 below. Realtime is an additive
    // enhancement (ADR 004 rule 2) — with the socket service stopped, editing,
    // saving, staging and publishing all still work over HTTP. If its check
    // joined this array, a realtime restart during a storage blip would take the
    // whole app out of rotation over a feature nobody needs in order to serve.
    const statuses = Object.values(checks)
      .filter(Boolean)
      .map((check: ServiceCheck) => check.status);

    let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (statuses.includes("error")) {
      overallStatus =
        statuses.filter((s) => s === "error").length > 1
          ? "unhealthy"
          : "degraded";
    }

    // Realtime, capped at `degraded` and never worse (ADR 004, "Watch"). It can
    // move `healthy` down one step — an outage should be visible, not silent —
    // and it can do nothing else. Attached after the count, so it is reported
    // without being counted.
    const realtimeCheck =
      realtime.status === "fulfilled" ? realtime.value : undefined;
    if (realtimeCheck) {
      checks.realtime = realtimeCheck;
      if (realtimeCheck.status !== "ok" && overallStatus === "healthy") {
        overallStatus = "degraded";
      }
    }

    // Build response
    const response: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0",
      environment:
        process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
      uptime: Math.round((Date.now() - serverStartTime) / 1000), // seconds
      checks,
    };

    // Add metrics if requested
    if (detailed) {
      response.metrics = {
        memory: getMemoryMetrics(),
      };
    }

    // Log health check
    logger.info("Health check completed", undefined, {
      component: "health-check",
      duration: Date.now() - startTime,
      status: overallStatus,
      detailed,
    });

    // Set appropriate status code
    const statusCode =
      overallStatus === "healthy"
        ? 200
        : overallStatus === "degraded"
          ? 200
          : 503;

    return NextResponse.json(response, {
      status: statusCode,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    logger.error("Health check endpoint error", error as Error, undefined, {
      component: "health-check",
    });

    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: "Health check failed",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      },
    );
  }
}

// Support HEAD requests for uptime monitoring.
// A HEAD probe must reflect real readiness: if the database is unreachable the
// instance cannot serve traffic, so return 503 and let the load balancer / uptime
// monitor route around it. A bare 200 would mask a hard outage.
//
// The realtime check is deliberately absent here and must stay absent. This is
// the probe a load balancer polls, and an instance with realtime down can serve
// every request the product makes — HTTP is authoritative (ADR 004 rule 1).
// Adding the probe would also put a cross-network fetch on the hottest path in
// the app, for a dependency it does not need.
export async function HEAD() {
  const db = await checkDatabase();
  return new NextResponse(null, {
    status: db.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
  });
}
