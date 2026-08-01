import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EditSessionManager } from "@/lib/auth/edit-sessions";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessions = await EditSessionManager.getActiveSessionsForUser(user.id);
    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Error fetching active edit sessions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
