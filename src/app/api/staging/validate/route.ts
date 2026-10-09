/**
 * Staging Token Validation API
 * POST: Validate staging access token for embed script
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extractEditorToken,
  validateEditorAccess,
} from "@/lib/auth/editor-access";
import { readStagingDeviceFingerprint } from "@/lib/auth/staging-device";
import { isEditLinkCode } from "@/lib/auth/edit-link";
import { redeemEditLink } from "@/lib/auth/edit-link-redeem";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, siteId }: { token?: string; siteId: string } = body;

    if (!siteId) {
      return withPublicCors(
        NextResponse.json({ error: "Missing siteId" }, { status: 400 }),
        request,
      );
    }

    let editorToken =
      extractEditorToken(request, body as Record<string, unknown>) ||
      (token ? { kind: "staging" as const, token } : null);

    if (!editorToken) {
      return withPublicCors(
        NextResponse.json({ error: "Missing token" }, { status: 400 }),
        request,
      );
    }

    // The owner's edit link (s76, ADR 055): the widget sends the code from
    // `#rcf_edit=` as its edit token, once, on its first load. Spent here and
    // nowhere else; the session it names is then validated like any other,
    // and its token goes back in this response body for the tab to keep
    // (ADR 036). The code is worthless from here on.
    let redeemedToken: string | null = null;
    if (
      editorToken.kind === "edit-session" &&
      isEditLinkCode(editorToken.token)
    ) {
      const redemption = await redeemEditLink({
        code: editorToken.token,
        siteId,
        origin: request.headers.get("origin"),
      });
      if (!redemption.ok) {
        return withPublicCors(
          NextResponse.json(
            { valid: false, error: redemption.error },
            { status: redemption.status },
          ),
          request,
        );
      }
      redeemedToken = redemption.token;
      editorToken = { kind: "edit-session", token: redemption.token };
    }

    const result = await validateEditorAccess({
      siteId,
      token: editorToken,
      allowUnverified: true,
      // This is the widget's boot check, and the point at which a forwarded URL
      // must be told to verify rather than handed someone else's session.
      device: readStagingDeviceFingerprint(request),
    });

    if (!result.valid) {
      return withPublicCors(
        NextResponse.json(
          {
            valid: false,
            error: result.error || "Invalid editor token",
          },
          { status: result.status || 401 },
        ),
        request,
      );
    }

    // Token is valid but may need email or verification
    return withPublicCors(
      NextResponse.json({
        valid: true,
        kind: result.access?.kind,
        verified: result.access?.verified,
        permissions: result.access?.permissions || [],
        email: result.access?.email,
        expiresAt: result.access?.expiresAt?.toISOString(),
        requiresEmail: result.requiresEmail,
        requiresVerification: result.requiresVerification,
        ...(redeemedToken ? { editToken: redeemedToken } : {}),
      }),
      request,
    );
  } catch (error) {
    console.error("Error validating staging token:", error);
    return withPublicCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "POST,OPTIONS");
}
