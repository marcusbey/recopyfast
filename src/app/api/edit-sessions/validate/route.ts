/**
 * Validate Edit Session API
 * POST /api/edit-sessions/validate
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extractEditorToken,
  validateEditorAccess,
} from "@/lib/auth/editor-access";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, siteId } = body;

    if (!token || !siteId) {
      return withPublicCors(
        NextResponse.json(
          { error: "Token and site ID are required" },
          { status: 400 },
        ),
        request,
      );
    }

    const editorToken = extractEditorToken(
      request,
      body as Record<string, unknown>,
    ) || {
      kind: "edit-session" as const,
      token,
    };
    const result = await validateEditorAccess({
      siteId,
      token: editorToken,
    });

    if (!result.valid || !result.access) {
      return withPublicCors(
        NextResponse.json(
          {
            valid: false,
            error: result.error || "Invalid or expired edit session",
            requiresAuth: true,
          },
          { status: result.status || 401 },
        ),
        request,
      );
    }

    // Check if session is expiring soon (within 30 minutes)
    const now = Date.now();
    const expiresAt = result.access.expiresAt?.getTime() || Date.now();
    const timeRemaining = expiresAt - now;
    const isExpiringSoon = timeRemaining < 30 * 60 * 1000; // 30 minutes
    const timeRemainingMinutes = Math.max(
      0,
      Math.floor(timeRemaining / (60 * 1000)),
    );

    return withPublicCors(
      NextResponse.json({
        valid: true,
        session: {
          id: result.access.editSessionId,
          siteId: result.access.siteId,
          userId: result.access.userId,
          permissions: result.access.permissions,
          expiresAt: result.access.expiresAt,
          isExpiringSoon,
          timeRemainingMinutes,
        },
        message: "Edit session is valid",
      }),
      request,
    );
  } catch (error) {
    console.error("Error validating edit session:", error);
    return withPublicCors(
      NextResponse.json(
        {
          valid: false,
          error: "Internal server error",
          requiresAuth: true,
        },
        { status: 500 },
      ),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "POST,OPTIONS");
}
