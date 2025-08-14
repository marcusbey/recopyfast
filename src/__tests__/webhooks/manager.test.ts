import { WebhookManager, WEBHOOK_EVENTS } from '@/lib/webhooks/manager';
import { createServerClient } from '@supabase/ssr';
import fetch from 'node-fetch';

// Mock fetch
jest.mock('node-fetch');
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

// Mock Supabase
jest.mock('@supabase/ssr');
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  contains: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  single: jest.fn()
};

(createServerClient as jest.Mock).mockReturnValue(mockSupabase);

describe('WebhookManager', () => {
  let webhookManager: WebhookManager;

  beforeEach(() => {
    webhookManager = new WebhookManager();
    jest.clearAllMocks();
  });

  describe('createWebhook', () => {
    it('should create a new webhook', async () => {
      const mockWebhook = {
        id: 'webhook-123',
        site_id: 'site-123',
        url: 'https://example.com/webhook',
        events: ['content.updated'],
        secret: 'secret-key'
      };

      mockSupabase.single.mockResolvedValue({ data: mockWebhook, error: null });

      const result = await webhookManager.createWebhook({
        siteId: 'site-123',
        url: 'https://example.com/webhook',
        events: ['content.updated'],
        createdBy: 'user-123'
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('webhooks');
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          site_id: 'site-123',
          url: 'https://example.com/webhook',
          events: ['content.updated'],
          created_by: 'user-123',
          is_active: true
        })
      );
      expect(result).toEqual(mockWebhook);
    });

    it('should throw error on database failure', async () => {
      mockSupabase.single.mockResolvedValue({ 
        data: null, 
        error: new Error('Database error') 
      });

      await expect(webhookManager.createWebhook({
        siteId: 'site-123',
        url: 'https://example.com/webhook',
        events: ['content.updated'],
        createdBy: 'user-123'
      })).rejects.toThrow('Database error');
    });
  });

  describe('updateWebhook', () => {
    it('should update a webhook', async () => {
      const mockUpdatedWebhook = {
        id: 'webhook-123',
        url: 'https://example.com/new-webhook'
      };

      mockSupabase.single.mockResolvedValue({ data: mockUpdatedWebhook, error: null });

      const result = await webhookManager.updateWebhook('webhook-123', {
        url: 'https://example.com/new-webhook'
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('webhooks');
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/new-webhook'
        })
      );
      expect(result).toEqual(mockUpdatedWebhook);
    });
  });

  describe('deleteWebhook', () => {
    it('should delete a webhook', async () => {
      mockSupabase.delete.mockResolvedValue({ error: null });

      await webhookManager.deleteWebhook('webhook-123');

      expect(mockSupabase.from).toHaveBeenCalledWith('webhooks');
      expect(mockSupabase.delete).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 'webhook-123');
    });
  });

  describe('getWebhooks', () => {
    it('should return webhooks for a site', async () => {
      const mockWebhooks = [
        { id: 'webhook-1', url: 'https://example1.com/webhook' },
        { id: 'webhook-2', url: 'https://example2.com/webhook' }
      ];

      mockSupabase.order.mockResolvedValue({ data: mockWebhooks, error: null });

      const result = await webhookManager.getWebhooks('site-123');

      expect(mockSupabase.from).toHaveBeenCalledWith('webhooks');
      expect(mockSupabase.select).toHaveBeenCalledWith('*');
      expect(mockSupabase.eq).toHaveBeenCalledWith('site_id', 'site-123');
      expect(result).toEqual(mockWebhooks);
    });

    it('should return empty array on error', async () => {
      mockSupabase.order.mockResolvedValue({ 
        data: null, 
        error: new Error('Database error') 
      });

      const result = await webhookManager.getWebhooks('site-123');

      expect(result).toEqual([]);
    });
  });

  describe('triggerEvent', () => {
    it('should trigger webhooks for matching event', async () => {
      const mockWebhooks = [
        {
          id: 'webhook-1',
          url: 'https://example.com/webhook',
          secret: 'secret-key',
          failure_count: 0,
          max_failures: 5
        }
      ];

      mockSupabase.contains.mockResolvedValue({ data: mockWebhooks, error: null });

      // Mock successful webhook delivery
      const mockResponse = {
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('OK')
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      await webhookManager.triggerEvent({
        siteId: 'site-123',
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: { elementId: 'elem-123', content: 'New content' }
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('webhooks');
      expect(mockSupabase.contains).toHaveBeenCalledWith('events', [WEBHOOK_EVENTS.CONTENT_UPDATED]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-ReCopyFast-Event': WEBHOOK_EVENTS.CONTENT_UPDATED
          })
        })
      );
    });

    it('should handle webhook delivery failure', async () => {
      const mockWebhooks = [
        {
          id: 'webhook-1',
          url: 'https://example.com/webhook',
          secret: 'secret-key',
          failure_count: 0,
          max_failures: 5
        }
      ];

      mockSupabase.contains.mockResolvedValue({ data: mockWebhooks, error: null });
      mockSupabase.update.mockResolvedValue({ error: null });
      mockSupabase.insert.mockResolvedValue({ error: null });

      // Mock failed webhook delivery
      const mockResponse = {
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error')
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      await webhookManager.triggerEvent({
        siteId: 'site-123',
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: { elementId: 'elem-123' }
      });

      // Should update failure count
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          failure_count: 1
        })
      );
    });

    it('should disable webhook after max failures', async () => {
      const mockWebhooks = [
        {
          id: 'webhook-1',
          url: 'https://example.com/webhook',
          secret: 'secret-key',
          failure_count: 4, // One more failure will hit max
          max_failures: 5
        }
      ];

      mockSupabase.contains.mockResolvedValue({ data: mockWebhooks, error: null });
      mockSupabase.update.mockResolvedValue({ error: null });
      mockSupabase.insert.mockResolvedValue({ error: null });

      // Mock failed webhook delivery
      mockFetch.mockRejectedValue(new Error('Network error'));

      await webhookManager.triggerEvent({
        siteId: 'site-123',
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: { elementId: 'elem-123' }
      });

      // Should disable webhook after max failures
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          is_active: false,
          failure_count: 5
        })
      );
    });
  });

  describe('testWebhook', () => {
    it('should test webhook endpoint successfully', async () => {
      const mockWebhook = {
        id: 'webhook-123',
        url: 'https://example.com/webhook',
        site_id: 'site-123',
        secret: 'secret-key'
      };

      mockSupabase.single.mockResolvedValue({ data: mockWebhook, error: null });
      mockSupabase.insert.mockResolvedValue({ error: null });

      const mockResponse = {
        ok: true,
        status: 200
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await webhookManager.testWebhook('webhook-123');

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.responseTime).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-ReCopyFast-Test': 'true'
          })
        })
      );
    });

    it('should return error for non-existent webhook', async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: new Error('Not found') });

      const result = await webhookManager.testWebhook('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Webhook not found');
    });

    it('should handle network errors during test', async () => {
      const mockWebhook = {
        id: 'webhook-123',
        url: 'https://example.com/webhook',
        site_id: 'site-123',
        secret: 'secret-key'
      };

      mockSupabase.single.mockResolvedValue({ data: mockWebhook, error: null });
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await webhookManager.testWebhook('webhook-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('verifySignature', () => {
    it('should verify correct signature', () => {
      const payload = 'test payload';
      const secret = 'test-secret';
      
      // Generate expected signature
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const isValid = webhookManager.verifySignature(payload, expectedSignature, secret);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect signature', () => {
      const payload = 'test payload';
      const secret = 'test-secret';
      const invalidSignature = 'invalid-signature';

      const isValid = webhookManager.verifySignature(payload, invalidSignature, secret);

      expect(isValid).toBe(false);
    });
  });
});