import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/logout/route';
import { createClient } from '@/lib/supabase/server';

// Mock dependencies
jest.mock('@/lib/supabase/server');

const mockSupabaseAuth = {
  signOut: jest.fn(),
  getUser: jest.fn(),
  getSession: jest.fn(),
};

const mockSupabase = {
  auth: mockSupabaseAuth,
};

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('/api/auth/logout - POST', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase as any);
  });

  describe('Successful logout scenarios', () => {
    it('should successfully logout an authenticated user', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Logged out successfully',
      });
      expect(mockSupabaseAuth.signOut).toHaveBeenCalled();
    });

    it('should handle logout without Authorization header', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Logged out successfully',
      });
    });

    it('should handle multiple logout calls gracefully', async () => {
      mockSupabaseAuth.signOut.mockResolvedValue({
        error: null,
      });

      // First logout
      const request1 = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });
      const response1 = await POST(request1);

      // Second logout (already logged out)
      const request2 = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });
      const response2 = await POST(request2);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(mockSupabaseAuth.signOut).toHaveBeenCalledTimes(2);
    });
  });

  describe('Failed logout scenarios', () => {
    it('should return 400 when Supabase signOut fails', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: { message: 'Failed to sign out' },
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Failed to sign out',
      });
    });

    it('should handle network errors during logout', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: { message: 'Network error' },
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Network error',
      });
    });
  });

  describe('Error handling scenarios', () => {
    it('should return 500 when Supabase client creation fails', async () => {
      mockCreateClient.mockRejectedValueOnce(new Error('Supabase connection failed'));

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });

    it('should return 500 for unexpected errors', async () => {
      mockSupabaseAuth.signOut.mockRejectedValueOnce(
        new Error('Unexpected error')
      );

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });
  });

  describe('Security scenarios', () => {
    it('should clear all session data on logout', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Cookie': 'session=abc123; other=value',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Logged out successfully',
      });
      expect(mockSupabaseAuth.signOut).toHaveBeenCalled();
    });

    it('should handle logout with expired tokens', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer expired-token',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Logged out successfully',
      });
    });

    it('should handle logout with invalid tokens', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-format-token-!@#$%',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Logged out successfully',
      });
    });

    it('should handle concurrent logout requests', async () => {
      mockSupabaseAuth.signOut.mockResolvedValue({
        error: null,
      });

      const requests = Array(5).fill(null).map(() => 
        new NextRequest('http://localhost/api/auth/logout', {
          method: 'POST',
        })
      );

      const responses = await Promise.all(
        requests.map(request => POST(request))
      );

      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      expect(mockSupabaseAuth.signOut).toHaveBeenCalledTimes(5);
    });
  });

  describe('Session cleanup scenarios', () => {
    it('should handle logout when no active session exists', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Logged out successfully',
      });
    });

    it('should handle partial logout failures', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: { message: 'Failed to clear session' },
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Failed to clear session',
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle logout with custom headers', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Request-ID': '12345',
          'User-Agent': 'Custom-Agent/1.0',
        },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should handle logout with request body (should be ignored)', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({
          extra: 'data',
          should: 'be ignored',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Logged out successfully',
      });
    });

    it('should handle logout when Supabase returns unexpected error format', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: { 
          message: undefined,
          code: 'UNKNOWN_ERROR',
          details: 'Some error details',
        } as any,
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: undefined,
      });
    });

    it('should handle logout when signOut returns null response', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce(null as any);

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });

    it('should handle logout with various authorization header formats', async () => {
      const authHeaders = [
        'Bearer token123',
        'bearer TOKEN123', // lowercase bearer
        'Token abc123', // Different scheme
        'Basic dXNlcjpwYXNz', // Basic auth
        '', // Empty auth header
      ];

      for (const authHeader of authHeaders) {
        mockSupabaseAuth.signOut.mockResolvedValueOnce({
          error: null,
        });

        const request = new NextRequest('http://localhost/api/auth/logout', {
          method: 'POST',
          headers: authHeader ? { 'Authorization': authHeader } : {},
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
      }
    });
  });

  describe('Performance and reliability', () => {
    it('should handle rapid successive logout calls', async () => {
      mockSupabaseAuth.signOut.mockResolvedValue({
        error: null,
      });

      const startTime = Date.now();
      const requests = Array(10).fill(null).map(() => 
        POST(new NextRequest('http://localhost/api/auth/logout', {
          method: 'POST',
        }))
      );

      const responses = await Promise.all(requests);
      const endTime = Date.now();

      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Ensure all requests complete in reasonable time (< 1 second)
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should handle logout when Supabase is slow to respond', async () => {
      mockSupabaseAuth.signOut.mockImplementationOnce(async () => {
        // Simulate slow response
        await new Promise(resolve => setTimeout(resolve, 100));
        return { error: null };
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  describe('CORS and redirect scenarios', () => {
    it('should handle logout from different origins', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: null,
      });

      const origins = [
        'http://localhost:3000',
        'https://example.com',
        'https://app.recopyfast.com',
        'null', // File protocol
      ];

      for (const origin of origins) {
        const request = new NextRequest('http://localhost/api/auth/logout', {
          method: 'POST',
          headers: {
            'Origin': origin,
          },
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
      }
    });

    it('should handle logout with referrer headers', async () => {
      mockSupabaseAuth.signOut.mockResolvedValueOnce({
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: {
          'Referer': 'https://app.recopyfast.com/dashboard',
        },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });
});