import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { User } from '@supabase/supabase-js';

// Mock dependencies
jest.mock('@/lib/supabase/client');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
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

// Mock user
const mockUser: Partial<User> = {
  id: 'user-123',
  email: 'test@example.com',
  user_metadata: {
    name: 'Test User',
  },
};

describe('AuthContext', () => {
  const mockRouter = { push: jest.fn() };
  const mockUnsubscribe = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockReturnValue(mockSupabaseClient);
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    
    // Default mock implementation for onAuthStateChange
    mockSupabaseClient.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    });
  });

  it('provides initial loading state', () => {
    mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
    });

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBe(null);
  });

  it('loads user session on mount', async () => {
    mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
      data: { session: { user: mockUser } },
    });

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.user).toEqual(mockUser);
    });
  });

  it('handles session loading error', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    mockSupabaseClient.auth.getSession.mockRejectedValueOnce(new Error('Session error'));

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.user).toBe(null);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error checking user session:',
        expect.any(Error)
      );
    });

    consoleErrorSpy.mockRestore();
  });

  it('subscribes to auth state changes', async () => {
    const mockCallback = jest.fn();
    mockSupabaseClient.auth.onAuthStateChange.mockImplementation((callback) => {
      mockCallback.mockImplementation(callback);
      return {
        data: { subscription: { unsubscribe: mockUnsubscribe } },
      };
    });

    mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
    });

    renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => {
      expect(mockSupabaseClient.auth.onAuthStateChange).toHaveBeenCalled();
    });

    // Simulate auth state change
    act(() => {
      mockCallback('SIGNED_IN', { user: mockUser });
    });

    await waitFor(() => {
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });
  });

  it('unsubscribes from auth state changes on unmount', async () => {
    mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
    });

    const { unmount } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => {
      expect(mockSupabaseClient.auth.onAuthStateChange).toHaveBeenCalled();
    });

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  describe('signIn', () => {
    it('successfully signs in user', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
        data: { session: null },
      });
      
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: mockUser, session: {} },
        error: null,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      });

      await act(async () => {
        await result.current.signIn('test@example.com', 'password123');
      });

      expect(mockSupabaseClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
      expect(mockRouter.push).toHaveBeenCalledWith('/dashboard');
    });

    it('handles sign in error', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
        data: { session: null },
      });
      
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid credentials' },
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      });

      await expect(
        act(async () => {
          await result.current.signIn('test@example.com', 'wrongpassword');
        })
      ).rejects.toThrow('Invalid credentials');

      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('handles sign in with generic error', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
        data: { session: null },
      });
      
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: null,
        error: {},
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      });

      await expect(
        act(async () => {
          await result.current.signIn('test@example.com', 'password');
        })
      ).rejects.toThrow('An error occurred during sign in');
    });
  });

  describe('signUp', () => {
    it('successfully signs up user', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
        data: { session: null },
      });
      
      mockSupabaseClient.auth.signUp.mockResolvedValueOnce({
        data: { user: mockUser, session: null },
        error: null,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      });

      const metadata = { name: 'Test User' };

      await act(async () => {
        await result.current.signUp('test@example.com', 'password123', metadata);
      });

      expect(mockSupabaseClient.auth.signUp).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        options: {
          data: metadata,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
    });

    it('handles sign up error', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
        data: { session: null },
      });
      
      mockSupabaseClient.auth.signUp.mockResolvedValueOnce({
        data: null,
        error: { message: 'Email already registered' },
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      });

      await expect(
        act(async () => {
          await result.current.signUp('existing@example.com', 'password123');
        })
      ).rejects.toThrow('Email already registered');
    });

    it('uses empty metadata when not provided', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
        data: { session: null },
      });
      
      mockSupabaseClient.auth.signUp.mockResolvedValueOnce({
        data: { user: mockUser, session: null },
        error: null,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      });

      await act(async () => {
        await result.current.signUp('test@example.com', 'password123');
      });

      expect(mockSupabaseClient.auth.signUp).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        options: {
          data: {},
          emailRedirectTo: expect.any(String),
        },
      });
    });
  });

  describe('signOut', () => {
    it('successfully signs out user', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
        data: { session: { user: mockUser } },
      });
      
      mockSupabaseClient.auth.signOut.mockResolvedValueOnce({
        error: null,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      });

      await act(async () => {
        await result.current.signOut();
      });

      expect(mockSupabaseClient.auth.signOut).toHaveBeenCalled();
      expect(mockRouter.push).toHaveBeenCalledWith('/');
    });

    it('handles sign out error', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
        data: { session: { user: mockUser } },
      });
      
      mockSupabaseClient.auth.signOut.mockResolvedValueOnce({
        error: { message: 'Sign out failed' },
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      });

      await expect(
        act(async () => {
          await result.current.signOut();
        })
      ).rejects.toThrow('Sign out failed');

      expect(mockRouter.push).not.toHaveBeenCalled();
    });
  });

  describe('refreshSession', () => {
    it('successfully refreshes session', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
        data: { session: { user: mockUser } },
      });
      
      const newUser = { ...mockUser, email: 'updated@example.com' };
      mockSupabaseClient.auth.refreshSession.mockResolvedValueOnce({
        data: { session: { user: newUser } },
        error: null,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      });

      await act(async () => {
        await result.current.refreshSession();
      });

      expect(mockSupabaseClient.auth.refreshSession).toHaveBeenCalled();
      await waitFor(() => {
        expect(result.current.user).toEqual(newUser);
      });
    });

    it('handles refresh session error', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
        data: { session: { user: mockUser } },
      });
      
      mockSupabaseClient.auth.refreshSession.mockResolvedValueOnce({
        data: null,
        error: { message: 'Refresh failed' },
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      });

      await act(async () => {
        await result.current.refreshSession();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error refreshing session:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('handles null session on refresh', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
        data: { session: { user: mockUser } },
      });
      
      mockSupabaseClient.auth.refreshSession.mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthProvider,
      });

      await act(async () => {
        await result.current.refreshSession();
      });

      await waitFor(() => {
        expect(result.current.user).toBe(null);
      });
    });
  });

  it('throws error when useAuth is used outside AuthProvider', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within an AuthProvider');

    consoleErrorSpy.mockRestore();
  });

  it('handles auth state change updates', async () => {
    let authChangeCallback: ((event: string, session: any) => void) | null = null;
    
    mockSupabaseClient.auth.onAuthStateChange.mockImplementation((callback) => {
      authChangeCallback = callback;
      return {
        data: { subscription: { unsubscribe: mockUnsubscribe } },
      };
    });

    mockSupabaseClient.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
    });

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.user).toBe(null);
    });

    // Simulate user signing in
    act(() => {
      if (authChangeCallback) {
        authChangeCallback('SIGNED_IN', { user: mockUser });
      }
    });

    await waitFor(() => {
      expect(result.current.user).toEqual(mockUser);
      expect(result.current.loading).toBe(false);
    });

    // Simulate user signing out
    act(() => {
      if (authChangeCallback) {
        authChangeCallback('SIGNED_OUT', null);
      }
    });

    await waitFor(() => {
      expect(result.current.user).toBe(null);
      expect(result.current.loading).toBe(false);
    });
  });
});