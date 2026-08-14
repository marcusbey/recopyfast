/**
 * Collaborator management for a site.
 *
 * WHY EVERY `site_permissions` QUERY HERE USES THE SERVICE ROLE
 * ------------------------------------------------------------
 * Which RLS policies production actually has is unknown from the repo, and the
 * two candidate migrations disagree. Only `20260731008000` grants
 * `authenticated` anything beyond SELECT on this table; `20260804130000` — the
 * one recorded as applied — restores SELECT-for-your-own-rows and FOR ALL to
 * `service_role`, and nothing else.
 *
 * Under that restrictive branch a caller-scoped client gives each handler a
 * different partial failure, and they compound into a feature that looks
 * half-alive:
 *   - POST   the INSERT matches zero rows, `.single()` returns PGRST116, 500.
 *   - GET    the list returns only the caller's own row, so an owner who has
 *            just added a teammate cannot see them.
 *   - DELETE the pre-read cannot see anyone else's row, so revoking a
 *            collaborator answers "Permission not found" — the owner can add a
 *            teammate and then never remove them.
 * Each of those is invisible to a test that only checks the happy branch, which
 * is why the first pass at this fix moved the writes and left the reads behind.
 *
 * The service role makes an already-authorised operation land; it never decides
 * whether it may. Every handler completes its own authorisation first —
 * `checkSitePermission` in all three, plus the `canShareSite` seat quota in
 * POST — and the queries below are scoped to `siteId` so a permission row from
 * another site is unreachable regardless of what RLS would have allowed.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { ShareSitePayload, TeamRole } from "@/types";
import {
  CollaborationPermissions,
  teamRoleToSitePermission,
} from "@/lib/collaboration/permissions";
import { canShareSite } from "@/lib/feature-gating/permissions";
import {
  attachUserIdentities,
  resolveUserIdentity,
} from "@/lib/auth/user-identity";

interface RouteContext {
  params: Promise<{ siteId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { siteId } = await context.params;
    const supabase = await createServerClient();
    const permissions = new CollaborationPermissions();

    // Every `site_permissions` query below goes through this client — see the
    // module header. Authorisation for this request is checkSitePermission
    // (["manager","owner"]) plus the canShareSite seat quota, both below.
    const serviceClient = createServiceRoleClient();

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

      // Read with the same client that writes. Under the no-INSERT-policy
      // branch the caller's client cannot see other people's rows either, so
      // this check answered "no existing permission" for everyone and the
      // duplicate guard below never fired.
      const { data: existingPermission } = await serviceClient
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

      // Same client as the write, for the same reason as the user branch above.
      const { data: existingPermission } = await serviceClient
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

    // Seats are a plan quota, and until now nothing checked it. Starter sells
    // zero collaborators and Pro sells five; both were unlimited in practice,
    // because the limit was declared in the plans table and never read on the
    // one path that creates a seat.
    //
    // Checked here rather than in the UI: a limit enforced only in a component
    // is not a limit. Charged to the site owner, not to the sharer — see
    // canShareSite.
    const seatQuota = await canShareSite(siteId, user.id);
    if (!seatQuota.allowed) {
      return NextResponse.json(
        {
          error: seatQuota.reason ?? "Collaborator limit reached",
          upgradeRequired: seatQuota.upgradeRequired ?? false,
          currentLimit: seatQuota.currentLimit,
          maxLimit: seatQuota.maxLimit,
        },
        { status: 403 },
      );
    }

    // Create site permission.
    //
    // `permission` is written alongside `role` and is the one that matters:
    // every authorisation check in the codebase reads `permission` and none read
    // `role`. Writing only `role` left the recipient with a row that looked like
    // access in the UI and granted nothing in practice.
    const { data: sitePermission, error } = await serviceClient
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

    // Managers and owners only — NOT every collaborator.
    //
    // This narrowed when the query below moved to the service role. While it ran
    // as the caller, a restrictive SELECT policy meant a viewer asking for the
    // roster got back their own row; the response was wrong (that is the bug
    // A-9's GET fix addresses) but it was not a disclosure. Service-scoped, the
    // same request returns every collaborator on the site, and each row is then
    // decorated with that person's email address from the Admin API. Fixing the
    // read without narrowing the reader would have turned "the list is broken"
    // into "any viewer can harvest the address of everyone they work with".
    //
    // Manager/owner is the right line rather than a redaction fallback because a
    // roster carrying identities is a management view and there is no
    // viewer-facing surface that needs it: no component in this repo fetches this
    // endpoint at all. ShareSiteDialog — the obvious candidate — talks to
    // /api/staging/access instead. So nothing in the product loses a capability
    // here, and if a viewer-facing roster is ever wanted it should be a separate
    // projection that omits identities, not a widening of this one.
    const permissionCheck = await permissions.checkSitePermission(
      user.id,
      siteId,
      ["manager", "owner"],
    );
    if (!permissionCheck.hasPermission) {
      return NextResponse.json(
        { error: "Insufficient permissions to view site permissions" },
        { status: 403 },
      );
    }

    // Service-scoped, like the write paths — see the module header. This list is
    // the whole point of the screen, and under a SELECT-own-rows-only policy the
    // caller's client returns just their own row: an owner sees an empty
    // collaborator list immediately after successfully adding someone.
    //
    // `auth.users` cannot be embedded — PostgREST does not expose that schema,
    // so the previous embed made this whole query fail. `teams` is in `public`
    // and embeds normally; user identities are resolved through the Admin API.
    const serviceClient = createServiceRoleClient();

    const { data: sitePermissions, error } = await serviceClient
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

    // A permission row pointing at a deleted user is real and must not blank the
    // whole response — such a row comes back with `user: null`.
    const permissionsWithUsers = await attachUserIdentities(
      sitePermissions ?? [],
      "user_id",
      "user",
    );

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

    // Service-scoped, like the other two handlers — see the module header. Under
    // a SELECT-own-rows-only policy this pre-read cannot see the row being
    // revoked, so revoking anyone but yourself answered "Permission not found"
    // and a collaborator could be added but never removed.
    const serviceClient = createServiceRoleClient();

    // Get the permission to be deleted. Scoped to `site_id`, so a permissionId
    // belonging to another site is a 404 rather than a cross-site read.
    const { data: targetPermission, error: targetPermissionError } =
      await serviceClient
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

    // Count admins before any revoke. A site with one admin row must keep it,
    // whether that row is the creator's or the last invited manager.
    const { data: adminRows, error: adminCountError } = await serviceClient
      .from("site_permissions")
      .select("id")
      .eq("site_id", siteId)
      .eq("permission", "admin");

    if (adminCountError) {
      console.error("Error counting site admins:", adminCountError);
      return NextResponse.json(
        { error: "Failed to revoke site access" },
        { status: 500 },
      );
    }

    // The site creator's row is not revocable through this endpoint.
    //
    // THIS GUARD IS PART OF THE SERVICE-ROLE CHANGE, not a separate feature.
    // `sites` has no owner column, so the creator's `site_permissions` row is the
    // entire record that they own the site — delete it and they lose read, edit,
    // publish, analytics and re-share, with no admin surface to grant it back,
    // while a collaborator whose row survives holds the tenant (audit A-4).
    //
    // The only thing that used to stop that on this path was an accident: the
    // pre-read ran as the caller, and under the restrictive SELECT policy it
    // could not see anyone else's row, so the request 404'd. Moving the read to
    // `service_role` — which is what makes revoking a collaborator work at all —
    // removes that accident, so the protection has to become deliberate here or
    // the fix for one finding arms another.
    //
    // `granted_by IS NULL` is the marker: sites/register/route.ts creates the
    // creator's row without it, and this route always sets it (see the POST
    // insert), so a null means "nobody granted this — it came with the site".
    //
    // NOT the whole of A-4. A site can still be left with no admin by revoking
    // the last non-creator admin, which needs a count this route does not make;
    // that remains open and its marker in share-owner-lockout.test.ts stays red.
    if (targetPermission.granted_by === null) {
      return NextResponse.json(
        {
          error:
            "The site creator's access cannot be revoked. Transfer ownership first.",
        },
        { status: 403 },
      );
    }

    if (
      targetPermission.permission === "admin" &&
      (adminRows?.length ?? 0) <= 1
    ) {
      return NextResponse.json(
        {
          error:
            "The last admin on this site cannot be revoked. Transfer ownership first.",
        },
        { status: 403 },
      );
    }

    // Delete the permission, scoped to `site_id` as well as `id`.
    //
    // The pre-read above already establishes that this row belongs to `siteId`,
    // so the filter is redundant on today's control flow — but it is the filter
    // that makes the DELETE safe *on its own terms* rather than only as a
    // consequence of the check above, and RLS is no longer behind it to catch a
    // future refactor that reorders or drops that check. Same reasoning as the
    // team-scoped delete in teams/[teamId]/members/route.ts.
    const { error } = await serviceClient
      .from("site_permissions")
      .delete()
      .eq("id", permissionId)
      .eq("site_id", siteId);

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
