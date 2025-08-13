import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { server, mockFetch } from './setup';
import TranslationDashboard from '@/components/dashboard/TranslationDashboard';

describe('Translation Workflow Integration', () => {
  beforeAll(() => {
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  const mockContentElements = [
    {
      id: 'content-1',
      element_id: 'hero-title',
      selector: '#hero-title',
      current_content: 'Welcome to Our Amazing Platform',
      site_id: 'test-site',
    },
    {
      id: 'content-2',
      element_id: 'hero-subtitle',
      selector: '#hero-subtitle',
      current_content: 'We provide the best solutions for your business needs',
      site_id: 'test-site',
    },
    {
      id: 'content-3',
      element_id: 'cta-button',
      selector: '.cta-button',
      current_content: 'Get Started Now',
      site_id: 'test-site',
    }
  ];

  describe('Translation API Flow', () => {
    it('should successfully translate content elements', async () => {
      const translationRequest = {
        siteId: 'test-site-123',
        fromLanguage: 'en',
        toLanguage: 'es',
        elements: [
          { id: 'hero-title', text: 'Welcome to Our Platform' },
          { id: 'hero-subtitle', text: 'Best solutions for your business' }
        ],
        context: 'website landing page'
      };

      const response = await mockFetch('/api/ai/translate', {
        method: 'POST',
        body: JSON.stringify(translationRequest),
      });

      expect(response.ok).toBe(true);
      
      const data = await response.json();
      
      expect(data).toMatchObject({
        success: true,
        translations: expect.arrayContaining([
          expect.objectContaining({
            id: 'hero-title',
            originalText: 'Welcome to Our Platform',
            translatedText: '[ES] Welcome to Our Platform'
          }),
          expect.objectContaining({
            id: 'hero-subtitle',
            originalText: 'Best solutions for your business',
            translatedText: '[ES] Best solutions for your business'
          })
        ]),
        tokensUsed: 150,
        message: expect.stringContaining('Successfully translated 2 elements to es')
      });
    });

    it('should validate translation request parameters', async () => {
      const invalidRequests = [
        {}, // Missing all required fields
        { siteId: 'test' }, // Missing other required fields
        { siteId: 'test', fromLanguage: 'en' }, // Missing toLanguage and elements
        { siteId: 'test', fromLanguage: 'en', toLanguage: 'es' }, // Missing elements
        { 
          siteId: 'test', 
          fromLanguage: 'en', 
          toLanguage: 'es', 
          elements: [] 
        }, // Empty elements array
      ];

      for (const invalidRequest of invalidRequests) {
        const response = await mockFetch('/api/ai/translate', {
          method: 'POST',
          body: JSON.stringify(invalidRequest),
        });

        expect(response.ok).toBe(false);
        expect(response.status).toBe(400);
        
        const data = await response.json();
        expect(data.error).toBe('Missing required fields: siteId, fromLanguage, toLanguage, elements');
      }
    });

    it('should handle translation service errors', async () => {
      const translationRequest = {
        siteId: 'test-site-123',
        fromLanguage: 'en',
        toLanguage: 'error-lang', // This triggers error in mock
        elements: [{ id: 'test', text: 'Test content' }],
      };

      const response = await mockFetch('/api/ai/translate', {
        method: 'POST',
        body: JSON.stringify(translationRequest),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(500);
      
      const data = await response.json();
      expect(data.error).toBe('Translation service unavailable');
    });

    it('should handle nonexistent site', async () => {
      const translationRequest = {
        siteId: 'nonexistent-site',
        fromLanguage: 'en',
        toLanguage: 'es',
        elements: [{ id: 'test', text: 'Test content' }],
      };

      const response = await mockFetch('/api/ai/translate', {
        method: 'POST',
        body: JSON.stringify(translationRequest),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
      
      const data = await response.json();
      expect(data.error).toBe('Site not found');
    });
  });

  describe('Translation Dashboard Component Integration', () => {
    it('should render translation dashboard with content elements', () => {
      render(
        <TranslationDashboard 
          siteId="test-site" 
          contentElements={mockContentElements} 
        />
      );

      // Check if main components are rendered
      expect(screen.getByText('AI Translation')).toBeInTheDocument();
      expect(screen.getByText('From Language')).toBeInTheDocument();
      expect(screen.getByText('To Language')).toBeInTheDocument();
      expect(screen.getByText('Select Content to Translate')).toBeInTheDocument();

      // Check if content elements are displayed
      mockContentElements.forEach((element) => {
        expect(screen.getByText(element.current_content)).toBeInTheDocument();
        expect(screen.getByText(element.selector)).toBeInTheDocument();
      });

      // Check if translate button is present but disabled initially
      const translateButton = screen.getByText('Translate with AI');
      expect(translateButton).toBeInTheDocument();
      expect(translateButton).toBeDisabled();
    });

    it('should handle element selection', () => {
      render(
        <TranslationDashboard 
          siteId="test-site" 
          contentElements={mockContentElements} 
        />
      );

      // Initially no elements selected
      expect(screen.getByText('0 of 3 elements selected')).toBeInTheDocument();

      // Select first element
      const firstCheckbox = screen.getAllByRole('checkbox')[0];
      fireEvent.click(firstCheckbox);

      expect(screen.getByText('1 of 3 elements selected')).toBeInTheDocument();

      // Translate button should now be enabled
      const translateButton = screen.getByText('Translate with AI');
      expect(translateButton).not.toBeDisabled();
    });

    it('should handle select all functionality', () => {
      render(
        <TranslationDashboard 
          siteId="test-site" 
          contentElements={mockContentElements} 
        />
      );

      // Click "Select All"
      fireEvent.click(screen.getByText('Select All'));

      expect(screen.getByText('3 of 3 elements selected')).toBeInTheDocument();

      // All checkboxes should be checked
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(checkbox => {
        expect(checkbox).toBeChecked();
      });

      // Click "Deselect All"
      fireEvent.click(screen.getByText('Deselect All'));

      expect(screen.getByText('0 of 3 elements selected')).toBeInTheDocument();

      // All checkboxes should be unchecked
      checkboxes.forEach(checkbox => {
        expect(checkbox).not.toBeChecked();
      });
    });

    it('should handle language selection', () => {
      render(
        <TranslationDashboard 
          siteId="test-site" 
          contentElements={mockContentElements} 
        />
      );

      // Change from language to German
      const fromLanguageSelect = screen.getByDisplayValue('🇺🇸 English');
      fireEvent.change(fromLanguageSelect, { target: { value: 'de' } });

      // Change to language to French
      const toLanguageSelect = screen.getByDisplayValue('🇪🇸 Spanish');
      fireEvent.change(toLanguageSelect, { target: { value: 'fr' } });

      // Verify language indicator shows correct flags
      expect(screen.getByText('🇩🇪 → 🇫🇷')).toBeInTheDocument();
    });

    it('should handle translation workflow', async () => {
      render(
        <TranslationDashboard 
          siteId="test-site" 
          contentElements={mockContentElements} 
        />
      );

      // Select elements
      fireEvent.click(screen.getByText('Select All'));

      // Set languages
      const toLanguageSelect = screen.getByDisplayValue('🇪🇸 Spanish');
      fireEvent.change(toLanguageSelect, { target: { value: 'fr' } });

      // Start translation
      const translateButton = screen.getByText('Translate with AI');
      fireEvent.click(translateButton);

      // Check loading state
      expect(screen.getByText('Translating...')).toBeInTheDocument();
      expect(translateButton).toBeDisabled();

      // Wait for translation to complete
      await waitFor(() => {
        expect(screen.queryByText('Translating...')).not.toBeInTheDocument();
      });

      // Check success message
      expect(screen.getByText(/Successfully translated 3 elements to French/)).toBeInTheDocument();

      // Check that results are displayed
      expect(screen.getByText('Translation Results')).toBeInTheDocument();
    });

    it('should handle translation errors', async () => {
      render(
        <TranslationDashboard 
          siteId="test-site" 
          contentElements={mockContentElements} 
        />
      );

      // Select elements
      fireEvent.click(screen.getByText('Select All'));

      // Set error-triggering language
      const toLanguageSelect = screen.getByDisplayValue('🇪🇸 Spanish');
      fireEvent.change(toLanguageSelect, { target: { value: 'error-lang' } });

      // Start translation
      fireEvent.click(screen.getByText('Translate with AI'));

      // Wait for error - the error message will be different due to validation
      await waitFor(() => {
        expect(screen.getByText(/Missing required fields|Translation service unavailable/)).toBeInTheDocument();
      });

      // Ensure success message is not shown
      expect(screen.queryByText(/Successfully translated/)).not.toBeInTheDocument();
    });

    it('should prevent translation with no elements selected', () => {
      render(
        <TranslationDashboard 
          siteId="test-site" 
          contentElements={mockContentElements} 
        />
      );

      // Try to translate without selecting elements
      fireEvent.click(screen.getByText('Translate with AI'));

      // Should show error message
      expect(screen.getByText('Please select at least one element to translate')).toBeInTheDocument();
    });
  });

  describe('Complete Translation Workflow', () => {
    it('should complete full translation workflow from selection to results', async () => {
      render(
        <TranslationDashboard 
          siteId="test-site" 
          contentElements={mockContentElements} 
        />
      );

      // Step 1: Select specific elements
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]); // Select first element
      fireEvent.click(checkboxes[2]); // Select third element

      expect(screen.getByText('2 of 3 elements selected')).toBeInTheDocument();

      // Step 2: Configure languages
      const fromLanguageSelect = screen.getByDisplayValue('🇺🇸 English');
      fireEvent.change(fromLanguageSelect, { target: { value: 'en' } });

      const toLanguageSelect = screen.getByDisplayValue('🇪🇸 Spanish');
      fireEvent.change(toLanguageSelect, { target: { value: 'de' } });

      // Step 3: Start translation
      const translateButton = screen.getByText('Translate with AI');
      expect(translateButton).not.toBeDisabled();
      fireEvent.click(translateButton);

      // Step 4: Verify loading state
      expect(screen.getByText('Translating...')).toBeInTheDocument();
      expect(translateButton).toBeDisabled();

      // Step 5: Wait for completion
      await waitFor(() => {
        expect(screen.queryByText('Translating...')).not.toBeInTheDocument();
      });

      // Step 6: Verify success
      expect(screen.getByText(/Successfully translated 2 elements to German/)).toBeInTheDocument();

      // Step 7: Verify results structure
      expect(screen.getByText('Translation Results')).toBeInTheDocument();
      
      // Should show original and translated text sections
      expect(screen.getByText('Original (English)')).toBeInTheDocument();
      expect(screen.getByText('Translation (German)')).toBeInTheDocument();
    });

    it('should handle multiple translation requests in sequence', async () => {
      render(
        <TranslationDashboard 
          siteId="test-site" 
          contentElements={mockContentElements} 
        />
      );

      // First translation: English to Spanish
      fireEvent.click(screen.getByText('Select All'));
      fireEvent.click(screen.getByText('Translate with AI'));

      await waitFor(() => {
        expect(screen.getByText(/Successfully translated 3 elements to Spanish/)).toBeInTheDocument();
      });

      // Second translation: English to French
      const toLanguageSelect = screen.getByDisplayValue('🇪🇸 Spanish');
      fireEvent.change(toLanguageSelect, { target: { value: 'fr' } });

      fireEvent.click(screen.getByText('Translate with AI'));

      await waitFor(() => {
        expect(screen.getByText(/Successfully translated 3 elements to French/)).toBeInTheDocument();
      });

      // Should show latest translation results
      expect(screen.getByText('Translation (French)')).toBeInTheDocument();
    });

    it('should maintain state during error recovery', async () => {
      render(
        <TranslationDashboard 
          siteId="test-site" 
          contentElements={mockContentElements} 
        />
      );

      // Select elements
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);

      // First attempt with error language
      const toLanguageSelect = screen.getByDisplayValue('🇪🇸 Spanish');
      fireEvent.change(toLanguageSelect, { target: { value: 'error-lang' } });

      fireEvent.click(screen.getByText('Translate with AI'));

      await waitFor(() => {
        expect(screen.getByText('Translation service unavailable')).toBeInTheDocument();
      });

      // Verify selections are maintained
      expect(screen.getByText('2 of 3 elements selected')).toBeInTheDocument();

      // Second attempt with valid language
      fireEvent.change(toLanguageSelect, { target: { value: 'fr' } });
      fireEvent.click(screen.getByText('Translate with AI'));

      await waitFor(() => {
        expect(screen.getByText(/Successfully translated 2 elements to French/)).toBeInTheDocument();
      });

      // Error should be cleared
      expect(screen.queryByText('Translation service unavailable')).not.toBeInTheDocument();
    });
  });
});

// Add React import for JSX
import React from 'react';