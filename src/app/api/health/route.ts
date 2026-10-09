/**
 * Health Check API Endpoint
 * Provides comprehensive system health status for monitoring
 *
 * Anonymous by design — uptime monitors call it without a credential — so the
 * body says HOW each component is and never WHY (s84, s69 L3). It used to
 * return the raw Postgres/Storage error text, the bucket name and its public
 * flag, the realtime service's live connection count and, on
 * `?detailed=true`, heap metrics. Each component is now `{ status, latency }`;
 * the reason is logged where an operator reads it. Do not add a `details` or
 * `error` field back to `ServiceCheck` "for debugging" — that is the leak.
 */

import { NextRequest, NextResponse } from "next/server";
import { limitHealthProbe } from "@/lib/api/health-rate-limit";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/monitoring/logger";
import {
  createRateLimitConfig,
  rateLimiter,
} from "@/lib/security/rate-limiter";
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
}

/** What the public learns about one component: its state and how long it took. */
interface ServiceCheck {
  status: "ok" | "error" | "timeout";
  latency?: number;
}

// Track server start time
const serverStartTime = Date.now();

async function checkDatabase(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const supabase = await createClient();

    // This endpoint is intentionally anonymous for uptime monitors. It used to
    // probe `sites`, which made the health signal depend on tenant-table ACLs:
    // once s38 removed anon's table grant, a healthy database was reported as
    // down. `plans` is the deliberate public catalogue (migration
    // 20260802000000 grants anon SELECT and RLS exposes active rows), so an
    // explicit one-column read checks PostgREST and Postgres without weakening
    // the credential boundary or depending on any tenant having data.
    const { error } = await supabase.from("plans").select("id").limit(1);

    const latency = Date.now() - start;

    if (error) {
      throw error;
    }

    return { status: "ok", latency };
  } catch (error) {
    logger.error("Database health check failed", error as Error, undefined, {
      component: "health-check",
      service: "database",
    });

    return { status: "error", latency: Date.now() - start };
  }
}

async function checkStorage(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const supabase = await createClient();

    // Check if storage bucket exists
    const { error } = await supabase.storage.getBucket("assets");

    const latency = Date.now() - start;

    if (error) {
      throw error;
    }

    return { status: "ok", latency };
  } catch (error) {
    logger.error("Storage health check failed", error as Error, undefined, {
      component: "health-check",
      service: "storage",
    });

    return { status: "error", latency: Date.now() - start };
  }
}

/**
 * The rate-limit store (Redis), probed with the one operation the product
 * depends on it for.
 *
 * A-30 / s84. This check did not exist: `checks.cache` was declared and never
 * filled. Redis is a hard dependency of signing in to edit — the store throws
 * when it is unreachable (`rate-limiter.ts` `checkLimit`) and the editor-login
 * limiters fail CLOSED on it — so the outage that refuses every editor showed
 * here as a green probe. Nothing paged and nothing was routed around.
 *
 * A real `checkLimit` rather than a PING: it exercises the exact INCR+EXPIRE
 * pipeline login runs, through the same client, connect timeout and command
 * timeout. The key is fixed and its verdict ignored — this never limits
 * anyone, it only asks whether the store answers. Two Upstash commands.
 */
const CACHE_PROBE_CONFIG = createRateLimitConfig(
  "health-probe",
  "ip",
  "API_GENERAL",
  "health/cache-probe",
);

async function checkCache(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    await rateLimiter.checkLimit(CACHE_PROBE_CONFIG);
    return { status: "ok", latency: Date.now() - start };
  } catch (error) {
    logger.error(
      "Rate-limit store health check failed",
      error as Error,
      undefined,
      {
        component: "health-check",
        service: "cache",
      },
    );

    return { status: "error", latency: Date.now() - start };
  }
}

/**
 * Checks whose failure ALONE means the product cannot serve (s84).
 *
 * The database holds every site, grant and published copy; the rate-limit
 * store gates editor login and fails closed. Either one down is an outage, and
 * the counting rule below ("two errors make `unhealthy`") reported each of them
 * as `degraded` with a 200 — so the uptime workflow, which GETs this endpoint,
 * would have read a database outage as "up". Storage is deliberately absent: it
 * serves image uploads, not the copy visitors read or the saves editors make.
 */
