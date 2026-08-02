import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { authorizeSiteReadAccess } from "@/lib/security/ingest-auth";

/**
 * Content elements for signed-in dashboard users.
 *
 * /api/content/[siteId] serves the same rows but is gated on a site token +
 * matching Origin, because it exists for the embed script running on the
 * customer's domain. A dashboard user has no site token and their Origin is
 * this app, so that route always 401s for them. This route covers the
 * first-party case: authorization is the caller's site_permissions row.
 *
 * Read-only by design — dashboard edits go through /api/staging/content.
 */

interface RouteContext {
  params: Promise<{ siteId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { siteId } = await context.params;

    const auth = await authorizeSiteReadAccess(siteId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const searchParams = request.nextUrl.searchParams;
    const language = searchParams.get("language") || "en";
    const variant = searchParams.get("variant") || "default";

    const supabase = createServiceRoleClient();
    const { data: contentElements, error } = await supabase
      .from("content_elements")
      .select(
        "id, site_id, element_id, selector, published_content, original_content, language, variant, metadata, published_at",
      )
      .eq("site_id", siteId)
      .eq("language", language)
      .eq("variant", variant);

    if (error) {
      console.error("Error fetching content elements:", error);
      return NextResponse.json(
        { error: "Failed to fetch content elements" },
        { status: 500 },
      );
    }

    // Mirror the embed route's shape so both callers see the same contract:
    // published content is the live value, original_content the fallback for
    // rows that have never been published.
    const elements = (contentElements || []).map((element) => ({
      ...element,
      current_content:
        element.published_content ?? element.original_content ?? "",
    }));

    return NextResponse.json({ elements });
  } catch (error) {
    console.error("Error in GET /api/sites/[siteId]/content-elements:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
