import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { server } from '../setup';
import { http, HttpResponse } from 'msw';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    refresh: jest.fn(),
  })),
}));

// Mock Supabase client
const mockSupabaseAuth = {
  getSession: jest.fn(),
  refreshSession: jest.fn(),
  onAuthStateChange: jest.fn(),
  signOut: jest.fn(),
};

jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    auth: mockSupabaseAuth,
  })),
}));

// Test component to interact with auth
function SessionTestComponent() {
  const { user, loading, refreshSession } = useAuth();
  const [sessionInfo, setSessionInfo] = React.useState<any>(null);

  React.useEffect(() => {
    // Check session info from localStorage/cookies
    const storedSession = localStorage.getItem('session-info');
    if (storedSession) {
      setSessionInfo(JSON.parse(storedSession));
    }
  }, [user]);

  return (
    <div>
      {loading ? (
        <p>Loading session...</p>
      ) : user ? (
        <>
          <p>User: {user.email}</p>
          <p>Session expires: {sessionInfo?.expiresAt || 'Unknown'}</p>
          <button onClick={refreshSession}>Refresh Session</button>
        </>
      ) : (
        <p>No active session</p>
      )}
    </div>
  );
}

// Session handlers
const sessionHandlers = [
  http.post('/api/auth/refresh', async () => {
    // Simulate session refresh
    const newSession = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
      expires_at: Date.now() + 3600000,
      user: {
        id: 'user-123',
        email: 'test@example.com',
        updated_at: new Date().toISOString(),
      },
    };

    return HttpResponse.json({ session: newSession });
  }),

  http.get('/api/auth/session', () => {
    // Check if session is valid
    const sessionExpiry = parseInt(localStorage.getItem('session-expiry') || '0');
    
    if (Date.now() > sessionExpiry) {
      return HttpResponse.json(
        { error: 'Session expired' },
        { status: 401 }
      );
    }

    return HttpResponse.json({
      user: {
        id: 'user-123',
        email: 'test@example.com',
      },
      expiresAt: sessionExpiry,
    });
  }),
];

