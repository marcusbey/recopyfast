import { server } from '../setup';
import { http, HttpResponse } from 'msw';

// Additional auth-specific handlers for testing edge cases
export const authTestHandlers = [
  // Network error simulation
  http.post('/api/auth/network-error', () => {
    return HttpResponse.error();
  }),

  // Timeout simulation  
  http.post('/api/auth/timeout', async () => {
    await new Promise(resolve => setTimeout(resolve, 30000));
    return HttpResponse.json({ success: true });
  }),

  // Email confirmation
  http.post('/api/auth/confirm-email', async ({ request }) => {
    const body = await request.json() as { token: string };
    
    if (!body.token || body.token === 'invalid-token') {
      return HttpResponse.json(
        { error: 'Invalid or expired token' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      user: {
        id: 'user-123',
        email: 'test@example.com',
        email_confirmed_at: new Date().toISOString(),
      },
      message: 'Email confirmed successfully',
    });
  }),

  // Password strength check
  http.post('/api/auth/check-password-strength', async ({ request }) => {
    const body = await request.json() as { password: string };
    
    const password = body.password;
    const strength = {
      score: 0,
      feedback: [] as string[],
    };

    if (password.length < 8) {
      strength.feedback.push('Password should be at least 8 characters long');
    } else {
      strength.score += 1;
    }

    if (!/[A-Z]/.test(password)) {
      strength.feedback.push('Password should contain at least one uppercase letter');
    } else {
      strength.score += 1;
    }

    if (!/[a-z]/.test(password)) {
      strength.feedback.push('Password should contain at least one lowercase letter');
    } else {
      strength.score += 1;
    }

    if (!/[0-9]/.test(password)) {
      strength.feedback.push('Password should contain at least one number');
    } else {
      strength.score += 1;
    }

    if (!/[^A-Za-z0-9]/.test(password)) {
      strength.feedback.push('Password should contain at least one special character');
    } else {
      strength.score += 1;
    }

    return HttpResponse.json({ strength });
  }),

  // Two-factor authentication
  http.post('/api/auth/2fa/verify', async ({ request }) => {
    const body = await request.json() as { code: string };
    
    if (body.code !== '123456') {
      return HttpResponse.json(
        { error: 'Invalid verification code' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      success: true,
      message: '2FA verified successfully',
    });
  }),

  // Social auth simulation
  http.post('/api/auth/social/google', async () => {
    return HttpResponse.json({
      user: {
        id: 'google-user-123',
        email: 'test@gmail.com',
        app_metadata: { provider: 'google' },
        user_metadata: {
          name: 'Google User',
          avatar_url: 'https://example.com/avatar.jpg',
        },
      },
      session: {
        access_token: 'google-access-token',
        provider_token: 'google-provider-token',
      },
    });
  }),

  // Account deletion
  http.delete('/api/auth/account', async () => {
    return HttpResponse.json({
      success: true,
      message: 'Account deleted successfully',
    });
  }),

  // Update profile
  http.put('/api/auth/profile', async ({ request }) => {
    const body = await request.json() as { name?: string; email?: string };
    
    return HttpResponse.json({
      user: {
        id: 'user-123',
        email: body.email || 'test@example.com',
        user_metadata: {
          name: body.name || 'Test User',
        },
        updated_at: new Date().toISOString(),
      },
    });
  }),

  // Change password
  http.post('/api/auth/change-password', async ({ request }) => {
    const body = await request.json() as { 
      currentPassword: string; 
      newPassword: string; 
    };
    
    if (body.currentPassword !== 'current-password') {
      return HttpResponse.json(
        { error: 'Current password is incorrect' },
        { status: 400 }
      );
    }

    if (body.newPassword.length < 8) {
      return HttpResponse.json(
        { error: 'New password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      success: true,
      message: 'Password changed successfully',
    });
  }),
];

// Mock user data for testing
export const mockUsers = {
  validUser: {
    id: 'user-123',
    email: 'test@example.com',
    app_metadata: { provider: 'email' },
    user_metadata: { name: 'Test User' },
    created_at: new Date().toISOString(),
    email_confirmed_at: new Date().toISOString(),
  },
  unconfirmedUser: {
    id: 'user-456',
    email: 'unconfirmed@example.com',
    app_metadata: { provider: 'email' },
    user_metadata: { name: 'Unconfirmed User' },
    created_at: new Date().toISOString(),
    email_confirmed_at: null,
  },
  adminUser: {
    id: 'admin-123',
    email: 'admin@example.com',
    app_metadata: { 
      provider: 'email',
      role: 'admin',
    },
    user_metadata: { name: 'Admin User' },
    created_at: new Date().toISOString(),
    email_confirmed_at: new Date().toISOString(),
  },
};

// Mock sessions for testing
export const mockSessions = {
  validSession: {
    access_token: 'valid-access-token',
    refresh_token: 'valid-refresh-token',
    expires_in: 3600,
    expires_at: Date.now() + 3600000,
    user: mockUsers.validUser,
  },
  expiredSession: {
    access_token: 'expired-access-token',
    refresh_token: 'expired-refresh-token',
    expires_in: 3600,
    expires_at: Date.now() - 1000, // Expired 1 second ago
    user: mockUsers.validUser,
  },
  longSession: {
    access_token: 'long-access-token',
    refresh_token: 'long-refresh-token',
    expires_in: 604800, // 7 days
    expires_at: Date.now() + 604800000,
    user: mockUsers.validUser,
  },
};

// Helper functions for auth testing
export const authTestUtils = {
  // Set up authenticated user
  setAuthenticatedUser: (user = mockUsers.validUser, session = mockSessions.validSession) => {
    localStorage.setItem('auth-user', JSON.stringify(user));
    localStorage.setItem('auth-session', JSON.stringify(session));
  },

  // Clear auth state
  clearAuthState: () => {
    localStorage.removeItem('auth-user');
    localStorage.removeItem('auth-session');
    localStorage.removeItem('session-expiry');
    localStorage.removeItem('remember-me');
    sessionStorage.clear();
  },

  // Set session expiry
  setSessionExpiry: (expiryTime: number) => {
    localStorage.setItem('session-expiry', expiryTime.toString());
  },

  // Simulate network conditions
  simulateNetworkConditions: (condition: 'offline' | 'slow' | 'timeout') => {
    switch (condition) {
      case 'offline':
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
        break;
      case 'slow':
        // Add delay to all requests
        server.use(
          http.all('*', async (req) => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            return req.passthrough();
          })
        );
        break;
      case 'timeout':
        // Make all requests timeout
        server.use(
          http.all('*', async () => {
            await new Promise(resolve => setTimeout(resolve, 30000));
            return HttpResponse.json({ error: 'Timeout' }, { status: 408 });
          })
        );
        break;
    }
  },

  // Reset network conditions
  resetNetworkConditions: () => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
    // Reset server to default handlers
    server.resetHandlers();
  },

  // Create form validation errors
  createValidationError: (field: string, message: string) => ({
    field,
    message,
    code: 'validation_error',
  }),

  // Create auth error
  createAuthError: (type: 'invalid_credentials' | 'user_not_found' | 'email_not_confirmed' | 'account_locked', message?: string) => ({
    type,
    message: message || getDefaultErrorMessage(type),
  }),
};

function getDefaultErrorMessage(type: string): string {
  switch (type) {
    case 'invalid_credentials':
      return 'Invalid email or password';
    case 'user_not_found':
      return 'User not found';
    case 'email_not_confirmed':
      return 'Please confirm your email address';
    case 'account_locked':
      return 'Account has been locked due to multiple failed login attempts';
    default:
      return 'An authentication error occurred';
  }
}

// Setup function to be called before auth tests
export const setupAuthTests = () => {
  // Add auth-specific handlers
  server.use(...authTestHandlers);
  
  // Clear any existing auth state
  authTestUtils.clearAuthState();
  
  // Reset network conditions
  authTestUtils.resetNetworkConditions();
};

// Cleanup function to be called after auth tests
export const cleanupAuthTests = () => {
  authTestUtils.clearAuthState();
  authTestUtils.resetNetworkConditions();
};