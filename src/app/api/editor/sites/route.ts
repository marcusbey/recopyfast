/**
 * GET /api/editor/sites
 *
 * Hub-only. The sites the currently-verified address may edit.
 *
 * Read fresh on every call rather than baked into the hub session, so a
 * revocation is reflected immediately in the list.
 */

import { NextResponse } from "next/server";
import { getHubSessionEmail } from "@/lib/auth/editor-hub-session";
import { listSitesForEditor } from "@/lib/auth/editor-directory";

export async function GET() {
  try {
    const email = await getHubSessionEmail();
    if (!email) {
      return NextResponse.json(
        { error: "not_signed_in", message: "Verify your email again." },
        { status: 401 },
      );
    }

    const sites = await listSitesForEditor(email);

    return NextResponse.json({
      ok: true,
      email,
      sites: sites.map((site) => ({
        siteId: site.siteId,
        name: site.siteName,
        domain: site.siteDomain,
        permissions: site.permissions,
      })),
    });
  } catch (error) {
    console.error("[editor-auth] site list failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
