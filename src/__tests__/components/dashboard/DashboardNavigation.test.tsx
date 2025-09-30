import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardNavigation } from '@/components/dashboard/DashboardNavigation';
import { usePathname } from 'next/navigation';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

describe('DashboardNavigation', () => {
  const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

  beforeEach(() => {
    mockUsePathname.mockReturnValue('/dashboard');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Navigation Rendering', () => {
    it('should render all navigation items', () => {
      render(<DashboardNavigation />);

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Sites')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.getByText('Analytics')).toBeInTheDocument();
      expect(screen.getByText('Teams')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText('Billing')).toBeInTheDocument();
    });

    it('should render the ReCopyFast logo', () => {
      render(<DashboardNavigation />);

      expect(screen.getByText('ReCopyFast')).toBeInTheDocument();
    });

    it('should display current plan badge', () => {
      render(<DashboardNavigation userPlan="free" />);

      expect(screen.getByText(/free/i)).toBeInTheDocument();
    });

    it('should show upgrade button for free plan', () => {
      render(<DashboardNavigation userPlan="free" />);

      expect(screen.getByText('Upgrade')).toBeInTheDocument();
    });

    it('should not show upgrade button for pro plan', () => {
      render(<DashboardNavigation userPlan="pro" />);

      expect(screen.queryByText('Upgrade')).not.toBeInTheDocument();
    });
  });

  describe('Active State Highlighting', () => {
    it('should highlight Dashboard link when on dashboard page', () => {
      mockUsePathname.mockReturnValue('/dashboard');
      render(<DashboardNavigation />);

      const dashboardLink = screen.getByText('Dashboard').closest('a');
      expect(dashboardLink).toHaveClass('text-blue-600');
    });

    it('should highlight Sites link when on sites page', () => {
      mockUsePathname.mockReturnValue('/dashboard/sites');
      render(<DashboardNavigation />);

      const sitesLink = screen.getByText('Sites').closest('a');
      expect(sitesLink).toHaveClass('text-blue-600');
    });

    it('should highlight Content link when on content page', () => {
      mockUsePathname.mockReturnValue('/dashboard/content');
      render(<DashboardNavigation />);

      const contentLink = screen.getByText('Content').closest('a');
      expect(contentLink).toHaveClass('text-blue-600');
    });

    it('should highlight Analytics link when on analytics page', () => {
      mockUsePathname.mockReturnValue('/dashboard/analytics');
      render(<DashboardNavigation />);

      const analyticsLink = screen.getByText('Analytics').closest('a');
      expect(analyticsLink).toHaveClass('text-blue-600');
    });

    it('should highlight Settings link when on settings page', () => {
      mockUsePathname.mockReturnValue('/dashboard/settings');
      render(<DashboardNavigation />);

      const settingsLink = screen.getByText('Settings').closest('a');
      expect(settingsLink).toHaveClass('text-blue-600');
    });
  });

  describe('Plan-Based Access Control', () => {
    it('should show Pro badge on Teams for free users', () => {
      render(<DashboardNavigation userPlan="free" />);

      const teamsLink = screen.getByText('Teams').closest('a');
      expect(teamsLink?.parentElement).toContainHTML('Pro');
    });

    it('should disable Teams link for free users', () => {
      render(<DashboardNavigation userPlan="free" />);

      const teamsLink = screen.getByText('Teams').closest('a');
      expect(teamsLink).toHaveClass('cursor-not-allowed');
    });

    it('should enable Teams link for pro users', () => {
      render(<DashboardNavigation userPlan="pro" />);

      const teamsLink = screen.getByText('Teams').closest('a');
      expect(teamsLink).not.toHaveClass('cursor-not-allowed');
    });

    it('should enable Teams link for enterprise users', () => {
      render(<DashboardNavigation userPlan="enterprise" />);

      const teamsLink = screen.getByText('Teams').closest('a');
      expect(teamsLink).not.toHaveClass('cursor-not-allowed');
    });

    it('should prevent navigation when clicking disabled link', () => {
      render(<DashboardNavigation userPlan="free" />);

      const teamsLink = screen.getByText('Teams').closest('a');
      fireEvent.click(teamsLink!);

      // Link should have href="#" for disabled state
      expect(teamsLink).toHaveAttribute('href', '#');
    });
  });

  describe('Mobile Responsiveness', () => {
    it('should render mobile menu button', () => {
      render(<DashboardNavigation />);

      // Mobile menu button should exist (hidden on desktop)
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should toggle mobile menu when button is clicked', () => {
      render(<DashboardNavigation />);

      // Find and click the mobile menu button
      const menuButtons = screen.getAllByRole('button');
      const mobileMenuButton = menuButtons[0]; // First button should be the mobile menu toggle

      fireEvent.click(mobileMenuButton);

      // Menu should be visible after click
      const navigation = screen.getByRole('navigation');
      expect(navigation).toBeInTheDocument();
    });
  });

  describe('Navigation Links', () => {
    it('should have correct href attributes', () => {
      render(<DashboardNavigation />);

      expect(screen.getByText('Dashboard').closest('a')).toHaveAttribute('href', '/dashboard');
      expect(screen.getByText('Sites').closest('a')).toHaveAttribute('href', '/dashboard/sites');
      expect(screen.getByText('Content').closest('a')).toHaveAttribute('href', '/dashboard/content');
      expect(screen.getByText('Analytics').closest('a')).toHaveAttribute('href', '/dashboard/analytics');
      expect(screen.getByText('Settings').closest('a')).toHaveAttribute('href', '/dashboard/settings');
      expect(screen.getByText('Billing').closest('a')).toHaveAttribute('href', '/dashboard/billing');
    });
  });

  describe('Icons', () => {
    it('should render icons for each navigation item', () => {
      const { container } = render(<DashboardNavigation />);

      // Check that SVG icons are rendered
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(7); // At least one icon per nav item plus plan section
    });
  });
});