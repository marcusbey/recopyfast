import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { InviteTeamMemberPayload, TeamRole } from "@/types";
import {
  attachUserIdentities,
  resolveUserIdentities,
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

    // Check if user has permission to view invitations (manager or owner)
    const { data: membership, error: membershipError } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .single();

    if (
      membershipError ||
      !membership ||
      !["manager", "owner"].includes(membership.role)
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // Get pending invitations. `team:teams(name)` embeds fine — it is in the
    // `public` schema. The `inviter:auth.users!...` embed that used to sit
    // beside it did not: PostgREST does not expose `auth`, so it failed the
    // whole select and this endpoint answered 500 to every caller. The inviter's
    // identity is attached afterwards through the Admin API.
    const { data: invitations, error } = await supabase
      .from("team_invitations")
      .select(
        `
        *,
        team:teams(name)
      `,
      )
      .eq("team_id", teamId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString());

    if (error) {
      console.error("Error fetching invitations:", error);
      return NextResponse.json(
        { error: "Failed to fetch invitations" },
        { status: 500 },
      );
    }

    const invitationsWithInviters = await attachUserIdentities(
      invitations ?? [],
      "invited_by",
      "inviter",
    );

    return NextResponse.json({ invitations: invitationsWithInviters });
  } catch (error) {
    console.error("Error in invitations GET:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
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

    const body: InviteTeamMemberPayload = await request.json();

    // Validate input
    if (!body.email || !body.role) {
      return NextResponse.json(
        { error: "Email and role are required" },
        { status: 400 },
      );
    }

    const validRoles: TeamRole[] = ["viewer", "editor", "manager"];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    // Check if user has permission to invite (manager or owner)
    const { data: membership, error: membershipError } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .single();

    if (
      membershipError ||
      !membership ||
      !["manager", "owner"].includes(membership.role)
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // Check if team exists and get team info
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("id, name, max_members")
      .eq("id", teamId)
      .single();

    if (teamError || !team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // The current membership, read once and used twice: for the capacity check
    // and for the already-a-member check below. `max_members` bounds it.
    const { data: currentMembers, error: currentMembersError } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId);

    if (currentMembersError) {
      // Not swallowed. Without this list neither check below can answer, and
      // treating "I could not look" as "not a member" is exactly the bug being
      // fixed here.
      console.error("Error checking team membership:", currentMembersError);
      return NextResponse.json(
        { error: "Failed to check team capacity" },
        { status: 500 },
      );
    }

    const members = currentMembers ?? [];

    if (members.length >= team.max_members) {
      return NextResponse.json(
        { error: "Team is at maximum capacity" },
        { status: 400 },
      );
    }

    // Check whether the invitee is already a member of this team.
    //
    // The previous implementation asked PostgREST for `.from("auth.users")` and
    // destructured the error away. That table is not exposed, so the lookup
    // always failed, `inviteeUser` was always null, and this guard never ran
    // once — after which the pending-invitation check below answered
    // "Invitation already sent" and left the inviter with no way forward.
    //
    // Resolved the other way round: compare against the addresses of the members
    // this team already has. There is no admin lookup-by-email in the API —
    // `listUsers` pages through every user in the project and takes no filter —
    // and the question here is only ever about one team.
    const memberIdentities = await resolveUserIdentities(
      members.map((member) => member.user_id),
    );
    const inviteeEmail = body.email.toLowerCase();
    const alreadyAMember = [...memberIdentities.values()].some(
      (identity) => identity.email.toLowerCase() === inviteeEmail,
    );

    if (alreadyAMember) {
      return NextResponse.json(
        { error: "User is already a team member" },
        { status: 400 },
      );
    }

    // Check if there's already a pending invitation
    const { data: existingInvitation } = await supabase
      .from("team_invitations")
      .select("id")
      .eq("team_id", teamId)
      .eq("email", body.email.toLowerCase())
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (existingInvitation) {
      return NextResponse.json(
        { error: "Invitation already sent to this email" },
        { status: 400 },
      );
    }

    // Create invitation.
    //
    // The echo names only `public` relations. The `inviter:auth.users!...` embed
    // it used to carry made the insert report failure *after* the row had been
    // written, so a retry then hit the pending-invitation check and dead-ended.
    type InvitationRow = {
      id: string;
      team_id: string;
      email: string;
      role: string;
      invited_by: string;
      accepted_at: string | null;
      expires_at: string;
      created_at: string;
      team: { name: string } | null;
    };
    const { data: invitationRaw, error } = await supabase
      .from("team_invitations")
      .insert({
        team_id: teamId,
        email: body.email.toLowerCase(),
        role: body.role,
        invited_by: user.id,
      })
      .select(
        `
        *,
        team:teams(name)
      `,
      )
      .single();
    const invitationRow = invitationRaw as InvitationRow | null;

    if (error || !invitationRow) {
      console.error("Error creating invitation:", error);
      return NextResponse.json(
        { error: "Failed to create invitation" },
        { status: 500 },
      );
    }

    const invitation = {
      ...invitationRow,
      inviter: await resolveUserIdentity(user.id),
    };

    // TODO: Send invitation email
    // await sendInvitationEmail(invitation);

    // Create notification for the inviter
    await supabase.from("collaboration_notifications").insert({
      user_id: user.id,
      type: "invitation",
      title: "Invitation Sent",
      message: `Invitation sent to ${body.email} for team ${team.name}`,
      data: {
        invitation_id: invitation.id,
        team_id: teamId,
        email: body.email,
        role: body.role,
      },
    });

    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    console.error("Error in invitations POST:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
