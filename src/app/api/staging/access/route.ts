/**
 * Staging Access API
 * POST: Create new staging access (invite or shareable link)
 * GET: List staging access for a site
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  StagingAccessManager,
  StagingPermission,
  AccessType,
} from "@/lib/auth/staging-access";
import { sendStagingVerificationEmail } from "@/lib/email/resend";

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

    const body = await request.json();
    const {
      siteId,
      type,
      email,
      permissions,
      label,
      expiresInDays,
    }: {
      siteId: string;
      type: AccessType;
      email?: string;
      permissions: StagingPermission[];
      label?: string;
      expiresInDays?: number;
    } = body;

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

    // Get site info for staging URL
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("domain")
      .eq("id", siteId)
      .single();

    if (siteError || !site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // Create staging access
    const result = await StagingAccessManager.createStagingAccess({
      siteId,
      accessType: type,
      email,
      permissions,
      label,
      createdBy: user.id,
      expiresInDays,
    });

    if (!result) {
      return NextResponse.json(
        {
          error:
            "Failed to create staging access. Make sure you have admin permission.",
        },
        { status: 403 },
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
    if (type === "invite" && email && result.verificationCode) {
      const mail = await sendStagingVerificationEmail(
        email,
        result.verificationCode,
        result.access.label ?? undefined,
      );
      if (!mail.sent) {
        console.error(
          "Staging invite created but verification email failed:",
          mail.error,
        );
        // Non-fatal: the access exists and the code can be resent. Surface a hint.
      }
    }

    return NextResponse.json({
      success: true,
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
