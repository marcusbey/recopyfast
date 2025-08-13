import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { server, mockFetch } from './setup';
import AISuggestionButton from '@/components/editor/AISuggestionButton';

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockImplementation(() => Promise.resolve()),
    readText: jest.fn().mockImplementation(() => Promise.resolve('')),
  },
});

describe('AI Suggestions Integration', () => {
  beforeAll(() => {
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
    jest.clearAllMocks();
  });

  afterAll(() => {
    server.close();
  });

  describe('AI Suggestions API Flow', () => {
    it('should generate content suggestions successfully', async () => {
      const suggestionRequest = {
        text: 'Welcome to our platform',
        context: 'website header',
        tone: 'professional',
        goal: 'improve'
      };

      const response = await mockFetch('/api/ai/suggest', {
        method: 'POST',
        body: JSON.stringify(suggestionRequest),
      });

      expect(response.ok).toBe(true);
      
      const data = await response.json();
      
      expect(data).toMatchObject({
        success: true,
        suggestions: expect.arrayContaining([
          expect.stringContaining('Enhanced: Welcome to our platform'),
          expect.stringContaining('Improved version of: Welcome to our platform'),
          expect.stringContaining('Better: Welcome to our platform')
        ]),
        tokensUsed: 75,
        originalText: 'Welcome to our platform'
      });
    });

    it('should generate different suggestions based on goal', async () => {
      // Test 'shorten' goal
      const shortenRequest = {
        text: 'This is a very long text that needs to be shortened',
        context: 'button text',
        goal: 'shorten'
      };

      const shortenResponse = await mockFetch('/api/ai/suggest', {
        method: 'POST',
        body: JSON.stringify(shortenRequest),
      });

      const shortenData = await shortenResponse.json();
      expect(shortenData.suggestions).toEqual(
        expect.arrayContaining([
          expect.any(String) // Shortened versions from mock
        ])
      );

      // Test 'expand' goal
      const expandRequest = {
        text: 'Buy now',
        context: 'call to action',
        goal: 'expand'
      };

      const expandResponse = await mockFetch('/api/ai/suggest', {
        method: 'POST',
        body: JSON.stringify(expandRequest),
      });

      const expandData = await expandResponse.json();
      expect(expandData.suggestions).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Buy now with additional details'),
          expect.stringContaining('Expanded version: Buy now'),
          expect.stringContaining('Buy now - comprehensive version')
        ])
      );
    });

    it('should validate suggestion request parameters', async () => {
      const invalidRequests = [
        {}, // Missing all required fields
        { text: 'Valid text' }, // Missing context
        { context: 'Valid context' }, // Missing text
        { text: '', context: 'Valid context' }, // Empty text
        { text: 'Valid text', context: '' }, // Empty context
      ];

      for (const invalidRequest of invalidRequests) {
        const response = await mockFetch('/api/ai/suggest', {
          method: 'POST',
          body: JSON.stringify(invalidRequest),
        });

        expect(response.ok).toBe(false);
        expect(response.status).toBe(400);
        
        const data = await response.json();
        expect(data.error).toBe('Missing required fields: text, context');
      }
    });

    it('should handle AI service errors', async () => {
      const errorRequest = {
        text: 'ERROR_TEXT that triggers failure',
        context: 'test context',
      };

      const response = await mockFetch('/api/ai/suggest', {
        method: 'POST',
        body: JSON.stringify(errorRequest),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(500);
      
      const data = await response.json();
      expect(data.error).toBe('AI service temporarily unavailable');
    });
  });

  describe('AI Suggestion Button Component Integration', () => {
    const mockOnSuggestionSelect = jest.fn();

    beforeEach(() => {
      mockOnSuggestionSelect.mockClear();
    });

    it('should render collapsed button initially', () => {
      render(
        <AISuggestionButton
          currentText="Test content"
          context="test context"
          onSuggestionSelect={mockOnSuggestionSelect}
        />
      );

      expect(screen.getByText('AI Suggest')).toBeInTheDocument();
      expect(screen.queryByText('AI Content Suggestions')).not.toBeInTheDocument();
    });

    it('should open suggestion modal when clicked', () => {
      render(
        <AISuggestionButton
          currentText="Test content for suggestions"
          context="website content"
          onSuggestionSelect={mockOnSuggestionSelect}
        />
      );

      fireEvent.click(screen.getByText('AI Suggest'));

      expect(screen.getByText('AI Content Suggestions')).toBeInTheDocument();
      expect(screen.getByText('Original Text')).toBeInTheDocument();
      expect(screen.getByText('Test content for suggestions')).toBeInTheDocument();
      expect(screen.getByText('Generate AI Suggestions')).toBeInTheDocument();
    });

    it('should close modal when close button is clicked', () => {
      render(
        <AISuggestionButton
          currentText="Test content"
          onSuggestionSelect={mockOnSuggestionSelect}
        />
      );

      // Open modal
      fireEvent.click(screen.getByText('AI Suggest'));
      expect(screen.getByText('AI Content Suggestions')).toBeInTheDocument();

      // Close modal - find the button that contains the X icon
      const closeButtons = screen.getAllByRole('button');
      const closeButton = closeButtons.find(button => 
        button.querySelector('svg') && 
        button.className.includes('text-gray-400')
      );
      fireEvent.click(closeButton!);

      expect(screen.queryByText('AI Content Suggestions')).not.toBeInTheDocument();
    });

    it('should generate and display suggestions', async () => {
      render(
        <AISuggestionButton
          currentText="Improve this text"
          context="landing page"
          onSuggestionSelect={mockOnSuggestionSelect}
        />
      );

      // Open modal
      fireEvent.click(screen.getByText('AI Suggest'));

      // Generate suggestions
      fireEvent.click(screen.getByText('Generate AI Suggestions'));

      // Check loading state
      expect(screen.getByText('Generating...')).toBeInTheDocument();

      // Wait for suggestions
      await waitFor(() => {
        expect(screen.queryByText('Generating...')).not.toBeInTheDocument();
      });

      // Check suggestions are displayed
      expect(screen.getByText('Suggestions')).toBeInTheDocument();
      expect(screen.getByText('Enhanced: Improve this text')).toBeInTheDocument();
      expect(screen.getByText('Improved version of: Improve this text')).toBeInTheDocument();
    });

    it('should handle different goals and tones', async () => {
      render(
        <AISuggestionButton
          currentText="Make this shorter please"
          context="button text"
          onSuggestionSelect={mockOnSuggestionSelect}
        />
      );

      // Open modal
      fireEvent.click(screen.getByText('AI Suggest'));

      // Change goal to 'shorten'
      const goalSelect = screen.getByDisplayValue('Improve - Enhance clarity and impact');
      fireEvent.change(goalSelect, { target: { value: 'shorten' } });

      // Change tone to 'casual'
      const toneSelect = screen.getByDisplayValue('Professional');
      fireEvent.change(toneSelect, { target: { value: 'casual' } });

      // Generate suggestions
      fireEvent.click(screen.getByText('Generate AI Suggestions'));

      // Wait for suggestions
      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
      });

      // Should show shortened suggestions (from mock implementation)
      const suggestions = screen.getAllByText(/Make this shorter/);
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('should handle suggestion selection', async () => {
      render(
        <AISuggestionButton
          currentText="Select this suggestion"
          context="test content"
          onSuggestionSelect={mockOnSuggestionSelect}
        />
      );

      // Open modal and generate suggestions
      fireEvent.click(screen.getByText('AI Suggest'));
      fireEvent.click(screen.getByText('Generate AI Suggestions'));

      // Wait for suggestions
      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
      });

      // Click "Use This" on first suggestion
      const useButtons = screen.getAllByText('Use This');
      fireEvent.click(useButtons[0]);

      // Should call callback and close modal
      expect(mockOnSuggestionSelect).toHaveBeenCalledWith('Enhanced: Select this suggestion');
      expect(screen.queryByText('AI Content Suggestions')).not.toBeInTheDocument();
    });

    it('should handle copy to clipboard functionality', async () => {
      render(
        <AISuggestionButton
          currentText="Copy this text"
          context="test content"
          onSuggestionSelect={mockOnSuggestionSelect}
        />
      );

      // Open modal and generate suggestions
      fireEvent.click(screen.getByText('AI Suggest'));
      fireEvent.click(screen.getByText('Generate AI Suggestions'));

      // Wait for suggestions
      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
      });

      // Click copy button
      const copyButtons = screen.getAllByText('Copy');
      fireEvent.click(copyButtons[0]);

      // Should call clipboard API
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Enhanced: Copy this text');

      // Should show "Copied" temporarily
      await waitFor(() => {
        expect(screen.getByText('Copied')).toBeInTheDocument();
      });
    });

    it('should handle API errors gracefully', async () => {
      render(
        <AISuggestionButton
          currentText="ERROR_TEXT"
          context="error context"
          onSuggestionSelect={mockOnSuggestionSelect}
        />
      );

      // Open modal
      fireEvent.click(screen.getByText('AI Suggest'));

      // Generate suggestions (will trigger error)
      fireEvent.click(screen.getByText('Generate AI Suggestions'));

      // Wait for error
      await waitFor(() => {
        expect(screen.getByText('AI service temporarily unavailable')).toBeInTheDocument();
      });

      // Should not show suggestions
      expect(screen.queryByText('Suggestions')).not.toBeInTheDocument();
    });
  });

  describe('Complete AI Suggestion Workflow', () => {
    const mockOnSuggestionSelect = jest.fn();

    beforeEach(() => {
      mockOnSuggestionSelect.mockClear();
    });

    it('should complete full suggestion workflow from trigger to selection', async () => {
      render(
        <AISuggestionButton
          currentText="This is the original content that needs improvement"
          context="product description"
          onSuggestionSelect={mockOnSuggestionSelect}
        />
      );

      // Step 1: Open suggestion modal
      fireEvent.click(screen.getByText('AI Suggest'));
      expect(screen.getByText('AI Content Suggestions')).toBeInTheDocument();

      // Step 2: Configure options
      const goalSelect = screen.getByDisplayValue('Improve - Enhance clarity and impact');
      fireEvent.change(goalSelect, { target: { value: 'optimize' } });

      const toneSelect = screen.getByDisplayValue('Professional');
      fireEvent.change(toneSelect, { target: { value: 'marketing' } });

      // Step 3: Generate suggestions
      fireEvent.click(screen.getByText('Generate AI Suggestions'));

      // Step 4: Verify loading state
      expect(screen.getByText('Generating...')).toBeInTheDocument();
      expect(screen.getByText('Generating...')).toBeDisabled();

      // Step 5: Wait for results
      await waitFor(() => {
        expect(screen.queryByText('Generating...')).not.toBeInTheDocument();
      });

      // Step 6: Verify suggestions are displayed
      expect(screen.getByText('Suggestions')).toBeInTheDocument();
      const suggestions = screen.getAllByText(/This is the original content/);
      expect(suggestions.length).toBeGreaterThan(0);

      // Step 7: Test copy functionality
      const copyButtons = screen.getAllByText('Copy');
      fireEvent.click(copyButtons[0]);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();

      // Step 8: Select a suggestion
      const useButtons = screen.getAllByText('Use This');
      fireEvent.click(useButtons[1]);

      // Step 9: Verify workflow completion
      expect(mockOnSuggestionSelect).toHaveBeenCalledWith(
        expect.stringContaining('This is the original content')
      );
      expect(screen.queryByText('AI Content Suggestions')).not.toBeInTheDocument();
    });

    it('should handle multiple suggestion generations in one session', async () => {
      render(
        <AISuggestionButton
          currentText="Content for multiple generations"
          context="versatile content"
          onSuggestionSelect={mockOnSuggestionSelect}
        />
      );

      // Open modal
      fireEvent.click(screen.getByText('AI Suggest'));

      // First generation with 'improve' goal
      fireEvent.click(screen.getByText('Generate AI Suggestions'));
      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
      });

      // Verify first set of suggestions
      expect(screen.getByText('Enhanced: Content for multiple generations')).toBeInTheDocument();

      // Second generation with 'shorten' goal
      const goalSelect = screen.getByDisplayValue('Improve - Enhance clarity and impact');
      fireEvent.change(goalSelect, { target: { value: 'shorten' } });

      fireEvent.click(screen.getByText('Generate AI Suggestions'));
      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
      });

      // Should show new suggestions (shortened versions)
      const suggestions = screen.getAllByText(/Content for multiple/);
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('should maintain state during error recovery', async () => {
      render(
        <AISuggestionButton
          currentText="ERROR_TEXT then recovery"
          context="error recovery test"
          onSuggestionSelect={mockOnSuggestionSelect}
        />
      );

      // Open modal
      fireEvent.click(screen.getByText('AI Suggest'));

      // Set custom options
      const toneSelect = screen.getByDisplayValue('Professional');
      fireEvent.change(toneSelect, { target: { value: 'technical' } });

      // First attempt (will error due to ERROR_TEXT)
      fireEvent.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('AI service temporarily unavailable')).toBeInTheDocument();
      });

      // Verify options are preserved
      expect(toneSelect).toHaveValue('technical');

      // For demonstration, we'll just verify that the error state was handled
      // In a real app, the user would edit the text and try again
      expect(screen.getByText('AI service temporarily unavailable')).toBeInTheDocument();
      
      // The error recovery would require a new component instance with different text
      // This test demonstrates that errors are properly displayed and handled
    });
  });

  describe('AI Suggestion Integration with Content Editor', () => {
    // Mock ContentEditor that uses AI Suggestions
    const MockContentEditor = () => {
      const [content, setContent] = React.useState('Original editable content');
      const [history, setHistory] = React.useState<string[]>(['Original editable content']);

      const handleSuggestionSelect = (newContent: string) => {
        setContent(newContent);
        setHistory(prev => [...prev, newContent]);
      };

      const handleUndo = () => {
        if (history.length > 1) {
          const newHistory = history.slice(0, -1);
          setHistory(newHistory);
          setContent(newHistory[newHistory.length - 1]);
        }
      };

      return (
        <div data-testid="content-editor">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            data-testid="content-textarea"
          />
          <div data-testid="editor-controls">
            <AISuggestionButton
              currentText={content}
              context="content editor"
              onSuggestionSelect={handleSuggestionSelect}
            />
            <button onClick={handleUndo} data-testid="undo-button">
              Undo
            </button>
            <div data-testid="history-count">
              Changes: {history.length - 1}
            </div>
          </div>
        </div>
      );
    };

    it('should integrate AI suggestions with content editor', async () => {
      render(<MockContentEditor />);

      // Verify initial state
      expect(screen.getByTestId('content-textarea')).toHaveValue('Original editable content');
      expect(screen.getByText('Changes: 0')).toBeInTheDocument();

      // Open AI suggestions
      fireEvent.click(screen.getByText('AI Suggest'));

      // Generate and select suggestion
      fireEvent.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
      });

      // Select first suggestion
      const useButtons = screen.getAllByText('Use This');
      fireEvent.click(useButtons[0]);

      // Verify content updated
      expect(screen.getByTestId('content-textarea')).toHaveValue('Enhanced: Original editable content');
      expect(screen.getByText('Changes: 1')).toBeInTheDocument();
    });

    it('should support undo functionality after suggestion selection', async () => {
      render(<MockContentEditor />);

      // Apply AI suggestion
      fireEvent.click(screen.getByText('AI Suggest'));
      fireEvent.click(screen.getByText('Generate AI Suggestions'));

      await waitFor(() => {
        expect(screen.getByText('Suggestions')).toBeInTheDocument();
      });

      fireEvent.click(screen.getAllByText('Use This')[0]);

      // Verify suggestion applied
      expect(screen.getByTestId('content-textarea')).toHaveValue('Enhanced: Original editable content');

      // Undo the change
      fireEvent.click(screen.getByTestId('undo-button'));

      // Verify reverted to original
      expect(screen.getByTestId('content-textarea')).toHaveValue('Original editable content');
      expect(screen.getByText('Changes: 0')).toBeInTheDocument();
    });
  });
});

// Add React import for JSX
import React from 'react';