const CRITICAL_CHECKS = ["database", "cache"] as const;

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

    if (!allHealthy) {
      // Which integration is off is for the log, not for an anonymous caller.
      logger.warn("External services health check failed", undefined, {
        component: "health-check",
        service: "external",
        services,
      });
    }

    return { status: allHealthy ? "ok" : "error", latency };
  } catch (error) {
    logger.error(
      "External services health check failed",
      error as Error,
      undefined,
      { component: "health-check", service: "external" },
    );

    return { status: "error", latency: Date.now() - start };
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
      logger.warn("Realtime health check failed", undefined, {
        component: "health-check",
        service: "realtime",
        reason: `Realtime service responded ${response.status}`,
      });
      return { status: "error", latency };
    }

    // The service's own body (its live connection count, its Supabase state)
    // is deliberately not relayed: s84 / s69 L3. Reachable and 2xx is the
    // answer this check gives.
    return { status: "ok", latency };
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

    // Status on the wire, reason in the log. `/api/health` is public and
    // unauthenticated, and the raw message carries infrastructure detail a
    // caller has no business seeing — TLS handshake and certificate errors,
    // `ECONNREFUSED 127.0.0.1:4001` with the internal port, Node-specific error
    // shapes. Most valuable to an attacker precisely during an outage, when the
    // probe is failing and the errors get interesting. The full message is
    // already logged at warn above, which is where an operator reads it.
    return {
      status: isTimeout ? "timeout" : "error",
      latency: Date.now() - start,
    };
  }
}

/**
 * How long one realtime probe answers for.
 *
 * `/api/health` is public and unauthenticated. Since the realtime check landed,
 * every GET also issues an outbound request to `recopyfast-ws.fly.dev` — which
 * turned an endpoint anyone can call into a small amplifier, one request in and
 * two out. s07b answered that with this memo rather than a limiter, because a
 * memo costs the monitors nothing. s84 then added a per-IP limiter as well
 * (`limitHealthProbe`, 60/min, fail-open): the limiter bounds what ONE address
 * can make this endpoint do, the memo bounds what ALL of them together can make
 * it send downstream. Neither replaces the other — many addresses at 59/min
 * each would still fan out without the memo.
 *
 * What the monitors lose to the memo is freshness, not an answer. Ten seconds is short
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

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Per IP, before any check — and before `?quick=true`, so the cheap path is
  // not a way around it. Fails open: see `limitHealthProbe`.
  const limited = await limitHealthProbe(request);
  if (limited) return limited;

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
    const [database, storage, cache, external, realtime] =
      await Promise.allSettled([
        checkDatabase(),
        checkStorage(),
        checkCache(),
        detailed ? checkExternalServices() : Promise.resolve(undefined),
        realtimeUrl ? probeRealtime(realtimeUrl) : Promise.resolve(undefined),
      ]);

    // Process results
    const checks: HealthStatus["checks"] = {
      database:
        database.status === "fulfilled" ? database.value : { status: "error" },
      storage:
        storage.status === "fulfilled" ? storage.value : { status: "error" },
      cache: cache.status === "fulfilled" ? cache.value : { status: "error" },
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

    const errorCount = statuses.filter((s) => s === "error").length;
    const isCriticalDown = CRITICAL_CHECKS.some(
      (name) => checks[name]?.status === "error",
    );

    let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (isCriticalDown || errorCount > 1) {
      overallStatus = "unhealthy";
    } else if (errorCount === 1) {
      overallStatus = "degraded";
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
// monitor route around it. A bare 200 would mask a hard outage. The rate-limit
// store is the same kind of dependency (A-30 / s84): with Redis down, editor
// login refuses every request, so HEAD answers 503 for it too.
//
// The realtime check is deliberately absent here and must stay absent. This is
// the probe a load balancer polls, and an instance with realtime down can serve
// every request the product makes — HTTP is authoritative (ADR 004 rule 1).
// Adding the probe would also put a cross-network fetch on the hottest path in
// the app, for a dependency it does not need.
export async function HEAD(request: NextRequest) {
  const limited = await limitHealthProbe(request);
  if (limited) return limited;

  const [db, cache] = await Promise.all([checkDatabase(), checkCache()]);
  return new NextResponse(null, {
    status: db.status === "ok" && cache.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
  });
}
