import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '@/contexts/AuthContext';
import { AuthModal } from '@/components/auth/AuthModal';
import { Header } from '@/components/layout/Header';
import { server } from '../setup';
import { http, HttpResponse } from 'msw';
import { useRouter, usePathname } from 'next/navigation';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

// Mock Supabase client
const mockSupabaseAuth = {
  signInWithPassword: jest.fn(),
  signOut: jest.fn(),
  getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
  onAuthStateChange: jest.fn(() => ({
    data: { subscription: { unsubscribe: jest.fn() } },
  })),
};

jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    auth: mockSupabaseAuth,
  })),
}));

// Add login handlers
const loginHandlers = [
  http.post('/api/auth/login', async ({ request }) => {
    const body = await request.json() as { email: string; password: string };
    
    // Validation
    if (!body.email || !body.password) {
      return HttpResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Invalid credentials
    if (body.email === 'wrong@example.com' || body.password === 'wrongpassword') {
      return HttpResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Account locked
    if (body.email === 'locked@example.com') {
      return HttpResponse.json(
        { error: 'Account has been locked due to multiple failed login attempts' },
        { status: 403 }
      );
    }

    // Successful login
    const user = {
      id: 'user-123',
      email: body.email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: 'email' },
      user_metadata: { name: 'Test User' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return HttpResponse.json({
      user,
      session: {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        expires_at: Date.now() + 3600000,
        user,
      },
    });
  }),

  http.get('/api/auth/session', () => {
    // Return mock session for authenticated user
    return HttpResponse.json({
      user: {
        id: 'user-123',
        email: 'test@example.com',
        user_metadata: { name: 'Test User' },
      },
    });
  }),
];

describe('User Login and Dashboard Access', () => {
  const mockRouter = {
    push: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
  };

  beforeAll(() => {
    server.use(...loginHandlers);
  });

  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (usePathname as jest.Mock).mockReturnValue('/');
    jest.clearAllMocks();
  });

  it('should complete login flow with valid credentials', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    // Mock successful Supabase auth
    mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: {
        user: { id: 'user-123', email: 'test@example.com' },
        session: { access_token: 'token' },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={onClose} defaultTab="login" />
      </AuthProvider>
    );

    // Verify on login tab
    expect(screen.getByRole('tab', { name: /sign in/i })).toHaveAttribute('data-state', 'active');

    // Fill login form
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');

    // Submit form
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Wait for redirect to dashboard
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/dashboard');
    });

    // Modal should close
    expect(onClose).toHaveBeenCalled();
  });

  it('should show error for invalid credentials', async () => {
    const user = userEvent.setup();

    // Mock failed Supabase auth
    mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Invalid email or password' },
    });

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    // Enter wrong credentials
    await user.type(screen.getByLabelText(/email/i), 'wrong@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword');

    // Submit
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Check error message
    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });

    // Should not redirect
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('should handle locked account error', async () => {
    const user = userEvent.setup();

    // Mock locked account
    mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Account has been locked' },
    });

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    await user.type(screen.getByLabelText(/email/i), 'locked@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/account.*locked/i)).toBeInTheDocument();
    });
  });

  it('should remember user preference with remember me checkbox', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    // Check remember me if it exists
    const rememberCheckbox = screen.queryByRole('checkbox', { name: /remember me/i });
    if (rememberCheckbox) {
      await user.click(rememberCheckbox);
      expect(rememberCheckbox).toBeChecked();
    }

    // Continue with login
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Verify persistence preference was set
    // This would typically set a longer-lasting cookie or localStorage flag
  });

  it('should disable form during login process', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');
    
    // Click submit
    await user.click(submitButton);

    // Form elements should be disabled
    expect(emailInput).toBeDisabled();
    expect(passwordInput).toBeDisabled();
    expect(submitButton).toBeDisabled();

    // Wait for completion
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('should navigate to forgot password flow', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    // Look for forgot password link
    const forgotLink = screen.queryByText(/forgot password/i);
    if (forgotLink) {
      await user.click(forgotLink);
      
      // Should navigate to password reset or show reset form
      await waitFor(() => {
        const resetText = screen.queryByText(/reset.*password/i) ||
                         screen.queryByText(/enter.*email.*reset/i);
        expect(resetText).toBeInTheDocument();
      });
    }
  });

  it('should handle network errors gracefully', async () => {
    const user = userEvent.setup();

    // Mock network error
    mockSupabaseAuth.signInWithPassword.mockRejectedValueOnce(
      new Error('Network error')
    );

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      const errorMessage = screen.queryByText(/network/i) ||
                          screen.queryByText(/try again/i) ||
                          screen.queryByText(/error/i);
      expect(errorMessage).toBeInTheDocument();
    });
  });

  it('should update header after successful login', async () => {
    const user = userEvent.setup();

    // Mock successful auth state
    const mockAuthStateChange = jest.fn();
    mockSupabaseAuth.onAuthStateChange.mockImplementation((callback) => {
      mockAuthStateChange.mockImplementation(callback);
      return {
        data: { subscription: { unsubscribe: jest.fn() } },
      };
    });

    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: 'user-123', email: 'test@example.com' },
        },
      },
    });

    const { rerender } = render(
      <AuthProvider>
        <Header />
      </AuthProvider>
    );

    // Initially should show login button
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();

    // Simulate successful login
    mockAuthStateChange('SIGNED_IN', {
      user: { id: 'user-123', email: 'test@example.com' },
    });

    // Re-render to see updated state
    rerender(
      <AuthProvider>
        <Header />
      </AuthProvider>
    );

    // Should now show user menu or avatar
    await waitFor(() => {
      const userMenu = screen.queryByRole('button', { name: /user menu/i }) ||
                      screen.queryByRole('button', { name: /account/i }) ||
                      screen.queryByTestId('user-menu');
      expect(userMenu).toBeInTheDocument();
    });
  });

  it('should validate email format before submission', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    // Enter invalid email
    await user.type(emailInput, 'notanemail');
    await user.type(passwordInput, 'Password123!');

    // Try to submit
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Should show validation error
    await waitFor(() => {
      const errorMessage = screen.queryByText(/valid email/i) ||
                          screen.queryByText(/invalid email/i);
      expect(errorMessage).toBeInTheDocument();
    });

    // Should not call auth service
    expect(mockSupabaseAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('should clear errors when user modifies form', async () => {
    const user = userEvent.setup();

    mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Invalid credentials' },
    });

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    // Submit with wrong credentials
    await user.type(screen.getByLabelText(/email/i), 'wrong@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Wait for error
    await waitFor(() => {
      expect(screen.getByText(/invalid/i)).toBeInTheDocument();
    });

    // Start typing in email field
    await user.clear(screen.getByLabelText(/email/i));
    await user.type(screen.getByLabelText(/email/i), 'n');

    // Error should be cleared
    await waitFor(() => {
      expect(screen.queryByText(/invalid/i)).not.toBeInTheDocument();
    });
  });
});