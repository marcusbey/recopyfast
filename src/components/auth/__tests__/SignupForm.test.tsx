import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignupForm } from '../SignupForm';
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

describe('SignupForm', () => {
  const mockOnSuccess = jest.fn();
  const mockOnSwitchToLogin = jest.fn();
  const mockRouter = { push: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useAuth as jest.Mock).mockReturnValue(mockAuthContext);
  });

  it('renders signup form with all fields', () => {
    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} onSwitchToLogin={mockOnSwitchToLogin} />
      </AuthProviderWrapper>
    );

    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
    expect(screen.getByText('Already have an account?')).toBeInTheDocument();
  });

  it('validates email format', async () => {
    const user = userEvent.setup();
    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    const emailInput = screen.getByLabelText('Email');
    const submitButton = screen.getByRole('button', { name: 'Create Account' });

    // Fill in all fields except email with invalid format
    await user.type(screen.getByLabelText('Name'), 'John Doe');
    await user.type(emailInput, 'invalid-email');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm Password'), 'password123');
    
    await user.click(submitButton);

    // HTML5 validation should prevent form submission
    expect(emailInput).toBeInvalid();
    expect(mockAuthContext.signUp).not.toHaveBeenCalled();
  });

  it('validates password match', async () => {
    const user = userEvent.setup();
    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form with mismatched passwords
    await user.type(screen.getByLabelText('Name'), 'John Doe');
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm Password'), 'differentpassword');

    // Submit form
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
      expect(mockAuthContext.signUp).not.toHaveBeenCalled();
    });
  });

  it('validates password length', async () => {
    const user = userEvent.setup();
    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form with short password
    await user.type(screen.getByLabelText('Name'), 'John Doe');
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), '12345');
    await user.type(screen.getByLabelText('Confirm Password'), '12345');

    // Submit form
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 6 characters')).toBeInTheDocument();
      expect(mockAuthContext.signUp).not.toHaveBeenCalled();
    });
  });

  it('handles successful signup', async () => {
    const user = userEvent.setup();
    mockAuthContext.signUp.mockResolvedValueOnce(undefined);

    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form
    await user.type(screen.getByLabelText('Name'), 'John Doe');
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm Password'), 'password123');

    // Submit form
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(mockAuthContext.signUp).toHaveBeenCalledWith(
        'test@example.com',
        'password123',
        { name: 'John Doe' }
      );
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('shows success message after signup', async () => {
    const user = userEvent.setup();
    mockAuthContext.signUp.mockResolvedValueOnce(undefined);

    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form
    await user.type(screen.getByLabelText('Name'), 'John Doe');
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm Password'), 'password123');

    // Submit form
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Check your email')).toBeInTheDocument();
      expect(screen.getByText(/We've sent you a confirmation link/)).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });
  });

  it('handles signup errors', async () => {
    const user = userEvent.setup();
    const errorMessage = 'Email already registered';
    mockAuthContext.signUp.mockRejectedValueOnce(new Error(errorMessage));

    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form
    await user.type(screen.getByLabelText('Name'), 'John Doe');
    await user.type(screen.getByLabelText('Email'), 'existing@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm Password'), 'password123');

    // Submit form
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
      expect(mockOnSuccess).not.toHaveBeenCalled();
    });
  });

  it('shows loading state during signup', async () => {
    const user = userEvent.setup();
    
    // Create a promise that we can control
    let resolveSignup: () => void;
    const signupPromise = new Promise<void>((resolve) => {
      resolveSignup = resolve;
    });
    mockAuthContext.signUp.mockReturnValueOnce(signupPromise);

    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form
    await user.type(screen.getByLabelText('Name'), 'John Doe');
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm Password'), 'password123');

    // Submit form
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    // Check loading state
    expect(screen.getByText('Creating account...')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();

    // Resolve the signup
    resolveSignup!();

    await waitFor(() => {
      expect(screen.getByText('Check your email')).toBeInTheDocument();
    });
  });

  it('calls onSwitchToLogin when login link is clicked', async () => {
    const user = userEvent.setup();
    render(
      <AuthProviderWrapper>
        <SignupForm onSwitchToLogin={mockOnSwitchToLogin} />
      </AuthProviderWrapper>
    );

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(mockOnSwitchToLogin).toHaveBeenCalled();
  });

  it('requires all fields to be filled', async () => {
    const user = userEvent.setup();
    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Try to submit empty form
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(mockAuthContext.signUp).not.toHaveBeenCalled();
  });

  it('has proper input icons', () => {
    render(
      <AuthProviderWrapper>
        <SignupForm />
      </AuthProviderWrapper>
    );

    // Check for User icon
    const nameContainer = screen.getByLabelText('Name').parentElement;
    expect(nameContainer?.querySelector('svg')).toBeInTheDocument();

    // Check for Mail icon
    const emailContainer = screen.getByLabelText('Email').parentElement;
    expect(emailContainer?.querySelector('svg')).toBeInTheDocument();

    // Check for Lock icons
    const passwordContainer = screen.getByLabelText('Password').parentElement;
    expect(passwordContainer?.querySelector('svg')).toBeInTheDocument();

    const confirmPasswordContainer = screen.getByLabelText('Confirm Password').parentElement;
    expect(confirmPasswordContainer?.querySelector('svg')).toBeInTheDocument();
  });

  it('supports keyboard navigation', async () => {
    const user = userEvent.setup();
    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Tab through form elements
    await user.tab();
    expect(screen.getByLabelText('Name')).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText('Email')).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText('Password')).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText('Confirm Password')).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Create Account' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus();
  });

  it('clears validation errors when correcting input', async () => {
    const user = userEvent.setup();
    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form with mismatched passwords
    await user.type(screen.getByLabelText('Name'), 'John Doe');
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm Password'), 'differentpassword');

    // Submit to trigger error
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });

    // Fix the password mismatch
    await user.clear(screen.getByLabelText('Confirm Password'));
    await user.type(screen.getByLabelText('Confirm Password'), 'password123');

    // Submit again
    mockAuthContext.signUp.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.queryByText('Passwords do not match')).not.toBeInTheDocument();
      expect(mockAuthContext.signUp).toHaveBeenCalled();
    });
  });

  it('has proper ARIA labels for accessibility', () => {
    render(
      <AuthProviderWrapper>
        <SignupForm />
      </AuthProviderWrapper>
    );

    expect(screen.getByLabelText('Name')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Name')).toHaveAttribute('required');
    
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Email')).toHaveAttribute('required');
    
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Password')).toHaveAttribute('required');
    
    expect(screen.getByLabelText('Confirm Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm Password')).toHaveAttribute('required');
  });

  it('prevents duplicate form submission', async () => {
    const user = userEvent.setup();
    
    // Make signUp hang
    mockAuthContext.signUp.mockImplementation(() => new Promise(() => {}));

    render(
      <AuthProviderWrapper>
        <SignupForm onSuccess={mockOnSuccess} />
      </AuthProviderWrapper>
    );

    // Fill in form
    await user.type(screen.getByLabelText('Name'), 'John Doe');
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm Password'), 'password123');

    // Submit form multiple times quickly
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));

    // Should only be called once
    expect(mockAuthContext.signUp).toHaveBeenCalledTimes(1);
  });
});