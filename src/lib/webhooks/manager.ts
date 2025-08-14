import { createServerClient } from '@supabase/ssr';
import { Webhook, WebhookDelivery } from '@/types';
import crypto from 'crypto';

export class WebhookManager {
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
   * Create a new webhook
   */
  async createWebhook(params: {
    siteId: string;
    url: string;
    events: string[];
    secret?: string;
    createdBy: string;
  }): Promise<Webhook> {
    const secret = params.secret || this.generateSecret();
    
    const { data: webhook, error } = await this.supabase
      .from('webhooks')
      .insert({
        site_id: params.siteId,
        url: params.url,
        events: params.events,
        secret,
        created_by: params.createdBy,
        is_active: true,
        failure_count: 0,
        max_failures: 5
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return webhook;
  }

  /**
   * Update webhook
   */
  async updateWebhook(webhookId: string, updates: Partial<Webhook>): Promise<Webhook> {
    const { data: webhook, error } = await this.supabase
      .from('webhooks')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', webhookId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return webhook;
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    const { error } = await this.supabase
      .from('webhooks')
      .delete()
      .eq('id', webhookId);

    if (error) {
      throw error;
    }
  }

  /**
   * Get webhooks for a site
   */
  async getWebhooks(siteId: string): Promise<Webhook[]> {
    const { data: webhooks, error } = await this.supabase
      .from('webhooks')
      .select('*')
      .eq('site_id', siteId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return webhooks || [];
  }

  /**
   * Trigger webhook for an event
   */
  async triggerEvent(params: {
    siteId: string;
    eventType: string;
    payload: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      // Get active webhooks for this site and event
      const { data: webhooks, error } = await this.supabase
        .from('webhooks')
        .select('*')
        .eq('site_id', params.siteId)
        .eq('is_active', true)
        .contains('events', [params.eventType]);

      if (error) {
        console.error('Failed to get webhooks:', error);
        return;
      }

      if (!webhooks || webhooks.length === 0) {
        return; // No webhooks for this event
      }

      // Trigger each webhook
      const deliveryPromises = webhooks.map(webhook => 
        this.deliverWebhook(webhook, params.eventType, params.payload, params.metadata)
      );

      await Promise.allSettled(deliveryPromises);
    } catch (error) {
      console.error('Failed to trigger webhook event:', error);
    }
  }

  /**
   * Deliver webhook to a specific endpoint
   */
  private async deliverWebhook(
    webhook: Webhook,
    eventType: string,
    payload: Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const delivery: Partial<WebhookDelivery> = {
      webhook_id: webhook.id,
      event_type: eventType,
      payload: {
        event: eventType,
        timestamp: new Date().toISOString(),
        site_id: webhook.site_id,
        data: payload,
        metadata
      },
      attempt_number: 1,
      success: false
    };

    try {
      const startTime = Date.now();
      
      // Prepare request
      const requestPayload = JSON.stringify(delivery.payload);
      const signature = this.generateSignature(requestPayload, webhook.secret || '');

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ReCopyFast-Webhooks/1.0',
          'X-ReCopyFast-Event': eventType,
          'X-ReCopyFast-Signature': signature,
          'X-ReCopyFast-Delivery': crypto.randomUUID()
        },
        body: requestPayload,
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      const responseTime = Date.now() - startTime;
      const responseBody = await response.text().catch(() => '');

      delivery.response_status = response.status;
      delivery.response_body = responseBody.substring(0, 1000); // Limit response body size
      delivery.response_time = responseTime;
      delivery.success = response.ok;

      if (response.ok) {
        // Update webhook last triggered time
        await this.supabase
          .from('webhooks')
          .update({
            last_triggered_at: new Date().toISOString(),
            failure_count: 0 // Reset failure count on success
          })
          .eq('id', webhook.id);
      } else {
        // Handle failure
        await this.handleWebhookFailure(webhook, delivery);
      }
    } catch (error) {
      // Handle delivery error
      delivery.error_message = error instanceof Error ? error.message : 'Unknown error';
      delivery.success = false;
      
      await this.handleWebhookFailure(webhook, delivery);
    }

    // Log delivery attempt
    await this.supabase
      .from('webhook_deliveries')
      .insert(delivery);
  }

  /**
   * Handle webhook delivery failure
   */
  private async handleWebhookFailure(
    webhook: Webhook,
    delivery: Partial<WebhookDelivery>
  ): Promise<void> {
    const newFailureCount = webhook.failure_count + 1;
    
    if (newFailureCount >= webhook.max_failures) {
      // Disable webhook after max failures
      await this.supabase
        .from('webhooks')
        .update({
          is_active: false,
          failure_count: newFailureCount
        })
        .eq('id', webhook.id);
    } else {
      // Increment failure count
      await this.supabase
        .from('webhooks')
        .update({
          failure_count: newFailureCount
        })
        .eq('id', webhook.id);

      // Schedule retry (would be handled by a background job in production)
      setTimeout(() => {
        this.retryWebhook(webhook, delivery);
      }, this.calculateRetryDelay(newFailureCount));
    }
  }

  /**
   * Retry webhook delivery
   */
  private async retryWebhook(
    webhook: Webhook,
    originalDelivery: Partial<WebhookDelivery>
  ): Promise<void> {
    if (!originalDelivery.payload || !originalDelivery.event_type) {
      return;
    }

    // Create retry delivery record
    const retryDelivery: Partial<WebhookDelivery> = {
      webhook_id: webhook.id,
      event_type: originalDelivery.event_type,
      payload: originalDelivery.payload,
      attempt_number: (originalDelivery.attempt_number || 1) + 1,
      success: false
    };

    try {
      const startTime = Date.now();
      const requestPayload = JSON.stringify(retryDelivery.payload);
      const signature = this.generateSignature(requestPayload, webhook.secret || '');

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ReCopyFast-Webhooks/1.0',
          'X-ReCopyFast-Event': originalDelivery.event_type,
          'X-ReCopyFast-Signature': signature,
          'X-ReCopyFast-Delivery': crypto.randomUUID(),
          'X-ReCopyFast-Retry': 'true'
        },
        body: requestPayload,
        signal: AbortSignal.timeout(30000)
      });

      const responseTime = Date.now() - startTime;
      const responseBody = await response.text().catch(() => '');

      retryDelivery.response_status = response.status;
      retryDelivery.response_body = responseBody.substring(0, 1000);
      retryDelivery.response_time = responseTime;
      retryDelivery.success = response.ok;

      if (response.ok) {
        // Reset failure count on successful retry
        await this.supabase
          .from('webhooks')
          .update({
            last_triggered_at: new Date().toISOString(),
            failure_count: 0
          })
          .eq('id', webhook.id);
      }
    } catch (error) {
      retryDelivery.error_message = error instanceof Error ? error.message : 'Unknown error';
      retryDelivery.success = false;
    }

