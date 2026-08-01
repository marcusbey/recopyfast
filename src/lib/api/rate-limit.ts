/**
 * Route-level rate limiting for App Router handlers.
 *
 * Wraps the store in `@/lib/security/rate-limiter` with the bits a route
 * actually needs: identifier extraction, RFC-compliant 429 responses, and an
 * explicit decision about what happens when the store itself is unavailable.
 *
 * Usage:
 *   const limited = await enforceRateLimit(request, {
 *     limit: "API_AUTH",
 *     endpoint: "auth/login",
 *     onStoreFailure: "deny",
 *   });
 *   if (limited) return limited;
 */

import { NextRequest, NextResponse } from "next/server";
import {
  rateLimiter,
  createRateLimitConfig,
  RATE_LIMIT_CONFIGS,
} from "@/lib/security/rate-limiter";

/**
 * What to do when the rate-limit store (Redis) is unreachable.
 *
 * "deny"  — reject the request with 503. Correct for endpoints where an
 *           unmetered request costs real money (OpenAI) or grants access
 *           (auth brute force). Losing Redis must not silently remove the
 *           only control standing between an attacker and the spend.
 * "allow" — serve the request unmetered. Correct for best-effort telemetry
 *           ingest, where dropping traffic during a Redis blip degrades the
 *           product for legitimate visitors and the downside of a brief
 *           unmetered window is bounded.
 */
export type RateLimitFailureMode = "allow" | "deny";

export interface EnforceRateLimitOptions {
  /** Which preset in RATE_LIMIT_CONFIGS to apply. */
  limit: keyof typeof RATE_LIMIT_CONFIGS;
  /** Logical endpoint name; scopes the counter so limits do not bleed across routes. */
  endpoint: string;
  /**
   * Bucket key. Defaults to the client IP.
   *
   * NOTE: the identifier is stored as part of an ephemeral Redis key with a TTL
   * equal to the window, and is never written to application logs. It must be
   * stable across serverless isolates — do not pass a per-process hash, or every
   * isolate would count into a different bucket and the limit would not hold.
   */
  identifier?: string;
  identifierType?: "user" | "ip" | "api_key";
  /** Defaults to "deny" — the safe choice; opt into "allow" deliberately. */
  onStoreFailure?: RateLimitFailureMode;
  /** Client-facing message on 429. */
  message?: string;
}

/** Client IP from proxy headers. NextRequest.ip was removed in Next 15+. */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function buildRateLimitHeaders(params: {
  maxRequests: number;
  remaining: number;
  resetTime: number;
}): Record<string, string> {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((params.resetTime - Date.now()) / 1000),
  );

  return {
    "Retry-After": String(retryAfterSeconds),
    "X-RateLimit-Limit": String(params.maxRequests),
    "X-RateLimit-Remaining": String(params.remaining),
    "X-RateLimit-Reset": String(Math.ceil(params.resetTime / 1000)),
  };
}

/**
 * Returns a 429/503 response when the request must be rejected, or `null` when
 * the caller should proceed.
 */
export async function enforceRateLimit(
  request: NextRequest,
  options: EnforceRateLimitOptions,
): Promise<NextResponse | null> {
  const {
    limit,
    endpoint,
    identifierType = "ip",
    onStoreFailure = "deny",
    message = "Too many requests. Please try again later.",
  } = options;

  const identifier = options.identifier ?? getClientIp(request);
  const config = createRateLimitConfig(
    identifier,
    identifierType,
    limit,
    endpoint,
  );

  let result;
  try {
    result = await rateLimiter.checkLimit(config);
  } catch (error) {
    // Never swallow this: a rate limiter that fails invisibly is indistinguishable
    // from one that is working. Log it, then apply the endpoint's declared policy.
    // The identifier is deliberately omitted — it is usually a raw client IP.
    console.error(
      `Rate limit store unavailable for ${endpoint} (policy: ${onStoreFailure}):`,
      error,
    );

    if (onStoreFailure === "allow") return null;

    return NextResponse.json(
      {
        error: "Service temporarily unavailable",
        message:
          "Request throttling is currently unavailable. Please retry shortly.",
      },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }

  if (result.allowed) return null;

  console.warn(
    `Rate limit exceeded on ${endpoint} (${identifierType}, ${result.totalRequests}/${config.maxRequests})`,
  );

  return NextResponse.json(
    { error: "Rate limit exceeded", message },
    {
      status: 429,
      headers: buildRateLimitHeaders({
        maxRequests: config.maxRequests,
        remaining: result.remaining,
        resetTime: result.resetTime,
      }),
    },
  );
}
