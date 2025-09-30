import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { server, mockFetch } from './setup';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

describe('Site Registration Integration', () => {
  beforeAll(() => {
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe('Site Registration API Flow', () => {
    it('should successfully register a new site', async () => {
      const siteData = {
        domain: 'newsite.com',
        name: 'New Test Site'
      };

      const response = await mockFetch('/api/sites/register', {
        method: 'POST',
        body: JSON.stringify(siteData),
      });

      expect(response.ok).toBe(true);
      
      const data = await response.json();
      
      expect(data).toMatchObject({
        site: {
          domain: 'newsite.com',
          name: 'New Test Site',
          id: expect.any(String),
          created_at: expect.any(String),
        },
        apiKey: expect.any(String),
        siteToken: expect.any(String),
        embedScript: expect.stringContaining('<script src='),
      });

      // Verify embed script contains site ID
      expect(data.embedScript).toContain(`data-site-id="${data.site.id}"`);
      expect(data.embedScript).toContain('recopyfast.js');
      expect(data.embedScript).toContain(`data-site-token="${data.siteToken}"`);
    });

    it('should prevent duplicate domain registration', async () => {
      const siteData = {
        domain: 'existing.com',
        name: 'Existing Site'
      };

      const response = await mockFetch('/api/sites/register', {
        method: 'POST',
        body: JSON.stringify(siteData),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.error).toBe('Domain already registered');
    });

    it('should validate required fields', async () => {
      const testCases = [
        { domain: '', name: 'Test Site' },
        { domain: 'test.com', name: '' },
        { domain: '', name: '' },
        {},
      ];

      for (const testCase of testCases) {
        const response = await mockFetch('/api/sites/register', {
          method: 'POST',
          body: JSON.stringify(testCase),
        });

        expect(response.ok).toBe(false);
        expect(response.status).toBe(400);
        
        const data = await response.json();
        expect(data.error).toBe('Domain and name are required');
      }
    });

    it('should generate unique API keys for different sites', async () => {
      const site1Response = await mockFetch('/api/sites/register', {
        method: 'POST',
        body: JSON.stringify({
          domain: 'site1.com',
          name: 'Site One'
        }),
      });

      const site2Response = await mockFetch('/api/sites/register', {
        method: 'POST',
        body: JSON.stringify({
          domain: 'site2.com',
          name: 'Site Two'
        }),
      });

      const site1Data = await site1Response.json();
      const site2Data = await site2Response.json();

      expect(site1Data.apiKey).not.toBe(site2Data.apiKey);
      expect(site1Data.siteToken).not.toBe(site2Data.siteToken);
      expect(site1Data.site.id).not.toBe(site2Data.site.id);
    });
  });

  describe('Site Registration UI Integration', () => {
    // Mock SiteRegistrationForm component for testing
    const MockSiteRegistrationForm = () => {
      const [domain, setDomain] = React.useState('');
      const [name, setName] = React.useState('');
      const [isLoading, setIsLoading] = React.useState(false);
      const [result, setResult] = React.useState<{
        site: { id: string };
        apiKey: string;
        siteToken: string;
        embedScript: string;
      } | null>(null);
      const [error, setError] = React.useState<string | null>(null);

      const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
          const response = await fetch('/api/sites/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, name }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error);
          }

          setResult(data);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Registration failed');
        } finally {
          setIsLoading(false);
        }
      };

      return (
        <form onSubmit={handleSubmit} data-testid="site-registration-form">
          <input
            type="text"
            placeholder="Domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            data-testid="domain-input"
          />
          <input
            type="text"
            placeholder="Site Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="name-input"
          />
          <button type="submit" disabled={isLoading} data-testid="submit-button">
            {isLoading ? 'Registering...' : 'Register Site'}
          </button>
          {error && <div data-testid="error-message">{error}</div>}
          {result && (
            <div data-testid="success-result">
              <div data-testid="site-id">{result.site.id}</div>
              <div data-testid="api-key">{result.apiKey}</div>
              <div data-testid="embed-script">{result.embedScript}</div>
            </div>
          )}
        </form>
      );
    };

    it('should handle successful site registration through UI', async () => {
      render(<MockSiteRegistrationForm />);

      // Fill out the form
      fireEvent.change(screen.getByTestId('domain-input'), {
        target: { value: 'testui.com' }
      });
      fireEvent.change(screen.getByTestId('name-input'), {
        target: { value: 'Test UI Site' }
      });

      // Submit the form
      fireEvent.click(screen.getByTestId('submit-button'));

      // Check loading state
      expect(screen.getByTestId('submit-button')).toHaveTextContent('Registering...');
      expect(screen.getByTestId('submit-button')).toBeDisabled();

      // Wait for success
      await waitFor(() => {
        expect(screen.getByTestId('success-result')).toBeInTheDocument();
      });

      // Verify results are displayed
      expect(screen.getByTestId('site-id')).toBeInTheDocument();
      expect(screen.getByTestId('api-key')).toBeInTheDocument();
      expect(screen.getByTestId('embed-script')).toBeInTheDocument();

      // Check that button is no longer loading
      expect(screen.getByTestId('submit-button')).toHaveTextContent('Register Site');
      expect(screen.getByTestId('submit-button')).not.toBeDisabled();
    });

    it('should handle registration errors through UI', async () => {
      render(<MockSiteRegistrationForm />);

      // Fill out the form with existing domain
      fireEvent.change(screen.getByTestId('domain-input'), {
        target: { value: 'existing.com' }
      });
      fireEvent.change(screen.getByTestId('name-input'), {
        target: { value: 'Existing Site' }
      });

      // Submit the form
      fireEvent.click(screen.getByTestId('submit-button'));

      // Wait for error
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument();
      });

      // Verify error message
      expect(screen.getByTestId('error-message')).toHaveTextContent('Domain already registered');

      // Ensure success result is not shown
      expect(screen.queryByTestId('success-result')).not.toBeInTheDocument();
    });

    it('should handle form validation through UI', async () => {
      render(<MockSiteRegistrationForm />);

      // Submit empty form
      fireEvent.click(screen.getByTestId('submit-button'));

      // Wait for error
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument();
      });

      // Verify validation error message
      expect(screen.getByTestId('error-message')).toHaveTextContent('Domain and name are required');
    });
  });

  describe('Site Registration Data Flow', () => {
    it('should maintain data consistency throughout registration process', async () => {
      const originalSiteData = {
        domain: 'consistency-test.com',
        name: 'Consistency Test Site'
      };

      // Step 1: Register site
      const registrationResponse = await mockFetch('/api/sites/register', {
        method: 'POST',
        body: JSON.stringify(originalSiteData),
      });

      const registrationData = await registrationResponse.json();

      // Step 2: Verify site data structure
      expect(registrationData.site).toMatchObject({
        domain: originalSiteData.domain,
        name: originalSiteData.name,
        id: expect.any(String),
        created_at: expect.any(String),
      });

      // Step 3: Verify API key format
      expect(registrationData.apiKey).toMatch(/^test-api-key-[a-z0-9]+$/);
      expect(registrationData.siteToken).toMatch(/^test-site-token-[a-z0-9]+$/i);

      // Step 4: Verify embed script format
      const embedScript = registrationData.embedScript;
      expect(embedScript).toContain('recopyfast.js');
      expect(embedScript).toContain(`data-site-id="${registrationData.site.id}"`);
      expect(embedScript).toContain(`data-site-token="${registrationData.siteToken}"`);
      expect(embedScript).toMatch(/<script[^>]*><\/script>/);

      // Step 5: Extract site ID from embed script and verify consistency
      const siteIdMatch = embedScript.match(/data-site-id="([^"]+)"/);
      expect(siteIdMatch?.[1]).toBe(registrationData.site.id);

      const tokenMatch = embedScript.match(/data-site-token="([^"]+)"/);
      expect(tokenMatch?.[1]).toBe(registrationData.siteToken);
    });
  });
});

// Add React import for JSX
import React from 'react';
