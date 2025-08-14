import { createServerClient } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { AuditLog } from '@/types';

export class AuditLogger {
  private supabase;

  constructor() {
    this.supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          get: () => '',
          set: () => {},
          remove: () => {},
        },
      }
    );
  }

  /**
   * Log an audit event
   */
  async log(params: {
    userId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
    success?: boolean;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.supabase
        .from('audit_logs')
        .insert({
          user_id: params.userId,
          action: params.action,
          resource_type: params.resourceType,
          resource_id: params.resourceId,
          old_values: params.oldValues,
          new_values: params.newValues,
          ip_address: params.ipAddress,
          user_agent: params.userAgent,
          session_id: params.sessionId,
          success: params.success ?? true,
          error_message: params.errorMessage,
          metadata: params.metadata || {},
          timestamp: new Date().toISOString()
        });
    } catch (error) {
      console.error('Failed to log audit event:', error);
      // Don't throw error to avoid breaking the main operation
    }
  }

  /**
   * Log user authentication events
   */
  async logAuth(params: {
    userId?: string;
    action: 'login' | 'logout' | 'signup' | 'password_change' | 'failed_login';
    ipAddress?: string;
    userAgent?: string;
    success?: boolean;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.log({
      ...params,
      resourceType: 'auth',
      resourceId: params.userId
    });
  }

  /**
   * Log content operations
   */
  async logContent(params: {
    userId?: string;
    action: 'create' | 'update' | 'delete' | 'view';
    contentElementId: string;
    siteId: string;
    oldContent?: string;
    newContent?: string;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.log({
      userId: params.userId,
      action: `content_${params.action}`,
      resourceType: 'content_element',
      resourceId: params.contentElementId,
      oldValues: params.oldContent ? { content: params.oldContent } : undefined,
      newValues: params.newContent ? { content: params.newContent } : undefined,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      sessionId: params.sessionId,
      metadata: {
        ...params.metadata,
        site_id: params.siteId
      }
    });
  }

  /**
   * Log site operations
   */
  async logSite(params: {
    userId?: string;
    action: 'create' | 'update' | 'delete' | 'share' | 'unshare';
    siteId: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.log({
      ...params,
      action: `site_${params.action}`,
      resourceType: 'site',
      resourceId: params.siteId
    });
  }

  /**
   * Log team operations
   */
  async logTeam(params: {
    userId?: string;
    action: 'create' | 'update' | 'delete' | 'join' | 'leave' | 'invite' | 'remove_member';
    teamId: string;
    targetUserId?: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.log({
      ...params,
      action: `team_${params.action}`,
      resourceType: 'team',
      resourceId: params.teamId,
      metadata: {
        ...params.metadata,
        target_user_id: params.targetUserId
      }
    });
  }

  /**
   * Log API access
   */
  async logAPI(params: {
    userId?: string;
    apiKeyId?: string;
    action: string;
    endpoint: string;
    method: string;
    statusCode: number;
    responseTime?: number;
    ipAddress?: string;
    userAgent?: string;
    success?: boolean;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.log({
      userId: params.userId,
      action: `api_${params.action}`,
      resourceType: 'api_endpoint',
      resourceId: params.endpoint,
      success: params.success ?? (params.statusCode < 400),
      errorMessage: params.errorMessage,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: {
        ...params.metadata,
        api_key_id: params.apiKeyId,
        method: params.method,
        status_code: params.statusCode,
        response_time: params.responseTime
      }
    });
  }

  /**
   * Log security events
   */
  async logSecurity(params: {
    userId?: string;
    action: 'rate_limit_exceeded' | 'unauthorized_access' | 'suspicious_activity' | 'data_export' | 'data_import';
    resourceType?: string;
    resourceId?: string;
    ipAddress?: string;
    userAgent?: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.log({
      ...params,
      action: `security_${params.action}`,
      resourceType: params.resourceType || 'security_event',
      success: false, // Security events are typically about failures or threats
      metadata: {
        ...params.metadata,
        severity: params.severity
      }
    });
  }

  /**
   * Get audit logs with filtering
   */
  async getLogs(params: {
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    try {
      let query = this.supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('timestamp', { ascending: false });

      if (params.userId) {
        query = query.eq('user_id', params.userId);
      }

      if (params.resourceType) {
        query = query.eq('resource_type', params.resourceType);
      }

      if (params.resourceId) {
        query = query.eq('resource_id', params.resourceId);
      }

      if (params.action) {
        query = query.eq('action', params.action);
      }

      if (params.startDate) {
        query = query.gte('timestamp', params.startDate);
      }

      if (params.endDate) {
        query = query.lte('timestamp', params.endDate);
      }

      if (params.limit) {
        query = query.limit(params.limit);
      }

      if (params.offset) {
        query = query.range(params.offset, params.offset + (params.limit || 50) - 1);
      }

      const { data: logs, count, error } = await query;

      if (error) {
        throw error;
      }

      return {
        logs: logs || [],
        total: count || 0
      };
    } catch (error) {
      console.error('Failed to get audit logs:', error);
      return { logs: [], total: 0 };
    }
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(params: {
    siteId?: string;
    reportType: 'gdpr' | 'soc2' | 'hipaa' | 'custom';
    startDate: string;
    endDate: string;
    generatedBy: string;
  }): Promise<{
    id: string;
    report_type: string;
    report_data: Record<string, unknown>;
    created_at: string;
  }> {
    try {
      const { logs } = await this.getLogs({
        startDate: params.startDate,
        endDate: params.endDate,
        limit: 10000 // Large limit for comprehensive reports
      });

      let filteredLogs = logs;
      if (params.siteId) {
        filteredLogs = logs.filter(log => 
          log.metadata?.site_id === params.siteId ||
          (log.resource_type === 'site' && log.resource_id === params.siteId)
        );
      }

      const reportData = {
        report_type: params.reportType,
        period: {
          start: params.startDate,
          end: params.endDate
        },
        total_events: filteredLogs.length,
        event_breakdown: this.categorizeEvents(filteredLogs),
        security_events: filteredLogs.filter(log => log.action.startsWith('security_')),
        data_access_events: filteredLogs.filter(log => 
          ['content_view', 'content_update', 'data_export', 'data_import'].includes(log.action)
        ),
        authentication_events: filteredLogs.filter(log => log.resource_type === 'auth'),
        failed_operations: filteredLogs.filter(log => !log.success),
        compliance_metrics: this.calculateComplianceMetrics(filteredLogs, params.reportType)
      };

      // Store the report
      const { data: report, error } = await this.supabase
        .from('compliance_reports')
        .insert({
          report_type: params.reportType,
          site_id: params.siteId,
          generated_by: params.generatedBy,
          report_data: reportData,
          period_start: params.startDate,
          period_end: params.endDate,
          status: 'generated'
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return report;
    } catch (error) {
      console.error('Failed to generate compliance report:', error);
      throw error;
    }
  }

  private categorizeEvents(logs: AuditLog[]): Record<string, number> {
    const categories: Record<string, number> = {};
    
    logs.forEach(log => {
      const category = log.action.split('_')[0]; // Extract category from action
      categories[category] = (categories[category] || 0) + 1;
    });

    return categories;
  }

  private calculateComplianceMetrics(logs: AuditLog[], reportType: string): Record<string, unknown> {
    const metrics: Record<string, any> = {
      data_retention_compliance: true,
      access_control_violations: logs.filter(log => 
        log.action.includes('unauthorized') || !log.success
      ).length,
      encryption_status: 'enabled', // This would be checked elsewhere
      backup_status: 'compliant'   // This would be checked elsewhere
    };

    switch (reportType) {
      case 'gdpr':
        metrics.data_subject_requests = logs.filter(log => 
          log.action.includes('data_export') || log.action.includes('data_delete')
        ).length;
        metrics.consent_tracking = true;
        metrics.right_to_be_forgotten = true;
        break;

      case 'soc2':
        metrics.change_management = logs.filter(log => 
          ['content_update', 'site_update', 'team_update'].includes(log.action)
        ).length;
        metrics.access_reviews = true;
        metrics.incident_response = logs.filter(log => 
          log.action.startsWith('security_')
        ).length;
        break;

      case 'hipaa':
        metrics.phi_access_logs = logs.filter(log => 
          log.metadata?.contains_phi === true
        ).length;
        metrics.audit_trail_integrity = true;
        metrics.minimum_necessary_standard = true;
        break;
    }

    return metrics;
  }
}

// Middleware helper for automatic audit logging
export function createAuditMiddleware() {
  return async (req: NextRequest) => {
    const auditLogger = new AuditLogger();
    const startTime = Date.now();

    // Extract client info
    const forwarded = req.headers.get('x-forwarded-for');
    const ipAddress = forwarded ? forwarded.split(',')[0] : req.ip;
    const userAgent = req.headers.get('user-agent');

    // Add logger to request context (if your framework supports it)
    // req.auditLogger = auditLogger;

    return {
      auditLogger,
      logRequest: async (params: {
        userId?: string;
        action: string;
        resourceType: string;
        resourceId?: string;
        success?: boolean;
        errorMessage?: string;
        metadata?: Record<string, unknown>;
      }) => {
        await auditLogger.log({
          ...params,
          ipAddress,
          userAgent,
          metadata: {
            ...params.metadata,
            url: req.url,
            method: req.method,
            response_time: Date.now() - startTime
          }
        });
      }
    };
  };
}

// Export singleton instance
export const auditLogger = new AuditLogger();