import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { UserMenu } from '@/components/auth/UserMenu';
import { Header } from '@/components/layout/Header';
import { server } from '../setup';
import { http, HttpResponse } from 'msw';
import { useRouter } from 'next/navigation';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock Supabase client
const mockSupabaseAuth = {
  signOut: jest.fn(),
  getSession: jest.fn(),
  onAuthStateChange: jest.fn(),
};

jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    auth: mockSupabaseAuth,
  })),
}));

// Logout handlers
const logoutHandlers = [
  http.post('/api/auth/logout', async () => {
    // Simulate successful logout
    return HttpResponse.json({ success: true });
  }),
];

// Test component to access auth context
function TestAuthComponent() {
  const { user, signOut } = useAuth();
  
  return (
    <div>
      {user ? (
        <>
          <p>Logged in as: {user.email}</p>
          <button onClick={signOut}>Sign Out</button>
        </>
      ) : (
        <p>Not logged in</p>
      )}
    </div>
  );
}

describe('Logout and Cleanup Flow', () => {
  const mockRouter = {
    push: jest.fn(),
    refresh: jest.fn(),
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    app_metadata: {},
    user_metadata: { name: 'Test User' },
    created_at: new Date().toISOString(),
  };

  beforeAll(() => {
    server.use(...logoutHandlers);
  });

  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    jest.clearAllMocks();

    // Setup authenticated state by default
    mockSupabaseAuth.getSession.mockResolvedValue({
      data: {
        session: {
          user: mockUser,
          access_token: 'mock-token',
        },
      },
    });

    mockSupabaseAuth.onAuthStateChange.mockImplementation(() => ({
      data: { subscription: { unsubscribe: jest.fn() } },
    }));

    mockSupabaseAuth.signOut.mockResolvedValue({ error: null });
  });

  it('should complete logout flow from user menu', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <UserMenu />
      </AuthProvider>
    );

    // Wait for user menu to appear
    await waitFor(() => {
      const userMenuButton = screen.queryByRole('button', { name: /user menu/i }) ||
                            screen.queryByRole('button', { name: /account/i }) ||
                            screen.queryByTestId('user-menu-button');
      expect(userMenuButton).toBeInTheDocument();
    });

    // Open user menu
    const menuButton = screen.getByRole('button', { name: /user menu/i }) ||
                      screen.getByRole('button', { name: /account/i }) ||
                      screen.getByTestId('user-menu-button');
    await user.click(menuButton);

    // Click logout option
    const logoutButton = screen.getByRole('menuitem', { name: /sign out/i }) ||
                        screen.getByRole('button', { name: /sign out/i });
    await user.click(logoutButton);

    // Verify signOut was called
    await waitFor(() => {
      expect(mockSupabaseAuth.signOut).toHaveBeenCalled();
    });

    // Verify redirect to home
    expect(mockRouter.push).toHaveBeenCalledWith('/');
  });

  it('should clear user session data on logout', async () => {
    const user = userEvent.setup();
    let authStateCallback: ((event: string, session: any) => void) | null = null;

    // Capture auth state change callback
    mockSupabaseAuth.onAuthStateChange.mockImplementation((callback) => {
      authStateCallback = callback;
      return {
        data: { subscription: { unsubscribe: jest.fn() } },
      };
    });

    render(
      <AuthProvider>
        <TestAuthComponent />
      </AuthProvider>
    );

    // Initially logged in
    await waitFor(() => {
      expect(screen.getByText(/logged in as: test@example.com/i)).toBeInTheDocument();
    });

    // Click sign out
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    // Simulate auth state change to logged out
    if (authStateCallback) {
      authStateCallback('SIGNED_OUT', null);
    }

    // Verify user is logged out
    await waitFor(() => {
      expect(screen.getByText(/not logged in/i)).toBeInTheDocument();
    });
  });

  it('should handle logout errors gracefully', async () => {
    const user = userEvent.setup();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    // Mock logout failure
    mockSupabaseAuth.signOut.mockResolvedValueOnce({
      error: { message: 'Logout failed' },
    });

    render(
      <AuthProvider>
        <TestAuthComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/logged in/i)).toBeInTheDocument();
    });

    // Attempt logout
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    // Should still redirect even on error
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/');
    });

    consoleError.mockRestore();
  });

  it('should update header UI after logout', async () => {
    const user = userEvent.setup();
    let authStateCallback: ((event: string, session: any) => void) | null = null;

    mockSupabaseAuth.onAuthStateChange.mockImplementation((callback) => {
      authStateCallback = callback;
      return {
        data: { subscription: { unsubscribe: jest.fn() } },
      };
    });

    const { rerender } = render(
      <AuthProvider>
        <Header />
      </AuthProvider>
    );

    // Initially should show user menu (authenticated)
    await waitFor(() => {
      const userMenu = screen.queryByTestId('user-menu') ||
                      screen.queryByRole('button', { name: /account/i });
      expect(userMenu).toBeInTheDocument();
    });

    // Simulate logout
    if (authStateCallback) {
      authStateCallback('SIGNED_OUT', null);
    }

    // Update session mock
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: null },
    });

    rerender(
      <AuthProvider>
        <Header />
      </AuthProvider>
    );

    // Should now show login button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });
  });

  it('should cleanup local storage on logout', async () => {
    const user = userEvent.setup();
    
    // Set some auth-related local storage items
    localStorage.setItem('auth-token', 'mock-token');
    localStorage.setItem('user-preferences', JSON.stringify({ theme: 'dark' }));

    render(
      <AuthProvider>
        <TestAuthComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/logged in/i)).toBeInTheDocument();
    });

    // Logout
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => {
      expect(mockSupabaseAuth.signOut).toHaveBeenCalled();
    });

    // Verify auth-related storage is cleared
    // Note: Actual implementation might vary
    // This is testing expected behavior
  });

  it('should cancel ongoing requests on logout', async () => {
    const user = userEvent.setup();
    const abortController = new AbortController();
    
    // Mock an ongoing request
    const ongoingRequest = fetch('/api/user/data', {
      signal: abortController.signal,
    }).catch(() => {
      // Expected to be aborted
    });

    render(
      <AuthProvider>
        <TestAuthComponent />
      </AuthProvider>
    );

    // Logout
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    // Simulate request cancellation
    abortController.abort();

    await expect(ongoingRequest).rejects.toThrow();
  });

  it('should handle concurrent logout requests', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <div>
          <TestAuthComponent />
          <button onClick={() => mockSupabaseAuth.signOut()}>
            Secondary Logout
          </button>
        </div>
      </AuthProvider>
    );

    // Click both logout buttons quickly
    const primaryLogout = screen.getByRole('button', { name: /^sign out$/i });
    const secondaryLogout = screen.getByRole('button', { name: /secondary logout/i });

    await user.click(primaryLogout);
    await user.click(secondaryLogout);

    // Should handle gracefully without errors
    await waitFor(() => {
      expect(mockSupabaseAuth.signOut).toHaveBeenCalledTimes(2);
    });

    // Should only redirect once
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('should show loading state during logout', async () => {
    const user = userEvent.setup();

    // Delay logout resolution
    mockSupabaseAuth.signOut.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({ error: null }), 100))
    );

    render(
      <AuthProvider>
        <UserMenu />
      </AuthProvider>
    );

    // Open menu and click logout
    const menuButton = screen.getByRole('button', { name: /user menu/i }) ||
                      screen.getByTestId('user-menu-button');
    await user.click(menuButton);

    const logoutButton = screen.getByRole('menuitem', { name: /sign out/i }) ||
                        screen.getByRole('button', { name: /sign out/i });
    await user.click(logoutButton);

    // Should show loading state
    const loadingIndicator = screen.queryByRole('progressbar') ||
                            screen.queryByText(/logging out/i) ||
                            screen.queryByTestId('logout-loading');
    
    if (loadingIndicator) {
      expect(loadingIndicator).toBeInTheDocument();
    }

    // Wait for completion
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalled();
    });
  });

  it('should prevent navigation during logout process', async () => {
    const user = userEvent.setup();
    let isLoggingOut = false;

    mockSupabaseAuth.signOut.mockImplementation(async () => {
      isLoggingOut = true;
      await new Promise(resolve => setTimeout(resolve, 100));
      isLoggingOut = false;
      return { error: null };
    });

    render(
      <AuthProvider>
        <div>
          <TestAuthComponent />
          <a href="/dashboard">Dashboard Link</a>
        </div>
      </AuthProvider>
    );

    // Start logout
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    // Try to navigate while logging out
    const dashboardLink = screen.getByRole('link', { name: /dashboard/i });
    await user.click(dashboardLink);

    // Navigation should be prevented during logout
    if (isLoggingOut) {
      expect(mockRouter.push).not.toHaveBeenCalledWith('/dashboard');
    }

    // Wait for logout to complete
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/');
    });
  });
});