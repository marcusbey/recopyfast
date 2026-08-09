import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { attachUserIdentities } from "@/lib/auth/user-identity";

interface RouteContext {
  params: Promise<{ teamId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { teamId } = await context.params;
    const supabase = await createServerClient();

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is a member of this team
    const { data: membership, error: membershipError } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "Not a member of this team" },
        { status: 403 },
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");

    // Get team activity. Service-scoped, after the membership check above has
    // established that the caller belongs to this team.
    //
    // The feed is by definition other people's actions, and the only policy on
    // `team_activity_log` authorises through a `team_members` subquery
    // (`20260731001000:45-57`) whose own SELECT policy is restricted to the
    // caller's row — so as the caller this returned an empty feed for every
    // member of every team. Scoped to `team_id`, which is what confines the
    // caller to the team they were just authorised against.
    //
    // Identities are attached afterwards rather than embedded: PostgREST cannot
    // resolve `auth.users`, so the embed this select used to carry failed the
    // whole query. `user_id` is nullable here (system-generated entries have
    // none), which `attachUserIdentities` renders as `user: null`.
    const { data: activities, error } = await createServiceRoleClient()
      .from("team_activity_log")
      .select("*")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Error fetching team activity:", error);
      return NextResponse.json(
        { error: "Failed to fetch team activity" },
        { status: 500 },
      );
    }

    const activitiesWithUsers = await attachUserIdentities(
      activities ?? [],
      "user_id",
      "user",
    );

    return NextResponse.json({ activities: activitiesWithUsers });
  } catch (error) {
    console.error("Error in team activity GET:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
