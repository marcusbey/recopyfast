/**
 * GET /api/editor/sites
 *
 * Hub-only. The sites the currently-verified address may edit.
 *
 * Read fresh on every call rather than baked into the hub session, so a
 * revocation is reflected immediately in the list.
 *
 * s39: `/edit` calls this on load to resume a live session instead of asking
 * for a new code every time an editor comes back from a site. It also reports
 * whether the session is a remembered one — a resumed hub never shows the
 * "Remember this browser" checkbox again, so the page shows what the session
 * says rather than its own default.
 */

import { NextResponse } from "next/server";
import { getHubSession } from "@/lib/auth/editor-hub-session";
import { listSitesForEditor } from "@/lib/auth/editor-directory";

export async function GET() {
  try {
    const session = await getHubSession();
    if (!session) {
      return NextResponse.json(
        { error: "not_signed_in", message: "Verify your email again." },
        { status: 401 },
      );
    }

    const sites = await listSitesForEditor(session.email);

    return NextResponse.json({
      ok: true,
      email: session.email,
      remembered: session.remembered,
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
