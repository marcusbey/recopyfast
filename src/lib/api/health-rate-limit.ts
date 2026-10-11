/**
 * The per-IP limit on the anonymous health endpoints (s84).
 *
 * `GET`/`HEAD /api/health` and `GET /api/health/ready` were unlimited by
 * design: uptime monitors poll them, and denying a monitor looked worse than
 * what a limit bounds (s07b). But every admitted request costs two Supabase
 * calls and a rate-limit-store round trip, and `GET` adds an outbound probe to
 * the realtime service — so an endpoint anyone could call at any rate was a
 * small amplifier, the one public path AGENTS.md's "rate limit before
 * authorization" rule did not cover (s07b review, minor).
 *
 * The number is chosen so the limit and a monitor can never meet:
 *
 *   - 60 per minute per IP, one shared bucket across the three probes — one a
 *     second, sustained, from a single address.
 *   - Our uptime workflow asks once per 10 minutes (600x headroom). Sentry
 *     uptime at its tightest interval asks once a minute; a 30-second SaaS
 *     monitor wired to all three probes asks six times — still 10x under.
 *     Someone `curl`-looping during an incident is not refused either.
 *   - A single-address flood is cut to 60/min before any database, storage or
 *     realtime work happens.
 *
 * FAILS OPEN, deliberately — the opposite of editor login. These endpoints
 * exist to REPORT a Redis outage: with the store down, `/api/health`'s own
 * cache check answers `unhealthy`/503 with `checks.cache: error`, which is the
 * truth. Failing closed would replace that with "throttling unavailable" — the
 * same status code with the wrong reason, and readiness refused over a
 * dependency it does not have. AGENTS.md: public reads fail open.
 *
 * Cost bound on the metered store: a refused request costs two Upstash
 * commands (the limiter), an admitted `/api/health` four (limiter + cache
 * probe). `src/__tests__/api/health/rate-limit.test.ts` pins every claim above.
 */

import type { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";

export function limitHealthProbe(
  request: NextRequest,
): Promise<NextResponse | null> {
  return enforceRateLimit(request, {
    limit: "IP_HEALTH",
    endpoint: "health",
    identifierType: "ip",
    onStoreFailure: "allow",
    message: "Too many health checks. Please slow down.",
  });
}
