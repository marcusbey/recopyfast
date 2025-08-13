import { NextRequest } from 'next/server';
import { GET } from '@/app/api/auth/session/route';
import { createClient } from '@/lib/supabase/server';

// Mock dependencies
jest.mock('@/lib/supabase/server');

const mockSupabaseAuth = {
  getUser: jest.fn(),
  getSession: jest.fn(),
  refreshSession: jest.fn(),
};

const mockSupabase = {
  auth: mockSupabaseAuth,
};

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('/api/auth/session - GET', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase as ReturnType<typeof createClient>);
  });

  describe('Successful session retrieval', () => {
    it('should return user data for authenticated session', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        email_confirmed_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        user_metadata: {
          name: 'Test User',
          avatar_url: 'https://example.com/avatar.jpg',
        },
      };

      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: mockUser },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer valid-token',
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: mockUser,
      });
      expect(mockSupabaseAuth.getUser).toHaveBeenCalled();
    });

    it('should handle session check without Authorization header', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
      };

      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: mockUser },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: mockUser,
      });
    });

    it('should return user with full metadata', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        email_confirmed_at: '2024-01-01T00:00:00Z',
        phone: '+1234567890',
        phone_confirmed_at: '2024-01-01T00:00:00Z',
        confirmed_at: '2024-01-01T00:00:00Z',
        last_sign_in_at: '2024-01-02T00:00:00Z',
        role: 'authenticated',
        user_metadata: {
          name: 'Test User',
          avatar_url: 'https://example.com/avatar.jpg',
          preferences: {
            theme: 'dark',
            language: 'en',
          },
        },
        app_metadata: {
          provider: 'email',
          providers: ['email'],
        },
      };

      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: mockUser },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: mockUser,
      });
    });
  });

  describe('No session scenarios', () => {
    it('should return null user when no session exists', async () => {
      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: null,
      });
    });

    it('should return null user when session is expired', async () => {
      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Session expired' },
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: null,
      });
    });

    it('should return null user for invalid token', async () => {
      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer invalid-token',
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: null,
      });
    });
  });

  describe('Error handling scenarios', () => {
    it('should return 500 when Supabase client creation fails', async () => {
      mockCreateClient.mockRejectedValueOnce(new Error('Supabase connection failed'));

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });

    it('should return 500 for unexpected errors', async () => {
      mockSupabaseAuth.getUser.mockRejectedValueOnce(
        new Error('Unexpected database error')
      );

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });

    it('should handle when getUser returns unexpected format', async () => {
      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: null as unknown as { user: null },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });
  });

  describe('Security scenarios', () => {
    it('should not leak sensitive information in errors', async () => {
      const sensitiveErrors = [
        { message: 'Database connection string: postgresql://...' },
        { message: 'API key: sk_test_...' },
        { message: 'Internal server configuration: {...}' },
      ];

      for (const error of sensitiveErrors) {
        mockSupabaseAuth.getUser.mockResolvedValueOnce({
          data: { user: null },
          error,
        });

        const request = new NextRequest('http://localhost/api/auth/session', {
          method: 'GET',
        });

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          user: null,
        });
        expect(data.error).toBeUndefined();
      }
    });

    it('should handle various authorization header formats', async () => {
      const authHeaders = [
        'Bearer valid-token',
        'bearer VALID-TOKEN', // lowercase bearer
        'Token abc123', // Different scheme
        'Basic dXNlcjpwYXNz', // Basic auth
        'Bearer ', // Empty token
        'InvalidFormat', // No scheme
      ];

      for (const authHeader of authHeaders) {
        mockSupabaseAuth.getUser.mockResolvedValueOnce({
          data: { user: null },
          error: null,
        });

        const request = new NextRequest('http://localhost/api/auth/session', {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
          },
        });

        const response = await GET(request);
        expect(response.status).toBe(200);
      }
    });

    it('should handle JWT token manipulation attempts', async () => {
      const manipulatedTokens = [
        'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fake',
        'Bearer malformed.jwt.token',
        'Bearer ../../../etc/passwd',
        'Bearer null',
        'Bearer undefined',
        'Bearer <script>alert("XSS")</script>',
      ];

      for (const token of manipulatedTokens) {
        mockSupabaseAuth.getUser.mockResolvedValueOnce({
          data: { user: null },
          error: { message: 'Invalid token' },
        });

        const request = new NextRequest('http://localhost/api/auth/session', {
          method: 'GET',
          headers: {
            'Authorization': token,
          },
        });

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({
          user: null,
        });
      }
    });
  });

  describe('Session refresh scenarios', () => {
    it('should handle concurrent session checks', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
      };

      mockSupabaseAuth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const requests = Array(10).fill(null).map(() =>
        new NextRequest('http://localhost/api/auth/session', {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer valid-token',
          },
        })
      );

      const responses = await Promise.all(
        requests.map(request => GET(request))
      );

      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      expect(mockSupabaseAuth.getUser).toHaveBeenCalledTimes(10);
    });

    it('should handle session check during token refresh', async () => {
      // First call returns expired error
      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Token expired' },
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer expired-token',
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: null,
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle extremely long tokens', async () => {
      const longToken = 'Bearer ' + 'a'.repeat(10000);

      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
        headers: {
          'Authorization': longToken,
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: null,
      });
    });

    it('should handle session check with custom headers', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
      };

      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: mockUser },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Request-ID': '12345',
          'User-Agent': 'Custom-Agent/1.0',
        },
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
    });

    it('should handle session check from different origins', async () => {
      const origins = [
        'http://localhost:3000',
        'https://example.com',
        'https://app.recopyfast.com',
        'null',
      ];

      for (const origin of origins) {
        mockSupabaseAuth.getUser.mockResolvedValueOnce({
          data: { user: null },
          error: null,
        });

        const request = new NextRequest('http://localhost/api/auth/session', {
          method: 'GET',
          headers: {
            'Origin': origin,
          },
        });

        const response = await GET(request);
        expect(response.status).toBe(200);
      }
    });

    it('should handle user with special characters in email', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test+special@example.com',
      };

      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: mockUser },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: mockUser,
      });
    });

    it('should handle user with unicode characters in metadata', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        user_metadata: {
          name: '山田太郎',
          bio: 'Hello 👋 World 🌍',
          company: 'Société Française',
        },
      };

      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: mockUser },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: mockUser,
      });
    });
  });

  describe('Performance scenarios', () => {
    it('should handle slow Supabase responses', async () => {
      mockSupabaseAuth.getUser.mockImplementationOnce(async () => {
        // Simulate slow response
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          data: { user: { id: 'user-123', email: 'test@example.com' } },
          error: null,
        };
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
      });

      const startTime = Date.now();
      const response = await GET(request);
      const endTime = Date.now();

      expect(response.status).toBe(200);
      expect(endTime - startTime).toBeGreaterThanOrEqual(100);
    });

    it('should handle rapid successive session checks', async () => {
      mockSupabaseAuth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      });

      const startTime = Date.now();
      const requests = Array(20).fill(null).map(() =>
        GET(new NextRequest('http://localhost/api/auth/session', {
          method: 'GET',
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
  });

  describe('Cookie handling', () => {
    it('should handle session check with cookies', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
      };

      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: mockUser },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
        headers: {
          'Cookie': 'sb-access-token=valid-token; sb-refresh-token=refresh-token',
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: mockUser,
      });
    });

    it('should handle malformed cookies', async () => {
      mockSupabaseAuth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/session', {
        method: 'GET',
        headers: {
          'Cookie': 'invalid-cookie-format;;;===',
        },
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: null,
      });
    });
  });
});