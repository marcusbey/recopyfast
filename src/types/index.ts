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
  user_id: string;
  site_id: string;
  permission: 'view' | 'edit' | 'admin';
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  role: 'user' | 'admin';
  created_at: string;
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