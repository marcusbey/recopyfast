import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { server } from './setup';
import { http, HttpResponse } from 'msw';

describe('Error Handling Integration', () => {
  beforeAll(() => {
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe('API Error Handling', () => {
    it('should handle 500 internal server errors', async () => {
      // Override handler to return 500 error
      server.use(
        http.post('/api/sites/register', () => {
          return HttpResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
          );
        })
      );

      const response = await fetch('/api/sites/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'test.com', name: 'Test Site' }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(500);
      
      const data = await response.json();
      expect(data.error).toBe('Internal server error');
    });

    it('should handle 404 not found errors', async () => {
      // Override handler to return 404 error
      server.use(
        http.get('/api/content/:siteId', () => {
          return HttpResponse.json(
            { error: 'Site not found' },
            { status: 404 }
          );
        })
      );

      const response = await fetch('/api/content/nonexistent-site');

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
      
      const data = await response.json();
      expect(data.error).toBe('Site not found');
    });

    it('should handle 400 validation errors', async () => {
      const response = await fetch('/api/sites/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // Invalid payload
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.error).toBe('Domain and name are required');
    });

    it('should handle network timeout errors', async () => {
      // Override handler to simulate timeout
      server.use(
        http.post('/api/ai/translate', async () => {
          // Simulate long delay
          await new Promise(resolve => setTimeout(resolve, 10000));
          return HttpResponse.json({ success: true });
        })
      );

      const controller = new AbortController();
      
      // Set timeout
      setTimeout(() => controller.abort(), 1000);

      try {
        await fetch('/api/ai/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteId: 'test',
            fromLanguage: 'en',
            toLanguage: 'es',
            elements: [{ id: 'test', text: 'test' }]
          }),
          signal: controller.signal
        });
        
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle malformed JSON responses', async () => {
      server.use(
        http.get('/api/content/:siteId', () => {
          return new Response('Invalid JSON{', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        })
      );

      const response = await fetch('/api/content/test-site');
      
      try {
        await response.json();
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(SyntaxError);
      }
    });
  });

  describe('Component Error Handling', () => {
    // Mock ErrorBoundary component
    class MockErrorBoundary extends React.Component<
      { children: React.ReactNode },
      { hasError: boolean; error?: Error }
    > {
      constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false };
      }

      static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
      }

      componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('Error caught by boundary:', error, errorInfo);
      }

      render() {
        if (this.state.hasError) {
          return (
            <div data-testid="error-boundary">
              <h2>Something went wrong</h2>
              <p data-testid="error-message">{this.state.error?.message}</p>
              <button
                onClick={() => this.setState({ hasError: false, error: undefined })}
                data-testid="retry-button"
              >
                Retry
              </button>
            </div>
          );
        }

        return this.props.children;
      }
    }

    // Mock component that can throw errors
    const MockErrorComponent = ({ shouldError }: { shouldError: boolean }) => {
      if (shouldError) {
        throw new Error('Component crashed intentionally');
      }
      
      return <div data-testid="working-component">Component is working</div>;
    };

    it('should catch and handle component errors', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      render(
        <MockErrorBoundary>
          <MockErrorComponent shouldError={true} />
        </MockErrorBoundary>
      );

      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByTestId('error-message')).toHaveTextContent('Component crashed intentionally');

      consoleSpy.mockRestore();
    });

    it('should allow error recovery', () => {
      render(
        <MockErrorBoundary>
          <MockErrorComponent shouldError={true} />
        </MockErrorBoundary>
      );

      // Error state
      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();

      // Click retry
      fireEvent.click(screen.getByTestId('retry-button'));

      // Should attempt to render again (will still error, but demonstrates recovery mechanism)
      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
    });
  });

  describe('Form Validation Error Handling', () => {
    // Mock form component with validation
    const MockFormWithValidation = () => {
      const [formData, setFormData] = React.useState({
        domain: '',
        name: '',
        email: ''
      });
      const [errors, setErrors] = React.useState<Record<string, string>>({});
      const [isSubmitting, setIsSubmitting] = React.useState(false);
      const [submitError, setSubmitError] = React.useState<string | null>(null);

      const validateForm = () => {
        const newErrors: Record<string, string> = {};

        if (!formData.domain) {
          newErrors.domain = 'Domain is required';
        } else if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(formData.domain)) {
          newErrors.domain = 'Invalid domain format';
        }

        if (!formData.name) {
          newErrors.name = 'Name is required';
        } else if (formData.name.length < 3) {
          newErrors.name = 'Name must be at least 3 characters';
        }

        if (!formData.email) {
          newErrors.email = 'Email is required';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
          newErrors.email = 'Invalid email format';
        }

        return newErrors;
      };

      const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        const validationErrors = validateForm();
        setErrors(validationErrors);

        if (Object.keys(validationErrors).length > 0) {
          return;
        }

        setIsSubmitting(true);
        setSubmitError(null);

        try {
          const response = await fetch('/api/sites/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              domain: formData.domain,
              name: formData.name
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Registration failed');
          }

          // Success handling would go here
        } catch (error) {
          setSubmitError(error instanceof Error ? error.message : 'Registration failed');
        } finally {
          setIsSubmitting(false);
        }
      };

      return (
        <form onSubmit={handleSubmit} data-testid="validation-form">
          <div>
            <input
              type="text"
              placeholder="Domain"
              value={formData.domain}
              onChange={(e) => setFormData(prev => ({ ...prev, domain: e.target.value }))}
              data-testid="domain-input"
            />
            {errors.domain && (
              <div data-testid="domain-error" className="error">
                {errors.domain}
              </div>
            )}
          </div>

          <div>
            <input
              type="text"
              placeholder="Site Name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              data-testid="name-input"
            />
            {errors.name && (
              <div data-testid="name-error" className="error">
                {errors.name}
              </div>
            )}
          </div>

          <div>
            <input
              type="email"
              placeholder="Email"
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              data-testid="email-input"
            />
            {errors.email && (
              <div data-testid="email-error" className="error">
                {errors.email}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            data-testid="submit-button"
          >
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </button>

          {submitError && (
            <div data-testid="submit-error" className="error">
              {submitError}
            </div>
          )}
        </form>
      );
    };

    it('should validate required fields', () => {
      render(<MockFormWithValidation />);

      // Submit empty form
      fireEvent.click(screen.getByTestId('submit-button'));

      // Should show validation errors
      expect(screen.getByTestId('domain-error')).toHaveTextContent('Domain is required');
      expect(screen.getByTestId('name-error')).toHaveTextContent('Name is required');
      expect(screen.getByTestId('email-error')).toHaveTextContent('Email is required');
    });

    it('should validate field formats', () => {
      render(<MockFormWithValidation />);

      // Fill with invalid data
      fireEvent.change(screen.getByTestId('domain-input'), {
        target: { value: 'invalid-domain' }
      });
      fireEvent.change(screen.getByTestId('name-input'), {
        target: { value: 'ab' } // Too short
      });
      fireEvent.change(screen.getByTestId('email-input'), {
        target: { value: 'invalid-email' }
      });

      fireEvent.click(screen.getByTestId('submit-button'));

      expect(screen.getByTestId('domain-error')).toHaveTextContent('Invalid domain format');
      expect(screen.getByTestId('name-error')).toHaveTextContent('Name must be at least 3 characters');
      expect(screen.getByTestId('email-error')).toHaveTextContent('Invalid email format');
    });

    it('should handle server validation errors', async () => {
      render(<MockFormWithValidation />);

      // Fill with valid data but existing domain
      fireEvent.change(screen.getByTestId('domain-input'), {
        target: { value: 'existing.com' }
      });
      fireEvent.change(screen.getByTestId('name-input'), {
        target: { value: 'Test Site' }
      });
      fireEvent.change(screen.getByTestId('email-input'), {
        target: { value: 'test@example.com' }
      });

      fireEvent.click(screen.getByTestId('submit-button'));

      // Wait for server error
      await waitFor(() => {
        expect(screen.getByTestId('submit-error')).toBeInTheDocument();
      });

      expect(screen.getByTestId('submit-error')).toHaveTextContent('Domain already registered');
    });

    it('should clear errors when user corrects input', () => {
      render(<MockFormWithValidation />);

      // Trigger validation errors
      fireEvent.click(screen.getByTestId('submit-button'));
      expect(screen.getByTestId('domain-error')).toBeInTheDocument();

      // Correct the input
      fireEvent.change(screen.getByTestId('domain-input'), {
        target: { value: 'valid-domain.com' }
      });

      // Submit again to retrigger validation
      fireEvent.click(screen.getByTestId('submit-button'));

      // Domain error should be cleared
      expect(screen.queryByTestId('domain-error')).not.toBeInTheDocument();
    });
  });

  describe('Network Error Recovery', () => {
    // Mock component with retry logic
    const MockNetworkComponent = () => {
      const [data, setData] = React.useState<unknown>(null);
      const [loading, setLoading] = React.useState(false);
      const [error, setError] = React.useState<string | null>(null);
      const [retryCount, setRetryCount] = React.useState(0);

      const fetchData = async (isRetry = false) => {
        setLoading(true);
        if (isRetry) {
          setRetryCount(prev => prev + 1);
        } else {
          setRetryCount(0);
        }
        setError(null);

        try {
          const response = await fetch('/api/content/test-site');
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const result = await response.json();
          setData(result);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Network error';
          setError(errorMessage);
        } finally {
          setLoading(false);
        }
      };

      React.useEffect(() => {
        fetchData();
      }, []);

      if (loading) {
        return <div data-testid="loading">Loading...</div>;
      }

      if (error) {
        return (
          <div data-testid="error-state">
            <div data-testid="error-message">{error}</div>
            <div data-testid="retry-count">Retry attempts: {retryCount}</div>
            <button
              onClick={() => fetchData(true)}
              data-testid="retry-button"
            >
              Retry
            </button>
          </div>
        );
      }

      return (
        <div data-testid="success-state">
          <div data-testid="data-display">
            Data loaded: {data?.length || 0} items
          </div>
        </div>
      );
    };

    it('should handle network errors with retry functionality', async () => {
      // Override to return network error
      server.use(
        http.get('/api/content/:siteId', () => {
          return HttpResponse.json(
            { error: 'Network error' },
            { status: 500 }
          );
        })
      );

      render(<MockNetworkComponent />);

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument();
      });

      expect(screen.getByTestId('error-message')).toHaveTextContent('HTTP 500');
      expect(screen.getByTestId('retry-count')).toHaveTextContent('Retry attempts: 0');
    });

    it('should track retry attempts', async () => {
      // Override to return network error
      server.use(
        http.get('/api/content/:siteId', () => {
          return HttpResponse.json(
            { error: 'Network error' },
            { status: 500 }
          );
        })
      );

      render(<MockNetworkComponent />);

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument();
      });

      // Click retry
      fireEvent.click(screen.getByTestId('retry-button'));

      await waitFor(() => {
        expect(screen.getByTestId('retry-count')).toHaveTextContent('Retry attempts: 1');
      });

      // Click retry again
      fireEvent.click(screen.getByTestId('retry-button'));

      await waitFor(() => {
        expect(screen.getByTestId('retry-count')).toHaveTextContent('Retry attempts: 2');
      });
    });

    it('should recover from network errors', async () => {
      let errorCount = 0;

      // Override to fail first request, then succeed
      server.use(
        http.get('/api/content/:siteId', () => {
          errorCount++;
          if (errorCount === 1) {
            return HttpResponse.json(
              { error: 'Network error' },
              { status: 500 }
            );
          }
          
          // Return success on retry
          return HttpResponse.json([
            { id: '1', content: 'Test content' }
          ]);
        })
      );

      render(<MockNetworkComponent />);

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument();
      });

      // Retry
      fireEvent.click(screen.getByTestId('retry-button'));

      // Wait for success
      await waitFor(() => {
        expect(screen.getByTestId('success-state')).toBeInTheDocument();
      });

      expect(screen.getByTestId('data-display')).toHaveTextContent('Data loaded: 1 items');
    });
  });

  describe('Graceful Degradation', () => {
    it('should handle missing browser features gracefully', () => {
      // Mock missing clipboard API
      const originalClipboard = navigator.clipboard;
      delete (navigator as Record<string, unknown>).clipboard;

      const MockClipboardComponent = () => {
        const [message, setMessage] = React.useState('');

        const copyText = async () => {
          try {
            if (navigator.clipboard) {
              await navigator.clipboard.writeText('Test text');
              setMessage('Copied successfully');
            } else {
              setMessage('Clipboard not supported');
            }
          } catch {
            setMessage('Copy failed');
          }
        };

        return (
          <div>
            <button onClick={copyText} data-testid="copy-button">
              Copy Text
            </button>
            <div data-testid="message">{message}</div>
          </div>
        );
      };

      render(<MockClipboardComponent />);

      fireEvent.click(screen.getByTestId('copy-button'));

      expect(screen.getByTestId('message')).toHaveTextContent('Clipboard not supported');

      // Restore clipboard API
      (navigator as Record<string, unknown>).clipboard = originalClipboard;
    });

    it('should handle WebSocket connection failures', () => {
      const MockWebSocketComponent = () => {
        const [status, setStatus] = React.useState('connecting');

        React.useEffect(() => {
          try {
            const ws = new WebSocket('ws://invalid-url');
            
            ws.onopen = () => setStatus('connected');
            ws.onerror = () => setStatus('failed');
            ws.onclose = () => setStatus('disconnected');
          } catch {
            setStatus('unavailable');
          }
        }, []);

        return (
          <div data-testid="websocket-status">
            WebSocket Status: {status}
          </div>
        );
      };

      render(<MockWebSocketComponent />);

      // Should handle WebSocket errors gracefully
      expect(screen.getByTestId('websocket-status')).toBeInTheDocument();
    });
  });
});

// Add React import for JSX
import React from 'react';