export interface Site {
  id: string;
  domain: string;
  name: string;
  api_key: string;
  created_at: string;
  updated_at: string;
}

export interface ContentElementMetadata {
  type?: string;
  category?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface ContentElement {
  id: string;
  site_id: string;
  element_id: string;
  selector: string;
  original_content: string;
  current_content: string;
  language: string;
  variant: string;
  metadata?: ContentElementMetadata;
  created_at: string;
  updated_at: string;
}

export interface ContentHistory {
  id: string;
  content_element_id: string;
  content: string;
  changed_by: string;
  change_type: 'create' | 'update' | 'delete';
  created_at: string;
}

export interface SitePermission {
  id: string;
  site_id: string;
  user_id?: string;
  team_id?: string;
  role: TeamRole;
  permissions: Record<string, unknown>;
  granted_by?: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  role: 'user' | 'admin';
  created_at: string;
}

// Collaboration Types
export type TeamRole = 'viewer' | 'editor' | 'manager' | 'owner';
export type BillingPlan = 'free' | 'starter' | 'pro' | 'enterprise';
export type NotificationType = 'invitation' | 'permission_change' | 'content_edit' | 'team_update' | 'site_shared';

export interface Team {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  billing_plan: BillingPlan;
  max_members: number;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
  invited_by?: string;
  user?: {
    email: string;
    raw_user_meta_data?: {
      name?: string;
      avatar_url?: string;
    };
  };
}

export interface TeamInvitation {
  id: string;
  team_id: string;
  email: string;
  role: TeamRole;
  invited_by: string;
  token: string;
  expires_at: string;
  accepted_at?: string;
  created_at: string;
  team?: {
    name: string;
  };
  inviter?: {
    email: string;
    raw_user_meta_data?: {
      name?: string;
    };
  };
}

export interface ContentEditingSession {
  id: string;
  content_element_id: string;
  user_id: string;
  session_token: string;
  started_at: string;
  last_activity: string;
  ended_at?: string;
  user?: {
    email: string;
    raw_user_meta_data?: {
      name?: string;
      avatar_url?: string;
    };
  };
}

export interface CollaborationNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown>;
  read_at?: string;
  created_at: string;
}

export interface TeamActivityLog {
  id: string;
  team_id: string;
  user_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details: Record<string, unknown>;
  created_at: string;
  user?: {
    email: string;
    raw_user_meta_data?: {
      name?: string;
    };
  };
}

// Enhanced Site interface with team collaboration
export interface Site {
  id: string;
  domain: string;
  name: string;
  api_key: string;
  team_id?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  team?: Team;
  permissions?: SitePermission[];
}


export interface ContentUpdatePayload {
  siteId: string;
  elementId: string;
  content: string;
  language?: string;
  variant?: string;
}

export interface ContentMapPayload {
  siteId: string;
  url: string;
  contentMap: Record<string, {
    selector: string;
    content: string;
    type: string;
  }>;
}

// Invitation and Team Management Payloads
export interface CreateTeamPayload {
  name: string;
  description?: string;
}

export interface InviteTeamMemberPayload {
  email: string;
  role: TeamRole;
  teamId: string;
}

export interface UpdateTeamMemberRolePayload {
  memberId: string;
  role: TeamRole;
}

export interface AcceptInvitationPayload {
  token: string;
}

export interface ShareSitePayload {
  siteId: string;
  teamId?: string;
  userId?: string;
  role: TeamRole;
}

// Real-time collaboration types
export interface PresenceData {
  userId: string;
  userEmail: string;
  userName?: string;
  userAvatar?: string;
  elementId?: string;
  cursorPosition?: number;
  selection?: {
    start: number;
    end: number;
  };
  lastActivity: string;
}

export interface CollaborativeEdit {
  elementId: string;
  content: string;
  delta?: unknown; // For operational transforms
  userId: string;
  timestamp: string;
  sessionToken: string;
}

export interface EditConflict {
  elementId: string;
  conflictingEdits: CollaborativeEdit[];
  baseContent: string;
  resolution?: 'auto' | 'manual';
}