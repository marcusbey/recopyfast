import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/signup/route';
import { createClient } from '@/lib/supabase/server';

// Mock dependencies
jest.mock('@/lib/supabase/server');

const mockSupabaseAuth = {
  signUp: jest.fn(),
};

const mockSupabase = {
  auth: mockSupabaseAuth,
};

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('/api/auth/signup - POST', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase as ReturnType<typeof createClient>);
    process.env.NEXT_PUBLIC_APP_URL = 'https://recopyfast.com';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  describe('Successful signup scenarios', () => {
    it('should successfully sign up a new user', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'newuser@example.com',
        email_confirmed_at: null,
        created_at: '2024-01-01T00:00:00Z',
      };

      mockSupabaseAuth.signUp.mockResolvedValueOnce({
        data: {
          user: mockUser,
          session: null, // No session until email confirmed
        },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'newuser@example.com',
          password: 'SecurePass123!',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        user: mockUser,
        message: 'Check your email to confirm your account',
      });
      expect(mockSupabaseAuth.signUp).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        options: {
          data: {},
          emailRedirectTo: 'https://recopyfast.com/auth/callback',
        },
      });
    });

    it('should successfully sign up with metadata', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'newuser@example.com',
        user_metadata: { name: 'Test User', company: 'TestCorp' },
      };

      mockSupabaseAuth.signUp.mockResolvedValueOnce({
        data: { user: mockUser, session: null },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'newuser@example.com',
          password: 'SecurePass123!',
          metadata: {
            name: 'Test User',
            company: 'TestCorp',
          },
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user).toEqual(mockUser);
      expect(mockSupabaseAuth.signUp).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        options: {
          data: {
            name: 'Test User',
            company: 'TestCorp',
          },
          emailRedirectTo: 'https://recopyfast.com/auth/callback',
        },
      });
    });

    it('should handle trimmed email addresses', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'newuser@example.com',
      };

      mockSupabaseAuth.signUp.mockResolvedValueOnce({
        data: { user: mockUser, session: null },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: '  newuser@example.com  ',
          password: 'SecurePass123!',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  describe('Failed signup scenarios', () => {
    it('should return 400 for duplicate email', async () => {
      mockSupabaseAuth.signUp.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'User already registered' },
      });

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'existing@example.com',
          password: 'SecurePass123!',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'User already registered',
      });
    });

    it('should return 400 for weak password', async () => {
      mockSupabaseAuth.signUp.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Password should be at least 6 characters' },
      });

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'newuser@example.com',
          password: '123',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Password should be at least 6 characters',
      });
    });

    it('should return 400 for invalid email format', async () => {
      mockSupabaseAuth.signUp.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid email format' },
      });

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'SecurePass123!',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Invalid email format',
      });
    });
  });

  describe('Validation scenarios', () => {
    it('should return 400 when email is missing', async () => {
      const request = new NextRequest('http://localhost/api/auth/signup', {
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
      expect(mockSupabaseAuth.signUp).not.toHaveBeenCalled();
    });

    it('should return 400 when password is missing', async () => {
      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'newuser@example.com',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Email and password are required',
      });
      expect(mockSupabaseAuth.signUp).not.toHaveBeenCalled();
    });

    it('should return 400 for empty string email', async () => {
      const request = new NextRequest('http://localhost/api/auth/signup', {
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
      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'newuser@example.com',
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

    it('should return 400 for null values', async () => {
      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: null,
          password: null,
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
      const request = new NextRequest('http://localhost/api/auth/signup', {
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

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'newuser@example.com',
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
      mockSupabaseAuth.signUp.mockRejectedValueOnce(
        new Error('Unexpected database error')
      );

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'newuser@example.com',
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
    it('should handle SQL injection attempts in email field', async () => {
      const sqlInjectionAttempts = [
        "test@example.com' OR '1'='1",
        "test@example.com'; DROP TABLE users; --",
        "test@example.com' UNION SELECT * FROM users --",
        "admin'--@example.com",
      ];

      for (const maliciousEmail of sqlInjectionAttempts) {
        mockSupabaseAuth.signUp.mockResolvedValueOnce({
          data: { user: null, session: null },
          error: { message: 'Invalid email format' },
        });

        const request = new NextRequest('http://localhost/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: maliciousEmail,
            password: 'password123',
          }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBeDefined();
      }
    });

    it('should handle XSS attempts in email and metadata', async () => {
      const xssAttempts = [
        {
          email: '<script>alert("XSS")</script>@example.com',
          metadata: { name: '<script>alert("XSS")</script>' },
        },
        {
          email: 'test@example.com<img src=x onerror=alert("XSS")>',
          metadata: { company: '<img src=x onerror=alert("XSS")>' },
        },
      ];

      for (const attempt of xssAttempts) {
        mockSupabaseAuth.signUp.mockResolvedValueOnce({
          data: { user: null, session: null },
          error: { message: 'Invalid input' },
        });

        const request = new NextRequest('http://localhost/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: attempt.email,
            password: 'password123',
            metadata: attempt.metadata,
          }),
        });

        const response = await POST(request);
        expect(response.status).toBe(400);
      }
    });

    it('should handle extremely long input gracefully', async () => {
      const veryLongEmail = 'a'.repeat(1000) + '@example.com';
      const veryLongPassword = 'p'.repeat(10000);
      const veryLongMetadata = {
        name: 'n'.repeat(5000),
        bio: 'b'.repeat(10000),
      };

      mockSupabaseAuth.signUp.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Input too long' },
      });

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: veryLongEmail,
          password: veryLongPassword,
          metadata: veryLongMetadata,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('should validate password strength requirements', async () => {
      const weakPasswords = [
        '123456', // Too simple
        'password', // Common password
        'qwerty', // Keyboard pattern
        'abc123', // Too predictable
        '12345678', // Sequential numbers
      ];

      for (const weakPassword of weakPasswords) {
        mockSupabaseAuth.signUp.mockResolvedValueOnce({
          data: { user: null, session: null },
          error: { message: 'Password is too weak' },
        });

        const request = new NextRequest('http://localhost/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: 'newuser@example.com',
            password: weakPassword,
          }),
        });

        const response = await POST(request);
        expect(response.status).toBe(400);
      }
    });
  });

  describe('Email validation scenarios', () => {
    it('should reject invalid email formats', async () => {
      const invalidEmails = [
        'notanemail',
        '@example.com',
        'user@',
        'user@.com',
        'user@example',
        'user @example.com',
        'user@@example.com',
        'user@example..com',
        'user.@example.com',
        '.user@example.com',
      ];

      for (const invalidEmail of invalidEmails) {
        mockSupabaseAuth.signUp.mockResolvedValueOnce({
          data: { user: null, session: null },
          error: { message: 'Invalid email format' },
        });

        const request = new NextRequest('http://localhost/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: invalidEmail,
            password: 'SecurePass123!',
          }),
        });

        const response = await POST(request);
        expect(response.status).toBe(400);
      }
    });

    it('should accept various valid email formats', async () => {
      const validEmails = [
        'user@example.com',
        'user+tag@example.com',
        'user.name@example.com',
        'user_name@example.com',
        'user123@example.com',
        'user@subdomain.example.com',
        'user@example.co.uk',
        'user@example.travel',
      ];

      for (const validEmail of validEmails) {
        mockSupabaseAuth.signUp.mockResolvedValueOnce({
          data: {
            user: { id: 'user-123', email: validEmail },
            session: null,
          },
          error: null,
        });

        const request = new NextRequest('http://localhost/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: validEmail,
            password: 'SecurePass123!',
          }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
      }
    });
  });

  describe('Rate limiting scenarios', () => {
    it('should handle multiple signup attempts from same IP', async () => {
      const attempts = 10;
      const results = [];

      for (let i = 0; i < attempts; i++) {
        mockSupabaseAuth.signUp.mockResolvedValueOnce({
          data: { user: null, session: null },
          error: { message: 'Too many signup attempts' },
        });

        const request = new NextRequest('http://localhost/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: `user${i}@example.com`,
            password: 'SecurePass123!',
          }),
          headers: {
            'X-Forwarded-For': '192.168.1.1',
          },
        });

        const response = await POST(request);
        results.push(response);
      }

      // All attempts should be handled gracefully
      results.forEach(response => {
        expect([200, 400]).toContain(response.status);
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle signup with complex metadata', async () => {
      const complexMetadata = {
        name: 'Test User',
        preferences: {
          theme: 'dark',
          language: 'en',
          notifications: {
            email: true,
            push: false,
          },
        },
        tags: ['developer', 'beta-tester'],
        joinedAt: new Date().toISOString(),
      };

      mockSupabaseAuth.signUp.mockResolvedValueOnce({
        data: {
          user: {
            id: 'user-123',
            email: 'newuser@example.com',
            user_metadata: complexMetadata,
          },
          session: null,
        },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'newuser@example.com',
          password: 'SecurePass123!',
          metadata: complexMetadata,
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should handle signup when emailRedirectTo is not set', async () => {
      delete process.env.NEXT_PUBLIC_APP_URL;

      mockSupabaseAuth.signUp.mockResolvedValueOnce({
        data: {
          user: { id: 'user-123', email: 'newuser@example.com' },
          session: null,
        },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'newuser@example.com',
          password: 'SecurePass123!',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      
      // Check that emailRedirectTo uses undefined when env var is not set
      expect(mockSupabaseAuth.signUp).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        options: {
          data: {},
          emailRedirectTo: 'undefined/auth/callback',
        },
      });
    });

    it('should handle special characters in password', async () => {
      const specialPasswords = [
        'Pass@#$%^&*()123!',
        'Password with spaces 123!',
        'パスワード123!@#', // Japanese characters
        '🔒🔑SecurePass123', // Emojis
        "Pass'word\"123!@", // Quotes
        'Pass\\word/123!@', // Slashes
      ];

      for (const password of specialPasswords) {
        mockSupabaseAuth.signUp.mockResolvedValueOnce({
          data: {
            user: { id: 'user-123', email: 'newuser@example.com' },
            session: null,
          },
          error: null,
        });

        const request = new NextRequest('http://localhost/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: 'newuser@example.com',
            password,
          }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
      }
    });

    it('should handle request with extra fields', async () => {
      mockSupabaseAuth.signUp.mockResolvedValueOnce({
        data: {
          user: { id: 'user-123', email: 'newuser@example.com' },
          session: null,
        },
        error: null,
      });

      const request = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'newuser@example.com',
          password: 'SecurePass123!',
          extra_field: 'should be ignored',
          another_field: 123,
          nested: { field: 'value' },
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      
      // Verify only expected fields were passed to Supabase
      expect(mockSupabaseAuth.signUp).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        options: {
          data: {},
          emailRedirectTo: 'https://recopyfast.com/auth/callback',
        },
      });
    });
  });
});