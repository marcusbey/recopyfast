import { createClient } from "@/lib/supabase/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { TeamRole } from "@/types";
import { attachUserIdentities } from "@/lib/auth/user-identity";

export interface PermissionCheck {
  hasPermission: boolean;
  userRole?: TeamRole;
  reason?: string;
}

/** The values `site_permissions.permission` is allowed to take. */
export type SitePermissionLevel = "view" | "edit" | "admin";

/**
 * Collapse a collaboration role onto the column authorisation actually reads.
 *
 * `site_permissions` carries both a `role` and a `permission` column, but only
 * `permission` is consulted — by `user_has_site_permission` in the RLS helpers,
 * by `checkSitePermission` below, and by every admin gate in /api/staging/* and
 * /api/editor/*. A row written with `role` alone grants nothing anywhere, which
 * is exactly the bug this exists to close: sharing appeared to succeed, fired a
 * notification, and left the recipient with no access at all.
 *
 * The mapping is lossy, and deliberately so. `permission` has three levels
 * (CHECK constraint: view|edit|admin) against four roles, so `manager` and
 * `owner` both land on `admin` — a manager is someone who may manage the site,
 * and `admin` is the only level that permits managing. The consequence worth
 * knowing is that the inverse mapping (`sitePermissionToTeamRole`) renders both
 * back as `owner`, so a manager reads as an owner after a round trip. Widening
 * the CHECK constraint to carry a distinct `manager` level is the real fix and
 * is a schema change beyond this repair.
 */
export function teamRoleToSitePermission(role: TeamRole): SitePermissionLevel {
  switch (role) {
    case "owner":
    case "manager":
      return "admin";
    case "editor":
      return "edit";
    case "viewer":
      return "view";
  }
}

export class CollaborationPermissions {
  private supabase: Promise<SupabaseClient>;

  constructor() {
    this.supabase = createClient();
  }

  private sitePermissionToTeamRole(permission: string): TeamRole {
    switch (permission) {
      case "admin":
        return "owner";
      case "edit":
        return "editor";
      case "view":
      default:
        return "viewer";
    }
  }

  /**
   * Check if a user has permission to perform an action on a team
   */
  async checkTeamPermission(
    userId: string,
    teamId: string,
    requiredRoles: TeamRole[],
  ): Promise<PermissionCheck> {
    try {
      const client = await this.supabase;
      const { data: membership, error } = await client
        .from("team_members")
        .select("role")
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .single();

      if (error || !membership) {
        return {
          hasPermission: false,
          reason: "User is not a member of this team",
        };
      }

      const hasPermission = requiredRoles.includes(membership.role as TeamRole);

      return {
        hasPermission,
        userRole: membership.role as TeamRole,
        reason: hasPermission
          ? undefined
          : `Requires one of: ${requiredRoles.join(", ")}`,
      };
    } catch (error) {
      console.error("Error checking team permission:", error);
      return {
        hasPermission: false,
        reason: "Error checking permissions",
      };
    }
  }

  /**
   * Check if a user has permission to perform an action on a site
   */
  async checkSitePermission(
    userId: string,
    siteId: string,
    requiredRoles: TeamRole[],
  ): Promise<PermissionCheck> {
    try {
      const client = await this.supabase;

      // Check direct site permissions
      const { data: sitePermission } = await client
        .from("site_permissions")
        .select("permission")
        .eq("site_id", siteId)
        .eq("user_id", userId)
        .single();

      if (sitePermission) {
        const siteRole = this.sitePermissionToTeamRole(
          sitePermission.permission as string,
        );
        if (requiredRoles.includes(siteRole)) {
          return {
            hasPermission: true,
            userRole: siteRole,
          };
        }
      }

      // Check team-based site permissions
      const { data: teamSitePermissions } = await client
        .from("site_permissions")
        .select(
          `
          permission,
          team:teams!site_permissions_team_id_fkey(
            team_members!inner(role)
          )
        `,
        )
        .eq("site_id", siteId)
        .eq("team_members.user_id", userId);

      for (const permission of teamSitePermissions || []) {
        const permissionTeam = permission.team as unknown as {
          team_members: Array<{ role: string }>;
        } | null;
        if (permissionTeam?.team_members?.[0]) {
          const userTeamRole = permissionTeam.team_members[0].role as TeamRole;
          const siteRole = this.sitePermissionToTeamRole(
            permission.permission as string,
          );

          // User must have sufficient role in team AND site permission must allow the required roles
          if (
            this.isRoleSufficient(userTeamRole, [
              "editor",
              "manager",
              "owner",
            ]) &&
            requiredRoles.includes(siteRole)
          ) {
            return {
              hasPermission: true,
              userRole: siteRole,
            };
          }
        }
      }

      // Check if site belongs to user's team
      const { data: siteTeam } = await client
        .from("sites")
        .select(
          `
          team:teams(
            team_members!inner(role)
          )
        `,
        )
        .eq("id", siteId)
        .eq("team_members.user_id", userId)
        .single();

      const siteTeamData = siteTeam?.team as unknown as {
        team_members: Array<{ role: string }>;
      } | null;
      if (siteTeamData?.team_members?.[0]) {
        const userRole = siteTeamData.team_members[0].role as TeamRole;
        if (requiredRoles.includes(userRole)) {
          return {
            hasPermission: true,
            userRole,
          };
        }
      }

      return {
        hasPermission: false,
        reason: "Insufficient permissions for this site",
      };
    } catch (error) {
      console.error("Error checking site permission:", error);
      return {
        hasPermission: false,
        reason: "Error checking permissions",
      };
    }
  }

