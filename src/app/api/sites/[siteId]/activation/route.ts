import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requireUuid } from "@/lib/api/validation";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ siteId: string }>;
}

interface AuthorizedRequest {
  siteId: string;
  user: {
    id: string;
    user_metadata?: Record<string, unknown>;
  };
  supabase: Awaited<ReturnType<typeof createClient>>;
}

const dismissalKey = (siteId: string) => `activation_dismissed_${siteId}`;

async function authorizeAdmin(
  request: NextRequest,
  context: RouteContext,
): Promise<AuthorizedRequest | NextResponse> {
  const { siteId: rawSiteId } = await context.params;
  const siteIdResult = requireUuid({ siteId: rawSiteId }, "siteId");
  if (!siteIdResult.ok) {
    return NextResponse.json({ error: "Invalid site id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userIdResult = requireUuid({ userId: user.id }, "userId");
  if (!userIdResult.ok) {
    console.error("Authenticated user has a malformed UUID");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const siteId = siteIdResult.value;
  const userId = userIdResult.value;

  // The first implementation used a shared-IP bucket before authentication.
  // That made every visible checklist card in an agency office spend from the
  // same counter. The activation facts are cheap RLS reads, so isolate each
  // authenticated user's polling budget for each site. Keep this before the admin
  // lookup and every data read, and fail closed so a missing Redis store cannot
  // silently turn an authenticated polling endpoint into an unmetered path.
  const limited = await enforceRateLimit(request, {
    limit: "IP_GENERAL",
    endpoint: "sites/activation:user-site",
    identifier: `${userId}:${siteId}`,
    identifierType: "user",
    onStoreFailure: "deny",
  });
  if (limited) return limited;

  const { data: permission, error: permissionError } = await supabase
    .from("site_permissions")
    .select("permission")
    .eq("site_id", siteId)
    .eq("user_id", userId)
    .maybeSingle();

  if (permissionError || permission?.permission !== "admin") {
    return NextResponse.json(
      { error: "Admin permission required" },
      { status: 403 },
    );
  }

  return { siteId, user, supabase };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authorization = await authorizeAdmin(request, context);
    if (!("siteId" in authorization)) return authorization;

    const { siteId, user, supabase } = authorization;

    // These are three independent facts. Keeping them as bounded existence
    // reads makes the response cheap without allowing one missing/erroring fact
    // to collapse into a false value that looks like trustworthy progress. All
    // reads stay on the signed-in user's client: the service-role version hid
    // an RLS regression and turned a missing site filter into an IDOR. The
    // explicit column lists also avoid `sites.api_key`, whose SELECT grant is
    // intentionally revoked from authenticated users.
    const [siteResult, editorResult, publishResult] = await Promise.all([
      supabase
        .from("sites")
        .select("status, live_at")
        .eq("id", siteId)
        .single(),
      supabase
        .from("site_editors")
        .select("id")
        .eq("site_id", siteId)
        .is("revoked_at", null)
        // normalizePermissions grants publish to both explicit publishers and
        // admins. Filter for both before limiting; taking the first active
        // editor and normalizing afterward can miss a later publisher.
        .overlaps("permissions", ["publish", "admin"])
        .limit(1),
      supabase
        .from("staging_history")
        .select("content_element_id, content_elements!inner(site_id)")
        .eq("action", "publish")
        .eq("content_elements.site_id", siteId)
        .limit(1),
    ]);

    if (
      siteResult.error ||
      !siteResult.data ||
      editorResult.error ||
      !Array.isArray(editorResult.data) ||
      publishResult.error ||
      !Array.isArray(publishResult.data)
    ) {
      console.error("Failed to derive site activation progress", {
        siteError: siteResult.error,
        editorError: editorResult.error,
        publishError: publishResult.error,
      });
      return NextResponse.json(
        { error: "Failed to load activation progress" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        // `last_reported_at` drives the advisory stale badge elsewhere. The
        // checklist is a one-way milestone: once the persisted state machine
        // has ever recorded a live status/time, 14 quiet days must not tell the
        // owner to reinstall a script that was already verified.
        installed:
          siteResult.data.status === "live" ||
          typeof siteResult.data.live_at === "string",
        invited: editorResult.data.length > 0,
        published: publishResult.data.length > 0,
        dismissed: user.user_metadata?.[dismissalKey(siteId)] === true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error in GET /api/sites/[siteId]/activation:", error);
    return NextResponse.json(
      { error: "Failed to load activation progress" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authorization = await authorizeAdmin(request, context);
    if (!("siteId" in authorization)) return authorization;

    const { siteId, supabase } = authorization;
    // Supabase merges `data` into user_metadata. Sending only this site key is
    // intentional: replacing the object would erase preferences and dismissal
    // choices for every other site on the account.
    const { error } = await supabase.auth.updateUser({
      data: { [dismissalKey(siteId)]: true },
    });

    if (error) {
      console.error("Failed to persist activation checklist dismissal", error);
      return NextResponse.json(
        { error: "Failed to dismiss activation checklist" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { dismissed: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error in POST /api/sites/[siteId]/activation:", error);
    return NextResponse.json(
      { error: "Failed to dismiss activation checklist" },
      { status: 500 },
    );
  }
}
