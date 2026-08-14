import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateAndSanitizeInput } from "@/lib/security/content-sanitizer";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");
    const eventType = searchParams.get("eventType");
    const severity = searchParams.get("severity");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build query
    let query = supabase
      .from("security_events")
      .select(
        `
        *,
        sites(id, domain)
      `,
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (siteId) {
      const sanitizedSiteId = validateAndSanitizeInput(siteId);

      // Check if user has permission to view this site's events
      const { data: sitePermission, error: permissionError } = await supabase
        .from("site_permissions")
        .select("permission")
        .eq("site_id", sanitizedSiteId)
        .eq("user_id", user.id)
        .single();

      if (
        permissionError ||
        !sitePermission ||
        sitePermission.permission !== "admin"
      ) {
        return NextResponse.json(
          { error: "Insufficient permissions" },
          { status: 403 },
        );
      }

      query = query.eq("site_id", sanitizedSiteId);
    } else {
      // Only show events for sites the user has access to
      const { data: userSites } = await supabase
        .from("site_permissions")
        .select("site_id")
        .eq("user_id", user.id)
        .eq("permission", "admin");

      if (userSites && userSites.length > 0) {
        const siteIds = userSites.map((s) => s.site_id);
        query = query.in("site_id", siteIds);
      } else {
        // User has no sites, return empty result
        return NextResponse.json({ events: [], total: 0 });
      }
    }

    if (eventType) {
      const sanitizedEventType = validateAndSanitizeInput(eventType);
      query = query.eq("event_type", sanitizedEventType);
    }

    if (severity) {
      const sanitizedSeverity = validateAndSanitizeInput(severity);
      query = query.eq("severity", sanitizedSeverity);
    }

    const { data: events, error } = await query;

    if (error) {
      console.error("Security events fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch security events" },
        { status: 500 },
      );
    }

    // Get total count for pagination
    let countQuery = supabase
      .from("security_events")
      .select("id", { count: "exact", head: true });

    if (siteId) {
      countQuery = countQuery.eq("site_id", siteId);
    }
    if (eventType) {
      countQuery = countQuery.eq("event_type", eventType);
    }
    if (severity) {
      countQuery = countQuery.eq("severity", severity);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error("Security events count error:", countError);
    }

    return NextResponse.json({
      events: events || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Security events API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Writes used to land here with no session and caller-chosen userId / siteId.
 * Nothing in the product POSTs this route — the dashboard only GETs — and
 * server-side logging should not go through a public HTTP surface.
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      error:
        "Client writes to /api/security/events are disabled. Security events are recorded server-side only.",
    },
    {
      status: 405,
      headers: { Allow: "GET" },
    },
  );
}