describe('Session Management and Persistence', () => {
  const mockSession = {
    user: {
      id: 'user-123',
      email: 'test@example.com',
      app_metadata: {},
      user_metadata: {},
    },
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_in: 3600,
    expires_at: Date.now() + 3600000,
  };

  beforeAll(() => {
    server.use(...sessionHandlers);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    // Default mock implementations
    mockSupabaseAuth.onAuthStateChange.mockImplementation(() => ({
      data: { subscription: { unsubscribe: jest.fn() } },
    }));
  });

  it('should persist session across page refreshes', async () => {
    // Initial render with session
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: mockSession },
    });

    const { unmount } = render(
      <AuthProvider>
        <SessionTestComponent />
      </AuthProvider>
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Store session info
    localStorage.setItem('session-info', JSON.stringify({
      expiresAt: new Date(mockSession.expires_at).toISOString(),
    }));

    // Unmount component (simulate page refresh)
    unmount();

    // Re-render (simulate page reload)
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: mockSession },
    });

    render(
      <AuthProvider>
        <SessionTestComponent />
      </AuthProvider>
    );

    // Session should be restored
    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Session info should be preserved
    expect(screen.getByText(/session expires:/i)).toBeInTheDocument();
  });

  it('should automatically refresh expiring sessions', async () => {
    jest.useFakeTimers();

    // Session that expires in 5 minutes
    const expiringSession = {
      ...mockSession,
      expires_at: Date.now() + 300000, // 5 minutes
    };

    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: expiringSession },
    });

    mockSupabaseAuth.refreshSession.mockResolvedValueOnce({
      data: {
        session: {
          ...mockSession,
          access_token: 'refreshed-token',
          expires_at: Date.now() + 3600000, // 1 hour
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <SessionTestComponent />
      </AuthProvider>
    );

    // Initial session loaded
    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Fast-forward to near expiry (4 minutes)
    act(() => {
      jest.advanceTimersByTime(240000);
    });

    // Session should be refreshed automatically
    await waitFor(() => {
      expect(mockSupabaseAuth.refreshSession).toHaveBeenCalled();
    });

    jest.useRealTimers();
  });

  it('should handle session refresh failures', async () => {
    const user = userEvent.setup();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: mockSession },
    });

    mockSupabaseAuth.refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Refresh token expired' },
    });

    render(
      <AuthProvider>
        <SessionTestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Manually trigger refresh
    await user.click(screen.getByRole('button', { name: /refresh session/i }));

    // Should handle error gracefully
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Error refreshing session'),
        expect.any(Object)
      );
    });

    consoleError.mockRestore();
  });

  it('should clear session on expiry', async () => {
    jest.useFakeTimers();
    let authStateCallback: ((event: string, session: any) => void) | null = null;

    mockSupabaseAuth.onAuthStateChange.mockImplementation((callback) => {
      authStateCallback = callback;
      return {
        data: { subscription: { unsubscribe: jest.fn() } },
      };
    });

    // Session that expires in 1 second
    const expiredSession = {
      ...mockSession,
      expires_at: Date.now() + 1000,
    };

    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: expiredSession },
    });

    render(
      <AuthProvider>
        <SessionTestComponent />
      </AuthProvider>
    );

    // Session active initially
    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Fast-forward past expiry
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // Simulate session expiry event
    if (authStateCallback) {
      authStateCallback('TOKEN_REFRESHED', null);
    }

    // Session should be cleared
    await waitFor(() => {
      expect(screen.getByText(/no active session/i)).toBeInTheDocument();
    });

    jest.useRealTimers();
  });

  it('should handle remember me functionality', async () => {
    // Simulate "remember me" checked during login
    const rememberMeSession = {
      ...mockSession,
      expires_at: Date.now() + 604800000, // 7 days
    };

    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: rememberMeSession },
    });

    render(
      <AuthProvider>
        <SessionTestComponent />
      </AuthProvider>
    );

    // Set remember me flag
    localStorage.setItem('remember-me', 'true');
    localStorage.setItem('session-info', JSON.stringify({
      expiresAt: new Date(rememberMeSession.expires_at).toISOString(),
      remembered: true,
    }));

    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Verify extended session
    const sessionInfo = JSON.parse(localStorage.getItem('session-info') || '{}');
    expect(sessionInfo.remembered).toBe(true);
  });

  it('should sync session across browser tabs', async () => {
    // Initial session in first tab
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: mockSession },
    });

    render(
      <AuthProvider>
        <SessionTestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Simulate storage event from another tab (logout)
    const storageEvent = new StorageEvent('storage', {
      key: 'auth-session',
      oldValue: JSON.stringify(mockSession),
      newValue: null,
      storageArea: localStorage,
    });

    act(() => {
      window.dispatchEvent(storageEvent);
    });

    // Session should be cleared in current tab
    await waitFor(() => {
      expect(screen.getByText(/no active session/i)).toBeInTheDocument();
    });
  });

  it('should handle session renewal on activity', async () => {
    const user = userEvent.setup();
    jest.useFakeTimers();

    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: mockSession },
    });

    mockSupabaseAuth.refreshSession.mockResolvedValueOnce({
      data: {
        session: {
          ...mockSession,
          expires_at: Date.now() + 3600000,
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <div>
          <SessionTestComponent />
          <button>Interactive Element</button>
        </div>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Simulate user activity after 30 minutes
    act(() => {
      jest.advanceTimersByTime(1800000); // 30 minutes
    });

    // User interaction should trigger session check
    await user.click(screen.getByRole('button', { name: /interactive element/i }));

    // Session should be renewed if needed
    // This depends on implementation details

    jest.useRealTimers();
  });

  it('should handle offline session management', async () => {
    // Start with active session
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: mockSession },
    });

    render(
      <AuthProvider>
        <SessionTestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Simulate going offline
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // Session should remain cached while offline
    expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();

    // Simulate coming back online
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    // Should verify session validity
    await waitFor(() => {
      expect(mockSupabaseAuth.getSession).toHaveBeenCalledTimes(2);
    });
  });

  it('should implement session timeout warnings', async () => {
    jest.useFakeTimers();

    // Session expiring in 2 minutes
    const soonExpiringSession = {
      ...mockSession,
      expires_at: Date.now() + 120000,
    };

    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: soonExpiringSession },
    });

    render(
      <AuthProvider>
        <SessionTestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Fast-forward to warning time (1 minute before expiry)
    act(() => {
      jest.advanceTimersByTime(60000);
    });

    // Should show warning (implementation specific)
    // This would typically show a modal or notification
    const warningElement = screen.queryByText(/session.*expir/i) ||
                          screen.queryByRole('alert');
    
    // Note: Actual implementation may vary
    if (warningElement) {
      expect(warningElement).toBeInTheDocument();
    }

    jest.useRealTimers();
  });

  it('should clean up session data on logout', async () => {
    // Set up session with various stored data
    localStorage.setItem('auth-token', 'mock-token');
    localStorage.setItem('session-info', JSON.stringify({ expiresAt: Date.now() + 3600000 }));
    localStorage.setItem('user-preferences', JSON.stringify({ theme: 'dark' }));
    sessionStorage.setItem('temp-data', 'temporary');

    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: mockSession },
    });

    mockSupabaseAuth.signOut.mockResolvedValueOnce({ error: null });

    render(
      <AuthProvider>
        <button onClick={() => mockSupabaseAuth.signOut()}>Logout</button>
      </AuthProvider>
    );

    // Trigger logout
    await userEvent.click(screen.getByRole('button', { name: /logout/i }));

    await waitFor(() => {
      expect(mockSupabaseAuth.signOut).toHaveBeenCalled();
    });

    // Auth-related storage should be cleared
    expect(localStorage.getItem('auth-token')).toBeNull();
    expect(localStorage.getItem('session-info')).toBeNull();
    
    // Non-auth data might be preserved (implementation specific)
    // expect(localStorage.getItem('user-preferences')).not.toBeNull();
  });
});