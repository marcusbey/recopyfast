import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildSiteToken } from "@/lib/security/site-auth";
import { buildEmbedScript } from "@/lib/sites/embed-script";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";

function normalizeDomain(domain: string) {
  const trimmed = domain.trim();
  if (!trimmed) {
    throw new Error("Domain and name are required");
  }

  try {
    const url = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    );
    return url.hostname.toLowerCase();
  } catch {
    throw new Error("Invalid domain name");
  }
}

export async function POST(request: NextRequest) {
  try {
    // Loose pre-auth flood guard. Deliberately NOT the registration cap: IP is
    // an identifier the user does not control, and a tight per-IP limit would
    // lock out every agency and office behind one NAT address. The real cap is
    // applied per account below, once we know who is asking.
    const floodLimited = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "sites/register:ip",
      identifier: getClientIp(request),
      onStoreFailure: "deny",
    });
    if (floodLimited) return floodLimited;

    const { domain, name } = await request.json();

    if (!domain || !name) {
      return NextResponse.json(
        { error: "Domain and name are required" },
        { status: 400 },
      );
    }

    let normalizedDomain: string;
    try {
      normalizedDomain = normalizeDomain(domain);
    } catch (validationError) {
      return NextResponse.json(
        {
          error:
            validationError instanceof Error
              ? validationError.message
              : "Invalid domain name",
        },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const serviceClient = createServiceRoleClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // The real registration cap, scoped to the account. Each success mints an
    // API key and a signed site token, so this is the credential-farming control.
    // Fails CLOSED — issuing credentials unmetered is not an acceptable degraded mode.
    const registrationLimited = await enforceRateLimit(request, {
      limit: "IP_REGISTRATION",
      endpoint: "sites/register",
      identifier: user.id,
      identifierType: "user",
      onStoreFailure: "deny",
      message: "Too many site registrations. Please try again later.",
    });
    if (registrationLimited) return registrationLimited;

    // Check if domain already exists
    const { data: existingSite } = await serviceClient
      .from("sites")
      .select("id")
      .eq("domain", normalizedDomain)
      .single();

    if (existingSite) {
      return NextResponse.json(
        { error: "Domain already registered" },
        { status: 400 },
      );
    }

    // Create site
    const { data: site, error } = await serviceClient
      .from("sites")
      .insert({
        domain: normalizedDomain,
        name,
      })
      .select("id, domain, name, created_at, api_key")
      .single();

    if (error || !site) {
      console.error("Error creating site:", error);
      return NextResponse.json(
        { error: "Failed to create site" },
        { status: 500 },
      );
    }

    // Grant permissions to creator
    const { error: permissionError } = await serviceClient
      .from("site_permissions")
      .upsert(
        {
          site_id: site.id,
          user_id: user.id,
          permission: "admin",
        },
        { onConflict: "user_id,site_id" },
      );

    if (permissionError) {
      console.error("Error creating site permissions:", permissionError);
      return NextResponse.json(
        { error: "Failed to assign site permissions" },
        { status: 500 },
      );
    }

    const siteToken = buildSiteToken(site.id, site.api_key);
    const embedScript = buildEmbedScript({ siteId: site.id, siteToken });

    return NextResponse.json({
      site: {
        id: site.id,
        domain: site.domain,
        name: site.name,
        created_at: site.created_at,
      },
      apiKey: site.api_key,
      siteToken,
      embedScript,
    });
  } catch (error) {
    console.error("Error in site registration:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
