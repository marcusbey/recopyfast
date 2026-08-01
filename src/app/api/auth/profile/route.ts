import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
    const userMetadata: Record<string, string> = {};

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
