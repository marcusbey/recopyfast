/**
 * Staging Access API
 * POST: Create new staging access (invite or shareable link)
 * GET: List staging access for a site
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  REMOVED_EDITOR_INVITE_MESSAGE,
  StagingAccessManager,
  StagingPermission,
  AccessType,
} from "@/lib/auth/staging-access";
import { sendStagingVerificationEmail } from "@/lib/email/resend";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { authorizeFirstPartyEditorAccess } from "@/lib/auth/editor-access";
import {
  checkOwnerCanEdit,
  ownerCanEditRefusal,
} from "@/lib/billing/owner-can-edit";
import { optionalBoundedString } from "@/lib/api/validation";
import { isPlausibleEmail } from "@/lib/auth/editor-directory";

/** Longest invite label accepted (s68b M6) — it is mailed to the invitee. */
const MAX_STAGING_LABEL_LENGTH = 80;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Invite-type access sends an email to an address the caller supplies, so an
    // unthrottled endpoint is an open mail relay for spam and a way to burn the
    // sending domain's reputation. Fails CLOSED.
    const limited = await enforceRateLimit(request, {
      limit: "USER_DOMAIN_VERIFY",
      endpoint: "staging/access",
      identifier: user.id,
      identifierType: "user",
      onStoreFailure: "deny",
      message: "Too many staging invites. Please try again shortly.",
    });
    if (limited) return limited;

    const body = await request.json();
    const {
      siteId,
      type,
      email,
      permissions,
      expiresInDays,
    }: {
      siteId: string;
      type: AccessType;
      email?: string;
      permissions: StagingPermission[];
      expiresInDays?: number;
    } = body;
    // `label` is read below through `optionalBoundedString`, never trusted as
    // typed here (s68b M6).

    // Validate required fields
    if (!siteId || !type || !permissions || permissions.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields: siteId, type, permissions" },
        { status: 400 },
      );
    }

    // Validate type
    if (!["invite", "link"].includes(type)) {
      return NextResponse.json(
        { error: "Invalid type. Must be 'invite' or 'link'" },
        { status: 400 },
      );
    }

    // Validate permissions
    const validPermissions: StagingPermission[] = [
      "view",
      "edit",
      "publish",
      "admin",
    ];
    if (!permissions.every((p) => validPermissions.includes(p))) {
      return NextResponse.json(
        { error: "Invalid permissions. Must be: view, edit, publish, admin" },
        { status: 400 },
      );
    }

    // For invite type, email is required
    if (type === "invite" && !email) {
      return NextResponse.json(
        { error: "Email is required for invite-type access" },
        { status: 400 },
      );
    }

    // s72. The invite's address becomes the `created_by` of every version its
    // holder saves, and the embed's History tab rendered that as markup on the
    // customer's origin (s70a review F1): this route checked only that an email
    // was present, so a site admin could invite `<img/src/onerror=…>@x.co`. The
    // address must now be a string holding a valid address (the shared rule the
    // editor routes use), trimmed, refused before the site is read with a fixed
    // message that never repeats what was sent. Advisory against an admin until
    // s72b: an admin can still write `staging_access.email` directly through
    // PostgREST. The embed rendering it as text is what makes a stored value
    // harmless, rows written before this included.
    const inviteEmail = typeof email === "string" ? email.trim() : email;
    if (
      type === "invite" &&
      (typeof inviteEmail !== "string" || !isPlausibleEmail(inviteEmail))
    ) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400 },
      );
    }

    // s68b M6. The label is free text any site admin chooses, and it is mailed
    // — beside a genuine code, from our domain — to an address that admin also
    // chooses. The emails escape it; this bounds it before anything is created:
    // a string, at most 80 characters, no control characters (no header-shaped
    // `\r\nBcc:` lines). The text still reads as the admin wrote it.
    const labelCheck = optionalBoundedString(body, "label", {
      maxLength: MAX_STAGING_LABEL_LENGTH,
      rejectControlCharacters: true,
    });
    if (!labelCheck.ok) {
      return NextResponse.json({ error: labelCheck.error }, { status: 400 });
    }

    // Get site info for staging URL
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("domain")
      .eq("id", siteId)
      .single();

    if (siteError || !site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // An invite onto a lapsed owner's site would only be refused at its first
    // save, so none is issued (s51, ADR 041). The admin check lives inside
    // `createStagingAccess`, which also inserts, so the caller's access is
    // read first and only someone with a row on the site hears about its plan.
    const firstPartyAccess = await authorizeFirstPartyEditorAccess(
      siteId,
      "view",
    );
    if (firstPartyAccess) {
      const ownerCanEdit = await checkOwnerCanEdit(siteId);
      if (!ownerCanEdit.ok) {
        return ownerCanEditRefusal(ownerCanEdit);
      }
    }

    // Create staging access.
    // `createStagingAccess` now throws instead of returning null, so its real
    // reason for failing — not an admin, links are retired, email missing — can
    // be told apart here instead of every rejection collapsing into one generic
    // "make sure you have admin permission" message.
    let result: Awaited<
      ReturnType<typeof StagingAccessManager.createStagingAccess>
    >;
    try {
      result = await StagingAccessManager.createStagingAccess({
        siteId,
        accessType: type,
        email: inviteEmail,
        permissions,
        label: labelCheck.value,
        createdBy: user.id,
        expiresInDays,
      });
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : undefined;

      if (message === "Only site admins can create staging access") {
        return NextResponse.json({ error: message }, { status: 403 });
      }
      if (
        message ===
        "Shareable staging links are retired. Add the person as a site editor instead."
      ) {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      if (message === "Email is required for invite-type access") {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      // The address's directory row for this site is revoked: the request is
      // well-formed but conflicts with the site's current editors (s68c review).
      if (message === REMOVED_EDITOR_INVITE_MESSAGE) {
        return NextResponse.json({ error: message }, { status: 409 });
      }

      // Anything else — e.g. a raw database error — is logged server-side only.
      // Surfacing it to the client would leak schema/internals.
      console.error("Error creating staging access:", createError);
      return NextResponse.json(
        { error: "Failed to create staging access" },
        { status: 500 },
      );
    }

    // Generate staging URL
    const stagingUrl = StagingAccessManager.getStagingUrl(
      site.domain.startsWith("http") ? site.domain : `https://${site.domain}`,
      result.access.token,
    );

    // The verification code is a shared secret gating staging access. Deliver it
    // only via email — returning it here would let any caller self-verify and bypass
    // email ownership. For invite-type access we email it now.
    // An invite whose code never arrives is indistinguishable from no invite at
    // all, so whether the mail actually left is part of the result. Reporting an
    // unqualified success here is how a misconfigured sender domain went
    // unnoticed: the row was written, Resend refused the message, and the
    // dialog said "Link created".
    let emailDelivered: boolean | undefined;

    if (type === "invite" && inviteEmail && result.verificationCode) {
      const mail = await sendStagingVerificationEmail(
        inviteEmail,
        result.verificationCode,
        result.access.label ?? undefined,
      );
      emailDelivered = mail.sent;

      if (!mail.sent) {
        console.error(
          "Staging invite created but verification email failed:",
          mail.error,
        );
      }
    }

    return NextResponse.json({
      success: true,
      emailDelivered,
      access: {
        id: result.access.id,
        type: result.access.access_type,
        email: result.access.email,
        permissions: result.access.permissions,
        label: result.access.label,
        expiresAt: result.access.expires_at,
        isVerified: result.access.email_verified,
      },
      stagingUrl,
      token: result.access.token,
    });
  } catch (error) {
    console.error("Error creating staging access:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");
    const includeRevoked = searchParams.get("includeRevoked") === "true";

    if (!siteId) {
      return NextResponse.json(
        { error: "Missing siteId parameter" },
        { status: 400 },
      );
    }

    // Verify user has admin permission on site
    const { data: permission, error: permError } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", siteId)
      .eq("user_id", user.id)
      .single();

    if (permError || permission?.permission !== "admin") {
      return NextResponse.json(
        { error: "Admin permission required" },
        { status: 403 },
      );
    }

    // Get staging access list
    const accessList = await StagingAccessManager.listStagingAccess(
      siteId,
      includeRevoked,
    );

    return NextResponse.json({
      success: true,
      accessList: accessList.map((access) => ({
        id: access.id,
        type: access.access_type,
        email: access.email,
        emailVerified: access.email_verified,
        permissions: access.permissions,
        label: access.label,
        expiresAt: access.expires_at,
        isActive: access.is_active,
        lastUsedAt: access.last_used_at,
        createdAt: access.created_at,
      })),
    });
  } catch (error) {
    console.error("Error listing staging access:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const accessId = searchParams.get("accessId");

    if (!accessId) {
      return NextResponse.json(
        { error: "Missing accessId parameter" },
        { status: 400 },
      );
    }

    // Get access record to verify permission
    const { data: access, error: accessError } = await supabase
      .from("staging_access")
      .select("site_id")
      .eq("id", accessId)
      .single();

    if (accessError || !access) {
      return NextResponse.json(
        { error: "Staging access not found" },
        { status: 404 },
      );
    }

    // Verify user has admin permission on site
    const { data: permission, error: permError } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", access.site_id)
      .eq("user_id", user.id)
      .single();

    if (permError || permission?.permission !== "admin") {
      return NextResponse.json(
        { error: "Admin permission required" },
        { status: 403 },
      );
    }

    // Revoke access
    const success = await StagingAccessManager.revokeStagingAccess(
      accessId,
      user.id,
    );

    if (!success) {
      return NextResponse.json(
        { error: "Failed to revoke access" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error revoking staging access:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
