import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Notification toggles offered on the settings page. */
const NOTIFICATION_KEYS = [
  "email",
  "contentEdits",
  "weeklyReports",
  "marketing",
] as const;

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Authenticate the user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await request.json();

    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const payload = body as Record<string, unknown>;

    // Only allow safe metadata fields to be updated
    const allowedFields = ["name", "company", "role"] as const;
    const userMetadata: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (field in payload) {
        const value = payload[field];
        if (typeof value !== "string") {
          return NextResponse.json(
            { error: `Field "${field}" must be a string` },
            { status: 400 },
          );
        }
        userMetadata[field] = value.trim();
      }
    }

    // Notification preferences are a fixed set of booleans. They are validated
    // key by key rather than passed through, so a caller cannot smuggle
    // arbitrary keys into their own auth metadata.
    if ("notifications" in payload) {
      const raw = payload.notifications;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return NextResponse.json(
          { error: 'Field "notifications" must be an object' },
          { status: 400 },
        );
      }

      const incoming = raw as Record<string, unknown>;
      const notifications: Record<string, boolean> = {};

      for (const key of NOTIFICATION_KEYS) {
        if (!(key in incoming)) continue;
        const value = incoming[key];
        if (typeof value !== "boolean") {
          return NextResponse.json(
            { error: `Notification preference "${key}" must be a boolean` },
            { status: 400 },
          );
        }
        notifications[key] = value;
      }

      if (Object.keys(notifications).length > 0) {
        userMetadata.notifications = notifications;
      }
    }

    if (Object.keys(userMetadata).length === 0) {
      return NextResponse.json(
        { error: "No valid fields provided for update" },
        { status: 400 },
      );
    }

    // Update user metadata via Supabase auth
    const { data: updatedUser, error: updateError } =
      await supabase.auth.updateUser({
        data: userMetadata,
      });

    if (updateError) {
      console.error("Error updating user profile:", updateError);
      return NextResponse.json(
        { error: "Failed to update profile" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      user: updatedUser.user,
      message: "Profile updated successfully",
    });
  } catch (error) {
    console.error("Error in PATCH /api/auth/profile:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
