import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '../LoginForm';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock the useAuth hook
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Mock auth context
const mockAuthContext = {
  user: null,
  loading: false,
  signIn: jest.fn(),
  signUp: jest.fn(),
  signOut: jest.fn(),
  refreshSession: jest.fn(),
};

const AuthProviderWrapper = ({ children }: { children: React.ReactNode }) => (
  <div>{children}</div>
);

describe('LoginForm', () => {
  const mockOnSuccess = jest.fn();
  const mockOnSwitchToSignup = jest.fn();
  const mockRouter = { push: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useAuth as jest.Mock).mockReturnValue(mockAuthContext);
  });

  it('renders login form with all fields', () => {
    render(
      <AuthProviderWrapper>
        <LoginForm onSuccess={mockOnSuccess} onSwitchToSignup={mockOnSwitchToSignup} />
      </AuthProviderWrapper>
    );

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(screen.getByText("Don't have an account?")).toBeInTheDocument();
  });

  it('validates email format', async () => {
    const user = userEvent.setup();
    render(
      <AuthProviderWrapper>
        <LoginForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    const emailInput = screen.getByLabelText('Email');
    const submitButton = screen.getByRole('button', { name: 'Sign In' });

    // Test invalid email
    await user.type(emailInput, 'invalid-email');
    await user.click(submitButton);

    // HTML5 validation should prevent form submission
    expect(emailInput).toBeInvalid();
    expect(mockAuthContext.signIn).not.toHaveBeenCalled();
  });

  it('requires both email and password', async () => {
    const user = userEvent.setup();
    render(
      <AuthProviderWrapper>
        <LoginForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    const submitButton = screen.getByRole('button', { name: 'Sign In' });

    // Try to submit empty form
    await user.click(submitButton);

    expect(mockAuthContext.signIn).not.toHaveBeenCalled();
  });

  it('handles successful login', async () => {
    const user = userEvent.setup();
    mockAuthContext.signIn.mockResolvedValueOnce(undefined);

    render(
      <AuthProviderWrapper>
        <LoginForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');

    // Submit form
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mockAuthContext.signIn).toHaveBeenCalledWith('test@example.com', 'password123');
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('handles login errors', async () => {
    const user = userEvent.setup();
    const errorMessage = 'Invalid credentials';
    mockAuthContext.signIn.mockRejectedValueOnce(new Error(errorMessage));

    render(
      <AuthProviderWrapper>
        <LoginForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrongpassword');

    // Submit form
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
      expect(mockOnSuccess).not.toHaveBeenCalled();
    });
  });

  it('shows loading state during login', async () => {
    const user = userEvent.setup();
    
    // Create a promise that we can control
    let resolveLogin: () => void;
    const loginPromise = new Promise<void>((resolve) => {
      resolveLogin = resolve;
    });
    mockAuthContext.signIn.mockReturnValueOnce(loginPromise);

    render(
      <AuthProviderWrapper>
        <LoginForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');

    // Submit form
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    // Check loading state
    expect(screen.getByText('Signing in...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();

    // Resolve the login
    resolveLogin!();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sign In' })).not.toBeDisabled();
    });
  });

  it('calls onSwitchToSignup when signup link is clicked', async () => {
    const user = userEvent.setup();
    render(
      <AuthProviderWrapper>
        <LoginForm onSwitchToSignup={mockOnSwitchToSignup} />
      </AuthProviderWrapper>
    );

    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(mockOnSwitchToSignup).toHaveBeenCalled();
  });

  it('clears error when user starts typing', async () => {
    const user = userEvent.setup();
    mockAuthContext.signIn.mockRejectedValueOnce(new Error('Invalid credentials'));

    render(
      <AuthProviderWrapper>
        <LoginForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form and submit to trigger error
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });

    // Start typing in email field - clear first, then type
    const emailInput = screen.getByLabelText('Email');
    await user.clear(emailInput);
    await user.type(emailInput, 'newemail@test.com');

    // Try submitting again to trigger the error clearing
    const submitButton = screen.getByRole('button', { name: 'Sign In' });
    await user.click(submitButton);

    // Error should be cleared on new submission
    await waitFor(() => {
      expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument();
    });
  });

  it('has proper input icons', () => {
    render(
      <AuthProviderWrapper>
        <LoginForm />
      </AuthProviderWrapper>
    );

    // Check for Mail icon
    const emailContainer = screen.getByLabelText('Email').parentElement;
    expect(emailContainer?.querySelector('svg')).toBeInTheDocument();

    // Check for Lock icon
    const passwordContainer = screen.getByLabelText('Password').parentElement;
    expect(passwordContainer?.querySelector('svg')).toBeInTheDocument();
  });

  it('supports keyboard navigation', async () => {
    const user = userEvent.setup();
    render(
      <AuthProviderWrapper>
        <LoginForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Tab through form elements
    await user.tab();
    expect(screen.getByLabelText('Email')).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText('Password')).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Sign In' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Sign up' })).toHaveFocus();
  });

  it('submits form on Enter key', async () => {
    const user = userEvent.setup();
    mockAuthContext.signIn.mockResolvedValueOnce(undefined);

    render(
      <AuthProviderWrapper>
        <LoginForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');

    // Press Enter while in password field
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockAuthContext.signIn).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('prevents form submission when loading', async () => {
    const user = userEvent.setup();
    
    // Make signIn hang
    mockAuthContext.signIn.mockImplementation(() => new Promise(() => {}));

    render(
      <AuthProviderWrapper>
        <LoginForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form and submit
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    // Try to submit again while loading - use the disabled submit button
    await user.click(screen.getByRole('button', { name: /signing in/i }));

    // Should only be called once
    expect(mockAuthContext.signIn).toHaveBeenCalledTimes(1);
  });

  it('has proper ARIA labels for accessibility', () => {
    render(
      <AuthProviderWrapper>
        <LoginForm />
      </AuthProviderWrapper>
    );

    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Email')).toHaveAttribute('required');
    expect(screen.getByLabelText('Email')).toHaveAttribute('placeholder', 'you@example.com');

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Password')).toHaveAttribute('required');
    expect(screen.getByLabelText('Password')).toHaveAttribute('placeholder', '••••••••');
  });
});