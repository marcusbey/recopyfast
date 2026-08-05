import { NextRequest, NextResponse } from "next/server";
import { analytics, getClientInfo } from "@/lib/analytics/tracker";
import {
  authorizeIngestRequest,
  authorizeSiteReadAccess,
  requireAuthenticatedUser,
} from "@/lib/security/ingest-auth";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  optionalEnum,
  optionalMetadata,
  optionalString,
  readJsonObject,
  requireEnum,
  requireUuid,
} from "@/lib/api/validation";
import type { UserActivityLog } from "@/types";

/**
 * Activity ingest.
 *
 * This is a public ingest endpoint by design: the embed script on a customer's
 * site posts anonymous visitor events (page views have no logged-in user), so a
 * blanket session requirement would break the widget. It is NOT anonymous
 * though — every write must present either a site token or a session with a
 * permission on the target site. See @/lib/security/ingest-auth.
 */

const ACTION_TYPES = [
  "page_view",
  "content_edit",
  "login",
  "logout",
  "api_call",
] as const satisfies readonly UserActivityLog["action_type"][];

const RESOURCE_TYPES = [
  "content_element",
  "site",
  "user",
  "team",
] as const satisfies readonly NonNullable<UserActivityLog["resource_type"]>[];

const MAX_RESOURCE_ID_LENGTH = 255;

/**
 * The embed script calls this cross-origin from customer domains. Origin is
 * already pinned to the site's registered domain inside authorizeSiteRequest,
 * so a wildcard here does not widen access; credentials are never allowed.
 * Same-origin dashboard calls ignore these headers entirely.
 */
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

    // siteId is validated before authorization so a malformed id cannot reach
    // the database lookup inside authorizeIngestRequest.
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

    // Rate limit per site rather than per IP: visitor traffic legitimately
    // arrives from many addresses, and the resource being protected is the
    // per-site activity log. Telemetry fails open — a Redis blip should degrade
    // analytics, not the customer's page.
    const limited = await enforceRateLimit(req, {
      limit: "API_CONTENT",
      endpoint: "analytics/track",
      identifier: siteId.value,
      identifierType: "api_key",
      onStoreFailure: "allow",
      message: "Analytics ingest rate limit exceeded for this site.",
    });
    if (limited) return withCors(limited);

    const action = requireEnum(body.value, "action", ACTION_TYPES);
    if (!action.ok) {
      return withCors(
        NextResponse.json({ error: action.error }, { status: 400 }),
      );
    }

    const resourceType = optionalEnum(
      body.value,
      "resourceType",
      RESOURCE_TYPES,
    );
    if (!resourceType.ok) {
      return withCors(
        NextResponse.json({ error: resourceType.error }, { status: 400 }),
      );
    }

    const resourceId = optionalString(body.value, "resourceId", {
      maxLength: MAX_RESOURCE_ID_LENGTH,
    });
    if (!resourceId.ok) {
      return withCors(
        NextResponse.json({ error: resourceId.error }, { status: 400 }),
      );
    }

    const metadata = optionalMetadata(body.value);
    if (!metadata.ok) {
      return withCors(
        NextResponse.json({ error: metadata.error }, { status: 400 }),
      );
    }

    const clientInfo = getClientInfo(req);

    await analytics.trackActivity({
      // Only a session-authenticated caller may attribute a row to a user. A
      // site-token caller is an anonymous visitor and must never be able to
      // pick whose id lands on the record.
      userId: auth.userId,
      siteId: siteId.value,
      actionType: action.value,
      resourceType: resourceType.value,
      resourceId: resourceId.value,
      metadata: metadata.value,
      ...clientInfo,
    });

    return withCors(NextResponse.json({ success: true }));
  } catch (error) {
    console.error("Analytics tracking error:", error);
    return withCors(
      NextResponse.json(
        { error: "Failed to track analytics" },
        { status: 500 },
      ),
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteIdParam = searchParams.get("siteId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    // siteId stays optional: the dashboard's "all sites" view omits it. That
    // path is not a cross-tenant leak — getDashboardData filters on `id = ""`
    // when no siteId is given, which matches nothing and yields an empty
    // dashboard. Scoping it to the caller's own sites belongs in the tracker,
    // not here.
    let siteId: string | undefined;
    if (siteIdParam) {
      const parsed = requireUuid({ siteId: siteIdParam }, "siteId");
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      siteId = parsed.value;
    }

    const auth = siteId
      ? await authorizeSiteReadAccess(siteId)
      : await requireAuthenticatedUser();

    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limited = await enforceRateLimit(req, {
      limit: "USER_GENERAL",
      endpoint: "analytics/track:read",
      identifier: auth.userId!,
      identifierType: "user",
      onStoreFailure: "allow",
    });
    if (limited) return limited;

    const dateRange =
      startDate && endDate ? { start: startDate, end: endDate } : undefined;
    const dashboardData = await analytics.getDashboardData(
      siteId,
      dateRange,
      auth.userId,
    );

    return NextResponse.json(dashboardData);
  } catch (error) {
    console.error("Analytics fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 },
    );
  }
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}
