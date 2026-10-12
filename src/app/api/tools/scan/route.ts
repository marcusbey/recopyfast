/**
 * POST /api/tools/scan — run a free tool on a public website (s96, ADR 062).
 *
 * Anyone can call this, unauthenticated, and each call can make our
 * infrastructure fetch up to 24 URLs of the caller's choosing and write a row.
 * So it is metered, guarded and fail-closed at every step, in this order:
 *
 *   1. `TOOLS_SCAN_DISABLED=1` → 503, before anything (the kill switch).
 *   2. Same-origin guard → 415/403 (`same-origin-guard.ts`): no third-party
 *      page can spend our caps from its visitors' browsers. Stateless, so no
 *      store is touched for a refused cross-site call.
 *   3. Client key → 403 when the address is unreadable (`client-key.ts`).
 *   4. Burst limiter, 5/min per /64 or IPv4 — BEFORE the body is read.
 *   5. Body (≤ 4 KB), tool, URL normalisation, the operator denylist.
 *   6. The 24 h cache (one indexed read). A hit answers at once and spends no
 *      daily allowance.
 *   7. On a miss only: 5/day per /64 or IPv4, 20/day per IPv6 /48, 500/day for
 *      everyone together (env override), 20/hour per scanned site — its
 *      registrable domain, charged again for the final site after redirects. A limiter
 *      counts when checked, so a call refused by a later one has spent the
 *      earlier ones — strict on purpose, and a call refused by the per-site
 *      limit still counts against the caller's day (architect decision 10).
 *   8. The scan (`run-scan.ts`): every fetch through the guarded fetcher. A
 *      failed scan has spent its daily allowance — otherwise failures would
 *      be a free probe — and stores nothing.
 *   9. The report row, through the service role (no web principal can reach
 *      `tool_reports`, ADR 062).
 *
 * Every limiter fails CLOSED (`onStoreFailure: "deny"`): this path spends
 * outbound fetches, function seconds and database rows with no authorization
 * behind it, so losing Redis must not remove the only control on it.
 *
 * Errors are fixed text (`messages.ts`). No message echoes the submitted URL,
 * an exception or a resolved address. No CORS header, ever. Logs carry the
 * tool, the scanned HOST, the outcome and the duration — never the full URL,
 * the caller's address or page text.
 */

