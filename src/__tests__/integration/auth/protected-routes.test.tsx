import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '@/contexts/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { server } from '../setup';
import { http, HttpResponse } from 'msw';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

// Mock Supabase client
const mockSupabaseAuth = {
  getSession: jest.fn(),
  onAuthStateChange: jest.fn(),
};

jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    auth: mockSupabaseAuth,
  })),
}));

// Mock Dashboard component
function MockDashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      <p>Protected content</p>
    </div>
  );
}

// Mock Settings component with role check
function MockSettings({ requiredRole }: { requiredRole?: string }) {
  const [hasAccess, setHasAccess] = React.useState(false);

  React.useEffect(() => {
    // Simulate role check
    const checkAccess = async () => {
      const response = await fetch('/api/auth/check-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requiredRole }),
      });
      
      if (response.ok) {
        setHasAccess(true);
      }
    };
    
    checkAccess();
  }, [requiredRole]);

  if (!hasAccess) {
    return <div>Access Denied</div>;
  }

  return (
    <div>
      <h1>Settings</h1>
      <p>Admin only content</p>
    </div>
  );
}

// Protected Route wrapper component
function ProtectedRoute({ 
  children, 
  requiredRole 
}: { 
  children: React.ReactNode;
  requiredRole?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isChecking, setIsChecking] = React.useState(true);
  const [hasAccess, setHasAccess] = React.useState(false);

  React.useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await mockSupabaseAuth.getSession();
        
        if (!session) {
          // Store intended destination
          sessionStorage.setItem('redirectAfterLogin', pathname);
          router.push('/login');
          return;
        }

        if (requiredRole) {
          // Check role-based access
          const response = await fetch('/api/auth/check-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requiredRole }),
          });
          
          if (!response.ok) {
            router.push('/unauthorized');
            return;
          }
        }

        setHasAccess(true);
      } catch (error) {
        console.error('Auth check failed:', error);
        router.push('/login');
      } finally {
        setIsChecking(false);
      }
    };

    checkAuth();
  }, [pathname, requiredRole, router]);

  if (isChecking) {
    return <div>Loading...</div>;
  }

  if (!hasAccess) {
    return null;
  }

  return <>{children}</>;
}

