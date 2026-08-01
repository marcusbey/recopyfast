/**
 * /api/editor/editors — the site owner's control over the durable allowlist.
 *
 *   GET     list editors of a site, with a live device count
 *   POST    invite, or restore a previously revoked editor
 *   DELETE  revoke, killing every active device grant in the same call
 *
 * Authenticated by the owner's Supabase session and authorised by an explicit
 * `admin` grant on the site — the same check the rest of the staging API makes.
 * Same-origin only: no CORS headers, because nothing outside the dashboard has
 * any business calling this.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  isPlausibleEmail,
  listSiteEditors,
  revokeSiteEditor,
  upsertSiteEditor,
} from "@/lib/auth/editor-directory";
import {
  normalizePermissions,
  type EditorPermission,
} from "@/lib/auth/editor-access";
import { readJsonBody, readString } from "@/lib/auth/editor-request";
import { enforceRateLimit } from "@/lib/api/rate-limit";

interface Caller {
  userId: string;
}

/** Authenticate, then authorise against this specific site. */
async function requireSiteAdmin(
  siteId: string,
): Promise<{ caller: Caller } | { response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const { data: permission, error: permError } = await supabase
    .from("site_permissions")
    .select("permission")
    .eq("site_id", siteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (permError || permission?.permission !== "admin") {
    return {
      response: NextResponse.json(
        { error: "forbidden", message: "Admin permission required." },
        { status: 403 },
      ),
    };
  }

  return { caller: { userId: user.id } };
}

export async function GET(request: NextRequest) {
  try {
    const siteId = request.nextUrl.searchParams.get("siteId");
    if (!siteId) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const auth = await requireSiteAdmin(siteId);
    if ("response" in auth) return auth.response;

    const editors = await listSiteEditors(siteId);

    return NextResponse.json({
      ok: true,
      editors: editors.map((editor) => ({
        id: editor.id,
        email: editor.email,
        permissions: editor.permissions,
        createdAt: editor.createdAt.toISOString(),
        revokedAt: editor.revokedAt?.toISOString() ?? null,
        activeDevices: editor.activeDevices,
      })),
    });
  } catch (error) {
    console.error("[editor-auth] list editors failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    const siteId = readString(body, "siteId");
    const email = readString(body, "email");
    const rawPermissions = Array.isArray(body?.permissions)
      ? (body.permissions as unknown[]).filter(
          (value): value is string => typeof value === "string",
        )
      : ["edit"];

    if (!siteId || !email || !isPlausibleEmail(email.trim())) {
      return NextResponse.json(
        {
          error: "invalid_request",
          message: "siteId and a valid email are required.",
        },
        { status: 400 },
      );
    }

    const auth = await requireSiteAdmin(siteId);
    if ("response" in auth) return auth.response;

    // Adding an editor does not itself send mail, but it is the step that makes
    // an address mailable by the code endpoint. Throttle it so a compromised
    // owner session cannot be used to enrol a list of addresses at speed.
    const limited = await enforceRateLimit(request, {
      limit: "USER_DOMAIN_VERIFY",
      endpoint: "editor/editors:invite",
      identifier: auth.caller.userId,
      identifierType: "user",
      onStoreFailure: "deny",
      message: "Too many invites. Please try again shortly.",
    });
    if (limited) return limited;

    const permissions = normalizePermissions(
      rawPermissions as EditorPermission[],
    );
    if (permissions.length === 0) {
      return NextResponse.json(
        {
          error: "invalid_permissions",
          message:
            "Permissions must include at least one of view, edit, publish, admin.",
        },
        { status: 400 },
      );
    }

    const editor = await upsertSiteEditor({
      siteId,
      email: email.trim(),
      permissions,
      invitedBy: auth.caller.userId,
    });

    if (!editor) {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      editor: {
        id: editor.id,
        email: editor.email,
        permissions: editor.permissions,
        createdAt: editor.createdAt.toISOString(),
      },
      // There is no invitation link to send: the editor goes to /edit and asks
      // for a code. Nothing here is a secret, so nothing here can be forwarded.
      hubUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/edit`,
    });
  } catch (error) {
    console.error("[editor-auth] invite editor failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const siteEditorId = request.nextUrl.searchParams.get("siteEditorId");
    if (!siteEditorId) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    // Resolve the owning site before the permission check — the caller supplies
    // an editor id, and we must authorise against the site that id belongs to
    // rather than one they name.
    const service = createServiceRoleClient();
    const { data: editor, error } = await service
      .from("site_editors")
      .select("id, site_id")
      .eq("id", siteEditorId)
      .maybeSingle();

    if (error || !editor) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const auth = await requireSiteAdmin(editor.site_id);
    if ("response" in auth) return auth.response;

    const result = await revokeSiteEditor({ siteEditorId });
    if (!result.revoked) {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }

    console.warn(
      `[editor-auth] editor ${siteEditorId} revoked by ${auth.caller.userId}; ${result.grantsKilled} device grant(s) killed`,
    );

    return NextResponse.json({
      ok: true,
      grantsRevoked: result.grantsKilled,
    });
  } catch (error) {
    console.error("[editor-auth] revoke editor failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
