import { createClient } from "@/lib/supabase/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { TeamRole } from "@/types";

export interface PermissionCheck {
  hasPermission: boolean;
  userRole?: TeamRole;
  reason?: string;
}

export class CollaborationPermissions {
  private supabase: Promise<SupabaseClient>;

  constructor() {
    this.supabase = createClient();
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
        .select("role")
        .eq("site_id", siteId)
        .eq("user_id", userId)
        .single();

      if (
        sitePermission &&
        requiredRoles.includes(sitePermission.role as TeamRole)
      ) {
        return {
          hasPermission: true,
          userRole: sitePermission.role as TeamRole,
        };
      }

      // Check team-based site permissions
      const { data: teamSitePermissions } = await client
        .from("site_permissions")
        .select(
          `
          role,
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
          const siteRole = permission.role as TeamRole;

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
   * Get active editing sessions for a content element
   */
  async getActiveEditingSessions(
    contentElementId: string,
  ): Promise<Record<string, unknown>[]> {
    try {
      const client = await this.supabase;
      const { data: sessions, error } = await client
        .from("content_editing_sessions")
        .select(
          `
          *,
          user:auth.users!content_editing_sessions_user_id_fkey(
            email,
            raw_user_meta_data
          )
        `,
        )
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

      return (sessions as unknown as Record<string, unknown>[]) || [];
    } catch (error) {
      console.error("Error getting active editing sessions:", error);
      return [];
    }
  }
}
