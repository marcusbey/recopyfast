import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
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
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    auth: {
      signUp: jest.fn(),
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
  })),
}));

// Add auth-specific handlers
const authHandlers = [
  http.post('/api/auth/signup', async ({ request }) => {
    const body = await request.json() as { email: string; password: string; metadata?: any };
    
    // Validation errors
    if (!body.email || !body.password) {
      return HttpResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Email already exists
    if (body.email === 'existing@example.com') {
      return HttpResponse.json(
        { error: 'User already registered' },
        { status: 400 }
      );
    }

    // Invalid email format
    if (!body.email.includes('@')) {
      return HttpResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Weak password
    if (body.password.length < 6) {
      return HttpResponse.json(
        { error: 'Password should be at least 6 characters' },
        { status: 400 }
      );
    }

    // Successful registration
    return HttpResponse.json({
      user: {
        id: 'new-user-id',
        email: body.email,
        app_metadata: {},
        user_metadata: body.metadata || {},
        created_at: new Date().toISOString(),
      },
      message: 'Check your email to confirm your account',
    });
  }),
];

describe('User Registration and Onboarding Flow', () => {
  const mockRouter = {
    push: jest.fn(),
    refresh: jest.fn(),
  };

  beforeAll(() => {
    server.use(...authHandlers);
  });

  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    jest.clearAllMocks();
  });

  it('should complete full registration flow with valid data', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={onClose} defaultTab="signup" />
      </AuthProvider>
    );

    // Switch to signup tab (should already be there)
    expect(screen.getByRole('tab', { name: /sign up/i })).toHaveAttribute('data-state', 'active');

    // Fill in registration form
    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);

    await user.type(emailInput, 'newuser@example.com');
    await user.type(passwordInput, 'SecurePassword123!');
    await user.type(confirmPasswordInput, 'SecurePassword123!');

    // Accept terms if checkbox exists
    const termsCheckbox = screen.queryByRole('checkbox', { name: /terms/i });
    if (termsCheckbox) {
      await user.click(termsCheckbox);
    }

    // Submit form
    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    // Wait for success message
    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });

    // Verify modal closes after successful registration
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('should handle registration with existing email', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={onClose} defaultTab="signup" />
      </AuthProvider>
    );

    // Fill form with existing email
    await user.type(screen.getByLabelText(/email/i), 'existing@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');

    // Submit form
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    // Verify error message
    await waitFor(() => {
      expect(screen.getByText(/user already registered/i)).toBeInTheDocument();
    });

    // Modal should remain open
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should validate email format during registration', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    // Enter invalid email
    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'invalidemail');
    
    // Try to move to next field
    const passwordInput = screen.getByLabelText(/^password$/i);
    await user.click(passwordInput);

    // Check for validation error
    await waitFor(() => {
      const errorMessage = screen.queryByText(/invalid email/i) || 
                          screen.queryByText(/valid email/i);
      expect(errorMessage).toBeInTheDocument();
    });
  });

  it('should validate password strength requirements', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    // Enter weak password
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), '123');
    await user.type(screen.getByLabelText(/confirm password/i), '123');

    // Submit form
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    // Check for password strength error
    await waitFor(() => {
      expect(screen.getByText(/password should be at least 6 characters/i)).toBeInTheDocument();
    });
  });

  it('should handle password mismatch validation', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    // Enter mismatched passwords
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'DifferentPassword123!');

    // Try to submit
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    // Check for mismatch error
    await waitFor(() => {
      const errorMessage = screen.queryByText(/passwords.*match/i) ||
                          screen.queryByText(/password confirmation/i);
      expect(errorMessage).toBeInTheDocument();
    });
  });

  it('should switch between login and signup tabs', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    // Verify on signup tab
    expect(screen.getByRole('tab', { name: /sign up/i })).toHaveAttribute('data-state', 'active');

    // Switch to login tab
    const loginTab = screen.getByRole('tab', { name: /sign in/i });
    await user.click(loginTab);

    // Verify tab switched
    await waitFor(() => {
      expect(loginTab).toHaveAttribute('data-state', 'active');
    });

    // Verify login form is visible
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('should handle network errors during registration', async () => {
    const user = userEvent.setup();

    // Override handler to simulate network error
    server.use(
      http.post('/api/auth/signup', () => {
        return HttpResponse.error();
      })
    );

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    // Fill and submit form
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    // Check for error message
    await waitFor(() => {
      const errorMessage = screen.queryByText(/error/i) ||
                          screen.queryByText(/try again/i) ||
                          screen.queryByText(/failed/i);
      expect(errorMessage).toBeInTheDocument();
    });
  });

  it('should disable submit button during registration process', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    // Fill form
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    
    // Submit form
    await user.click(submitButton);

    // Button should be disabled during submission
    expect(submitButton).toBeDisabled();

    // Wait for completion
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('should clear form errors when user starts typing', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    // Submit empty form to trigger errors
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    // Wait for validation errors
    await waitFor(() => {
      expect(screen.getByText(/email.*required/i)).toBeInTheDocument();
    });

    // Start typing in email field
    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 't');

    // Error should be cleared
    await waitFor(() => {
      expect(screen.queryByText(/email.*required/i)).not.toBeInTheDocument();
    });
  });
});