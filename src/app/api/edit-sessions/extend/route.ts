import { NextRequest, NextResponse } from "next/server";
import {
  extractEditorToken,
  validateEditorAccess,
} from "@/lib/auth/editor-access";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { readStagingDeviceFingerprint } from "@/lib/auth/staging-device";
import { MAX_SESSION_LIFETIME_HOURS } from "@/lib/auth/edit-sessions";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";

const EXTEND_HOURS = 2;
const MAX_EXTENSION_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

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
      device: readStagingDeviceFingerprint(request),
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
    const supabase = createServiceRoleClient();

    // When the session was first issued. Needed because the ceiling is absolute:
    // extending is sliding a window inside a fixed lifetime, not restarting it.
    const { data: session, error: readError } = await supabase
      .from("edit_sessions")
      .select("created_at")
      .eq("id", validation.access.editSessionId)
      .single();

    if (readError || !session) {
      console.error(
        "Could not read edit session for extension:",
        readError?.message ?? "no row returned",
      );
      return withPublicCors(
        NextResponse.json(
          { error: "Failed to extend session" },
          { status: 500 },
        ),
        request,
      );
    }

    const issuedAtMs = new Date(session.created_at).getTime();
    if (!Number.isFinite(issuedAtMs)) {
      // A session we cannot date is a session we cannot bound. Refuse rather
      // than fall back to an unbounded extension.
      console.error(
        `Edit session ${validation.access.editSessionId} has an unparseable created_at; refusing to extend.`,
      );
      return withPublicCors(
        NextResponse.json(
          { error: "Failed to extend session" },
          { status: 500 },
        ),
        request,
      );
    }

    const ceilingMs = issuedAtMs + MAX_SESSION_LIFETIME_HOURS * HOUR_MS;
    const now = Date.now();

    // The whole point of the ceiling: past it, no amount of extending helps.
    // The holder has to go back to the dashboard and prove who they are again.
    if (now >= ceilingMs) {
      return withPublicCors(
        NextResponse.json(
          {
            error: "Session lifetime exhausted",
            message: `An edit session cannot live longer than ${MAX_SESSION_LIFETIME_HOURS} hours. Create a new one.`,
          },
          { status: 403 },
        ),
        request,
      );
    }

    // Clamp rather than reject: asking for 24 more hours 20 hours in is a normal
    // request, it just cannot buy more than the 4 hours that remain.
    const expiresAt = new Date(
      Math.min(now + durationHours * HOUR_MS, ceilingMs),
    );

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
