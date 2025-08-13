/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TranslationDashboard from '../TranslationDashboard';

// Mock fetch
global.fetch = jest.fn();

// Mock content elements
const mockContentElements = [
  {
    id: '1',
    element_id: 'header-1',
    current_content: 'Welcome to our website',
    selector: 'h1'
  },
  {
    id: '2',
    element_id: 'paragraph-1',
    current_content: 'This is a test paragraph',
    selector: 'p.intro'
  },
  {
    id: '3',
    element_id: 'button-1',
    current_content: 'Click here',
    selector: 'button.cta'
  }
];

const mockTranslationResponse = {
  translations: [
    {
      id: 'header-1',
      originalText: 'Welcome to our website',
      translatedText: 'Bienvenido a nuestro sitio web'
    },
    {
      id: 'paragraph-1',
      originalText: 'This is a test paragraph',
      translatedText: 'Este es un párrafo de prueba'
    }
  ]
};

const defaultProps = {
  siteId: 'test-site-123',
  contentElements: mockContentElements
};

beforeEach(() => {
  jest.clearAllMocks();
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockTranslationResponse),
  });
});

afterEach(() => {
  cleanup();
});

describe('TranslationDashboard', () => {
  describe('Component Rendering', () => {
    it('should render with default state', () => {
      render(<TranslationDashboard {...defaultProps} />);

      expect(screen.getByText('AI Translation')).toBeInTheDocument();
      expect(screen.getByText('Powered by OpenAI')).toBeInTheDocument();
      expect(screen.getByLabelText('From Language')).toBeInTheDocument();
      expect(screen.getByLabelText('To Language')).toBeInTheDocument();
      expect(screen.getByText('Select Content to Translate')).toBeInTheDocument();
    });

    it('should display content elements correctly', () => {
      render(<TranslationDashboard {...defaultProps} />);

      expect(screen.getByText('Welcome to our website')).toBeInTheDocument();
      expect(screen.getByText('This is a test paragraph')).toBeInTheDocument();
      expect(screen.getByText('Click here')).toBeInTheDocument();
      expect(screen.getByText('h1')).toBeInTheDocument();
      expect(screen.getByText('p.intro')).toBeInTheDocument();
      expect(screen.getByText('button.cta')).toBeInTheDocument();
    });

    it('should show correct selection count initially', () => {
      render(<TranslationDashboard {...defaultProps} />);

      expect(screen.getByText('0 of 3 elements selected')).toBeInTheDocument();
    });
  });

  describe('Language Selection', () => {
    it('should have default language selections', () => {
      render(<TranslationDashboard {...defaultProps} />);

      const fromSelect = screen.getByLabelText('From Language') as HTMLSelectElement;
      const toSelect = screen.getByLabelText('To Language') as HTMLSelectElement;

      expect(fromSelect.value).toBe('en');
      expect(toSelect.value).toBe('es');
    });

    it('should update from language when changed', async () => {
      const user = userEvent.setup();
      render(<TranslationDashboard {...defaultProps} />);

      const fromSelect = screen.getByLabelText('From Language');
      await user.selectOptions(fromSelect, 'fr');

      expect((fromSelect as HTMLSelectElement).value).toBe('fr');
    });

    it('should update to language when changed', async () => {
      const user = userEvent.setup();
      render(<TranslationDashboard {...defaultProps} />);

      const toSelect = screen.getByLabelText('To Language');
      await user.selectOptions(toSelect, 'de');

      expect((toSelect as HTMLSelectElement).value).toBe('de');
    });

    it('should display language flags in translation direction', () => {
      render(<TranslationDashboard {...defaultProps} />);

      expect(screen.getByText('🇺🇸 → 🇪🇸')).toBeInTheDocument();
    });
  });

  describe('Element Selection', () => {
    it('should toggle individual element selection', async () => {
      const user = userEvent.setup();
      render(<TranslationDashboard {...defaultProps} />);

      const checkboxes = screen.getAllByRole('checkbox');
      const firstCheckbox = checkboxes[0];

      await user.click(firstCheckbox);

      expect(firstCheckbox).toBeChecked();
      expect(screen.getByText('1 of 3 elements selected')).toBeInTheDocument();

      await user.click(firstCheckbox);

      expect(firstCheckbox).not.toBeChecked();
      expect(screen.getByText('0 of 3 elements selected')).toBeInTheDocument();
    });

    it('should select all elements when clicking "Select All"', async () => {
      const user = userEvent.setup();
      render(<TranslationDashboard {...defaultProps} />);

      const selectAllButton = screen.getByText('Select All');
      await user.click(selectAllButton);

      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(checkbox => {
        expect(checkbox).toBeChecked();
      });

      expect(screen.getByText('3 of 3 elements selected')).toBeInTheDocument();
      expect(screen.getByText('Deselect All')).toBeInTheDocument();
    });

    it('should deselect all elements when clicking "Deselect All"', async () => {
      const user = userEvent.setup();
      render(<TranslationDashboard {...defaultProps} />);

      // First select all
      const selectAllButton = screen.getByText('Select All');
      await user.click(selectAllButton);

      // Then deselect all
      const deselectAllButton = screen.getByText('Deselect All');
      await user.click(deselectAllButton);

      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(checkbox => {
        expect(checkbox).not.toBeChecked();
      });

      expect(screen.getByText('0 of 3 elements selected')).toBeInTheDocument();
    });
  });

  describe('Translation Process', () => {
    it('should show error when trying to translate without selecting elements', async () => {
      const user = userEvent.setup();
      render(<TranslationDashboard {...defaultProps} />);

      const translateButton = screen.getByText('Translate with AI');
      await user.click(translateButton);

      expect(screen.getByText('Please select at least one element to translate')).toBeInTheDocument();
    });

    it('should disable translate button when no elements selected', () => {
      render(<TranslationDashboard {...defaultProps} />);

      const translateButton = screen.getByText('Translate with AI');
      expect(translateButton).toBeDisabled();
    });

    it('should enable translate button when elements are selected', async () => {
      const user = userEvent.setup();
      render(<TranslationDashboard {...defaultProps} />);

      const firstCheckbox = screen.getAllByRole('checkbox')[0];
      await user.click(firstCheckbox);

      const translateButton = screen.getByText('Translate with AI');
      expect(translateButton).not.toBeDisabled();
    });

    it('should show loading state during translation', async () => {
      const user = userEvent.setup();
      
      // Mock a delayed response
      (fetch as jest.Mock).mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            ok: true,
            json: () => Promise.resolve(mockTranslationResponse)
          }), 100)
        )
      );

      render(<TranslationDashboard {...defaultProps} />);

      // Select an element
      const firstCheckbox = screen.getAllByRole('checkbox')[0];
      await user.click(firstCheckbox);

      // Start translation
      const translateButton = screen.getByText('Translate with AI');
      await user.click(translateButton);

      expect(screen.getByText('Translating...')).toBeInTheDocument();
      expect(translateButton).toBeDisabled();

      // Wait for completion
      await waitFor(() => {
        expect(screen.getByText('Translate with AI')).toBeInTheDocument();
      });
    });

    it('should make correct API call with selected elements', async () => {
      const user = userEvent.setup();
      render(<TranslationDashboard {...defaultProps} />);

      // Select first two elements
      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[0]);
      await user.click(checkboxes[1]);

      const translateButton = screen.getByText('Translate with AI');
      await user.click(translateButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/ai/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            siteId: 'test-site-123',
            fromLanguage: 'en',
            toLanguage: 'es',
            elements: [
              { id: 'header-1', text: 'Welcome to our website' },
              { id: 'paragraph-1', text: 'This is a test paragraph' }
            ],
            context: 'website content'
          }),
        });
      });
    });

    it('should display translation results on success', async () => {
      const user = userEvent.setup();
      render(<TranslationDashboard {...defaultProps} />);

      // Select elements
      const firstCheckbox = screen.getAllByRole('checkbox')[0];
      await user.click(firstCheckbox);

      // Translate
      const translateButton = screen.getByText('Translate with AI');
      await user.click(translateButton);

      await waitFor(() => {
        expect(screen.getByText('Translation Results')).toBeInTheDocument();
        expect(screen.getByText('Successfully translated 2 elements to Spanish')).toBeInTheDocument();
        expect(screen.getByText('Welcome to our website')).toBeInTheDocument();
        expect(screen.getByText('Bienvenido a nuestro sitio web')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle API error responses', async () => {
      const user = userEvent.setup();
      
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Translation service unavailable' }),
      });

      render(<TranslationDashboard {...defaultProps} />);

      // Select element and translate
      const firstCheckbox = screen.getAllByRole('checkbox')[0];
      await user.click(firstCheckbox);

      const translateButton = screen.getByText('Translate with AI');
      await user.click(translateButton);

      await waitFor(() => {
        expect(screen.getByText('Translation service unavailable')).toBeInTheDocument();
      });
    });

    it('should handle network errors', async () => {
      const user = userEvent.setup();
      
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      render(<TranslationDashboard {...defaultProps} />);

      // Select element and translate
      const firstCheckbox = screen.getAllByRole('checkbox')[0];
      await user.click(firstCheckbox);

      const translateButton = screen.getByText('Translate with AI');
      await user.click(translateButton);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should handle unknown errors gracefully', async () => {
      const user = userEvent.setup();
      
      (fetch as jest.Mock).mockRejectedValueOnce('Unknown error');

      render(<TranslationDashboard {...defaultProps} />);

      // Select element and translate
      const firstCheckbox = screen.getAllByRole('checkbox')[0];
      await user.click(firstCheckbox);

      const translateButton = screen.getByText('Translate with AI');
      await user.click(translateButton);

      await waitFor(() => {
        expect(screen.getByText('Translation failed')).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty content elements', () => {
      render(<TranslationDashboard siteId="test" contentElements={[]} />);

      expect(screen.getByText('0 of 0 elements selected')).toBeInTheDocument();
      expect(screen.getByText('Select All')).toBeInTheDocument();
    });

    it('should handle content elements with empty content', () => {
      const elementsWithEmptyContent = [
        {
          id: '1',
          element_id: 'empty-1',
          current_content: '',
          selector: 'div.empty'
        }
      ];

      render(<TranslationDashboard siteId="test" contentElements={elementsWithEmptyContent} />);

      expect(screen.getByText('div.empty')).toBeInTheDocument();
    });

    it('should handle very long content gracefully', () => {
      const longContent = 'A'.repeat(1000);
      const elementsWithLongContent = [
        {
          id: '1',
          element_id: 'long-1',
          current_content: longContent,
          selector: 'div.long'
        }
      ];

      render(<TranslationDashboard siteId="test" contentElements={elementsWithLongContent} />);

      expect(screen.getByText('div.long')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      render(<TranslationDashboard {...defaultProps} />);

      expect(screen.getByLabelText('From Language')).toBeInTheDocument();
      expect(screen.getByLabelText('To Language')).toBeInTheDocument();
    });

    it('should have accessible form controls', () => {
      render(<TranslationDashboard {...defaultProps} />);

      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(checkbox => {
        expect(checkbox).toHaveAccessibleName();
      });

      const translateButton = screen.getByRole('button', { name: /translate with ai/i });
      expect(translateButton).toBeInTheDocument();
    });
  });

  describe('State Management', () => {
    it('should clear error when starting new translation', async () => {
      const user = userEvent.setup();
      
      // First, cause an error
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('API Error'));

      render(<TranslationDashboard {...defaultProps} />);

      const firstCheckbox = screen.getAllByRole('checkbox')[0];
      await user.click(firstCheckbox);

      const translateButton = screen.getByText('Translate with AI');
      await user.click(translateButton);

      await waitFor(() => {
        expect(screen.getByText('API Error')).toBeInTheDocument();
      });

      // Now mock a successful response
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTranslationResponse),
      });

      // Try again
      await user.click(translateButton);

      await waitFor(() => {
        expect(screen.queryByText('API Error')).not.toBeInTheDocument();
      });
    });

    it('should clear success message when starting new translation', async () => {
      const user = userEvent.setup();
      render(<TranslationDashboard {...defaultProps} />);

      const firstCheckbox = screen.getAllByRole('checkbox')[0];
      await user.click(firstCheckbox);

      const translateButton = screen.getByText('Translate with AI');
      
      // First successful translation
      await user.click(translateButton);

      await waitFor(() => {
        expect(screen.getByText(/Successfully translated/)).toBeInTheDocument();
      });

      // Start another translation
      await user.click(translateButton);

      expect(screen.queryByText(/Successfully translated/)).not.toBeInTheDocument();
    });
  });
});