import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/login/route';
import { createClient } from '@/lib/supabase/server';

// Mock dependencies
jest.mock('@/lib/supabase/server');
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    getAll: jest.fn().mockReturnValue([]),
    set: jest.fn(),
  }),
}));

const mockSupabaseAuth = {
  signInWithPassword: jest.fn(),
};

const mockSupabase = {
  auth: mockSupabaseAuth,
};

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('/api/auth/login - POST', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase as any);
  });

  describe('Successful login scenarios', () => {
    it('should successfully login with valid credentials', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        user_metadata: { name: 'Test User' },
      };
      const mockSession = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
      };

      mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'SecurePass123!',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: mockUser,
        session: mockSession,
      });
      expect(mockSupabaseAuth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'SecurePass123!',
      });
    });

    it('should handle login with trimmed email', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
      };
      const mockSession = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
      };

      mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: '  test@example.com  ',
          password: 'SecurePass123!',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  describe('Failed login scenarios', () => {
    it('should return 401 for invalid credentials', async () => {
      mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'WrongPassword',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        error: 'Invalid login credentials',
      });
    });

    it('should return 401 for non-existent user', async () => {
      mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'AnyPassword123!',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        error: 'Invalid login credentials',
      });
    });
  });

  describe('Validation scenarios', () => {
    it('should return 400 when email is missing', async () => {
      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          password: 'SecurePass123!',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Email and password are required',
      });
      expect(mockSupabaseAuth.signInWithPassword).not.toHaveBeenCalled();
    });

    it('should return 400 when password is missing', async () => {
      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Email and password are required',
      });
      expect(mockSupabaseAuth.signInWithPassword).not.toHaveBeenCalled();
    });

    it('should return 400 when both email and password are missing', async () => {
      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Email and password are required',
      });
    });

    it('should return 400 for empty string email', async () => {
      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: '',
          password: 'SecurePass123!',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Email and password are required',
      });
    });

    it('should return 400 for empty string password', async () => {
      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: '',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Email and password are required',
      });
    });
  });

  describe('Error handling scenarios', () => {
    it('should return 500 for invalid JSON body', async () => {
      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: 'invalid-json',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });

    it('should return 500 when Supabase client creation fails', async () => {
      mockCreateClient.mockRejectedValueOnce(new Error('Supabase connection failed'));

      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'SecurePass123!',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });

    it('should return 500 for unexpected Supabase errors', async () => {
      mockSupabaseAuth.signInWithPassword.mockRejectedValueOnce(
        new Error('Unexpected database error')
      );

      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'SecurePass123!',
        }),
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
    it('should not leak information about user existence', async () => {
      // Both invalid password and non-existent user should return same error
      const invalidPasswordError = { message: 'Invalid login credentials' };
      const nonExistentUserError = { message: 'Invalid login credentials' };

      // Test 1: Invalid password
      mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: invalidPasswordError,
      });

      const request1 = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'existing@example.com',
          password: 'WrongPassword',
        }),
      });

      const response1 = await POST(request1);
      const data1 = await response1.json();

      // Test 2: Non-existent user
      mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: nonExistentUserError,
      });

      const request2 = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'AnyPassword',
        }),
      });

      const response2 = await POST(request2);
      const data2 = await response2.json();

      // Both should return identical error messages
      expect(response1.status).toBe(401);
      expect(response2.status).toBe(401);
      expect(data1).toEqual(data2);
    });

    it('should handle SQL injection attempts in email field', async () => {
      const sqlInjectionAttempts = [
        "test@example.com' OR '1'='1",
        "test@example.com'; DROP TABLE users; --",
        "test@example.com' UNION SELECT * FROM users --",
      ];

      for (const maliciousEmail of sqlInjectionAttempts) {
        mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
          data: { user: null, session: null },
          error: { message: 'Invalid login credentials' },
        });

        const request = new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: maliciousEmail,
            password: 'password',
          }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data).toEqual({
          error: 'Invalid login credentials',
        });
      }
    });

    it('should handle XSS attempts in email field', async () => {
      const xssAttempts = [
        '<script>alert("XSS")</script>@example.com',
        'test@example.com<img src=x onerror=alert("XSS")>',
        'test@example.com\u003cscript\u003ealert("XSS")\u003c/script\u003e',
      ];

      for (const maliciousEmail of xssAttempts) {
        mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
          data: { user: null, session: null },
          error: { message: 'Invalid login credentials' },
        });

        const request = new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: maliciousEmail,
            password: 'password',
          }),
        });

        const response = await POST(request);
        expect(response.status).toBe(401);
      }
    });

    it('should handle extremely long input gracefully', async () => {
      const veryLongEmail = 'a'.repeat(1000) + '@example.com';
      const veryLongPassword = 'p'.repeat(10000);

      mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: veryLongEmail,
          password: veryLongPassword,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({
        error: 'Invalid login credentials',
      });
    });
  });

  describe('Rate limiting and session management', () => {
    it('should handle multiple rapid login attempts', async () => {
      const attempts = 5;
      const promises = [];

      for (let i = 0; i < attempts; i++) {
        mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
          data: { user: null, session: null },
          error: { message: 'Invalid login credentials' },
        });

        const request = new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'wrong-password',
          }),
        });

        promises.push(POST(request));
      }

      const responses = await Promise.all(promises);
      
      responses.forEach(response => {
        expect(response.status).toBe(401);
      });
      
      expect(mockSupabaseAuth.signInWithPassword).toHaveBeenCalledTimes(attempts);
    });

    it('should handle null/undefined values in response', async () => {
      mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: null,
        session: null,
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle special characters in password', async () => {
      const specialPasswords = [
        'Pass@#$%^&*()123',
        'Password with spaces!',
        'パスワード123!', // Japanese characters
        '🔒SecurePass123', // Emoji
        "Pass'word\"123", // Quotes
      ];

      for (const password of specialPasswords) {
        mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
          data: {
            user: { id: 'user-123', email: 'test@example.com' },
            session: { access_token: 'token', refresh_token: 'refresh' },
          },
          error: null,
        });

        const request = new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: 'test@example.com',
            password,
          }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
      }
    });

    it('should handle various email formats', async () => {
      const validEmails = [
        'test@example.com',
        'user+tag@example.com',
        'user.name@example.co.uk',
        'test123@subdomain.example.com',
        'TEST@EXAMPLE.COM', // Uppercase
      ];

      for (const email of validEmails) {
        mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
          data: {
            user: { id: 'user-123', email: email.toLowerCase() },
            session: { access_token: 'token', refresh_token: 'refresh' },
          },
          error: null,
        });

        const request = new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email,
            password: 'password123',
          }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
      }
    });

    it('should handle request with extra fields', async () => {
      mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
        data: {
          user: { id: 'user-123', email: 'test@example.com' },
          session: { access_token: 'token', refresh_token: 'refresh' },
        },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
          extra_field: 'should be ignored',
          another_field: 123,
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      
      // Verify only email and password were passed to Supabase
      expect(mockSupabaseAuth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });
});