import React from 'react';
import { render } from '@testing-library/react';
import { AuthContext } from '@/contexts/AuthContext';
import { User } from '@supabase/supabase-js';

// Mock user factory
export const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-123',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'test@example.com',
  email_confirmed_at: new Date().toISOString(),
  phone: '',
  confirmed_at: new Date().toISOString(),
  last_sign_in_at: new Date().toISOString(),
  app_metadata: {
    provider: 'email',
    providers: ['email']
  },
  user_metadata: {
    name: 'Test User'
  },
  identities: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  is_anonymous: false,
  ...overrides,
});

// Mock auth context factory
export const createMockAuthContext = (overrides: Partial<{
  user: User | null;
  loading: boolean;
  signIn: jest.MockedFunction<any>;
  signUp: jest.MockedFunction<any>;
  signOut: jest.MockedFunction<any>;
  refreshSession: jest.MockedFunction<any>;
}> = {}) => ({
  user: null,
  loading: false,
  signIn: jest.fn(),
  signUp: jest.fn(),
  signOut: jest.fn(),
  refreshSession: jest.fn(),
  ...overrides,
});

// Auth Provider wrapper for tests
export const AuthTestWrapper = ({ 
  children,
  authContextValue
}: {
  children: React.ReactNode;
  authContextValue?: ReturnType<typeof createMockAuthContext>;
}) => {
  const contextValue = authContextValue || createMockAuthContext();
  
  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

// Render with auth context helper
export const renderWithAuth = (
  ui: React.ReactElement,
  authContextValue?: ReturnType<typeof createMockAuthContext>
) => {
  return render(
    <AuthTestWrapper authContextValue={authContextValue}>
      {ui}
    </AuthTestWrapper>
  );
};

// Common test scenarios
export const authTestScenarios = {
  unauthenticated: () => createMockAuthContext({
    user: null,
    loading: false,
  }),
  
  loading: () => createMockAuthContext({
    user: null,
    loading: true,
  }),
  
  authenticated: (userOverrides?: Partial<User>) => createMockAuthContext({
    user: createMockUser(userOverrides),
    loading: false,
  }),
  
  authError: () => createMockAuthContext({
    user: null,
    loading: false,
    signIn: jest.fn().mockRejectedValue(new Error('Authentication failed')),
    signUp: jest.fn().mockRejectedValue(new Error('Registration failed')),
  }),
};

// Mock Supabase client
export const createMockSupabaseClient = () => ({
  auth: {
    getSession: jest.fn(),
    signInWithPassword: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
    onAuthStateChange: jest.fn(),
  },
});

// Common assertions
export const authAssertions = {
  expectUnauthenticatedState: (screen: any) => {
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /user menu/i })).not.toBeInTheDocument();
  },
  
  expectAuthenticatedState: (screen: any, user?: User) => {
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
    if (user) {
      const userInitial = user.email?.[0]?.toUpperCase() || 'U';
      expect(screen.getByText(userInitial)).toBeInTheDocument();
    }
  },
  
  expectLoadingState: (screen: any) => {
    expect(screen.getByText('ReCopyFast').parentElement?.parentElement
      ?.querySelector('.animate-pulse')).toBeInTheDocument();
  },
};

// Form validation helpers
export const formValidationHelpers = {
  expectFormToBeInvalid: (form: HTMLFormElement) => {
    expect(form).toBeInvalid?.();
  },
  
  expectInputToBeInvalid: (input: HTMLInputElement) => {
    expect(input).toBeInvalid();
  },
  
  expectRequiredFieldError: (screen: any, fieldName: string) => {
    const field = screen.getByLabelText(new RegExp(fieldName, 'i'));
    expect(field).toBeInvalid();
  },
};

// Async test helpers
export const asyncHelpers = {
  waitForAuth: async (callback: () => void, timeout = 5000) => {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Auth operation timed out after ${timeout}ms`));
      }, timeout);
      
      const checkAuth = () => {
        try {
          callback();
          clearTimeout(timer);
          resolve();
        } catch (error) {
          setTimeout(checkAuth, 100);
        }
      };
      
      checkAuth();
    });
  },
};

// Mock form data
export const mockFormData = {
  validLogin: {
    email: 'test@example.com',
    password: 'password123',
  },
  
  validSignup: {
    name: 'John Doe',
    email: 'john.doe@example.com',
    password: 'securepassword123',
    confirmPassword: 'securepassword123',
  },
  
  invalidEmail: {
    email: 'invalid-email',
    password: 'password123',
  },
  
  shortPassword: {
    email: 'test@example.com',
    password: '123',
  },
  
  mismatchedPasswords: {
    name: 'John Doe',
    email: 'test@example.com',
    password: 'password123',
    confirmPassword: 'differentpassword',
  },
};

// Error message constants
export const errorMessages = {
  INVALID_CREDENTIALS: 'Invalid credentials',
  EMAIL_ALREADY_REGISTERED: 'Email already registered',
  PASSWORDS_DONT_MATCH: 'Passwords do not match',
  PASSWORD_TOO_SHORT: 'Password must be at least 6 characters',
  SIGN_IN_FAILED: 'Failed to sign in',
  SIGN_UP_FAILED: 'Failed to sign up',
  SIGN_OUT_FAILED: 'An error occurred during sign out',
  GENERIC_ERROR: 'An unexpected error occurred',
};