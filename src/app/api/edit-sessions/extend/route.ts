import { NextRequest, NextResponse } from "next/server";
import {
  extractEditorToken,
  validateEditorAccess,
} from "@/lib/auth/editor-access";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";

const EXTEND_HOURS = 2;
const MAX_EXTENSION_HOURS = 24;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      token?: string;
      siteId?: string;
      durationHours?: number;
    };

    if (!body.siteId) {
      return withPublicCors(
        NextResponse.json({ error: "siteId is required" }, { status: 400 }),
        request,
      );
    }

    const editorToken =
      extractEditorToken(request, body) ||
      (body.token
        ? { kind: "edit-session" as const, token: body.token }
        : null);

    if (!editorToken || editorToken.kind !== "edit-session") {
      return withPublicCors(
        NextResponse.json(
          { error: "Valid edit session token required" },
          { status: 401 },
        ),
        request,
      );
    }

    const validation = await validateEditorAccess({
      siteId: body.siteId,
      token: editorToken,
    });

    if (!validation.valid || !validation.access?.editSessionId) {
      return withPublicCors(
        NextResponse.json(
          { error: validation.error || "Invalid edit session" },
          { status: validation.status || 401 },
        ),
        request,
      );
    }

    const durationHours = Math.min(
      Math.max(body.durationHours || EXTEND_HOURS, 0.5),
      MAX_EXTENSION_HOURS,
    );
    const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
    const supabase = createServiceRoleClient();

    const { error } = await supabase
      .from("edit_sessions")
      .update({
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", validation.access.editSessionId);

    if (error) {
      console.error("Error extending edit session:", error);
      return withPublicCors(
        NextResponse.json(
          { error: "Failed to extend session" },
          { status: 500 },
        ),
        request,
      );
    }

    return withPublicCors(
      NextResponse.json({
        success: true,
        expiresAt: expiresAt.toISOString(),
      }),
      request,
    );
  } catch (error) {
    console.error("Error in edit session extension:", error);
    return withPublicCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "POST,OPTIONS");
}
