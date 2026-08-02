import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { ShareSitePayload, TeamRole } from "@/types";
import {
  CollaborationPermissions,
  teamRoleToSitePermission,
} from "@/lib/collaboration/permissions";

/**
 * Resolve a user's email and display name.
 *
 * `auth.users` is not exposed over PostgREST, so the previous
 * `.from("auth.users")` calls could only ever fail — the POST path 404'd every
 * user-targeted share before reaching the insert, and the GET path dropped its
 * embed. The Admin API is the supported way to read that table, and it requires
 * the service-role key, hence the separate client.
 */
async function resolveUserIdentity(
  userId: string,
): Promise<{ email: string; name: string } | null> {
  const service = createServiceRoleClient();
  const { data, error } = await service.auth.admin.getUserById(userId);

  if (error || !data?.user?.email) {
    if (error) {
      console.error("Error resolving target user:", error.message);
    }
    return null;
  }

  const metadata = data.user.user_metadata as
    | Record<string, unknown>
    | undefined;
  const name = typeof metadata?.name === "string" ? metadata.name : null;

  return { email: data.user.email, name: name ?? data.user.email };
}

interface RouteContext {
  params: Promise<{ siteId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { siteId } = await context.params;
    const supabase = await createServerClient();
    const permissions = new CollaborationPermissions();

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: ShareSitePayload = await request.json();

    // Validate input
    if (!body.role || (!body.userId && !body.teamId)) {
      return NextResponse.json(
        { error: "Role and either userId or teamId are required" },
        { status: 400 },
      );
    }

    const validRoles: TeamRole[] = ["viewer", "editor", "manager"];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    if (body.userId && body.teamId) {
      return NextResponse.json(
        { error: "Cannot specify both userId and teamId" },
        { status: 400 },
      );
    }

    // Check if current user has permission to share this site
    const permissionCheck = await permissions.checkSitePermission(
      user.id,
      siteId,
      ["manager", "owner"],
    );
    if (!permissionCheck.hasPermission) {
      return NextResponse.json(
        { error: "Insufficient permissions to share this site" },
        { status: 403 },
      );
    }

    // Verify site exists
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .select("id, name")
      .eq("id", siteId)
      .single();

    if (siteError || !site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // Only the display name is used (in the notification body and the success
    // message). A parallel `targetIdentifier` was assigned in both branches and
    // never read.
    let targetName = "";

    if (body.userId) {
      // Verify user exists
      const targetUser = await resolveUserIdentity(body.userId);

      if (!targetUser) {
        return NextResponse.json(
          { error: "Target user not found" },
          { status: 404 },
        );
      }

      targetName = targetUser.name;

      // Check if user already has permissions
      const { data: existingPermission } = await supabase
        .from("site_permissions")
        .select("id")
        .eq("site_id", siteId)
        .eq("user_id", body.userId)
        .single();

      if (existingPermission) {
        return NextResponse.json(
          { error: "User already has permissions for this site" },
          { status: 400 },
        );
      }
    } else if (body.teamId) {
      // Verify team exists and user has access
      const { data: targetTeam, error: teamError } = await supabase
        .from("teams")
        .select("name")
        .eq("id", body.teamId)
        .single();

      if (teamError || !targetTeam) {
        return NextResponse.json(
          { error: "Target team not found" },
          { status: 404 },
        );
      }

      targetName = targetTeam.name;

      // Check if team already has permissions
      const { data: existingPermission } = await supabase
        .from("site_permissions")
        .select("id")
        .eq("site_id", siteId)
        .eq("team_id", body.teamId)
        .single();

      if (existingPermission) {
        return NextResponse.json(
          { error: "Team already has permissions for this site" },
          { status: 400 },
        );
      }
    }

    // Create site permission.
    //
    // `permission` is written alongside `role` and is the one that matters:
    // every authorisation check in the codebase reads `permission` and none read
    // `role`. Writing only `role` left the recipient with a row that looked like
    // access in the UI and granted nothing in practice.
    const { data: sitePermission, error } = await supabase
      .from("site_permissions")
      .insert({
        site_id: siteId,
        user_id: body.userId || null,
        team_id: body.teamId || null,
        permission: teamRoleToSitePermission(body.role),
        role: body.role,
        granted_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating site permission:", error);
      return NextResponse.json(
        { error: "Failed to share site" },
        { status: 500 },
      );
    }

    // Create notification for the target
    if (body.userId) {
      await supabase.from("collaboration_notifications").insert({
        user_id: body.userId,
        type: "site_shared",
        title: "Site Shared With You",
        message: `${user.email} shared the site "${site.name}" with you as a ${body.role}`,
        data: {
          site_id: siteId,
          site_name: site.name,
          role: body.role,
          shared_by: user.id,
        },
      });
    } else if (body.teamId) {
      // Create notifications for all team members
      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("user_id")
        .eq("team_id", body.teamId);

      if (teamMembers) {
        const notifications = teamMembers.map((member) => ({
          user_id: member.user_id,
          type: "site_shared" as const,
          title: "Site Shared With Your Team",
          message: `${user.email} shared the site "${site.name}" with your team as ${body.role}`,
          data: {
            site_id: siteId,
            site_name: site.name,
            team_id: body.teamId,
            team_name: targetName,
            role: body.role,
            shared_by: user.id,
          },
        }));

        await supabase
          .from("collaboration_notifications")
          .insert(notifications);
      }
    }

    return NextResponse.json(
      {
        permission: sitePermission,
        message: `Site shared with ${targetName} successfully`,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error in site share POST:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { siteId } = await context.params;
    const supabase = await createServerClient();
    const permissions = new CollaborationPermissions();

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if current user has permission to view site permissions
    const permissionCheck = await permissions.checkSitePermission(
      user.id,
      siteId,
      ["viewer", "editor", "manager", "owner"],
    );
    if (!permissionCheck.hasPermission) {
      return NextResponse.json(
        { error: "Insufficient permissions to view site permissions" },
        { status: 403 },
      );
    }

    // `auth.users` cannot be embedded — PostgREST does not expose that schema,
    // so the previous embed made this whole query fail. Teams still embed
    // normally; user identities are resolved separately through the Admin API.
    const { data: sitePermissions, error } = await supabase
      .from("site_permissions")
      .select(
        `
        *,
        team:teams!site_permissions_team_id_fkey(
          name,
          description
        )
      `,
      )
      .eq("site_id", siteId);

    if (error) {
      console.error("Error fetching site permissions:", error);
      return NextResponse.json(
        { error: "Failed to fetch site permissions" },
        { status: 500 },
      );
    }

    const rows = sitePermissions ?? [];
    const userIds = Array.from(
      new Set(
        rows
          .map((row) => row.user_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    );

    // One lookup per distinct user. The Admin API has no batch-by-id call, and a
    // site's permission list is small enough that this stays cheap; if it ever
    // is not, the fix is a profiles table, not a wider query here.
    const identities = new Map<string, { email: string; name: string }>();
    for (const userId of userIds) {
      const identity = await resolveUserIdentity(userId);
      if (identity) {
        identities.set(userId, identity);
      } else {
        // A permission row pointing at a deleted user is real and must not blank
        // the whole response — surface the row without an identity instead.
        console.warn(
          `Site permission references a user that could not be resolved: ${userId}`,
        );
      }
    }

    const permissionsWithUsers = rows.map((row) => ({
      ...row,
      user:
        typeof row.user_id === "string"
          ? (identities.get(row.user_id) ?? null)
          : null,
    }));

    return NextResponse.json({ permissions: permissionsWithUsers });
  } catch (error) {
    console.error("Error in site permissions GET:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { siteId } = await context.params;
    const supabase = await createServerClient();
    const permissions = new CollaborationPermissions();

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const permissionId = searchParams.get("permissionId");

    if (!permissionId) {
      return NextResponse.json(
        { error: "Permission ID is required" },
        { status: 400 },
      );
    }

    // Check if current user has permission to manage site permissions
    const permissionCheck = await permissions.checkSitePermission(
      user.id,
      siteId,
      ["manager", "owner"],
    );
    if (!permissionCheck.hasPermission) {
      return NextResponse.json(
        { error: "Insufficient permissions to manage site permissions" },
        { status: 403 },
      );
    }

    // Get the permission to be deleted
    const { data: targetPermission, error: targetPermissionError } =
      await supabase
        .from("site_permissions")
        .select("*")
        .eq("id", permissionId)
        .eq("site_id", siteId)
        .single();

    if (targetPermissionError || !targetPermission) {
      return NextResponse.json(
        { error: "Permission not found" },
        { status: 404 },
      );
    }

    // Delete the permission
    const { error } = await supabase
      .from("site_permissions")
      .delete()
      .eq("id", permissionId);

    if (error) {
      console.error("Error deleting site permission:", error);
      return NextResponse.json(
        { error: "Failed to revoke site access" },
        { status: 500 },
      );
    }

    // Create notification for the affected user(s)
    if (targetPermission.user_id) {
      await supabase.from("collaboration_notifications").insert({
        user_id: targetPermission.user_id,
        type: "permission_change",
        title: "Site Access Revoked",
        message: `Your access to a site has been revoked`,
        data: {
          site_id: siteId,
          revoked_by: user.id,
        },
      });
    } else if (targetPermission.team_id) {
      // Create notifications for all team members
      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("user_id")
        .eq("team_id", targetPermission.team_id);

      if (teamMembers) {
        const notifications = teamMembers.map((member) => ({
          user_id: member.user_id,
          type: "permission_change" as const,
          title: "Team Site Access Revoked",
          message: `Your team's access to a site has been revoked`,
          data: {
            site_id: siteId,
            team_id: targetPermission.team_id,
            revoked_by: user.id,
          },
        }));

        await supabase
          .from("collaboration_notifications")
          .insert(notifications);
      }
    }

    return NextResponse.json({ message: "Site access revoked successfully" });
  } catch (error) {
    console.error("Error in site permissions DELETE:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
