import {
  CONTEXT_COOKIE_NAME,
  revokeAnalyticsCapability,
} from "@/lib/analytics/google-analytics/context-server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const contextRevoked = await revokeAnalyticsCapability(request);

    // Sign out the user
    const { error } = await supabase.auth.signOut();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const response = NextResponse.json({ message: "Logged out successfully" });
    // A failed analytics request cannot block logout. The pending marker instead
    // blocks subsequent account binding until a first-party retry succeeds.
    response.headers.append(
      "Set-Cookie",
      contextRevoked
        ? `${CONTEXT_COOKIE_NAME}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`
        : "rcf_analytics_pending=signout; Max-Age=2592000; Path=/; Secure; SameSite=Lax",
    );
    return response;
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