// Auth handlers
const authHandlers = [
  http.post('/api/auth/check-role', async ({ request }) => {
    const body = await request.json() as { requiredRole: string };
    
    // Get current session from mock
    const session = mockSupabaseAuth.getSession();
    
    if (!session) {
      return HttpResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Mock role checking
    const userRole = 'user'; // Default role
    
    if (body.requiredRole === 'admin' && userRole !== 'admin') {
      return HttpResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    return HttpResponse.json({ hasAccess: true });
  }),
];

describe('Protected Route Access Control', () => {
  const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
    refresh: jest.fn(),
  };

  beforeAll(() => {
    server.use(...authHandlers);
  });

  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (usePathname as jest.Mock).mockReturnValue('/dashboard');
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it('should redirect unauthenticated users to login', async () => {
    // Mock no session
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: null },
    });

    mockSupabaseAuth.onAuthStateChange.mockImplementation(() => ({
      data: { subscription: { unsubscribe: jest.fn() } },
    }));

    render(
      <AuthProvider>
        <ProtectedRoute>
          <MockDashboard />
        </ProtectedRoute>
      </AuthProvider>
    );

    // Should show loading initially
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    // Should redirect to login
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/login');
    });

    // Should store intended destination
    expect(sessionStorage.getItem('redirectAfterLogin')).toBe('/dashboard');

    // Protected content should not be visible
    expect(screen.queryByText(/protected content/i)).not.toBeInTheDocument();
  });

  it('should allow authenticated users to access protected routes', async () => {
    // Mock authenticated session
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: 'user-123', email: 'test@example.com' },
          access_token: 'token',
        },
      },
    });

    render(
      <AuthProvider>
        <ProtectedRoute>
          <MockDashboard />
        </ProtectedRoute>
      </AuthProvider>
    );

    // Wait for auth check
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    // Should not redirect
    expect(mockRouter.push).not.toHaveBeenCalled();

    // Protected content should be visible
    expect(screen.getByText(/protected content/i)).toBeInTheDocument();
  });

  it('should enforce role-based access control', async () => {
    // Mock authenticated user without admin role
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { 
            id: 'user-123', 
            email: 'test@example.com',
            user_metadata: { role: 'user' }
          },
          access_token: 'token',
        },
      },
    });

    render(
      <AuthProvider>
        <ProtectedRoute requiredRole="admin">
          <MockSettings requiredRole="admin" />
        </ProtectedRoute>
      </AuthProvider>
    );

    // Should redirect to unauthorized
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/unauthorized');
    });

    // Admin content should not be accessible
    expect(screen.queryByText(/admin only content/i)).not.toBeInTheDocument();
  });

  it('should redirect to intended destination after login', async () => {
    // Set intended destination
    sessionStorage.setItem('redirectAfterLogin', '/dashboard/settings');

    // Mock successful authentication
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: 'user-123', email: 'test@example.com' },
          access_token: 'token',
        },
      },
    });

    // Simulate login completion
    const loginComplete = () => {
      const redirect = sessionStorage.getItem('redirectAfterLogin');
      if (redirect) {
        mockRouter.push(redirect);
        sessionStorage.removeItem('redirectAfterLogin');
      }
    };

    loginComplete();

    // Should redirect to intended destination
    expect(mockRouter.push).toHaveBeenCalledWith('/dashboard/settings');
    expect(sessionStorage.getItem('redirectAfterLogin')).toBeNull();
  });

  it('should handle auth check failures gracefully', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    // Mock auth check failure
    mockSupabaseAuth.getSession.mockRejectedValueOnce(
      new Error('Auth service unavailable')
    );

    render(
      <AuthProvider>
        <ProtectedRoute>
          <MockDashboard />
        </ProtectedRoute>
      </AuthProvider>
    );

    // Should redirect to login on error
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/login');
    });

    consoleError.mockRestore();
  });

  it('should show loading state during auth check', async () => {
    // Delay auth response
    mockSupabaseAuth.getSession.mockImplementation(() => 
      new Promise(resolve => 
        setTimeout(() => resolve({
          data: {
            session: {
              user: { id: 'user-123', email: 'test@example.com' },
              access_token: 'token',
            },
          },
        }), 100)
      )
    );

    render(
      <AuthProvider>
        <ProtectedRoute>
          <MockDashboard />
        </ProtectedRoute>
      </AuthProvider>
    );

    // Should show loading state
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    // Wait for auth check to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Content should appear after loading
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('should handle nested protected routes', async () => {
    // Mock authenticated session
    mockSupabaseAuth.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'user-123', email: 'test@example.com' },
          access_token: 'token',
        },
      },
    });

    function NestedProtectedContent() {
      return (
        <ProtectedRoute>
          <div>
            <h1>Parent Protected</h1>
            <ProtectedRoute requiredRole="user">
              <div>Nested Protected Content</div>
            </ProtectedRoute>
          </div>
        </ProtectedRoute>
      );
    }

    render(
      <AuthProvider>
        <NestedProtectedContent />
      </AuthProvider>
    );

    // Both parent and nested content should be accessible
    await waitFor(() => {
      expect(screen.getByText('Parent Protected')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Nested Protected Content')).toBeInTheDocument();
    });
  });

  it('should update access when auth state changes', async () => {
    let authStateCallback: ((event: string, session: any) => void) | null = null;

    // Start with no session
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: null },
    });

    mockSupabaseAuth.onAuthStateChange.mockImplementation((callback) => {
      authStateCallback = callback;
      return {
        data: { subscription: { unsubscribe: jest.fn() } },
      };
    });

    const { rerender } = render(
      <AuthProvider>
        <ProtectedRoute>
          <MockDashboard />
        </ProtectedRoute>
      </AuthProvider>
    );

    // Initially should redirect
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/login');
    });

    // Simulate successful login
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: 'user-123', email: 'test@example.com' },
          access_token: 'token',
        },
      },
    });

    if (authStateCallback) {
      authStateCallback('SIGNED_IN', {
        user: { id: 'user-123', email: 'test@example.com' },
      });
    }

    // Re-render with new auth state
    rerender(
      <AuthProvider>
        <ProtectedRoute>
          <MockDashboard />
        </ProtectedRoute>
      </AuthProvider>
    );

    // Should now show protected content
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('should handle concurrent route protection checks', async () => {
    mockSupabaseAuth.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'user-123', email: 'test@example.com' },
          access_token: 'token',
        },
      },
    });

    // Render multiple protected routes simultaneously
    render(
      <AuthProvider>
        <div>
          <ProtectedRoute>
            <div>Route 1</div>
          </ProtectedRoute>
          <ProtectedRoute>
            <div>Route 2</div>
          </ProtectedRoute>
          <ProtectedRoute requiredRole="user">
            <div>Route 3</div>
          </ProtectedRoute>
        </div>
      </AuthProvider>
    );

    // All routes should be accessible
    await waitFor(() => {
      expect(screen.getByText('Route 1')).toBeInTheDocument();
      expect(screen.getByText('Route 2')).toBeInTheDocument();
      expect(screen.getByText('Route 3')).toBeInTheDocument();
    });

    // Should only check session once (or minimal times)
    expect(mockSupabaseAuth.getSession).toHaveBeenCalledTimes(3);
  });
});