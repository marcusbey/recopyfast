import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { authorizeSiteRequest } from "@/lib/security/site-auth";

function extractToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return request.nextUrl.searchParams.get("token");
}

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type",
  );
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return response;
}

interface TrackEvent {
  site_id: string;
  test_id: string;
  variant_id: string;
  visitor_id: string;
  session_id?: string;
  event_type: "view" | "click" | "conversion";
  value?: number;
  metadata?: Record<string, unknown>;
  geo_country?: string;
  geo_region?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const events: TrackEvent[] = Array.isArray(body) ? body : [body];

    if (events.length === 0) {
      return withCors(
        NextResponse.json({ error: "No events provided" }, { status: 400 }),
      );
    }

    // All events must share the same site_id
    const siteId = events[0].site_id;
    if (!siteId || events.some((e) => e.site_id !== siteId)) {
      return withCors(
        NextResponse.json(
          { error: "All events must share the same site_id" },
          { status: 400 },
        ),
      );
    }

    const token = extractToken(request);

    try {
      await authorizeSiteRequest({
        siteId,
        token,
        origin: request.headers.get("origin"),
        referer: request.headers.get("referer"),
      });
    } catch (authError) {
      return withCors(
        NextResponse.json(
          {
            error:
              authError instanceof Error ? authError.message : "Unauthorized",
          },
          { status: 401 },
        ),
      );
    }

    const supabase = createServiceRoleClient();

    // Validate required fields
    for (const event of events) {
      if (
        !event.test_id ||
        !event.variant_id ||
        !event.visitor_id ||
        !event.event_type
      ) {
        return withCors(
          NextResponse.json(
            {
              error:
                "Each event requires: test_id, variant_id, visitor_id, event_type",
            },
            { status: 400 },
          ),
        );
      }
    }

    // Deduplicate view events: check existing views per (visitor_id, test_id, variant_id)
    const viewEvents = events.filter((e) => e.event_type === "view");
    const nonViewEvents = events.filter((e) => e.event_type !== "view");
    const eventsToInsert: TrackEvent[] = [...nonViewEvents];

    if (viewEvents.length > 0) {
      const viewChecks = viewEvents.map((e) => ({
        visitor_id: e.visitor_id,
        test_id: e.test_id,
      }));

      // Check for existing views
      const uniqueChecks = Array.from(
        new Map(
          viewChecks.map((c) => [`${c.visitor_id}:${c.test_id}`, c]),
        ).values(),
      );

      for (const check of uniqueChecks) {
        const { count } = await supabase
          .from("ab_test_results")
          .select("id", { count: "exact", head: true })
          .eq("visitor_id", check.visitor_id)
          .eq("test_id", check.test_id)
          .eq("event_type", "view");

        if ((count ?? 0) === 0) {
          // No existing view — add view events for this visitor+test
          const matching = viewEvents.filter(
            (e) =>
              e.visitor_id === check.visitor_id && e.test_id === check.test_id,
          );
          eventsToInsert.push(...matching);
        }
      }
    }

    if (eventsToInsert.length === 0) {
      return withCors(
        NextResponse.json({ recorded: 0, deduplicated: events.length }),
      );
    }

    // Insert events
    const rows = eventsToInsert.map((e) => ({
      test_id: e.test_id,
      variant_id: e.variant_id,
      visitor_id: e.visitor_id,
      session_id: e.session_id || null,
      event_type: e.event_type,
      value: e.value ?? 1,
      metadata: e.metadata ?? {},
      geo_country: e.geo_country || null,
      geo_region: e.geo_region || null,
    }));

    const { error } = await supabase.from("ab_test_results").insert(rows);

    if (error) {
      console.error("Error recording A/B test events:", error);
      return withCors(
        NextResponse.json(
          { error: "Failed to record events" },
          { status: 500 },
        ),
      );
    }

    // Every 50th view event, trigger inline significance check
    if (viewEvents.length > 0) {
      const testId = viewEvents[0].test_id;
      const { count: totalViews } = await supabase
        .from("ab_test_results")
        .select("id", { count: "exact", head: true })
        .eq("test_id", testId)
        .eq("event_type", "view");

      if (totalViews && totalViews % 50 < eventsToInsert.length) {
        // Lazy import to avoid circular deps
        try {
          const { checkTestCompletion } = await import(
            "@/lib/ab-testing/lifecycle"
          );
          await checkTestCompletion(testId);
        } catch (e) {
          console.error("Inline significance check failed:", e);
        }
      }
    }

    return withCors(
      NextResponse.json({
        recorded: eventsToInsert.length,
        deduplicated: events.length - eventsToInsert.length,
      }),
    );
  } catch (error) {
    console.error("Track A/B test error:", error);
    return withCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
    );
  }
}

export async function OPTIONS() {
  return withCors(NextResponse.json({}, { status: 204 }));
}
