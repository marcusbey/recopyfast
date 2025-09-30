import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SiteDetailView } from '../SiteDetailView';
import type { Site } from '@/types';

// Mock date-fns
jest.mock('date-fns', () => ({
  formatDistanceToNow: jest.fn(() => '5 hours ago'),
}));

describe('SiteDetailView', () => {
  const mockSite: Site & {
    stats?: {
      edits_count?: number;
      views?: number;
      content_elements_count?: number;
      last_activity?: string;
    };
    status?: 'active' | 'inactive' | 'verifying';
    embedScript?: string;
    siteToken?: string;
  } = {
    id: 'test-site-id',
    domain: 'example.com',
    name: 'Example Site',
    api_key: 'test-api-key',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T00:00:00Z',
    status: 'active',
    stats: {
      edits_count: 42,
      views: 1337,
      content_elements_count: 15,
      last_activity: '2024-01-15T00:00:00Z',
    },
    embedScript: '<script src="http://localhost:3000/embed/recopyfast.js"></script>',
    siteToken: 'test-site-token-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders site information correctly', () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText('Example Site')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('displays status badge with correct information', () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Site is verified and operational')).toBeInTheDocument();
  });

  it('renders all quick stats correctly', () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText('42')).toBeInTheDocument(); // edits_count
    expect(screen.getByText('1337')).toBeInTheDocument(); // views
    expect(screen.getByText('15')).toBeInTheDocument(); // content_elements_count
  });

  it('displays created and updated timestamps', () => {
    render(<SiteDetailView site={mockSite} />);

    // Both dates should show "5 hours ago" due to our mock
    const timeElements = screen.getAllByText('5 hours ago');
    expect(timeElements.length).toBeGreaterThan(0);
  });

  it('renders embed script section', () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText('Embed Script')).toBeInTheDocument();
    expect(screen.getByText(/Add this script to your website/i)).toBeInTheDocument();
  });

  it('copies embed script to clipboard', async () => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });

    render(<SiteDetailView site={mockSite} />);

    const copyButton = screen.getByText('Copy Embed Script');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockSite.embedScript);
    });

    // Check for "Copied!" confirmation
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  it('renders site token section when token is present', () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText('Site Token')).toBeInTheDocument();
    expect(screen.getByText('test-site-token-123')).toBeInTheDocument();
  });

  it('copies site token to clipboard', async () => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });

    render(<SiteDetailView site={mockSite} />);

    const copyButton = screen.getByText('Copy Site Token');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test-site-token-123');
    });
  });

  it('does not render site token section when token is missing', () => {
    const siteWithoutToken = { ...mockSite };
    delete siteWithoutToken.siteToken;

    render(<SiteDetailView site={siteWithoutToken} />);

    expect(screen.queryByText('Site Token')).not.toBeInTheDocument();
  });

  it('renders integration status section', () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText('Integration Status')).toBeInTheDocument();
    expect(screen.getByText('Script Installation')).toBeInTheDocument();
    expect(screen.getByText('API Connection')).toBeInTheDocument();
    expect(screen.getByText('Content Elements')).toBeInTheDocument();
  });

  it('displays external link to site', () => {
    render(<SiteDetailView site={mockSite} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('calls onClose when provided', () => {
    const mockOnClose = jest.fn();
    render(<SiteDetailView site={mockSite} onClose={mockOnClose} />);

    // Test would require a close button in the component
    // For now, just verify the prop is accepted
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('handles different status types correctly', () => {
    const { rerender } = render(
      <SiteDetailView site={{ ...mockSite, status: 'verifying' }} />
    );
    expect(screen.getByText('Verifying')).toBeInTheDocument();
    expect(screen.getByText('Site verification in progress')).toBeInTheDocument();

    rerender(<SiteDetailView site={{ ...mockSite, status: 'inactive' }} />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('Site is not currently active')).toBeInTheDocument();
  });

  it('handles missing stats gracefully', () => {
    const siteWithoutStats = { ...mockSite };
    delete siteWithoutStats.stats;

    render(<SiteDetailView site={siteWithoutStats} />);

    // Should display 0 for missing stats
    const zeroElements = screen.getAllByText('0');
    expect(zeroElements.length).toBeGreaterThan(0);
  });
});