import { NextResponse, type NextRequest } from "next/server";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { readBoundedJson } from "@/lib/api/validation";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getToolEntry } from "@/lib/tools/catalogue";
import { getLens } from "@/lib/tools/lenses/registry";
import {
  createReportStore,
  type ReportStore,
} from "@/lib/tools/report/report-store";
import { scanCacheKey } from "@/lib/tools/scan/cache-key";
import { scanClientKey } from "@/lib/tools/scan/client-key";
import {
  configuredDenylist,
  isDenylistedHost,
} from "@/lib/tools/scan/denylist";
import { globalDailyCap, isScanDisabled } from "@/lib/tools/scan/limits";
import {
  SCAN_FAILURE_MESSAGES,
  SCAN_MESSAGES,
} from "@/lib/tools/scan/messages";
import { normalizeScanUrl } from "@/lib/tools/scan/normalize-url";
import { registrableDomain } from "@/lib/tools/scan/registrable-domain";
import { runScan } from "@/lib/tools/scan/run-scan";
import { refuseCrossSiteScan } from "@/lib/tools/scan/same-origin-guard";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function json(body: object, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

function log(
  outcome: string,
  details: { tool?: string; host?: string; startedAt: number },
): void {
  console.info("[tools/scan]", {
    tool: details.tool,
    host: details.host,
    outcome,
    durationMs: Date.now() - details.startedAt,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();

  if (isScanDisabled()) {
    return json({ error: SCAN_MESSAGES.disabled }, 503);
  }

  const crossSite = refuseCrossSiteScan(request);
  if (crossSite) return crossSite;

  const client = scanClientKey(getClientIp(request));
  if (!client) return json({ error: SCAN_MESSAGES.unidentified }, 403);

  const burst = await enforceRateLimit(request, {
    limit: "TOOLS_SCAN_BURST",
    endpoint: "tools/scan:burst",
    identifier: client.key,
    identifierType: "ip",
    onStoreFailure: "deny",
    message: SCAN_MESSAGES.burst,
  });
  if (burst) return burst;

  const body = await readBoundedJson(request, MAX_BODY_BYTES);
  if (
    !body.ok ||
    body.value === null ||
    typeof body.value !== "object" ||
    Array.isArray(body.value) ||
    Object.keys(body.value).some((key) => FORBIDDEN_KEYS.has(key))
  ) {
    return json({ error: SCAN_MESSAGES.badBody }, 400);
  }
  const { tool: rawTool, url: rawUrl } = body.value as Record<string, unknown>;
  if (typeof rawTool !== "string" || typeof rawUrl !== "string") {
    return json({ error: SCAN_MESSAGES.badBody }, 400);
  }

  const entry = getToolEntry(rawTool);
  if (!entry) return json({ error: SCAN_MESSAGES.unknownTool }, 400);
  const lens = entry.lens ? getLens(entry.lens) : undefined;
  if (!lens) {
    if (entry.lens) {
      console.error(
        "[tools/scan] catalogue names a lens the registry lacks:",
        entry.slug,
      );
    }
    return json({ error: SCAN_MESSAGES.notScanTool }, 400);
  }
  const tool = entry.slug;

  const normalized = normalizeScanUrl(rawUrl);
  if (!normalized.ok) {
    return normalized.reason === "blocked_port"
      ? json(
          { error: SCAN_FAILURE_MESSAGES.blocked_port, reason: "blocked_port" },
          422,
        )
      : json({ error: SCAN_MESSAGES.invalidUrl }, 400);
  }
  const url = normalized.value;
  const denylist = configuredDenylist();
  if (isDenylistedHost(url.hostname, denylist)) {
    log("denylisted", { tool, host: url.hostname, startedAt });
    return json(
      { error: SCAN_FAILURE_MESSAGES.denylisted, reason: "denylisted" },
      422,
    );
  }

  let store: ReportStore;
  const now = new Date();
  const cacheKey = scanCacheKey(tool, url.href);
  let cachedId: string | null;
  try {
    store = createReportStore(createServiceRoleClient());
    cachedId = await store.findCachedReportId(cacheKey, now);
  } catch (error) {
    console.error(
      "[tools/scan] report store unavailable:",
      (error as Error).name,
    );
    return json({ error: SCAN_MESSAGES.unavailable }, 503);
  }
  if (cachedId) {
    log("cached", { tool, host: url.hostname, startedAt });
    return json(
      {
        reportId: cachedId,
        reportUrl: `/tools/${tool}/r/${cachedId}`,
        cached: true,
      },
      200,
    );
  }

  const daily = await enforceRateLimit(request, {
    limit: "TOOLS_SCAN_DAILY",
    endpoint: "tools/scan:daily",
    identifier: client.key,
    identifierType: "ip",
    onStoreFailure: "deny",
    message: SCAN_MESSAGES.daily,
  });
  if (daily) return daily;

  if (client.network48) {
    const daily48 = await enforceRateLimit(request, {
      limit: "TOOLS_SCAN_DAILY_48",
      endpoint: "tools/scan:daily48",
      identifier: client.network48,
      identifierType: "ip",
      onStoreFailure: "deny",
      message: SCAN_MESSAGES.daily,
    });
    if (daily48) return daily48;
  }

  const global = await enforceRateLimit(request, {
    limit: "TOOLS_SCAN_GLOBAL_DAILY",
    endpoint: "tools/scan:global",
    identifier: "all",
    identifierType: "global",
    onStoreFailure: "deny",
    maxRequests: globalDailyCap(),
    message: SCAN_MESSAGES.globalCap,
  });
  if (global) {
    if (global.status === 429) {
      // An operator signal, not a visitor's problem: the shared daily cap is
      // spent. docs/operations/free-tools.md says what to do (raise
      // TOOLS_SCAN_GLOBAL_DAILY_CAP, or build Turnstile — s96b).
      console.error("[tools/scan] global daily scan cap reached", {
        cap: globalDailyCap(),
      });
    }
    return global;
  }

  // Keyed on the registrable domain (s96 review, minor 3): keyed on the host
  // name, a victim's subdomains were each a fresh bucket.
  const chargeTarget = (domain: string) =>
    enforceRateLimit(request, {
      limit: "TOOLS_SCAN_TARGET_HOURLY",
      endpoint: "tools/scan:target",
      identifier: domain,
      identifierType: "host",
      onStoreFailure: "deny",
      message: SCAN_MESSAGES.target,
    });
  const target = await chargeTarget(registrableDomain(url.hostname));
  if (target) return target;

  // ...and charged again for the FINAL site when a redirect changed it, so a
  // host that redirects to a victim cannot spend the victim's scans from its
  // own bucket. Its refusal (429, or 503 when the store is down) is returned
  // as is.
  let finalHostRefusal: NextResponse | null = null;
  const result = await runScan({
    tool,
    lens,
    url,
    now,
    denylist,
    authorizeFinalHost: async (domain) => {
      finalHostRefusal = await chargeTarget(domain);
      return finalHostRefusal === null;
    },
  });
  if (!result.ok && result.reason === "target_limited" && finalHostRefusal) {
    log("target_limited", { tool, host: url.hostname, startedAt });
    return finalHostRefusal;
  }
  if (!result.ok) {
    log(result.reason, { tool, host: url.hostname, startedAt });
    return json(
      { error: SCAN_FAILURE_MESSAGES[result.reason], reason: result.reason },
      422,
    );
  }

  let reportId: string;
  try {
    reportId = await store.insertReport({
      tool,
      cacheKey,
      url: url.href,
      report: result.report,
    });
  } catch (error) {
    console.error("[tools/scan] report insert failed:", (error as Error).name);
    return json({ error: SCAN_MESSAGES.unavailable }, 503);
  }

  log("scanned", { tool, host: url.hostname, startedAt });
  return json(
    { reportId, reportUrl: `/tools/${tool}/r/${reportId}`, cached: false },
    200,
  );
}
