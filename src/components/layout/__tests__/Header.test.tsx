import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from '../Header';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { User } from '@supabase/supabase-js';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock the useAuth hook
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Mock Next.js Link
jest.mock('next/link', () => {
  return {
    __esModule: true,
    default: ({ children, href, className, ...props }: { children: React.ReactNode; href: string; className?: string; [key: string]: unknown }) => (
      <a href={href} className={className} {...props}>
        {children}
      </a>
    ),
  };
});

// Mock user
const mockUser: Partial<User> = {
  id: 'user-123',
  email: 'test@example.com',
  user_metadata: {
    name: 'Test User',
  },
};

describe('Header', () => {
  const mockRouter = { push: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
  });

  it('renders header with logo and brand name', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    expect(screen.getByText('ReCopyFast')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ReCopyFast/i })).toHaveAttribute('href', '/');
  });

  it('renders navigation links', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    expect(screen.getByText('Features')).toBeInTheDocument();
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.getByText('Live Demo')).toBeInTheDocument();
    
    const demoLink = screen.getByRole('link', { name: 'Live Demo' });
    expect(demoLink).toHaveAttribute('href', '/demo');
  });

  it('shows loading skeleton when auth is loading', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: true,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    const loadingSkeleton = screen.getByText('ReCopyFast').parentElement?.parentElement
      ?.querySelector('.animate-pulse');
    expect(loadingSkeleton).toBeInTheDocument();
  });

  it('shows Sign In button when user is not authenticated', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('shows UserMenu when user is authenticated', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    // UserMenu renders a button with user initial
    const userMenuButton = screen.getByRole('button');
    expect(userMenuButton).toBeInTheDocument();
    expect(screen.getByText('T')).toBeInTheDocument(); // First letter of email
  });

  it('opens AuthModal when Sign In button is clicked', async () => {
    const user = userEvent.setup();
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    const signInButton = screen.getByRole('button', { name: 'Sign In' });
    await user.click(signInButton);

    // Check if modal is opened
    expect(screen.getByText('Welcome to ReCopyFast')).toBeInTheDocument();
  });

  it('has proper sticky header styling', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    const header = screen.getByRole('banner');
    expect(header).toHaveClass('sticky', 'top-0', 'z-50');
  });

  it('has proper backdrop blur effect', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    const header = screen.getByRole('banner');
    expect(header).toHaveClass('backdrop-blur');
  });

  it('hides navigation on mobile', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveClass('hidden', 'md:flex');
  });

  it('supports keyboard navigation', async () => {
    const user = userEvent.setup();
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    // Tab through header elements
    await user.tab();
    expect(screen.getByRole('link', { name: /ReCopyFast/i })).toHaveFocus();

    await user.tab();
    expect(screen.getByText('Live Demo').closest('a')).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Sign In' })).toHaveFocus();

    // Open modal with Enter key
    await user.keyboard('{Enter}');
    expect(screen.getByText('Welcome to ReCopyFast')).toBeInTheDocument();
  });
});