/**
 * Team members.
 *
 * WHICH CLIENT READS WHAT, AND WHY
 * --------------------------------
 * `20260804130000_restore_missing_rls_policies.sql:214-217` — the policy set
 * recorded as applied — lets `authenticated` SELECT `team_members` only where
 * `user_id = auth.uid()`. Read as the caller, therefore:
 *   - the membership check sees its own row  — works, and IS the authorisation
 *   - the roster returns one row, the caller — so a team of ten looks like a
 *     team of one to every member of it
 *   - the target-member read in PATCH and DELETE sees nothing, so managing
 *     anyone but yourself answers "Team member not found"
 * The role update and the removal are writes, which that policy set grants only
 * to `service_role`, so both matched zero rows as well.
 *
 * The rule: a query about the CALLER stays on the caller's client, because that
 * is the authorisation and must be subject to the caller's own rights. A query
 * about OTHER rows runs on the service client, after authorisation has passed.
 * Every such query is scoped to `team_id` so a row from another team is
 * unreachable regardless of what RLS would have allowed.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { UpdateTeamMemberRolePayload } from "@/types";
import {
  attachUserIdentities,
  resolveUserIdentity,
} from "@/lib/auth/user-identity";

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

    // Get all team members. Service-scoped — the roster is other people, and as
    // the caller it came back holding only the caller. See the module header.
    //
    // No `user:auth.users!...` embed: PostgREST does not expose the `auth`
    // schema, so that embed was a hard PGRST200 and this endpoint answered 500
    // to every caller. Identities are attached afterwards through the Admin API
    // — see @/lib/auth/user-identity.
    const { data: members, error } = await createServiceRoleClient()
      .from("team_members")
      .select("*")
      .eq("team_id", teamId)
      .order("joined_at", { ascending: true });

    if (error) {
      console.error("Error fetching team members:", error);
      return NextResponse.json(
        { error: "Failed to fetch team members" },
        { status: 500 },
      );
    }

    const membersWithUsers = await attachUserIdentities(
      members ?? [],
      "user_id",
      "user",
    );

    return NextResponse.json({ members: membersWithUsers });
  } catch (error) {
    console.error("Error in team members GET:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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

    const body: UpdateTeamMemberRolePayload = await request.json();

    // Validate input
    if (!body.memberId || !body.role) {
      return NextResponse.json(
        { error: "Member ID and role are required" },
        { status: 400 },
      );
    }

    const validRoles = ["viewer", "editor", "manager", "owner"];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Check if current user has permission to update roles (manager or owner)
    const { data: currentUserMembership, error: membershipError } =
      await supabase
        .from("team_members")
        .select("role")
        .eq("team_id", teamId)
        .eq("user_id", user.id)
        .single();

    if (
      membershipError ||
      !currentUserMembership ||
      !["manager", "owner"].includes(currentUserMembership.role)
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // From here on the subject is another member's row — see the module header.
    // Authorisation is the manager/owner check above.
    const serviceClient = createServiceRoleClient();

    // Get the member being updated. `team:teams(owner_id)` is embedded rather
    // than read separately, and needs the service client for a second reason:
    // the `teams` SELECT policy is `owner_id = auth.uid()`, so for a manager who
    // does not own the team the embed resolves to null and the owner-protection
    // check below would dereference it.
    const { data: targetMember, error: targetMemberError } = await serviceClient
      .from("team_members")
      .select("*, team:teams(owner_id)")
      .eq("id", body.memberId)
      .eq("team_id", teamId)
      .single();

    if (targetMemberError || !targetMember) {
      return NextResponse.json(
        { error: "Team member not found" },
        { status: 404 },
      );
    }

    // Prevent changing the team owner's role
    if (
      targetMember.team.owner_id === targetMember.user_id &&
      body.role !== "owner"
    ) {
      return NextResponse.json(
        { error: "Cannot change team owner role" },
        { status: 400 },
      );
    }

    // Only owners can assign the owner role
    if (body.role === "owner" && currentUserMembership.role !== "owner") {
      return NextResponse.json(
        { error: "Only team owners can assign owner role" },
        { status: 403 },
      );
    }

    // Managers cannot update other managers or owners (unless they're the owner)
    if (
      currentUserMembership.role === "manager" &&
      ["manager", "owner"].includes(targetMember.role) &&
      targetMember.user_id !== user.id
    ) {
      return NextResponse.json(
        { error: "Managers cannot update other managers or owners" },
        { status: 403 },
      );
    }

    // Update member role. The echo of the updated row carries no `auth.users`
    // embed for the same reason as the GET above — it made this write report
    // failure after it had already succeeded.
    const { data: updatedMember, error } = await serviceClient
      .from("team_members")
      .update({ role: body.role })
      .eq("id", body.memberId)
      .eq("team_id", teamId)
      .select("*")
      .single();

    if (error) {
      console.error("Error updating member role:", error);
      return NextResponse.json(
        { error: "Failed to update member role" },
        { status: 500 },
      );
    }

    const updatedMemberWithUser = {
      ...updatedMember,
      user: await resolveUserIdentity(targetMember.user_id),
    };

    // Create notification for the updated member
    await supabase.from("collaboration_notifications").insert({
      user_id: targetMember.user_id,
      type: "permission_change",
      title: "Role Updated",
      message: `Your role has been updated to ${body.role}`,
      data: {
        team_id: teamId,
        old_role: targetMember.role,
        new_role: body.role,
        updated_by: user.id,
      },
    });

    return NextResponse.json({ member: updatedMemberWithUser });
  } catch (error) {
    console.error("Error in team members PATCH:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
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

    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get("memberId");

    if (!memberId) {
      return NextResponse.json(
        { error: "Member ID is required" },
        { status: 400 },
      );
    }

    // Check if current user has permission to remove members (manager or owner)
    const { data: currentUserMembership, error: membershipError } =
      await supabase
        .from("team_members")
        .select("role")
        .eq("team_id", teamId)
        .eq("user_id", user.id)
        .single();

    if (
      membershipError ||
      !currentUserMembership ||
      !["manager", "owner"].includes(currentUserMembership.role)
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // From here on the subject is another member's row — see the module header.
    // Authorisation is the manager/owner check above. The `teams` embed needs
    // this client too: its SELECT policy is `owner_id = auth.uid()`, so for a
    // non-owning manager it resolves to null and the owner-protection check
    // below would dereference it.
    const serviceClient = createServiceRoleClient();

    // Get the member being removed
    const { data: targetMember, error: targetMemberError } = await serviceClient
      .from("team_members")
      .select("*, team:teams(owner_id)")
      .eq("id", memberId)
      .eq("team_id", teamId)
      .single();

    if (targetMemberError || !targetMember) {
      return NextResponse.json(
        { error: "Team member not found" },
        { status: 404 },
      );
    }

    // Prevent removing the team owner
    if (targetMember.team.owner_id === targetMember.user_id) {
      return NextResponse.json(
        { error: "Cannot remove team owner" },
        { status: 400 },
      );
    }

    // Managers cannot remove other managers or owners
    if (
      currentUserMembership.role === "manager" &&
      ["manager", "owner"].includes(targetMember.role)
    ) {
      return NextResponse.json(
        { error: "Managers cannot remove other managers or owners" },
        { status: 403 },
      );
    }

    // Remove member — scope to team_id to prevent cross-team deletion. That
    // scoping is now the only thing enforcing it, RLS no longer being behind the
    // statement, so it matters more than when it was written.
    const { error } = await serviceClient
      .from("team_members")
      .delete()
      .eq("id", memberId)
      .eq("team_id", teamId);

    if (error) {
      console.error("Error removing team member:", error);
      return NextResponse.json(
        { error: "Failed to remove team member" },
        { status: 500 },
      );
    }

    // Create notification for the removed member
    await supabase.from("collaboration_notifications").insert({
      user_id: targetMember.user_id,
      type: "team_update",
      title: "Removed from Team",
      message: `You have been removed from the team`,
      data: {
        team_id: teamId,
        removed_by: user.id,
      },
    });

    return NextResponse.json({ message: "Member removed successfully" });
  } catch (error) {
    console.error("Error in team members DELETE:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
