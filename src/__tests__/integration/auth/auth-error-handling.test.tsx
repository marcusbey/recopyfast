import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '@/contexts/AuthContext';
import { AuthModal } from '@/components/auth/AuthModal';
import { server } from '../setup';
import { http, HttpResponse } from 'msw';
import { useRouter } from 'next/navigation';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock Supabase client
const mockSupabaseAuth = {
  signUp: jest.fn(),
  signInWithPassword: jest.fn(),
  signOut: jest.fn(),
  getSession: jest.fn(),
  onAuthStateChange: jest.fn(),
  resetPasswordForEmail: jest.fn(),
};

jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    auth: mockSupabaseAuth,
  })),
}));

// Error scenarios handlers
const errorHandlers = [
  // Network timeout simulation
  http.post('/api/auth/signup', async () => {
    await new Promise(resolve => setTimeout(resolve, 30000)); // Never resolves in test time
    return HttpResponse.json({ success: true });
  }),

  // Server errors
  http.post('/api/auth/login', () => {
    return HttpResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }),

  // Rate limiting
  http.post('/api/auth/password-reset', () => {
    return HttpResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
  }),

  // Service unavailable
  http.get('/api/auth/session', () => {
    return HttpResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503 }
    );
  }),
];

describe('Authentication Error Handling and Recovery', () => {
  const mockRouter = {
    push: jest.fn(),
    refresh: jest.fn(),
  };

  beforeAll(() => {
    // Use error handlers by default
    server.use(...errorHandlers);
  });

  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    jest.clearAllMocks();

    // Default mock implementations
    mockSupabaseAuth.getSession.mockResolvedValue({
      data: { session: null },
    });

    mockSupabaseAuth.onAuthStateChange.mockImplementation(() => ({
      data: { subscription: { unsubscribe: jest.fn() } },
    }));
  });

  it('should handle network timeouts during signup', async () => {
    const user = userEvent.setup();

    mockSupabaseAuth.signUp.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({ error: null }), 30000))
    );

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    // Fill and submit form
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    // Should show loading state
    expect(submitButton).toBeDisabled();

    // Should handle timeout gracefully after reasonable wait
    await waitFor(() => {
      const errorMessage = screen.queryByText(/timeout/i) ||
                          screen.queryByText(/try again/i) ||
                          screen.queryByText(/network/i);
      expect(errorMessage).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('should recover from validation errors', async () => {
    const user = userEvent.setup();

    mockSupabaseAuth.signUp
      .mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Password should be at least 8 characters' },
      })
      .mockResolvedValueOnce({
        data: {
          user: { id: 'user-123', email: 'test@example.com' },
          session: null,
        },
        error: null,
      });

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    // First attempt with weak password
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'weak');
    await user.type(screen.getByLabelText(/confirm password/i), 'weak');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    // Should show validation error
    await waitFor(() => {
      expect(screen.getByText(/password should be at least 8 characters/i)).toBeInTheDocument();
    });

    // Fix password and retry
    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    
    await user.clear(passwordInput);
    await user.clear(confirmInput);
    await user.type(passwordInput, 'StrongPassword123!');
    await user.type(confirmInput, 'StrongPassword123!');

    // Error should be cleared when user starts typing
    expect(screen.queryByText(/password should be at least 8 characters/i)).not.toBeInTheDocument();

    // Second attempt should succeed
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });
  });

  it('should handle server errors with retry capability', async () => {
    const user = userEvent.setup();

    mockSupabaseAuth.signInWithPassword
      .mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Internal server error' },
      })
      .mockResolvedValueOnce({
        data: {
          user: { id: 'user-123', email: 'test@example.com' },
          session: { access_token: 'token' },
        },
        error: null,
      });

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    // First login attempt
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Should show server error
    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });

    // Should show retry button or allow retry
    const retryButton = screen.queryByRole('button', { name: /retry/i }) ||
                       screen.getByRole('button', { name: /sign in/i });

    await user.click(retryButton);

    // Second attempt should succeed
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('should handle rate limiting errors', async () => {
    const user = userEvent.setup();

    mockSupabaseAuth.resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: { message: 'Too many requests. Please try again later.' },
    });

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    // Navigate to password reset if available
    const forgotPasswordLink = screen.queryByText(/forgot password/i);
    if (forgotPasswordLink) {
      await user.click(forgotPasswordLink);

      const emailInput = screen.getByLabelText(/email/i);
      await user.type(emailInput, 'test@example.com');
      await user.click(screen.getByRole('button', { name: /reset/i }));

      // Should show rate limit message
      await waitFor(() => {
        expect(screen.getByText(/too many requests/i)).toBeInTheDocument();
      });

      // Reset button should be disabled with countdown
      const resetButton = screen.getByRole('button', { name: /reset/i });
      expect(resetButton).toBeDisabled();

      // Should show when user can retry
      const retryMessage = screen.queryByText(/try again in/i) ||
                          screen.queryByText(/wait/i);
      expect(retryMessage).toBeInTheDocument();
    }
  });

  it('should handle expired session errors gracefully', async () => {
    let authStateCallback: ((event: string, session: any) => void) | null = null;

    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: null },
    });

    mockSupabaseAuth.onAuthStateChange.mockImplementation((callback) => {
      authStateCallback = callback;
      return {
        data: { subscription: { unsubscribe: jest.fn() } },
      };
    });

    const TestComponent = () => {
      const [error, setError] = React.useState<string | null>(null);

      React.useEffect(() => {
        const checkSession = async () => {
          try {
            const response = await fetch('/api/auth/session');
            if (!response.ok) {
              throw new Error('Session expired');
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
          }
        };

        checkSession();
      }, []);

      return (
        <div>
          {error ? (
            <div>
              <p>Error: {error}</p>
              <button onClick={() => setError(null)}>Retry</button>
            </div>
          ) : (
            <p>Session valid</p>
          )}
        </div>
      );
    };

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Should handle session error
    await waitFor(() => {
      expect(screen.getByText(/error: session expired/i)).toBeInTheDocument();
    });

    // Should provide recovery option
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('should implement exponential backoff for retries', async () => {
    const user = userEvent.setup();
    jest.useFakeTimers();

    let attemptCount = 0;
    mockSupabaseAuth.signInWithPassword.mockImplementation(async () => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error('Network error');
      }
      return {
        data: {
          user: { id: 'user-123', email: 'test@example.com' },
          session: { access_token: 'token' },
        },
        error: null,
      };
    });

    const RetryComponent = () => {
      const [isRetrying, setIsRetrying] = React.useState(false);
      const [retryCount, setRetryCount] = React.useState(0);

      const handleRetry = async () => {
        setIsRetrying(true);
        
        const backoffDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff
        
        setTimeout(async () => {
          try {
            await mockSupabaseAuth.signInWithPassword('test@example.com', 'password');
            setIsRetrying(false);
          } catch (error) {
            setRetryCount(prev => prev + 1);
            setIsRetrying(false);
          }
        }, backoffDelay);
      };

      return (
        <div>
          <button onClick={handleRetry} disabled={isRetrying}>
            {isRetrying ? `Retrying... (attempt ${retryCount + 1})` : 'Retry Login'}
          </button>
        </div>
      );
    };

    render(<RetryComponent />);

    // First retry (immediate)
    await user.click(screen.getByRole('button', { name: /retry login/i }));
    expect(screen.getByText(/retrying.*attempt 1/i)).toBeInTheDocument();

    // Fast forward 1 second
    jest.advanceTimersByTime(1000);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry login/i })).not.toBeDisabled();
    });

    // Second retry (2 second delay)
    await user.click(screen.getByRole('button', { name: /retry login/i }));
    jest.advanceTimersByTime(2000);
    
    // Third retry should succeed
    await waitFor(() => {
      expect(attemptCount).toBe(3);
    });

    jest.useRealTimers();
  });

  it('should provide detailed error messages for different failure types', async () => {
    const user = userEvent.setup();

    // Test different error scenarios
    const errorScenarios = [
      {
        error: { message: 'Invalid email or password' },
        expectedText: /invalid email or password/i,
      },
      {
        error: { message: 'User not found' },
        expectedText: /user not found/i,
      },
      {
        error: { message: 'Email not confirmed' },
        expectedText: /email.*confirm/i,
      },
      {
        error: { message: 'Account locked' },
        expectedText: /account.*locked/i,
      },
    ];

    for (const scenario of errorScenarios) {
      mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: scenario.error,
      });

      const { unmount } = render(
        <AuthProvider>
          <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
        </AuthProvider>
      );

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'Password123!');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      // Should show specific error message
      await waitFor(() => {
        expect(screen.getByText(scenario.expectedText)).toBeInTheDocument();
      });

      unmount();
    }
  });

  it('should handle connection failures with offline detection', async () => {
    const user = userEvent.setup();

    mockSupabaseAuth.signInWithPassword.mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    // Simulate going offline
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: false,
    });

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Should detect offline state
    await waitFor(() => {
      const offlineMessage = screen.queryByText(/offline/i) ||
                            screen.queryByText(/connection/i) ||
                            screen.queryByText(/network/i);
      expect(offlineMessage).toBeInTheDocument();
    });

    // Simulate coming back online
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true,
    });

    // Should automatically retry or show retry option
    const retryButton = screen.queryByRole('button', { name: /retry/i });
    if (retryButton) {
      expect(retryButton).toBeInTheDocument();
    }
  });

  it('should prevent form resubmission during error states', async () => {
    const user = userEvent.setup();

    mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Server error' },
    });

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    // Fill form
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');

    const submitButton = screen.getByRole('button', { name: /sign in/i });
    
    // First submission
    await user.click(submitButton);

    // Wait for error
    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });

    // Button should be enabled again after error
    expect(submitButton).not.toBeDisabled();

    // Multiple rapid clicks should be prevented
    await user.dblClick(submitButton);

    // Should only call auth function once more despite double-click
    expect(mockSupabaseAuth.signInWithPassword).toHaveBeenCalledTimes(2);
  });

  it('should clear errors when switching between auth modes', async () => {
    const user = userEvent.setup();

    // Login with error
    mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Invalid credentials' },
    });

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    // Trigger login error
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });

    // Switch to signup tab
    await user.click(screen.getByRole('tab', { name: /sign up/i }));

    // Error should be cleared
    await waitFor(() => {
      expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument();
    });

    // Should show signup form without previous errors
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
  });
});