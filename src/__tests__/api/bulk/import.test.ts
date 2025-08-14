import { POST, GET } from '@/app/api/bulk/import/route';
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
  upsert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn()
};

(createServerClient as jest.Mock).mockReturnValue(mockSupabase);

describe('/api/bulk/import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST', () => {
    it('should handle JSON import successfully', async () => {
      const mockUser = { id: 'user-123' };
      const mockPermission = { permission: 'admin' };

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single
        .mockResolvedValueOnce({ data: mockPermission, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      const importData = [
        {
          element_id: 'header-1',
          selector: '.header',
          current_content: 'Hello World',
          language: 'en',
          variant: 'default'
        }
      ];

      const requestBody = {
        site_id: 'site-123',
        format: 'json',
        data: importData,
        options: {
          overwrite_existing: false,
          create_missing_elements: true,
          validate_content: true
        }
      };

      const request = new NextRequest('http://localhost/api/bulk/import', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await POST(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toHaveProperty('operation_id');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('results');
    });

    it('should return 400 for missing required fields', async () => {
      const request = new NextRequest('http://localhost/api/bulk/import', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
    });

    it('should return 401 for unauthenticated requests', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const request = new NextRequest('http://localhost/api/bulk/import', {
        method: 'POST',
        body: JSON.stringify({
          site_id: 'site-123',
          format: 'json',
          data: []
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await POST(request);
      
      expect(response.status).toBe(401);
    });

    it('should return 403 for insufficient permissions', async () => {
      const mockUser = { id: 'user-123' };
      const mockPermission = { permission: 'view' };

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single.mockResolvedValueOnce({ data: mockPermission, error: null });

      const request = new NextRequest('http://localhost/api/bulk/import', {
        method: 'POST',
        body: JSON.stringify({
          site_id: 'site-123',
          format: 'json',
          data: []
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await POST(request);
      
      expect(response.status).toBe(403);
    });

    it('should handle CSV import', async () => {
      const mockUser = { id: 'user-123' };
      const mockPermission = { permission: 'admin' };

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single
        .mockResolvedValueOnce({ data: mockPermission, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      const csvData = 'element_id,selector,current_content,language,variant\nheader-1,.header,Hello World,en,default';

      const requestBody = {
        site_id: 'site-123',
        format: 'csv',
        data: csvData,
        options: {
          overwrite_existing: true,
          create_missing_elements: true,
          validate_content: false
        }
      };

      const request = new NextRequest('http://localhost/api/bulk/import', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await POST(request);
      
      expect(response.status).toBe(200);
    });

    it('should handle invalid JSON format', async () => {
      const mockUser = { id: 'user-123' };
      const mockPermission = { permission: 'admin' };

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single
        .mockResolvedValueOnce({ data: mockPermission, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      const requestBody = {
        site_id: 'site-123',
        format: 'json',
        data: 'invalid-json',
        options: {}
      };

      const request = new NextRequest('http://localhost/api/bulk/import', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const response = await POST(request);
      
      expect(response.status).toBe(500);
    });
  });

  describe('GET', () => {
    it('should return operation status', async () => {
      const mockUser = { id: 'user-123' };
      const mockOperation = {
        id: 'op-123',
        status: 'completed',
        total_items: 5,
        processed_items: 5,
        failed_items: 0
      };

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single.mockResolvedValue({ data: mockOperation, error: null });

      const request = new NextRequest('http://localhost/api/bulk/import?operationId=op-123');

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toEqual(mockOperation);
    });

    it('should return 400 for missing operationId', async () => {
      const request = new NextRequest('http://localhost/api/bulk/import');

      const response = await GET(request);
      
      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent operation', async () => {
      const mockUser = { id: 'user-123' };

      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
      mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'Not found' } });

      const request = new NextRequest('http://localhost/api/bulk/import?operationId=non-existent');

      const response = await GET(request);
      
      expect(response.status).toBe(404);
    });
  });
});