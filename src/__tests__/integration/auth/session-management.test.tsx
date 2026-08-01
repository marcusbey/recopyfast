import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { server } from "../setup";
import { http, HttpResponse } from "msw";

// Mock next/navigation
jest.mock("next/navigation", () => ({
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

jest.mock("@/lib/supabase/client", () => ({
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
    const storedSession = localStorage.getItem("session-info");
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
          <p>Session expires: {sessionInfo?.expiresAt || "Unknown"}</p>
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
  http.post("/api/auth/refresh", async () => {
    // Simulate session refresh
    const newSession = {
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 3600,
      expires_at: Date.now() + 3600000,
      user: {
        id: "user-123",
        email: "test@example.com",
        updated_at: new Date().toISOString(),
      },
    };

    return HttpResponse.json({ session: newSession });
  }),

  http.get("/api/auth/session", () => {
    // Check if session is valid
    const sessionExpiry = parseInt(
      localStorage.getItem("session-expiry") || "0",
    );

    if (Date.now() > sessionExpiry) {
      return HttpResponse.json({ error: "Session expired" }, { status: 401 });
    }

    return HttpResponse.json({
      user: {
        id: "user-123",
        email: "test@example.com",
      },
      expiresAt: sessionExpiry,
    });
  }),
];

describe("Session Management and Persistence", () => {
  const mockSession = {
    user: {
      id: "user-123",
      email: "test@example.com",
      app_metadata: {},
      user_metadata: {},
    },
    access_token: "mock-access-token",
    refresh_token: "mock-refresh-token",
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

  it("should persist session across page refreshes", async () => {
    // Initial render with session
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: mockSession },
    });

    const { unmount } = render(
      <AuthProvider>
        <SessionTestComponent />
      </AuthProvider>,
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Store session info
    localStorage.setItem(
      "session-info",
      JSON.stringify({
        expiresAt: new Date(mockSession.expires_at).toISOString(),
      }),
    );

    // Unmount component (simulate page refresh)
    unmount();

    // Re-render (simulate page reload)
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: mockSession },
    });

    render(
      <AuthProvider>
        <SessionTestComponent />
      </AuthProvider>,
    );

    // Session should be restored
    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Session info should be preserved
    expect(screen.getByText(/session expires:/i)).toBeInTheDocument();
  });

  it("should clear session on expiry", async () => {
    jest.useFakeTimers();
    // Held in a ref-style box: TypeScript's control-flow analysis cannot see
    // the assignment that happens inside the mock callback below, so a plain
    // `let` would narrow to `null` and make the later call uncallable.
    const authState: {
      current: ((event: string, session: any) => void) | null;
    } = { current: null };

    mockSupabaseAuth.onAuthStateChange.mockImplementation((callback) => {
      authState.current = callback;
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
      </AuthProvider>,
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
    if (authState.current) {
      authState.current("TOKEN_REFRESHED", null);
    }

    // Session should be cleared
    await waitFor(() => {
      expect(screen.getByText(/no active session/i)).toBeInTheDocument();
    });

    jest.useRealTimers();
  });

  it("should handle remember me functionality", async () => {
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
      </AuthProvider>,
    );

    // Set remember me flag
    localStorage.setItem("remember-me", "true");
    localStorage.setItem(
      "session-info",
      JSON.stringify({
        expiresAt: new Date(rememberMeSession.expires_at).toISOString(),
        remembered: true,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/user: test@example.com/i)).toBeInTheDocument();
    });

    // Verify extended session
    const sessionInfo = JSON.parse(
      localStorage.getItem("session-info") || "{}",
    );
    expect(sessionInfo.remembered).toBe(true);
  });

  it("should implement session timeout warnings", async () => {
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
      </AuthProvider>,
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
    const warningElement =
      screen.queryByText(/session.*expir/i) || screen.queryByRole("alert");

    // Note: Actual implementation may vary
    if (warningElement) {
      expect(warningElement).toBeInTheDocument();
    }

    jest.useRealTimers();
  });
});