    // Log retry attempt
    await this.supabase
      .from('webhook_deliveries')
      .insert(retryDelivery);
  }

  /**
   * Calculate retry delay using exponential backoff
   */
  private calculateRetryDelay(attemptNumber: number): number {
    // Exponential backoff: 2^attempt * 1000ms, max 5 minutes
    return Math.min(Math.pow(2, attemptNumber) * 1000, 5 * 60 * 1000);
  }

  /**
   * Generate webhook signature
   */
  private generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expectedSignature = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  /**
   * Generate secure webhook secret
   */
  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get webhook delivery logs
   */
  async getDeliveryLogs(webhookId: string, limit: number = 50): Promise<WebhookDelivery[]> {
    const { data: deliveries, error } = await this.supabase
      .from('webhook_deliveries')
      .select('*')
      .eq('webhook_id', webhookId)
      .order('delivered_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return deliveries || [];
  }

  /**
   * Test webhook endpoint
   */
  async testWebhook(webhookId: string): Promise<{
    success: boolean;
    statusCode?: number;
    responseTime?: number;
    error?: string;
  }> {
    try {
      const { data: webhook, error } = await this.supabase
        .from('webhooks')
        .select('*')
        .eq('id', webhookId)
        .single();

      if (error || !webhook) {
        return { success: false, error: 'Webhook not found' };
      }

      const testPayload = {
        event: 'test',
        timestamp: new Date().toISOString(),
        site_id: webhook.site_id,
        data: { message: 'This is a test webhook delivery' }
      };

      const startTime = Date.now();
      const payloadString = JSON.stringify(testPayload);
      const signature = this.generateSignature(payloadString, webhook.secret || '');

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ReCopyFast-Webhooks/1.0',
          'X-ReCopyFast-Event': 'test',
          'X-ReCopyFast-Signature': signature,
          'X-ReCopyFast-Test': 'true'
        },
        body: payloadString,
        signal: AbortSignal.timeout(10000) // 10 second timeout for tests
      });

      const responseTime = Date.now() - startTime;

      // Log test delivery
      await this.supabase
        .from('webhook_deliveries')
        .insert({
          webhook_id: webhookId,
          event_type: 'test',
          payload: testPayload,
          response_status: response.status,
          response_time: responseTime,
          success: response.ok,
          attempt_number: 1
        });

      return {
        success: response.ok,
        statusCode: response.status,
        responseTime
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Event types that can trigger webhooks
export const WEBHOOK_EVENTS = {
  CONTENT_UPDATED: 'content.updated',
  CONTENT_CREATED: 'content.created',
  CONTENT_DELETED: 'content.deleted',
  SITE_UPDATED: 'site.updated',
  USER_INVITED: 'user.invited',
  TEAM_MEMBER_ADDED: 'team.member_added',
  BULK_OPERATION_COMPLETED: 'bulk.operation_completed',
  AB_TEST_STARTED: 'ab_test.started',
  AB_TEST_COMPLETED: 'ab_test.completed'
} as const;

export type WebhookEventType = typeof WEBHOOK_EVENTS[keyof typeof WEBHOOK_EVENTS];

// Export singleton instance
export const webhookManager = new WebhookManager();