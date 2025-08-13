import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { server, mockFetch } from './setup';

describe('Content Management Integration', () => {
  beforeAll(() => {
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe('Content Retrieval API Flow', () => {
    it('should fetch content elements for a site', async () => {
      const siteId = 'test-site-123';
      
      const response = await mockFetch(`/api/content/${siteId}`);
      
      expect(response.ok).toBe(true);
      
      const content = await response.json();
      
      expect(Array.isArray(content)).toBe(true);
      expect(content).toHaveLength(2);
      
      // Verify content structure
      content.forEach((element: Record<string, unknown>) => {
        expect(element).toMatchObject({
          id: expect.any(String),
          site_id: siteId,
          element_id: expect.any(String),
          selector: expect.any(String),
          original_content: expect.any(String),
          current_content: expect.any(String),
          language: 'en',
          variant: 'default',
          created_at: expect.any(String),
          updated_at: expect.any(String),
          metadata: expect.any(Object),
        });
      });
    });

    it('should filter content by language and variant', async () => {
      const siteId = 'test-site-123';
      
      // Test with Spanish language
      const spanishResponse = await mockFetch(`/api/content/${siteId}?language=es&variant=premium`);
      const spanishContent = await spanishResponse.json();
      
      spanishContent.forEach((element: Record<string, unknown>) => {
        expect(element.language).toBe('es');
        expect(element.variant).toBe('premium');
      });
      
      // Test with default parameters
      const defaultResponse = await mockFetch(`/api/content/${siteId}`);
      const defaultContent = await defaultResponse.json();
      
      defaultContent.forEach((element: Record<string, unknown>) => {
        expect(element.language).toBe('en');
        expect(element.variant).toBe('default');
      });
    });
  });

  describe('Content Creation API Flow', () => {
    it('should create new content elements', async () => {
      const siteId = 'test-site-123';
      const contentMap = {
        'header-title': {
          selector: '#header-title',
          content: 'New Header Title',
          type: 'heading'
        },
        'main-text': {
          selector: '.main-text',
          content: 'Main content text',
          type: 'paragraph'
        }
      };

      const response = await mockFetch(`/api/content/${siteId}`, {
        method: 'POST',
        body: JSON.stringify(contentMap),
      });

      expect(response.ok).toBe(true);
      
      const result = await response.json();
      expect(result.success).toBe(true);
    });

    it('should handle nonexistent site creation attempt', async () => {
      const siteId = 'nonexistent-site';
      const contentMap = {
        'test-element': {
          selector: '#test',
          content: 'Test content',
          type: 'text'
        }
      };

      const response = await mockFetch(`/api/content/${siteId}`, {
        method: 'POST',
        body: JSON.stringify(contentMap),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
      
      const result = await response.json();
      expect(result.error).toBe('Site not found');
    });
  });

  describe('Content Update API Flow', () => {
    it('should update existing content elements', async () => {
      const siteId = 'test-site-123';
      const updateData = {
        elementId: 'hero-title',
        content: 'Updated Hero Title',
        language: 'en',
        variant: 'default'
      };

      const response = await mockFetch(`/api/content/${siteId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData),
      });

      expect(response.ok).toBe(true);
      
      const result = await response.json();
      expect(result.success).toBe(true);
    });

    it('should validate update request data', async () => {
      const siteId = 'test-site-123';
      
      const invalidRequests = [
        { elementId: '', content: 'Valid content' },
        { elementId: 'valid-id', content: '' },
        { elementId: '', content: '' },
        {}
      ];

      for (const invalidData of invalidRequests) {
        const response = await mockFetch(`/api/content/${siteId}`, {
          method: 'PUT',
          body: JSON.stringify(invalidData),
        });

        expect(response.ok).toBe(false);
        expect(response.status).toBe(400);
        
        const result = await response.json();
        expect(result.error).toBe('ElementId and content are required');
      }
    });
  });

  describe('Content Management UI Integration', () => {
    // Mock ContentManager component
    const MockContentManager = ({ siteId }: { siteId: string }) => {
      const [content, setContent] = React.useState<Record<string, unknown>[]>([]);
      const [loading, setLoading] = React.useState(false);
      const [error, setError] = React.useState<string | null>(null);
      const [selectedLanguage, setSelectedLanguage] = React.useState('en');
      const [editingElement, setEditingElement] = React.useState<string | null>(null);
      const [newContent, setNewContent] = React.useState('');

      const fetchContent = async () => {
        setLoading(true);
        setError(null);
        
        try {
          const response = await fetch(`/api/content/${siteId}?language=${selectedLanguage}`);
          const data = await response.json();
          
          if (!response.ok) {
            throw new Error('Failed to fetch content');
          }
          
          setContent(data);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load content');
        } finally {
          setLoading(false);
        }
      };

      const updateContent = async (elementId: string, newText: string) => {
        try {
          const response = await fetch(`/api/content/${siteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              elementId,
              content: newText,
              language: selectedLanguage
            }),
          });

          if (!response.ok) {
            throw new Error('Failed to update content');
          }

          // Refresh content after update
          await fetchContent();
          setEditingElement(null);
          setNewContent('');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to update content');
        }
      };

      React.useEffect(() => {
        fetchContent();
      }, [siteId, selectedLanguage, fetchContent]);

      return (
        <div data-testid="content-manager">
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            data-testid="language-selector"
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
          </select>

          <button onClick={fetchContent} data-testid="refresh-button">
            Refresh Content
          </button>

          {loading && <div data-testid="loading">Loading...</div>}
          {error && <div data-testid="error">{error}</div>}

          <div data-testid="content-list">
            {content.map((element) => (
              <div key={element.id as string} data-testid={`content-element-${element.element_id}`}>
                <div data-testid="element-selector">{element.selector as string}</div>
                <div data-testid="element-content">
                  {editingElement === element.element_id ? (
                    <div>
                      <textarea
                        value={newContent}
                        onChange={(e) => setNewContent(e.target.value)}
                        data-testid="content-editor"
                      />
                      <button
                        onClick={() => updateContent(element.element_id as string, newContent)}
                        data-testid="save-button"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingElement(null);
                          setNewContent('');
                        }}
                        data-testid="cancel-button"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div>
                      <span>{element.current_content as string}</span>
                      <button
                        onClick={() => {
                          setEditingElement(element.element_id as string);
                          setNewContent(element.current_content as string);
                        }}
                        data-testid={`edit-button-${element.element_id}`}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
                <div data-testid="element-language">{element.language as string}</div>
              </div>
            ))}
          </div>
        </div>
      );
    };

    it('should load and display content elements', async () => {
      render(<MockContentManager siteId="test-site-123" />);

      // Wait for content to load
      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      // Verify content elements are displayed
      expect(screen.getByTestId('content-element-hero-title')).toBeInTheDocument();
      expect(screen.getByTestId('content-element-hero-subtitle')).toBeInTheDocument();

      // Check content details
      const titleElement = screen.getByTestId('content-element-hero-title');
      expect(titleElement).toHaveTextContent('Welcome to Our Site');
      expect(titleElement).toHaveTextContent('#hero-title');
      expect(titleElement).toHaveTextContent('en');
    });

    it('should handle language switching', async () => {
      render(<MockContentManager siteId="test-site-123" />);

      // Wait for initial load
      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      // Switch to Spanish
      fireEvent.change(screen.getByTestId('language-selector'), {
        target: { value: 'es' }
      });

      // Wait for new content to load
      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      // Verify language updated in elements
      const elements = screen.getAllByTestId(/element-language/);
      elements.forEach(element => {
        expect(element).toHaveTextContent('es');
      });
    });

    it('should handle content editing workflow', async () => {
      render(<MockContentManager siteId="test-site-123" />);

      // Wait for content to load
      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      // Start editing
      fireEvent.click(screen.getByTestId('edit-button-hero-title'));

      // Verify edit mode
      expect(screen.getByTestId('content-editor')).toBeInTheDocument();
      expect(screen.getByTestId('save-button')).toBeInTheDocument();
      expect(screen.getByTestId('cancel-button')).toBeInTheDocument();

      // Update content
      fireEvent.change(screen.getByTestId('content-editor'), {
        target: { value: 'Updated Hero Title' }
      });

      // Save changes
      fireEvent.click(screen.getByTestId('save-button'));

      // Wait for save to complete
      await waitFor(() => {
        expect(screen.queryByTestId('content-editor')).not.toBeInTheDocument();
      });

      // Content should be refreshed (mocked to return original content)
      expect(screen.getByTestId('content-element-hero-title')).toHaveTextContent('Welcome to Our Site');
    });

    it('should handle edit cancellation', async () => {
      render(<MockContentManager siteId="test-site-123" />);

      // Wait for content to load
      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      // Start editing
      fireEvent.click(screen.getByTestId('edit-button-hero-title'));

      // Change content
      fireEvent.change(screen.getByTestId('content-editor'), {
        target: { value: 'Changed but will cancel' }
      });

      // Cancel editing
      fireEvent.click(screen.getByTestId('cancel-button'));

      // Verify edit mode is closed and original content remains
      expect(screen.queryByTestId('content-editor')).not.toBeInTheDocument();
      expect(screen.getByTestId('content-element-hero-title')).toHaveTextContent('Welcome to Our Site');
    });
  });

  describe('Complete Content Management Workflow', () => {
    it('should handle full content lifecycle', async () => {
      const siteId = 'lifecycle-test-site';

      // Step 1: Create initial content
      const initialContent = {
        'page-title': {
          selector: '#page-title',
          content: 'Initial Page Title',
          type: 'heading'
        },
        'page-description': {
          selector: '.description',
          content: 'Initial page description',
          type: 'text'
        }
      };

      const createResponse = await mockFetch(`/api/content/${siteId}`, {
        method: 'POST',
        body: JSON.stringify(initialContent),
      });

      expect(createResponse.ok).toBe(true);

      // Step 2: Retrieve created content
      const getResponse = await mockFetch(`/api/content/${siteId}`);
      const retrievedContent = await getResponse.json();

      expect(retrievedContent).toHaveLength(2);
      expect(retrievedContent[0].element_id).toBe('hero-title'); // From mock
      expect(retrievedContent[1].element_id).toBe('hero-subtitle'); // From mock

      // Step 3: Update content
      const updateResponse = await mockFetch(`/api/content/${siteId}`, {
        method: 'PUT',
        body: JSON.stringify({
          elementId: 'page-title',
          content: 'Updated Page Title',
          language: 'en',
          variant: 'default'
        }),
      });

      expect(updateResponse.ok).toBe(true);

      // Step 4: Retrieve updated content (different language variant)
      const frenchResponse = await mockFetch(`/api/content/${siteId}?language=fr&variant=premium`);
      const frenchContent = await frenchResponse.json();

      frenchContent.forEach((element: Record<string, unknown>) => {
        expect(element.language).toBe('fr');
        expect(element.variant).toBe('premium');
      });
    });
  });
});

// Add React import for JSX
import React from 'react';