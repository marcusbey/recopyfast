import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '@/contexts/AuthContext';
import { AuthModal } from '../AuthModal';
import { Header } from '@/components/layout/Header';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

// Mock dependencies
jest.mock('@/lib/supabase/client');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock Next.js Link
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock Supabase client
const mockSupabaseClient = {
  auth: {
    getSession: jest.fn(),
    signInWithPassword: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
    onAuthStateChange: jest.fn(),
  },
};

describe('Authentication Flow Integration', () => {
  const mockRouter = { push: jest.fn() };
  const mockUnsubscribe = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockReturnValue(mockSupabaseClient);
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    
    mockSupabaseClient.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    });
    
    mockSupabaseClient.auth.getSession.mockResolvedValue({
      data: { session: null },
    });
  });

  describe('Complete Login Flow', () => {
    it('allows user to complete full login flow', async () => {
      const user = userEvent.setup();
      
      // Mock successful login
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: { 
          user: { 
            id: 'user-123', 
            email: 'test@example.com',
            user_metadata: { name: 'Test User' }
          }, 
          session: {} 
        },
        error: null,
      });

      render(
        <AuthProvider>
          <Header />
        </AuthProvider>
      );

      // Wait for initial loading to complete
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
      });

      // Click sign in button to open modal
      await user.click(screen.getByRole('button', { name: 'Sign In' }));

      // Verify modal opened
      expect(screen.getByText('Welcome to ReCopyFast')).toBeInTheDocument();

      // Fill in login form
      const emailInput = screen.getByLabelText('Email');
      const passwordInput = screen.getByLabelText('Password');
      
      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');

      // Submit form
      const submitButton = screen.getByRole('button', { name: 'Sign In' });
      await user.click(submitButton);

      // Verify login was called
      expect(mockSupabaseClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });

      // Verify redirect to dashboard
      expect(mockRouter.push).toHaveBeenCalledWith('/dashboard');
    });

    it('shows error message on login failure', async () => {
      const user = userEvent.setup();
      
      // Mock failed login
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid login credentials' },
      });

      render(
        <AuthProvider>
          <Header />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
      });

      // Open modal and fill form
      await user.click(screen.getByRole('button', { name: 'Sign In' }));
      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'wrongpassword');
      await user.click(screen.getByRole('button', { name: 'Sign In' }));

      // Verify error is displayed
      await waitFor(() => {
        expect(screen.getByText('Invalid login credentials')).toBeInTheDocument();
      });

      // Verify no redirect occurred
      expect(mockRouter.push).not.toHaveBeenCalled();
    });
  });

  describe('Complete Signup Flow', () => {
    it('allows user to complete full signup flow', async () => {
      const user = userEvent.setup();
      
      // Mock successful signup
      mockSupabaseClient.auth.signUp.mockResolvedValueOnce({
        data: { 
          user: { 
            id: 'user-123', 
            email: 'newuser@example.com',
            user_metadata: { name: 'New User' }
          }, 
          session: null 
        },
        error: null,
      });

      render(
        <AuthProvider>
          <Header />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
      });

      // Open modal
      await user.click(screen.getByRole('button', { name: 'Sign In' }));

      // Switch to signup tab
      await user.click(screen.getByRole('tab', { name: 'Sign Up' }));

      // Fill in signup form
      await user.type(screen.getByLabelText('Name'), 'New User');
      await user.type(screen.getByLabelText('Email'), 'newuser@example.com');
      await user.type(screen.getByLabelText('Password'), 'securepassword123');
      await user.type(screen.getByLabelText('Confirm Password'), 'securepassword123');

      // Submit form
      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      // Verify signup was called
      expect(mockSupabaseClient.auth.signUp).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'securepassword123',
        options: {
          data: { name: 'New User' },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      // Verify success message is shown
      await waitFor(() => {
        expect(screen.getByText('Check your email')).toBeInTheDocument();
        expect(screen.getByText('newuser@example.com')).toBeInTheDocument();
      });
    });

    it('validates form fields during signup', async () => {
      const user = userEvent.setup();

      render(
        <AuthProvider>
          <AuthModal isOpen={true} onClose={() => {}} defaultTab="signup" />
        </AuthProvider>
      );

      // Try to submit with mismatched passwords
      await user.type(screen.getByLabelText('Name'), 'Test User');
      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');
      await user.type(screen.getByLabelText('Confirm Password'), 'differentpassword');

      await user.click(screen.getByRole('button', { name: 'Create Account' }));

      // Verify validation error
      await waitFor(() => {
        expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
      });

      // Verify signup was not called
      expect(mockSupabaseClient.auth.signUp).not.toHaveBeenCalled();
    });
  });

  describe('Modal Navigation', () => {
    it('allows switching between login and signup tabs', async () => {
      const user = userEvent.setup();

      render(
        <AuthProvider>
          <AuthModal isOpen={true} onClose={() => {}} />
        </AuthProvider>
      );

      // Verify default is login tab
      expect(screen.getByRole('tab', { name: 'Sign In' })).toHaveAttribute('data-state', 'active');
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();

      // Switch to signup
      await user.click(screen.getByRole('tab', { name: 'Sign Up' }));

      expect(screen.getByRole('tab', { name: 'Sign Up' })).toHaveAttribute('data-state', 'active');
      expect(screen.getByLabelText('Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();

      // Switch back to login
      await user.click(screen.getByRole('tab', { name: 'Sign In' }));

      expect(screen.getByRole('tab', { name: 'Sign In' })).toHaveAttribute('data-state', 'active');
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    });

    it('allows switching via form links', async () => {
      const user = userEvent.setup();

      render(
        <AuthProvider>
          <AuthModal isOpen={true} onClose={() => {}} />
        </AuthProvider>
      );

      // Click "Sign up" link in login form
      await user.click(screen.getByRole('button', { name: 'Sign up' }));

      expect(screen.getByRole('tab', { name: 'Sign Up' })).toHaveAttribute('data-state', 'active');

      // Click "Sign in" link in signup form
      await user.click(screen.getByRole('button', { name: 'Sign in' }));

      expect(screen.getByRole('tab', { name: 'Sign In' })).toHaveAttribute('data-state', 'active');
    });
  });

  describe('Authentication State Management', () => {
    it('updates UI when user state changes', async () => {
      const user = userEvent.setup();
      let authChangeCallback: ((event: string, session: any) => void) | null = null;
      
      mockSupabaseClient.auth.onAuthStateChange.mockImplementation((callback) => {
        authChangeCallback = callback;
        return {
          data: { subscription: { unsubscribe: mockUnsubscribe } },
        };
      });

      render(
        <AuthProvider>
          <Header />
        </AuthProvider>
      );

      // Initially unauthenticated
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
      });

      // Simulate authentication
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        user_metadata: { name: 'Test User' },
      };

      act(() => {
        authChangeCallback?.('SIGNED_IN', { user: mockUser });
      });

      // UI should update to show authenticated state
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument();
        expect(screen.getByText('T')).toBeInTheDocument(); // User initial
      });
    });
  });

  describe('Error Handling', () => {
    it('handles network errors gracefully', async () => {
      const user = userEvent.setup();
      
      // Mock network error
      mockSupabaseClient.auth.signInWithPassword.mockRejectedValueOnce(
        new Error('Network error')
      );

      render(
        <AuthProvider>
          <Header />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
      });

      // Try to login
      await user.click(screen.getByRole('button', { name: 'Sign In' }));
      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');
      await user.click(screen.getByRole('button', { name: 'Sign In' }));

      // Verify error is handled
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    it('shows loading states during authentication', async () => {
      const user = userEvent.setup();
      
      // Mock slow authentication
      let resolveAuth: () => void;
      const authPromise = new Promise<void>((resolve) => {
        resolveAuth = resolve;
      });
      
      mockSupabaseClient.auth.signInWithPassword.mockReturnValueOnce(
        authPromise.then(() => ({
          data: { user: { email: 'test@example.com' }, session: {} },
          error: null,
        }))
      );

      render(
        <AuthProvider>
          <Header />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
      });

      // Start login process
      await user.click(screen.getByRole('button', { name: 'Sign In' }));
      await user.type(screen.getByLabelText('Email'), 'test@example.com');
      await user.type(screen.getByLabelText('Password'), 'password123');
      await user.click(screen.getByRole('button', { name: 'Sign In' }));

      // Verify loading state
      expect(screen.getByText('Signing in...')).toBeInTheDocument();
      expect(screen.getByRole('button')).toBeDisabled();

      // Complete authentication
      resolveAuth!();

      await waitFor(() => {
        expect(screen.queryByText('Signing in...')).not.toBeInTheDocument();
      });
    });
  });
});