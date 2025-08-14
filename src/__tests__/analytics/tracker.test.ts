import { AnalyticsTracker } from '@/lib/analytics/tracker';
import { createServerClient } from '@supabase/ssr';

// Mock Supabase
jest.mock('@supabase/ssr');
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  gte: jest.fn().mockReturnThis(),
  lte: jest.fn().mockReturnThis(),
  single: jest.fn(),
  rpc: jest.fn()
};

(createServerClient as jest.Mock).mockReturnValue(mockSupabase);

describe('AnalyticsTracker', () => {
  let tracker: AnalyticsTracker;

  beforeEach(() => {
    tracker = new AnalyticsTracker();
    jest.clearAllMocks();
  });

  describe('trackActivity', () => {
    it('should track user activity successfully', async () => {
      mockSupabase.insert.mockResolvedValueOnce({ data: null, error: null });

      await tracker.trackActivity({
        userId: 'user-123',
        siteId: 'site-456',
        actionType: 'content_edit',
        resourceType: 'content_element',
        resourceId: 'element-789',
        metadata: { test: 'data' }
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('user_activity_logs');
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-123',
          site_id: 'site-456',
          action_type: 'content_edit',
          resource_type: 'content_element',
          resource_id: 'element-789',
          metadata: { test: 'data' }
        })
      );
    });

    it('should handle tracking errors gracefully', async () => {
      mockSupabase.insert.mockRejectedValueOnce(new Error('Database error'));
      
      // Should not throw
      await expect(tracker.trackActivity({
        userId: 'user-123',
        siteId: 'site-456',
        actionType: 'page_view'
      })).resolves.toBeUndefined();
    });
  });

  describe('trackPerformance', () => {
    it('should track performance metrics', async () => {
      mockSupabase.insert.mockResolvedValueOnce({ data: null, error: null });

      await tracker.trackPerformance({
        siteId: 'site-456',
        metricType: 'load_time',
        value: 250.5,
        metadata: { page: '/home' }
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('performance_metrics');
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          site_id: 'site-456',
          metric_type: 'load_time',
          value: 250.5,
          metadata: { page: '/home' }
        })
      );
    });
  });

  describe('trackConversion', () => {
    it('should track conversion events', async () => {
      mockSupabase.insert.mockResolvedValueOnce({ data: null, error: null });

      await tracker.trackConversion({
        siteId: 'site-456',
        userId: 'user-123',
        eventType: 'subscription',
        value: 99.99,
        metadata: { plan: 'pro' }
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('conversion_events');
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          site_id: 'site-456',
          user_id: 'user-123',
          event_type: 'subscription',
          value: 99.99,
          metadata: { plan: 'pro' }
        })
      );
    });
  });

  describe('getDashboardData', () => {
    it('should return dashboard data', async () => {
      const mockActivityData = [
        { action_type: 'page_view', user_id: 'user-1', site_id: 'site-1', timestamp: '2024-01-01T00:00:00Z' },
        { action_type: 'content_edit', user_id: 'user-1', site_id: 'site-1', timestamp: '2024-01-01T00:00:00Z' }
      ];
      
      const mockSiteAnalytics = [];
      const mockPerformanceData = [
        { metric_type: 'load_time', value: 200, recorded_at: '2024-01-01T00:00:00Z' }
      ];

      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.gte.mockReturnValueOnce(mockSupabase);
      mockSupabase.lte.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockResolvedValueOnce({ data: mockActivityData });

      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.gte.mockReturnValueOnce(mockSupabase);
      mockSupabase.lte.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockResolvedValueOnce({ data: mockSiteAnalytics });

      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.gte.mockReturnValueOnce(mockSupabase);
      mockSupabase.lte.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockResolvedValueOnce({ data: mockPerformanceData });

      const result = await tracker.getDashboardData('site-1');

      expect(result).toHaveProperty('overview');
      expect(result).toHaveProperty('trends');
      expect(result).toHaveProperty('top_sites');
      expect(result).toHaveProperty('performance');
      expect(result.overview.total_page_views).toBe(1);
      expect(result.overview.total_edits).toBe(1);
    });

    it('should return empty data on error', async () => {
      mockSupabase.select.mockRejectedValueOnce(new Error('Database error'));

      const result = await tracker.getDashboardData('site-1');

      expect(result.overview.total_sites).toBe(0);
      expect(result.overview.total_users).toBe(0);
    });
  });

  describe('trackAPIUsage', () => {
    it('should track API usage', async () => {
      mockSupabase.insert.mockResolvedValueOnce({ data: null, error: null });

      await tracker.trackAPIUsage({
        apiKeyId: 'key-123',
        endpoint: '/api/v1/content',
        method: 'GET',
        statusCode: 200,
        responseTime: 150
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('api_usage');
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_id: 'key-123',
          endpoint: '/api/v1/content',
          method: 'GET',
          status_code: 200,
          response_time: 150
        })
      );
    });
  });
});