/**
 * Edit Session Management
 * Handles secure authentication for website editing
 */

import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export interface EditSession {
  id: string;
  site_id: string;
  user_id: string;
  token: string;
  expires_at: Date;
  permissions: ('view' | 'edit' | 'admin')[];
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

export interface CreateEditSessionParams {
  siteId: string;
  userId: string;
  permissions: ('view' | 'edit' | 'admin')[];
  durationHours?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface ValidateEditSessionParams {
  token: string;
  siteId: string;
  ipAddress?: string;
}

export class EditSessionManager {
  private static readonly DEFAULT_DURATION_HOURS = 2;
  private static readonly MAX_DURATION_HOURS = 24;

  /**
   * Create a new edit session for a user
   */
  static async createEditSession(params: CreateEditSessionParams): Promise<EditSession | null> {
    try {
      const supabase = await createClient();
      
      // Validate permissions and site access
      const { data: sitePermission, error: permError } = await supabase
        .from('site_permissions')
        .select('permission, site_id')
        .eq('site_id', params.siteId)
        .eq('user_id', params.userId)
        .single();

      if (permError || !sitePermission) {
        throw new Error('User does not have access to this site');
      }

      // Validate requested permissions against user's actual permissions
      const userPermissions = this.expandPermissions(sitePermission.permission);
      const requestedPermissions = params.permissions;
      
      if (!requestedPermissions.every(perm => userPermissions.includes(perm))) {
        throw new Error('Requested permissions exceed user permissions');
      }

      // Generate secure token
      const token = this.generateSecureToken();
      const duration = Math.min(
        params.durationHours || this.DEFAULT_DURATION_HOURS,
        this.MAX_DURATION_HOURS
      );
      const expiresAt = new Date(Date.now() + (duration * 60 * 60 * 1000));

      // Create session record
      const { data: session, error } = await supabase
        .from('edit_sessions')
        .insert({
          site_id: params.siteId,
          user_id: params.userId,
          token,
          permissions: requestedPermissions,
          expires_at: expiresAt.toISOString(),
          ip_address: params.ipAddress,
          user_agent: params.userAgent
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create edit session: ${error.message}`);
      }

      return {
        id: session.id,
        site_id: session.site_id,
        user_id: session.user_id,
        token: session.token,
        expires_at: new Date(session.expires_at),
        permissions: session.permissions,
        ip_address: session.ip_address,
        user_agent: session.user_agent,
        created_at: new Date(session.created_at)
      };

    } catch (error) {
      console.error('Error creating edit session:', error);
      return null;
    }
  }

  /**
   * Validate an edit session token
   */
  static async validateEditSession(params: ValidateEditSessionParams): Promise<EditSession | null> {
    try {
      const supabase = await createClient();

      // Find active session
      const { data: session, error } = await supabase
        .from('edit_sessions')
        .select(`
          *,
          sites!inner(id, domain),
          profiles!inner(id, email, full_name)
        `)
        .eq('token', params.token)
        .eq('site_id', params.siteId)
        .eq('is_active', true)
        .gte('expires_at', new Date().toISOString())
        .single();

      if (error || !session) {
        return null;
      }

      // Optional IP validation (can be disabled for mobile/dynamic IPs)
      if (params.ipAddress && session.ip_address && session.ip_address !== params.ipAddress) {
        console.warn(`IP mismatch for edit session ${session.id}: expected ${session.ip_address}, got ${params.ipAddress}`);
        // Don't reject for now, just log
      }

      // Update last used timestamp
      await supabase
        .from('edit_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return {
        id: session.id,
        site_id: session.site_id,
        user_id: session.user_id,
        token: session.token,
        expires_at: new Date(session.expires_at),
        permissions: session.permissions,
        ip_address: session.ip_address,
        user_agent: session.user_agent,
        created_at: new Date(session.created_at)
      };

    } catch (error) {
      console.error('Error validating edit session:', error);
      return null;
    }
  }

  /**
   * Revoke an edit session
   */
  static async revokeEditSession(sessionId: string, userId: string): Promise<boolean> {
    try {
      const supabase = await createClient();

      const { error } = await supabase
        .from('edit_sessions')
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('user_id', userId);

      return !error;
    } catch (error) {
      console.error('Error revoking edit session:', error);
      return false;
    }
  }

  /**
   * Get active sessions for a user
   */
  static async getActiveSessionsForUser(userId: string): Promise<EditSession[]> {
    try {
      const supabase = await createClient();

      const { data: sessions, error } = await supabase
        .from('edit_sessions')
        .select(`
          *,
          sites!inner(id, domain, name)
        `)
        .eq('user_id', userId)
        .eq('is_active', true)
        .gte('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to get active sessions: ${error.message}`);
      }

      return sessions.map(session => ({
        id: session.id,
        site_id: session.site_id,
        user_id: session.user_id,
        token: session.token,
        expires_at: new Date(session.expires_at),
        permissions: session.permissions,
        ip_address: session.ip_address,
        user_agent: session.user_agent,
        created_at: new Date(session.created_at)
      }));

    } catch (error) {
      console.error('Error getting active sessions:', error);
      return [];
    }
  }

  /**
   * Clean up expired sessions
   */
  static async cleanupExpiredSessions(): Promise<number> {
    try {
      const supabase = await createClient();

      const { count, error } = await supabase
        .from('edit_sessions')
        .update({ is_active: false })
        .lt('expires_at', new Date().toISOString())
        .eq('is_active', true);

      if (error) {
        throw new Error(`Failed to cleanup expired sessions: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      console.error('Error cleaning up expired sessions:', error);
      return 0;
    }
  }

  /**
   * Generate a cryptographically secure token
   */
  private static generateSecureToken(): string {
    return crypto.randomBytes(48).toString('base64url');
  }

  /**
   * Expand permission level to include all allowed permissions
   */
  private static expandPermissions(permission: string): ('view' | 'edit' | 'admin')[] {
    switch (permission) {
      case 'admin':
        return ['view', 'edit', 'admin'];
      case 'edit':
        return ['view', 'edit'];
      case 'view':
        return ['view'];
      default:
        return [];
    }
  }

  /**
   * Check if session has specific permission
   */
  static hasPermission(session: EditSession, permission: 'view' | 'edit' | 'admin'): boolean {
    return session.permissions.includes(permission);
  }

  /**
   * Get session info for dashboard display
   */
  static getSessionInfo(session: EditSession) {
    return {
      id: session.id,
      siteId: session.site_id,
      permissions: session.permissions,
      expiresAt: session.expires_at,
      isExpiringSoon: (session.expires_at.getTime() - Date.now()) < (30 * 60 * 1000), // 30 minutes
      timeRemaining: Math.max(0, Math.floor((session.expires_at.getTime() - Date.now()) / (60 * 1000))) // minutes
    };
  }
}