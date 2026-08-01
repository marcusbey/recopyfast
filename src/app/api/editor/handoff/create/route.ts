/**
 * POST /api/editor/handoff/create
 *
 * Hub-only. Turns "Bob picked helloworld.com" into a URL that drops him onto
 * that site already trusted.
 *
 * Same-origin by design: authenticated by the httpOnly hub cookie, and
 * deliberately given no CORS headers so no other origin can drive it. The
 * cookie is SameSite=Lax, so a cross-site form post carries no credentials
 * either.
 */

import { NextRequest, NextResponse } from "next/server";
import { getHubSessionEmail } from "@/lib/auth/editor-hub-session";
import { findActiveSiteEditor } from "@/lib/auth/editor-directory";
import { createHandoff } from "@/lib/auth/editor-handoff";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { readJsonBody, readString } from "@/lib/auth/editor-request";

/** Build the URL the browser is sent to. `sites.domain` may or may not carry a scheme. */
function buildSiteUrl(domain: string, handoffCode: string): string {
  const base = domain.startsWith("http") ? domain : `https://${domain}`;
  const url = new URL(base);
  url.searchParams.set("rcf_handoff", handoffCode);
  return url.toString();
}

export async function POST(request: NextRequest) {
  try {
    const email = await getHubSessionEmail();
    if (!email) {
      return NextResponse.json(
        { error: "not_signed_in", message: "Verify your email again." },
        { status: 401 },
      );
    }

    const body = await readJsonBody(request);
    const siteId = readString(body, "siteId");
    const rememberDevice = body?.rememberDevice === true;

    if (!siteId) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    // Re-checked here, not taken from the session. A hub session minted before
    // the owner removed Bob must not still open the door — which is why the hub
    // session can stay stateless.
    const editor = await findActiveSiteEditor(siteId, email);
    if (!editor) {
      return NextResponse.json(
        { error: "not_authorized", message: "You can't edit that site." },
        { status: 403 },
      );
    }

    const supabase = createServiceRoleClient();
    const { data: site, error } = await supabase
      .from("sites")
      .select("domain")
      .eq("id", siteId)
      .maybeSingle();

    if (error || !site?.domain) {
      return NextResponse.json({ error: "site_unavailable" }, { status: 404 });
    }

    const code = await createHandoff({
      siteEditorId: editor.id,
      rememberDevice,
    });

    if (!code) {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      redirectUrl: buildSiteUrl(site.domain, code),
      expiresInSeconds: 60,
    });
  } catch (error) {
    console.error("[editor-auth] handoff create failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
