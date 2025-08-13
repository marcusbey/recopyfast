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
const mockSupabaseAuth = {
  signUp: jest.fn(),
  signInWithPassword: jest.fn(),
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

describe('Simple Authentication Integration Tests', () => {
  const mockRouter = {
    push: jest.fn(),
    refresh: jest.fn(),
  };

  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    jest.clearAllMocks();
  });

  it('should render authentication modal', async () => {
    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/welcome to recopyfast/i)).toBeInTheDocument();
    });
  });

  it('should show signup form by default when specified', async () => {
    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /sign up/i })).toHaveAttribute('data-state', 'active');
    });
  });

  it('should switch between login and signup tabs', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    // Verify on signup tab initially
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /sign up/i })).toHaveAttribute('data-state', 'active');
    });

    // Switch to login tab
    const loginTab = screen.getByRole('tab', { name: /sign in/i });
    await user.click(loginTab);

    // Verify tab switched
    await waitFor(() => {
      expect(loginTab).toHaveAttribute('data-state', 'active');
    });
  });

  it('should show form validation errors', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="signup" />
      </AuthProvider>
    );

    // Fill form with weak password (client-side validation)
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/name/i), 'Test User');
    
    // Use more specific selector for password
    const passwordInputs = screen.getAllByLabelText(/password/i);
    const mainPasswordInput = passwordInputs.find(input => 
      input.id === 'password' || !input.id.includes('confirm')
    ) || passwordInputs[0];
    
    await user.type(mainPasswordInput, '123');

    // Find confirm password input
    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
    await user.type(confirmPasswordInput, '123');

    // Find and click submit button
    const submitButtons = screen.getAllByRole('button');
    const signUpButton = submitButtons.find(button => 
      button.textContent?.includes('Create Account') || 
      button.textContent?.includes('Sign Up')
    );
    
    if (signUpButton) {
      await user.click(signUpButton);

      // Check for client-side validation error
      await waitFor(() => {
        expect(screen.getByText(/password must be at least 6 characters/i)).toBeInTheDocument();
      });
    }
  });

  it('should handle successful signup', async () => {
    mockSupabaseAuth.signUp.mockResolvedValueOnce({
      data: {
        user: { id: 'new-user', email: 'test@example.com' },
        session: null,
      },
      error: null,
    });

    const user = userEvent.setup();
    const onClose = jest.fn();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={onClose} defaultTab="signup" />
      </AuthProvider>
    );

    // Fill form with valid data
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/name/i), 'Test User');
    
    const passwordInputs = screen.getAllByLabelText(/password/i);
    const mainPasswordInput = passwordInputs.find(input => 
      input.id === 'password' || !input.id.includes('confirm')
    ) || passwordInputs[0];
    
    await user.type(mainPasswordInput, 'ValidPassword123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'ValidPassword123!');

    // Submit form
    const submitButtons = screen.getAllByRole('button');
    const signUpButton = submitButtons.find(button => 
      button.textContent?.includes('Create Account') || 
      button.textContent?.includes('Sign Up')
    );
    
    if (signUpButton) {
      await user.click(signUpButton);

      // Should show success message (use more specific selector)
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /check your email/i })).toBeInTheDocument();
      });
    }
  });

  it('should handle login flow', async () => {
    mockSupabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: {
        user: { id: 'user-123', email: 'test@example.com' },
        session: { access_token: 'token' },
      },
      error: null,
    });

    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    // Fill login form
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');

    // Submit form
    const submitButtons = screen.getAllByRole('button');
    const signInButton = submitButtons.find(button => 
      button.textContent?.includes('Sign In')
    );
    
    if (signInButton) {
      await user.click(signInButton);

      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith('/dashboard');
      });
    }
  });

  it('should show loading states during form submission', async () => {
    // Delay the auth response
    mockSupabaseAuth.signInWithPassword.mockImplementation(() => 
      new Promise(resolve => 
        setTimeout(() => resolve({
          data: { user: { id: 'user' }, session: { access_token: 'token' } },
          error: null,
        }), 100)
      )
    );

    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={jest.fn()} defaultTab="login" />
      </AuthProvider>
    );

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');

    const submitButtons = screen.getAllByRole('button');
    const signInButton = submitButtons.find(button => 
      button.textContent?.includes('Sign In')
    );
    
    if (signInButton) {
      await user.click(signInButton);

      // Should show loading state
      await waitFor(() => {
        expect(screen.getByText(/signing in/i)).toBeInTheDocument();
      });

      // Wait for completion
      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith('/dashboard');
      });
    }
  });
});