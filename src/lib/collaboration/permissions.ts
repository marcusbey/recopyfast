import { createServerClient } from '@/lib/supabase/server';
import { TeamRole } from '@/types';

export interface PermissionCheck {
  hasPermission: boolean;
  userRole?: TeamRole;
  reason?: string;
}

export class CollaborationPermissions {
  private supabase;

  constructor() {
    this.supabase = createServerClient();
  }

  /**
   * Check if a user has permission to perform an action on a team
   */
  async checkTeamPermission(
    userId: string,
    teamId: string,
    requiredRoles: TeamRole[]
  ): Promise<PermissionCheck> {
    try {
      const { data: membership, error } = await this.supabase
        .from('team_members')
        .select('role')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .single();

      if (error || !membership) {
        return {
          hasPermission: false,
          reason: 'User is not a member of this team',
        };
      }

      const hasPermission = requiredRoles.includes(membership.role as TeamRole);
      
      return {
        hasPermission,
        userRole: membership.role as TeamRole,
        reason: hasPermission ? undefined : `Requires one of: ${requiredRoles.join(', ')}`,
      };
    } catch (error) {
      console.error('Error checking team permission:', error);
      return {
        hasPermission: false,
        reason: 'Error checking permissions',
      };
    }
  }

  /**
   * Check if a user has permission to perform an action on a site
   */
  async checkSitePermission(
    userId: string,
    siteId: string,
    requiredRoles: TeamRole[]
  ): Promise<PermissionCheck> {
    try {
      // Check direct site permissions
      const { data: sitePermission } = await this.supabase
        .from('site_permissions')
        .select('role')
        .eq('site_id', siteId)
        .eq('user_id', userId)
        .single();

      if (sitePermission && requiredRoles.includes(sitePermission.role as TeamRole)) {
        return {
          hasPermission: true,
          userRole: sitePermission.role as TeamRole,
        };
      }

      // Check team-based site permissions
      const { data: teamSitePermissions } = await this.supabase
        .from('site_permissions')
        .select(`
          role,
          team:teams!site_permissions_team_id_fkey(
            team_members!inner(role)
          )
        `)
        .eq('site_id', siteId)
        .eq('team_members.user_id', userId);

      for (const permission of teamSitePermissions || []) {
        if (permission.team?.team_members?.[0]) {
          const userTeamRole = permission.team.team_members[0].role as TeamRole;
          const siteRole = permission.role as TeamRole;
          
          // User must have sufficient role in team AND site permission must allow the required roles
          if (this.isRoleSufficient(userTeamRole, ['editor', 'manager', 'owner']) &&
              requiredRoles.includes(siteRole)) {
            return {
              hasPermission: true,
              userRole: siteRole,
            };
          }
        }
      }

      // Check if site belongs to user's team
      const { data: siteTeam } = await this.supabase
        .from('sites')
        .select(`
          team:teams(
            team_members!inner(role)
          )
        `)
        .eq('id', siteId)
        .eq('team_members.user_id', userId)
        .single();

      if (siteTeam?.team?.team_members?.[0]) {
        const userRole = siteTeam.team.team_members[0].role as TeamRole;
        if (requiredRoles.includes(userRole)) {
          return {
            hasPermission: true,
            userRole,
          };
        }
      }

      return {
        hasPermission: false,
        reason: 'Insufficient permissions for this site',
      };
    } catch (error) {
      console.error('Error checking site permission:', error);
      return {
        hasPermission: false,
        reason: 'Error checking permissions',
      };
    }
  }

  /**
   * Check if a user can edit specific content
   */
  async checkContentEditPermission(
    userId: string,
    contentElementId: string
  ): Promise<PermissionCheck> {
    try {
      // Get content element and associated site
      const { data: contentElement, error } = await this.supabase
        .from('content_elements')
        .select('site_id')
        .eq('id', contentElementId)
        .single();

      if (error || !contentElement) {
        return {
          hasPermission: false,
          reason: 'Content element not found',
        };
      }

      // Check if there's an active editing session by another user
      const { data: activeSessions } = await this.supabase
        .from('content_editing_sessions')
        .select('user_id')
        .eq('content_element_id', contentElementId)
        .is('ended_at', null)
        .gt('last_activity', new Date(Date.now() - 30 * 60 * 1000).toISOString()) // Active in last 30 minutes
        .neq('user_id', userId);

      if (activeSessions && activeSessions.length > 0) {
        return {
          hasPermission: false,
          reason: 'Content is currently being edited by another user',
        };
      }

      // Check site permissions
      return this.checkSitePermission(userId, contentElement.site_id, ['editor', 'manager', 'owner']);
    } catch (error) {
      console.error('Error checking content edit permission:', error);
      return {
        hasPermission: false,
        reason: 'Error checking permissions',
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
  private isRoleSufficient(userRole: TeamRole, requiredRoles: TeamRole[]): boolean {
    const userLevel = this.getRoleLevel(userRole);
    return requiredRoles.some(role => userLevel >= this.getRoleLevel(role));
  }

  /**
   * Start an editing session for a user
   */
  async startEditingSession(userId: string, contentElementId: string): Promise<string | null> {
    try {
      // Check if user can edit this content
      const permission = await this.checkContentEditPermission(userId, contentElementId);
      if (!permission.hasPermission) {
        return null;
      }

      // End any existing session for this user and content
      await this.supabase
        .from('content_editing_sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('content_element_id', contentElementId)
        .is('ended_at', null);

      // Create new session
      const { data: session, error } = await this.supabase
        .from('content_editing_sessions')
        .insert({
          user_id: userId,
          content_element_id: contentElementId,
        })
        .select('session_token')
        .single();

      if (error || !session) {
        console.error('Error creating editing session:', error);
        return null;
      }

      return session.session_token;
    } catch (error) {
      console.error('Error starting editing session:', error);
      return null;
    }
  }

  /**
   * End an editing session
   */
  async endEditingSession(sessionToken: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('content_editing_sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('session_token', sessionToken)
        .is('ended_at', null);

      return !error;
    } catch (error) {
      console.error('Error ending editing session:', error);
      return false;
    }
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(sessionToken: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('content_editing_sessions')
        .update({ last_activity: new Date().toISOString() })
        .eq('session_token', sessionToken)
        .is('ended_at', null);

      return !error;
    } catch (error) {
      console.error('Error updating session activity:', error);
      return false;
    }
  }

  /**
   * Get active editing sessions for a content element
   */
  async getActiveEditingSessions(contentElementId: string): Promise<any[]> {
    try {
      const { data: sessions, error } = await this.supabase
        .from('content_editing_sessions')
        .select(`
          *,
          user:auth.users!content_editing_sessions_user_id_fkey(
            email,
            raw_user_meta_data
          )
        `)
        .eq('content_element_id', contentElementId)
        .is('ended_at', null)
        .gt('last_activity', new Date(Date.now() - 30 * 60 * 1000).toISOString());

      return sessions || [];
    } catch (error) {
      console.error('Error getting active editing sessions:', error);
      return [];
    }
  }
}