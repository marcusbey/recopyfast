import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { buildSiteToken } from "@/lib/security/site-auth";
import { buildEmbedScript } from "@/lib/sites/embed-script";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireUuid } from "@/lib/api/validation";

interface RouteContext {
  params: Promise<{ siteId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    // A loose IP bucket sheds anonymous floods before authentication performs
    // its database lookup. This deliberately reuses the broad existing preset:
    // offices and agencies share public IPs, so the tighter credential-rotation
    // limit belongs to the authenticated account below. Both fail closed because
    // this route replaces the secret that authorises every public widget call.
    const floodLimited = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "sites/regenerate-snippet:ip",
      identifier: getClientIp(request),
      onStoreFailure: "deny",
    });
    if (floodLimited) return floodLimited;

    const { siteId: rawSiteId } = await context.params;
    const siteIdResult = requireUuid({ siteId: rawSiteId }, "siteId");
    if (!siteIdResult.ok) {
      return NextResponse.json({ error: "Invalid site id" }, { status: 400 });
    }
    const siteId = siteIdResult.value;
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
    const userId = userIdResult.value;

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

    const ownerLimited = await enforceRateLimit(request, {
      limit: "USER_DOMAIN_VERIFY",
      endpoint: "sites/regenerate-snippet:owner",
      identifier: userId,
      identifierType: "user",
      onStoreFailure: "deny",
      message: "Too many snippet regenerations. Please try again shortly.",
    });
    if (ownerLimited) return ownerLimited;

    const apiKey = randomBytes(32).toString("hex");
    const service = createServiceRoleClient();

    // This is intentionally one guarded statement. The old key remains valid
    // if Postgres refuses the update; once the statement succeeds, every token
    // signed with the old key becomes invalid at the same instant. Returning
    // the row also prevents us from minting a token for a write that did not
    // actually affect this site.
    const { data: site, error: updateError } = await service
      .from("sites")
      .update({ api_key: apiKey })
      .eq("id", siteId)
      .select("id, api_key")
      .single();

    if (updateError || !site) {
      console.error("Failed to regenerate site snippet:", updateError);
      return NextResponse.json(
        { error: "Failed to regenerate snippet" },
        { status: 500 },
      );
    }

    const siteToken = buildSiteToken(site.id, site.api_key);
    const embedScript = buildEmbedScript({ siteId: site.id, siteToken });

    // The raw signing key never crosses this boundary. A freshly signed token
    // and its ready-to-paste snippet are the only credentials the dashboard
    // needs, and no-store prevents either from entering an intermediary cache.
    return NextResponse.json(
      { ok: true, siteToken, embedScript },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "Error in POST /api/sites/[siteId]/regenerate-snippet:",
      error,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
