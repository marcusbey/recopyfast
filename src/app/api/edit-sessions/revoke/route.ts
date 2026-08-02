/**
 * Revoke Edit Session API
 * POST /api/edit-sessions/revoke
 *
 * The missing half of edit-session management. `GET /api/edit-sessions/active`
 * has always listed a user's live sessions, but nothing could kill one — so the
 * documented remedy for a leaked `editUrl` ("revoke it") had no implementation
 * behind it, and the only thing that eventually retired a leaked token was its
 * own expiry.
 *
 * Same-origin and session-authenticated, deliberately: unlike validate/extend,
 * this is not called by the widget. Adding CORS here would let any page drive a
 * logged-in user's revocations.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EditSessionManager } from "@/lib/auth/edit-sessions";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const body: unknown = await request.json().catch(() => null);

    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const sessionId = (body as Record<string, unknown>).sessionId;

    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    // Authorisation is the `user_id` filter inside revokeEditSession: a caller
    // can only revoke a session they own. Passing the id of someone else's
    // session is indistinguishable from passing one that never existed, which is
    // what keeps this from being a probe for valid session ids.
    const revoked = await EditSessionManager.revokeEditSession(
      sessionId,
      user.id,
    );

    if (!revoked) {
      return NextResponse.json(
        {
          error: "Session not found",
          message: "No active edit session with that id belongs to you.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Edit session revoked",
    });
  } catch (error) {
    console.error("Error revoking edit session:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
