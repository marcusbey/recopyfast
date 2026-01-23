/**
 * Staging Token Validation API
 * POST: Validate staging access token for embed script
 */

import { NextRequest, NextResponse } from "next/server";
import { StagingAccessManager } from "@/lib/auth/staging-access";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, siteId }: { token: string; siteId: string } = body;

    if (!token || !siteId) {
      return NextResponse.json(
        { error: "Missing token or siteId" },
        { status: 400 },
      );
    }

    const result = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
    );

    if (!result.valid) {
      return NextResponse.json(
        {
          valid: false,
          error: result.error || "Invalid staging token",
        },
        { status: 401 },
      );
    }

    // Token is valid but may need email or verification
    return NextResponse.json({
      valid: true,
      verified: result.verified,
      permissions: result.permissions,
      email: result.email,
      expiresAt: result.expiresAt?.toISOString(),
      requiresEmail: result.requiresEmail,
      requiresVerification: result.requiresVerification,
    });
  } catch (error) {
    console.error("Error validating staging token:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
