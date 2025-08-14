import { GET, POST, PUT } from '@/app/api/ab-tests/route';
import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Mock Supabase
jest.mock('@supabase/ssr');
const mockSupabase = {
  auth: {
    getUser: jest.fn()
  },
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  single: jest.fn()
};

(createServerClient as jest.Mock).mockReturnValue(mockSupabase);

describe('/api/ab-tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET', () => {
    it('should return A/B tests for a site', async () => {
      const mockUser = { id: 'user-123' };
      const mockPermission = { permission: 'admin' };
      const mockTests = [
        {
          id: 'test-1',
          name: 'Homepage Test',
          status: 'running',
          variants: [
            { id: 'var-1', variant_name: 'control' },
            { id: 'var-2', variant_name: 'treatment' }
          ]
        }
      ];

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single.mockResolvedValueOnce({ data: mockPermission, error: null });
      mockSupabase.order.mockResolvedValueOnce({ data: mockTests, error: null });

      const request = new NextRequest('http://localhost/api/ab-tests?siteId=site-123');

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toEqual(mockTests);
    });

    it('should return 400 for missing siteId', async () => {
      const request = new NextRequest('http://localhost/api/ab-tests');

      const response = await GET(request);
      
      expect(response.status).toBe(400);
    });

    it('should return 401 for unauthenticated requests', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const request = new NextRequest('http://localhost/api/ab-tests?siteId=site-123');

      const response = await GET(request);
      
      expect(response.status).toBe(401);
    });

    it('should return 403 for insufficient permissions', async () => {
      const mockUser = { id: 'user-123' };

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single.mockResolvedValueOnce({ data: null, error: null });

      const request = new NextRequest('http://localhost/api/ab-tests?siteId=site-123');

      const response = await GET(request);
      
      expect(response.status).toBe(403);
    });
  });

  describe('POST', () => {
    it('should create a new A/B test', async () => {
      const mockUser = { id: 'user-123' };
      const mockPermission = { permission: 'admin' };
      const mockTest = {
        id: 'test-123',
        name: 'New Test',
        status: 'draft'
      };

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single
        .mockResolvedValueOnce({ data: mockPermission, error: null })
        .mockResolvedValueOnce({ data: mockTest, error: null });
      mockSupabase.insert.mockResolvedValueOnce({ error: null });

      const requestBody = {
        site_id: 'site-123',
        name: 'Homepage Test',
        success_metric: 'conversion_rate',
        variants: [
          {
            content_element_id: 'elem-1',
            variant_name: 'control',
            content: 'Original content',
            traffic_percentage: 50
          },
          {
            content_element_id: 'elem-1',
            variant_name: 'treatment',
            content: 'New content',
            traffic_percentage: 50
          }
        ]
      };

      const request = new NextRequest('http://localhost/api/ab-tests', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await POST(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toEqual(mockTest);
    });

    it('should return 400 for missing required fields', async () => {
      const request = new NextRequest('http://localhost/api/ab-tests', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid traffic percentages', async () => {
      const mockUser = { id: 'user-123' };
      const mockPermission = { permission: 'admin' };

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single.mockResolvedValueOnce({ data: mockPermission, error: null });

      const requestBody = {
        site_id: 'site-123',
        name: 'Test',
        success_metric: 'conversion_rate',
        variants: [
          { variant_name: 'control', traffic_percentage: 60 },
          { variant_name: 'treatment', traffic_percentage: 60 } // Total = 120%
        ]
      };

      const request = new NextRequest('http://localhost/api/ab-tests', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
    });

    it('should return 401 for unauthenticated requests', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const request = new NextRequest('http://localhost/api/ab-tests', {
        method: 'POST',
        body: JSON.stringify({
          site_id: 'site-123',
          name: 'Test',
          success_metric: 'conversion_rate',
          variants: []
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await POST(request);
      
      expect(response.status).toBe(401);
    });
  });

  describe('PUT', () => {
    it('should update an A/B test', async () => {
      const mockUser = { id: 'user-123' };
      const mockTest = { site_id: 'site-123', created_by: 'user-123' };
      const mockPermission = { permission: 'admin' };
      const mockUpdatedTest = {
        id: 'test-123',
        name: 'Updated Test',
        status: 'running'
      };

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single
        .mockResolvedValueOnce({ data: mockTest, error: null })
        .mockResolvedValueOnce({ data: mockPermission, error: null })
        .mockResolvedValueOnce({ data: mockUpdatedTest, error: null });

      const requestBody = {
        test_id: 'test-123',
        status: 'running',
        name: 'Updated Test'
      };

      const request = new NextRequest('http://localhost/api/ab-tests', {
        method: 'PUT',
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await PUT(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toEqual(mockUpdatedTest);
    });

    it('should return 400 for missing test_id', async () => {
      const request = new NextRequest('http://localhost/api/ab-tests', {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await PUT(request);
      
      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent test', async () => {
      const mockUser = { id: 'user-123' };

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single.mockResolvedValueOnce({ data: null, error: { message: 'Not found' } });

      const request = new NextRequest('http://localhost/api/ab-tests', {
        method: 'PUT',
        body: JSON.stringify({ test_id: 'non-existent' }),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await PUT(request);
      
      expect(response.status).toBe(404);
    });
  });
});