  /**
   * Check if a user can edit specific content
   */
  async checkContentEditPermission(
    userId: string,
    contentElementId: string,
  ): Promise<PermissionCheck> {
    try {
      const client = await this.supabase;

      // Get content element and associated site
      const { data: contentElement, error } = await client
        .from("content_elements")
        .select("site_id")
        .eq("id", contentElementId)
        .single();

      if (error || !contentElement) {
        return {
          hasPermission: false,
          reason: "Content element not found",
        };
      }

      // Check if there's an active editing session by another user
      const { data: activeSessions } = await client
        .from("content_editing_sessions")
        .select("user_id")
        .eq("content_element_id", contentElementId)
        .is("ended_at", null)
        .gt(
          "last_activity",
          new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        ) // Active in last 30 minutes
        .neq("user_id", userId);

      if (activeSessions && activeSessions.length > 0) {
        return {
          hasPermission: false,
          reason: "Content is currently being edited by another user",
        };
      }

      // Check site permissions
      return this.checkSitePermission(userId, contentElement.site_id, [
        "editor",
        "manager",
        "owner",
      ]);
    } catch (error) {
      console.error("Error checking content edit permission:", error);
      return {
        hasPermission: false,
        reason: "Error checking permissions",
      };
    }
  }

  /**
   * Get user's role hierarchy level (higher number = more permissions)
   */
  private getRoleLevel(role: TeamRole): number {
    const roleLevels: Record<TeamRole, number> = {
      viewer: 1,
      editor: 2,
      manager: 3,
      owner: 4,
    };
    return roleLevels[role] || 0;
  }

  /**
   * Check if a role is sufficient for the required roles
   */
  private isRoleSufficient(
    userRole: TeamRole,
    requiredRoles: TeamRole[],
  ): boolean {
    const userLevel = this.getRoleLevel(userRole);
    return requiredRoles.some((role) => userLevel >= this.getRoleLevel(role));
  }

  /**
   * Start an editing session for a user
   */
  async startEditingSession(
    userId: string,
    contentElementId: string,
  ): Promise<string | null> {
    try {
      // Check if user can edit this content
      const permission = await this.checkContentEditPermission(
        userId,
        contentElementId,
      );
      if (!permission.hasPermission) {
        return null;
      }

      const client = await this.supabase;

      // End any existing session for this user and content
      await client
        .from("content_editing_sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("content_element_id", contentElementId)
        .is("ended_at", null);

      // Create new session
      const { data: session, error } = await client
        .from("content_editing_sessions")
        .insert({
          user_id: userId,
          content_element_id: contentElementId,
        })
        .select("session_token")
        .single();

      if (error || !session) {
        console.error("Error creating editing session:", error);
        return null;
      }

      return session.session_token;
    } catch (error) {
      console.error("Error starting editing session:", error);
      return null;
    }
  }

  /**
   * End an editing session
   */
  async endEditingSession(sessionToken: string): Promise<boolean> {
    try {
      const client = await this.supabase;
      const { error } = await client
        .from("content_editing_sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("session_token", sessionToken)
        .is("ended_at", null);

      return !error;
    } catch (error) {
      console.error("Error ending editing session:", error);
      return false;
    }
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(sessionToken: string): Promise<boolean> {
    try {
      const client = await this.supabase;
      const { error } = await client
        .from("content_editing_sessions")
        .update({ last_activity: new Date().toISOString() })
        .eq("session_token", sessionToken)
        .is("ended_at", null);

      return !error;
    } catch (error) {
      console.error("Error updating session activity:", error);
      return false;
    }
  }

  /**
   * Get active editing sessions for a content element.
   *
   * The sixth site of the `auth.users` embed defect (audit A-12, which counted
   * five in `src/app/api/teams`). PostgREST does not expose the `auth` schema, so
   * `user:auth.users!content_editing_sessions_user_id_fkey(...)` was a hard
   * PGRST200 that failed the whole select — meaning this returned `[]` on every
   * call, not merely on error. Identities now come from the Admin API, the same
   * as everywhere else.
   *
   * `[]` IS STILL THE RIGHT ANSWER ON FAILURE, and deliberately so: presence is
   * advisory decoration, not authorisation. Nobody is denied an edit because we
   * could not say who else was in the document, so a failed presence read must
   * degrade to "no badges" rather than break the editor around it. What was
   * wrong before was not the fallback but that the fallback was permanent and
   * unreachable-by-design. The error is logged at error level on both branches
   * so the difference between "nobody is editing" and "we could not tell" is
   * visible in the logs even though the caller cannot distinguish them.
   */
  async getActiveEditingSessions(
    contentElementId: string,
  ): Promise<Record<string, unknown>[]> {
    try {
      const client = await this.supabase;
      const { data: sessions, error } = await client
        .from("content_editing_sessions")
        .select("*")
        .eq("content_element_id", contentElementId)
        .is("ended_at", null)
        .gt(
          "last_activity",
          new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        );

      if (error) {
        console.error("Error getting active editing sessions:", error);
        return [];
      }

      return await attachUserIdentities(
        (sessions as unknown as Record<string, unknown>[]) || [],
        "user_id",
        "user",
      );
    } catch (error) {
      console.error("Error getting active editing sessions:", error);
      return [];
    }
  }
}
