// Collaboration Types
export type TeamRole = 'viewer' | 'editor' | 'manager' | 'owner';
export type BillingPlan = 'free' | 'starter' | 'pro' | 'enterprise';
export type NotificationType = 'invitation' | 'permission_change' | 'content_edit' | 'team_update' | 'site_shared';

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

// Analytics Types
export interface SiteAnalytics {
  id: string;
  site_id: string;
  date: string;
  page_views: number;
  unique_visitors: number;
  avg_load_time: number;
  bounce_rate: number;
  conversion_rate: number;
  total_edits: number;
  active_editors: number;
  created_at: string;
  updated_at: string;
}

export interface UserActivityLog {
  id: string;
  user_id?: string;
  site_id: string;
  action_type: 'page_view' | 'content_edit' | 'login' | 'logout' | 'api_call';
  resource_type?: 'content_element' | 'site' | 'user' | 'team';
  resource_id?: string;
  metadata: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  session_id?: string;
  timestamp: string;
}

export interface PerformanceMetric {
  id: string;
  site_id: string;
  metric_type: 'load_time' | 'edit_time' | 'api_response_time';
  value: number;
  metadata: Record<string, unknown>;
  recorded_at: string;
}

export interface ConversionEvent {
  id: string;
  site_id: string;
  user_id?: string;
  event_type: 'trial_start' | 'subscription' | 'upgrade' | 'churn';
  value?: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Bulk Operations Types
export interface BulkOperation {
  id: string;
  user_id: string;
  site_id: string;
  operation_type: 'import' | 'export' | 'batch_update' | 'sync';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  total_items: number;
  processed_items: number;
  failed_items: number;
  configuration: Record<string, unknown>;
  result_data: Record<string, unknown>;
  error_log: string[];
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface ContentTemplate {
  id: string;
  name: string;
  description?: string;
  template_data: Record<string, unknown>;
  category: string;
  is_public: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

// Enhanced Content Features
export interface ContentVersion {
  id: string;
  content_element_id: string;
  version_number: number;
  content: string;
  metadata: Record<string, unknown>;
  created_by?: string;
  branch_name: string;
  parent_version_id?: string;
  is_published: boolean;
  published_at?: string;
  created_at: string;
}

export interface ABTest {
  id: string;
  site_id: string;
  name: string;
  description?: string;
  status: 'draft' | 'running' | 'completed' | 'paused';
  traffic_split: number;
  start_date?: string;
  end_date?: string;
  success_metric: 'conversion_rate' | 'engagement' | 'click_through';
  created_by?: string;
  created_at: string;
  updated_at: string;
  variants?: ABTestVariant[];
}

export interface ABTestVariant {
  id: string;
  test_id: string;
  content_element_id: string;
  variant_name: string;
  content: string;
  traffic_percentage: number;
  created_at: string;
}

export interface ABTestResult {
  id: string;
  test_id: string;
  variant_id: string;
  user_id?: string;
  session_id?: string;
  event_type: 'view' | 'click' | 'conversion';
  value: number;
  metadata: Record<string, unknown>;
  recorded_at: string;
}

export interface ApprovalWorkflow {
  id: string;
  site_id: string;
  name: string;
  steps: Array<{
    step_number: number;
    required_role: TeamRole;
    approvers?: string[];
  }>;
  is_active: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRequest {
  id: string;
  content_element_id: string;
  workflow_id: string;
  proposed_content: string;
  current_step: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_by: string;
  comments?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ScheduledContent {
  id: string;
  content_element_id: string;
  scheduled_content: string;
  publish_at: string;
  status: 'scheduled' | 'published' | 'cancelled' | 'failed';
  created_by: string;
  created_at: string;
  published_at?: string;
}

// Enterprise Features
export interface AuditLog {
  id: string;
  user_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  session_id?: string;
  success: boolean;
  error_message?: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface ComplianceReport {
  id: string;
  report_type: 'gdpr' | 'soc2' | 'hipaa' | 'custom';
  site_id: string;
  generated_by?: string;
  report_data: Record<string, unknown>;
  period_start?: string;
  period_end?: string;
  status: 'generated' | 'reviewed' | 'approved' | 'exported';
  created_at: string;
}

export interface WhiteLabelConfig {
  id: string;
  site_id: string;
  brand_name?: string;
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  custom_css?: string;
  custom_domain?: string;
  favicon_url?: string;
  contact_email?: string;
  support_url?: string;
  terms_url?: string;
  privacy_url?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// API and Integration Features
export interface APIKey {
  id: string;
  user_id: string;
  site_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  permissions: Record<string, boolean>;
  rate_limit: number;
  last_used_at?: string;
  expires_at?: string;
  is_active: boolean;
  created_at: string;
}

export interface APIUsage {
  id: string;
  api_key_id: string;
  endpoint: string;
  method: string;
  status_code?: number;
  response_time?: number;
  request_size?: number;
  response_size?: number;
  ip_address?: string;
  user_agent?: string;
  timestamp: string;
}

export interface Webhook {
  id: string;
  site_id: string;
  url: string;
  events: string[];
  secret?: string;
  is_active: boolean;
  last_triggered_at?: string;
  failure_count: number;
  max_failures: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  response_status?: number;
  response_body?: string;
  response_time?: number;
  attempt_number: number;
  success: boolean;
  error_message?: string;
  delivered_at: string;
}

// Analytics Dashboard Types
export interface AnalyticsDashboardData {
  overview: {
    total_sites: number;
    total_users: number;
    total_page_views: number;
    total_edits: number;
    avg_load_time: number;
    conversion_rate: number;
  };
  trends: {
    page_views: Array<{ date: string; value: number }>;
    edits: Array<{ date: string; value: number }>;
    users: Array<{ date: string; value: number }>;
  };
  top_sites: Array<{
    site_id: string;
    domain: string;
    page_views: number;
    edits: number;
  }>;
  performance: {
    avg_load_time: number;
    avg_edit_time: number;
    error_rate: number;
  };
}

// Bulk Operation Payloads
export interface BulkImportPayload {
  site_id: string;
  format: 'json' | 'csv' | 'xml';
  data: unknown;
  options: {
    overwrite_existing?: boolean;
    create_missing_elements?: boolean;
    validate_content?: boolean;
  };
}

export interface BulkExportPayload {
  site_id: string;
  format: 'json' | 'csv' | 'xml';
  filters?: {
    language?: string;
    variant?: string;
    element_ids?: string[];
    updated_since?: string;
  };
}

export interface BulkUpdatePayload {
  site_id: string;
  operations: Array<{
    element_id: string;
    operation: 'find_replace' | 'append' | 'prepend' | 'set';
    find?: string;
    replace?: string;
    content?: string;
  }>;
}