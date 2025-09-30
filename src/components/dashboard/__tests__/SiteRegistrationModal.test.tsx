/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteRegistrationModal } from '../SiteRegistrationModal';
import '@testing-library/jest-dom';

// Mock fetch
global.fetch = jest.fn();

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn(() => Promise.resolve()),
  },
});

describe('SiteRegistrationModal', () => {
  const mockOnClose = jest.fn();
  const mockOnSuccess = jest.fn();

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    onSuccess: mockOnSuccess,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('Initial Rendering', () => {
    it('should render the modal when isOpen is true', () => {
      render(<SiteRegistrationModal {...defaultProps} />);

      expect(screen.getByText('Register New Site')).toBeInTheDocument();
      expect(screen.getByText(/Add a new website to start making your content editable/i)).toBeInTheDocument();
    });

    it('should render all form fields', () => {
      render(<SiteRegistrationModal {...defaultProps} />);

      expect(screen.getByLabelText(/Website Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Website URL/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
    });

    it('should render submit and cancel buttons', () => {
      render(<SiteRegistrationModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: /Register Site/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    });

    it('should not render when isOpen is false', () => {
      render(<SiteRegistrationModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByText('Register New Site')).not.toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('should show error when website name is empty', async () => {
      const user = userEvent.setup();
      render(<SiteRegistrationModal {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      expect(await screen.findByText('Website name is required')).toBeInTheDocument();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should show error when website URL is empty', async () => {
      const user = userEvent.setup();
      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      await user.type(nameInput, 'Test Site');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      expect(await screen.findByText('Website URL is required')).toBeInTheDocument();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should show error for invalid URL format', async () => {
      const user = userEvent.setup();
      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'not a valid url');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      expect(await screen.findByText(/Please enter a valid domain/i)).toBeInTheDocument();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should accept valid domain formats', async () => {
      const user = userEvent.setup();
      const validDomains = [
        'example.com',
        'https://example.com',
        'http://example.com',
        'subdomain.example.com',
      ];

      for (const domain of validDomains) {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            site: {
              id: 'test-id',
              domain: domain,
              name: 'Test Site',
              created_at: '2024-01-01',
            },
            apiKey: 'test-api-key',
            siteToken: 'test-token',
            embedScript: '<script src="test.js"></script>',
          }),
        });

        render(<SiteRegistrationModal {...defaultProps} />);

        const nameInput = screen.getByLabelText(/Website Name/i);
        const domainInput = screen.getByLabelText(/Website URL/i);

        await user.type(nameInput, 'Test Site');
        await user.type(domainInput, domain);

        const submitButton = screen.getByRole('button', { name: /Register Site/i });
        await user.click(submitButton);

        await waitFor(() => {
          expect(global.fetch).toHaveBeenCalled();
        });

        jest.clearAllMocks();
      }
    });

    it('should clear field errors when user starts typing', async () => {
      const user = userEvent.setup();
      render(<SiteRegistrationModal {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      expect(await screen.findByText('Website name is required')).toBeInTheDocument();
      expect(await screen.findByText('Website URL is required')).toBeInTheDocument();

      const nameInput = screen.getByLabelText(/Website Name/i);
      await user.type(nameInput, 'Test');

      expect(screen.queryByText('Website name is required')).not.toBeInTheDocument();
      expect(screen.getByText('Website URL is required')).toBeInTheDocument();
    });
  });

  describe('Successful Registration Flow', () => {
    const mockSuccessResponse = {
      site: {
        id: 'test-site-123',
        domain: 'example.com',
        name: 'Test Site',
        created_at: '2024-01-01T00:00:00Z',
      },
      apiKey: 'test-api-key-abc123',
      siteToken: 'test-site-token-xyz789',
      embedScript: '<script src="http://localhost:3000/embed/recopyfast.js" data-site-id="test-site-123" data-site-token="test-site-token-xyz789"></script>',
    };

    it('should successfully register a site', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse,
      });

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'example.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      expect(await screen.findByText(/Site Registered Successfully!/i)).toBeInTheDocument();
      expect(screen.getByText('Test Site')).toBeInTheDocument();
      expect(screen.getByText('example.com')).toBeInTheDocument();
      expect(screen.getByText('test-site-123')).toBeInTheDocument();
    });

    it('should show loading state during submission', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockImplementationOnce(
        () => new Promise(resolve => setTimeout(() => resolve({
          ok: true,
          json: async () => mockSuccessResponse,
        }), 100))
      );

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'example.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      expect(screen.getByText(/Registering.../i)).toBeInTheDocument();
      expect(submitButton).toBeDisabled();

      await waitFor(() => {
        expect(screen.getByText(/Site Registered Successfully!/i)).toBeInTheDocument();
      });
    });

    it('should display embed script in success state', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse,
      });

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'example.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      expect(await screen.findByText(/Site Registered Successfully!/i)).toBeInTheDocument();
      expect(screen.getByText(/recopyfast.js/)).toBeInTheDocument();
      expect(screen.getByText(/data-site-id="test-site-123"/)).toBeInTheDocument();
    });

    it('should show integration instructions', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse,
      });

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'example.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Integration Instructions/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/Step 1: Copy the embed script/i)).toBeInTheDocument();
      expect(screen.getByText(/Step 2: Add the script to your website/i)).toBeInTheDocument();
      expect(screen.getByText(/Step 3: Mark elements as editable/i)).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle duplicate domain error', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Domain already registered' }),
      });

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'existing.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      expect(await screen.findByText('This domain is already registered')).toBeInTheDocument();
    });

    it('should handle general API errors', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'example.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    });

    it('should handle network errors', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'example.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      expect(await screen.findByText(/An unexpected error occurred/i)).toBeInTheDocument();
    });
  });

  describe('Copy to Clipboard Functionality', () => {
    const mockSuccessResponse = {
      site: {
        id: 'test-site-123',
        domain: 'example.com',
        name: 'Test Site',
        created_at: '2024-01-01T00:00:00Z',
      },
      apiKey: 'test-api-key-abc123',
      siteToken: 'test-site-token-xyz789',
      embedScript: '<script src="http://localhost:3000/embed/recopyfast.js" data-site-id="test-site-123"></script>',
    };

    it('should copy embed script to clipboard', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse,
      });

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'example.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Site Registered Successfully!/i)).toBeInTheDocument();
      });

      const copyButton = screen.getByRole('button', { name: /Copy/i });
      await user.click(copyButton);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockSuccessResponse.embedScript);
      expect(await screen.findByText(/Copied!/i)).toBeInTheDocument();
    });

    it('should show temporary "Copied" state', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse,
      });

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'example.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Site Registered Successfully!/i)).toBeInTheDocument();
      });

      const copyButton = screen.getByRole('button', { name: /Copy/i });
      await user.click(copyButton);

      expect(await screen.findByText(/Copied!/i)).toBeInTheDocument();

      // Wait for the copied state to reset (2 seconds)
      await waitFor(() => {
        expect(screen.getByText(/Copy/i)).toBeInTheDocument();
      }, { timeout: 3000 });
    });
  });

  describe('Modal State Management', () => {
    it('should call onClose when Cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(<SiteRegistrationModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      await user.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when Close button is clicked in success state', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          site: {
            id: 'test-site-123',
            domain: 'example.com',
            name: 'Test Site',
            created_at: '2024-01-01T00:00:00Z',
          },
          apiKey: 'test-api-key-abc123',
          siteToken: 'test-site-token-xyz789',
          embedScript: '<script src="test.js"></script>',
        }),
      });

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'example.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Site Registered Successfully!/i)).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: /^Close$/i });
      await user.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onSuccess when Go to Site Dashboard is clicked', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          site: {
            id: 'test-site-123',
            domain: 'example.com',
            name: 'Test Site',
            created_at: '2024-01-01T00:00:00Z',
          },
          apiKey: 'test-api-key-abc123',
          siteToken: 'test-site-token-xyz789',
          embedScript: '<script src="test.js"></script>',
        }),
      });

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'example.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Site Registered Successfully!/i)).toBeInTheDocument();
      });

      const dashboardButton = screen.getByRole('button', { name: /Go to Site Dashboard/i });
      await user.click(dashboardButton);

      expect(mockOnSuccess).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should reset form state when modal is closed and reopened', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      await user.type(nameInput, 'Test Site');

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      await user.click(cancelButton);

      rerender(<SiteRegistrationModal {...defaultProps} isOpen={false} />);
      rerender(<SiteRegistrationModal {...defaultProps} isOpen={true} />);

      const newNameInput = screen.getByLabelText(/Website Name/i);
      expect(newNameInput).toHaveValue('');
    });
  });

  describe('API Integration', () => {
    it('should send correct data to the API', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          site: {
            id: 'test-site-123',
            domain: 'example.com',
            name: 'Test Site',
            created_at: '2024-01-01T00:00:00Z',
          },
          apiKey: 'test-api-key',
          siteToken: 'test-token',
          embedScript: '<script src="test.js"></script>',
        }),
      });

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, 'Test Site');
      await user.type(domainInput, 'example.com');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/sites/register',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: 'Test Site',
              domain: 'example.com',
            }),
          })
        );
      });
    });

    it('should trim whitespace from input fields', async () => {
      const user = userEvent.setup();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          site: {
            id: 'test-site-123',
            domain: 'example.com',
            name: 'Test Site',
            created_at: '2024-01-01T00:00:00Z',
          },
          apiKey: 'test-api-key',
          siteToken: 'test-token',
          embedScript: '<script src="test.js"></script>',
        }),
      });

      render(<SiteRegistrationModal {...defaultProps} />);

      const nameInput = screen.getByLabelText(/Website Name/i);
      const domainInput = screen.getByLabelText(/Website URL/i);

      await user.type(nameInput, '  Test Site  ');
      await user.type(domainInput, '  example.com  ');

      const submitButton = screen.getByRole('button', { name: /Register Site/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/sites/register',
          expect.objectContaining({
            body: JSON.stringify({
              name: 'Test Site',
              domain: 'example.com',
            }),
          })
        );
      });
    });
  });
});