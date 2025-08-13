/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AISuggestionButton from '../AISuggestionButton';

// Mock fetch
global.fetch = jest.fn();

// Mock clipboard API
const mockWriteText = jest.fn();
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

const mockSuggestions = [
  'This is an improved version of your text with better clarity.',
  'Here is another suggestion that enhances the impact.',
  'A third option that optimizes for engagement.'
];

const mockApiResponse = {
  suggestions: mockSuggestions
};

const defaultProps = {
  currentText: 'This is the original text that needs improvement.',
  context: 'website content',
  onSuggestionSelect: jest.fn()
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteText.mockResolvedValue(undefined);
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockApiResponse),
  });
});

afterEach(() => {
  cleanup();
});

describe('AISuggestionButton', () => {
  describe('Initial State', () => {
    it('should render trigger button when closed', () => {
      render(<AISuggestionButton {...defaultProps} />);

      const triggerButton = screen.getByRole('button', { name: /ai suggest/i });
      expect(triggerButton).toBeInTheDocument();
      expect(triggerButton).toHaveAttribute('title', 'Get AI suggestions');
    });

    it('should not show modal initially', () => {
      render(<AISuggestionButton {...defaultProps} />);

      expect(screen.queryByText('AI Content Suggestions')).not.toBeInTheDocument();
    });
  });

  describe('Modal Opening and Closing', () => {
    it('should open modal when trigger button is clicked', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      const triggerButton = screen.getByRole('button', { name: /ai suggest/i });
      await user.click(triggerButton);

      expect(screen.getByText('AI Content Suggestions')).toBeInTheDocument();
      expect(screen.getByText('Original Text')).toBeInTheDocument();
      expect(screen.getByText(defaultProps.currentText)).toBeInTheDocument();
    });

    it('should close modal when X button is clicked', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      // Open modal
      const triggerButton = screen.getByRole('button', { name: /ai suggest/i });
      await user.click(triggerButton);

      // Close modal
      const closeButton = screen.getByRole('button', { name: '' }); // X button
      await user.click(closeButton);

      expect(screen.queryByText('AI Content Suggestions')).not.toBeInTheDocument();
    });

    it('should close modal when suggestion is selected', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      // Open modal and generate suggestions
      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      await user.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
      });

      // Use a suggestion
      const useButton = screen.getAllByText('Use This')[0];
      await user.click(useButton);

      expect(screen.queryByText('AI Content Suggestions')).not.toBeInTheDocument();
    });
  });

  describe('Options Configuration', () => {
    it('should have default goal and tone selected', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));

      const goalSelect = screen.getByLabelText('Goal') as HTMLSelectElement;
      const toneSelect = screen.getByLabelText('Tone') as HTMLSelectElement;

      expect(goalSelect.value).toBe('improve');
      expect(toneSelect.value).toBe('professional');
    });

    it('should update goal when changed', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));

      const goalSelect = screen.getByLabelText('Goal');
      await user.selectOptions(goalSelect, 'shorten');

      expect((goalSelect as HTMLSelectElement).value).toBe('shorten');
    });

    it('should update tone when changed', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));

      const toneSelect = screen.getByLabelText('Tone');
      await user.selectOptions(toneSelect, 'casual');

      expect((toneSelect as HTMLSelectElement).value).toBe('casual');
    });

    it('should display all goal options', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));

      const goalSelect = screen.getByLabelText('Goal');
      const options = Array.from(goalSelect.querySelectorAll('option'));

      expect(options).toHaveLength(4);
      expect(options.map(opt => opt.value)).toEqual(['improve', 'shorten', 'expand', 'optimize']);
    });

    it('should display all tone options', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));

      const toneSelect = screen.getByLabelText('Tone');
      const options = Array.from(toneSelect.querySelectorAll('option'));

      expect(options).toHaveLength(4);
      expect(options.map(opt => opt.value)).toEqual(['professional', 'casual', 'marketing', 'technical']);
    });
  });

  describe('Suggestion Generation', () => {
    it('should make correct API call when generating suggestions', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));

      const generateButton = screen.getByText('Generate AI Suggestions');
      await user.click(generateButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/ai/suggest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: defaultProps.currentText,
            context: defaultProps.context,
            tone: 'professional',
            goal: 'improve',
          }),
        });
      });
    });

    it('should show loading state during generation', async () => {
      const user = userEvent.setup();
      
      // Mock delayed response
      (fetch as jest.Mock).mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            ok: true,
            json: () => Promise.resolve(mockApiResponse)
          }), 100)
        )
      );

      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      
      const generateButton = screen.getByText('Generate AI Suggestions');
      await user.click(generateButton);

      expect(screen.getByText('Generating...')).toBeInTheDocument();
      expect(generateButton).toBeDisabled();

      await waitFor(() => {
        expect(screen.getByText('Generate AI Suggestions')).toBeInTheDocument();
      });
    });

    it('should display suggestions after successful generation', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      await user.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
        mockSuggestions.forEach(suggestion => {
          expect(screen.getByText(suggestion)).toBeInTheDocument();
        });
      });
    });

    it('should display action buttons for each suggestion', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      await user.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        const useButtons = screen.getAllByText('Use This');
        const copyButtons = screen.getAllByText('Copy');

        expect(useButtons).toHaveLength(3);
        expect(copyButtons).toHaveLength(3);
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message on API failure', async () => {
      const user = userEvent.setup();
      
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'AI service unavailable' }),
      });

      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      await user.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('AI service unavailable')).toBeInTheDocument();
      });
    });

    it('should handle network errors', async () => {
      const user = userEvent.setup();
      
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      await user.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should handle unknown errors gracefully', async () => {
      const user = userEvent.setup();
      
      (fetch as jest.Mock).mockRejectedValueOnce('Unknown error');

      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      await user.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('Failed to generate suggestions')).toBeInTheDocument();
      });
    });

    it('should clear error when generating new suggestions', async () => {
      const user = userEvent.setup();
      
      // First request fails
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'API Error' }),
      });

      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      await user.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('API Error')).toBeInTheDocument();
      });

      // Second request succeeds
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponse),
      });

      await user.click(screen.getByText('Generate AI Suggestions'));

      expect(screen.queryByText('API Error')).not.toBeInTheDocument();
    });
  });

  describe('Suggestion Actions', () => {
    beforeEach(async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      await user.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
      });
    });

    it('should call onSuggestionSelect when "Use This" is clicked', async () => {
      const user = userEvent.setup();
      
      const useButton = screen.getAllByText('Use This')[0];
      await user.click(useButton);

      expect(defaultProps.onSuggestionSelect).toHaveBeenCalledWith(mockSuggestions[0]);
    });

    it('should copy suggestion to clipboard when "Copy" is clicked', async () => {
      const user = userEvent.setup();
      
      const copyButton = screen.getAllByText('Copy')[0];
      await user.click(copyButton);

      expect(mockWriteText).toHaveBeenCalledWith(mockSuggestions[0]);
    });

    it('should show "Copied" state temporarily after copying', async () => {
      const user = userEvent.setup();
      
      const copyButton = screen.getAllByText('Copy')[0];
      await user.click(copyButton);

      expect(screen.getByText('Copied')).toBeInTheDocument();

      // Should revert after timeout
      await waitFor(() => {
        expect(screen.queryByText('Copied')).not.toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should handle clipboard API failure gracefully', async () => {
      const user = userEvent.setup();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockWriteText.mockRejectedValueOnce(new Error('Clipboard error'));
      
      const copyButton = screen.getAllByText('Copy')[0];
      await user.click(copyButton);

      expect(consoleSpy).toHaveBeenCalledWith('Failed to copy text:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no suggestions are generated', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));

      expect(screen.getByText('Click "Generate AI Suggestions" to get improved versions of your content')).toBeInTheDocument();
    });

    it('should not show empty state while loading', async () => {
      const user = userEvent.setup();
      
      // Mock delayed response
      (fetch as jest.Mock).mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            ok: true,
            json: () => Promise.resolve(mockApiResponse)
          }), 100)
        )
      );

      render(<AISuggestionButton {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      await user.click(screen.getByText('Generate AI Suggestions'));

      expect(screen.queryByText('Click "Generate AI Suggestions"')).not.toBeInTheDocument();
    });
  });

  describe('Props Handling', () => {
    it('should use default context when not provided', () => {
      const propsWithoutContext = {
        currentText: 'Test text',
        onSuggestionSelect: jest.fn()
      };

      render(<AISuggestionButton {...propsWithoutContext} />);

      expect(() => render(<AISuggestionButton {...propsWithoutContext} />)).not.toThrow();
    });

    it('should handle empty currentText', async () => {
      const user = userEvent.setup();
      const propsWithEmptyText = {
        ...defaultProps,
        currentText: ''
      };

      render(<AISuggestionButton {...propsWithEmptyText} />);

      await user.click(screen.getByRole('button', { name: /ai suggest/i }));

      expect(screen.getByText('')).toBeInTheDocument(); // Empty text in original text display
    });
  });

  describe('State Reset', () => {
    it('should clear suggestions when modal is closed', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      // Generate suggestions
      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      await user.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
      });

      // Close modal
      const closeButton = screen.getByRole('button', { name: '' });
      await user.click(closeButton);

      // Reopen modal
      await user.click(screen.getByRole('button', { name: /ai suggest/i }));

      expect(screen.queryByText('Suggestions')).not.toBeInTheDocument();
      expect(screen.getByText('Click "Generate AI Suggestions"')).toBeInTheDocument();
    });

    it('should clear suggestions when using a suggestion', async () => {
      const user = userEvent.setup();
      render(<AISuggestionButton {...defaultProps} />);

      // Generate suggestions
      await user.click(screen.getByRole('button', { name: /ai suggest/i }));
      await user.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
      });

      // Use a suggestion
      const useButton = screen.getAllByText('Use This')[0];
      await user.click(useButton);

      // Reopen modal
      await user.click(screen.getByRole('button', { name: /ai suggest/i }));

      expect(screen.queryByText('Suggestions')).not.toBeInTheDocument();
    });
  });
});