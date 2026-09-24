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
  activateSiteEditor,
  findActiveSiteEditor,
  isPlausibleEmail,
  listSiteEditors,
  revokeSiteEditor,
} from "@/lib/auth/editor-directory";
import { canShareSite } from "@/lib/feature-gating/permissions";
import {
  normalizePermissions,
  type EditorPermission,
} from "@/lib/auth/editor-access";
import { readJsonBody, readString } from "@/lib/auth/editor-request";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { sendEditorInvitationEmail } from "@/lib/email/resend";

interface Caller {
  userId: string;
  email: string | null;
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

  return { caller: { userId: user.id, email: user.email ?? null } };
}

function editorHubUrl(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/edit`;
}

async function deliverInvitation(params: {
  siteId: string;
  editor: {
    email: string;
    permissions: EditorPermission[];
  };
  inviterEmail: string;
}): Promise<boolean> {
  try {
    const service = createServiceRoleClient();
    const { data: site, error } = await service
      .from("sites")
      .select("name, domain")
      .eq("id", params.siteId)
      .maybeSingle();

    if (error || !site?.name || !site.domain) {
      console.error(
        "[editor-auth] invitation metadata lookup failed:",
        error?.message ?? "site metadata missing",
      );
      return false;
    }

    const result = await sendEditorInvitationEmail({
      to: params.editor.email,
      inviterEmail: params.inviterEmail,
      siteName: site.name,
      siteDomain: site.domain,
      permissions: params.editor.permissions,
      hubUrl: editorHubUrl(),
    });
    return result.sent;
  } catch (error) {
    // Enrolment is the durable source of access. A mail or metadata outage must
    // be visible to the dashboard without rolling that successful write back or
    // tempting the owner to create a duplicate editor row.
    console.error("[editor-auth] invitation delivery failed:", error);
    return false;
  }
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

    // Invitation delivery now happens in this request. Count the source before
    // session/database work so a caller cannot turn rejected auth attempts into
    // an unmetered path to the mail-capable branch. Store failure denies.
    const preAuthLimited = await enforceRateLimit(request, {
      limit: "IP_AUTH",
      endpoint: "editor/editors:invite:ip",
      identifierType: "ip",
      onStoreFailure: "deny",
      message: "Too many invites. Please try again shortly.",
    });
    if (preAuthLimited) return preAuthLimited;

    const auth = await requireSiteAdmin(siteId);
    if ("response" in auth) return auth.response;

    // The owner bucket limits both allowlist writes and the invitation they can
    // trigger, so a compromised session cannot enrol and mail a list at speed.
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

    // An editor is a person with standing access to change live copy, which is
    // what a seat is. Enrolment went unmetered while the share path was gated,
    // so the allowance Starter sells as zero and Pro sells as five was
    // avoidable simply by using this door instead of that one.
    //
    // Charged only when the write would actually occupy a seat. An already
    // active editor holds theirs, so re-saving their permissions costs nothing;
    // an unknown or revoked address does not, so both enrolling and restoring
    // are checked here — a seat freed by a revocation may have been taken by
    // someone else in the meantime.
    //
    // canShareSite resolves whose plan pays: the site's owner, never the
    // acting admin, or a Pro admin on a Starter owner's site would be issuing
    // seats nobody bought.
    const existingEditor = await findActiveSiteEditor(siteId, email.trim());
    if (!existingEditor) {
      const seatQuota = await canShareSite(siteId, auth.caller.userId);
      if (!seatQuota.allowed) {
        return NextResponse.json(
          {
            error: "seat_limit",
            message: seatQuota.reason ?? "Seat limit reached.",
            upgradeRequired: seatQuota.upgradeRequired ?? false,
            currentLimit: seatQuota.currentLimit,
            maxLimit: seatQuota.maxLimit,
          },
          { status: 403 },
        );
      }
    }

    const activation = await activateSiteEditor({
      siteId,
      email: email.trim(),
      permissions,
      invitedBy: auth.caller.userId,
    });

    if (!activation) {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }

    const { editor } = activation;
    const invitationEmailSent =
      activation.didActivate && auth.caller.email
        ? await deliverInvitation({
            siteId,
            editor,
            inviterEmail: auth.caller.email,
          })
        : false;

    return NextResponse.json({
      ok: true,
      editor: {
        id: editor.id,
        email: editor.email,
        permissions: editor.permissions,
        createdAt: editor.createdAt.toISOString(),
      },
      hubUrl: editorHubUrl(),
      invitationEmailSent,
    });
  } catch (error) {
    console.error("[editor-auth] invite editor failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    const siteId = readString(body, "siteId");
    const siteEditorId = readString(body, "siteEditorId");
    if (!siteId || !siteEditorId) {
      return NextResponse.json(
        {
          error: "invalid_request",
          message: "siteId and siteEditorId are required.",
        },
        { status: 400 },
      );
    }

    // This first bucket is intentionally before authentication. Auth performs
    // database work; without a cheap IP cap, a caller can spend that work while
    // never reaching the owner/editor mail limits below. Mail writes fail closed
    // if the limiter store is unavailable.
    const preAuthLimited = await enforceRateLimit(request, {
      limit: "IP_AUTH",
      endpoint: "editor/editors:resend:ip",
      identifierType: "ip",
      onStoreFailure: "deny",
      message: "Too many invitation requests. Please try again shortly.",
    });
    if (preAuthLimited) return preAuthLimited;

    const auth = await requireSiteAdmin(siteId);
    if ("response" in auth) return auth.response;

    const ownerLimited = await enforceRateLimit(request, {
      limit: "EDITOR_INVITE_OWNER",
      endpoint: "editor/editors:resend:owner",
      identifier: auth.caller.userId,
      identifierType: "user",
      onStoreFailure: "deny",
      message: "Too many invitations sent. Please try again later.",
    });
    if (ownerLimited) return ownerLimited;

    const editorLimited = await enforceRateLimit(request, {
      limit: "EDITOR_INVITE_RECIPIENT",
      endpoint: "editor/editors:resend:editor",
      identifier: `${siteId}|${siteEditorId}`,
      identifierType: "user",
      onStoreFailure: "deny",
      message:
        "This editor has already received several invitations. Try again later.",
    });
    if (editorLimited) return editorLimited;

    // Both predicates matter. Authorising site A must never make an editor id
    // from site B addressable, and revoked rows have no live access to invite.
    const service = createServiceRoleClient();
    const { data: editor, error } = await service
      .from("site_editors")
      .select("id, site_id, email, permissions, revoked_at")
      .eq("id", siteEditorId)
      .eq("site_id", siteId)
      .is("revoked_at", null)
      .maybeSingle();

    if (error || !editor) {
      if (error) {
        console.error(
          "[editor-auth] resend editor lookup failed:",
          error.message,
        );
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const permissions = normalizePermissions(editor.permissions);
    const invitationEmailSent = auth.caller.email
      ? await deliverInvitation({
          siteId,
          editor: { email: editor.email, permissions },
          inviterEmail: auth.caller.email,
        })
      : false;

    return NextResponse.json({
      ok: true,
      invitationEmailSent,
      hubUrl: editorHubUrl(),
    });
  } catch (error) {
    console.error("[editor-auth] resend invitation failed:", error);
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
