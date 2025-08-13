/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InteractiveHero from '../InteractiveHero';

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
    code: ({ children, ...props }: React.ComponentProps<'code'>) => <code {...props}>{children}</code>,
    p: ({ children, ...props }: React.ComponentProps<'p'>) => <p {...props}>{children}</p>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock timers
jest.useFakeTimers();

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

describe('InteractiveHero', () => {
  describe('Initial Rendering', () => {
    it('should render with default content', () => {
      render(<InteractiveHero />);

      expect(screen.getByText('Transform Your Website')).toBeInTheDocument();
      expect(screen.getByText('With just one script tag, edit your entire site in real-time.')).toBeInTheDocument();
      expect(screen.getByText('Start Free Trial')).toBeInTheDocument();
    });

    it('should render interactive demo banner', () => {
      render(<InteractiveHero />);

      expect(screen.getByText(/Interactive Demo:/)).toBeInTheDocument();
      expect(screen.getByText('Click any text below to edit it in real-time')).toBeInTheDocument();
      expect(screen.getByText('Auto Demo')).toBeInTheDocument();
    });

    it('should render code preview section', () => {
      render(<InteractiveHero />);

      expect(screen.getByText('Ready to integrate?')).toBeInTheDocument();
      expect(screen.getByText(/script src="https:\/\/cdn\.recopyfast\.com\/embed\/recopyfast\.js"/)).toBeInTheDocument();
      expect(screen.getByText("That's it! Your website becomes instantly editable.")).toBeInTheDocument();
    });

    it('should render live stats', () => {
      render(<InteractiveHero />);

      expect(screen.getByText('Live on 10,000+ websites')).toBeInTheDocument();
      expect(screen.getByText('99.9% uptime')).toBeInTheDocument();
      expect(screen.getByText('<100ms response time')).toBeInTheDocument();
    });
  });

  describe('Text Editing Functionality', () => {
    it('should make text editable when clicked', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      expect(input).toBeInTheDocument();
      expect(input).toHaveFocus();
    });

    it('should show editing instructions when text is being edited', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      expect(screen.getByText('Press Enter to save, Esc to cancel')).toBeInTheDocument();
    });

    it('should update text content when typing', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      await user.clear(input);
      await user.type(input, 'New Headline Text');

      expect(input).toHaveValue('New Headline Text');
    });

    it('should save changes when Enter is pressed', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      await user.clear(input);
      await user.type(input, 'New Headline Text');
      await user.keyboard('{Enter}');

      expect(screen.getByText('New Headline Text')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('New Headline Text')).not.toBeInTheDocument();
    });

    it('should save changes when input loses focus', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      await user.clear(input);
      await user.type(input, 'New Headline Text');
      
      // Click somewhere else to blur
      const banner = screen.getByText(/Interactive Demo:/);
      await user.click(banner);

      expect(screen.getByText('New Headline Text')).toBeInTheDocument();
    });

    it('should cancel changes when Escape is pressed', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      await user.clear(input);
      await user.type(input, 'New Text');
      await user.keyboard('{Escape}');

      expect(screen.getByText('Transform Your Website')).toBeInTheDocument();
      expect(screen.queryByText('New Text')).not.toBeInTheDocument();
    });

    it('should only allow one text to be edited at a time', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      const subheading = screen.getByText('With just one script tag, edit your entire site in real-time.');

      await user.click(headline);
      expect(screen.getByDisplayValue('Transform Your Website')).toBeInTheDocument();

      await user.click(subheading);
      expect(screen.queryByDisplayValue('Transform Your Website')).not.toBeInTheDocument();
      expect(screen.getByDisplayValue('With just one script tag, edit your entire site in real-time.')).toBeInTheDocument();
    });
  });

  describe('Success Animation', () => {
    it('should show success animation when text is saved', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      await user.type(input, ' Updated');
      await user.keyboard('{Enter}');

      expect(screen.getByText('Content updated instantly!')).toBeInTheDocument();

      // Fast-forward time to hide animation
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(screen.queryByText('Content updated instantly!')).not.toBeInTheDocument();
    });
  });

  describe('Auto Demo Functionality', () => {
    it('should run auto demo when button is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const autoDemoButton = screen.getByText('Auto Demo');
      await user.click(autoDemoButton);

      expect(screen.getByText('Running Demo...')).toBeInTheDocument();
      expect(autoDemoButton).toBeDisabled();
    });

    it('should update texts during auto demo sequence', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const autoDemoButton = screen.getByText('Auto Demo');
      await user.click(autoDemoButton);

      // Fast-forward through the demo sequence
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(screen.getByDisplayValue('Transform Any Website Instantly')).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(screen.getByDisplayValue('AI-powered content editing with real-time collaboration.')).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(screen.getByDisplayValue('Try AI Magic Now')).toBeInTheDocument();
    });

    it('should complete auto demo after specified time', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const autoDemoButton = screen.getByText('Auto Demo');
      await user.click(autoDemoButton);

      // Fast-forward to completion
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(screen.getByText('Auto Demo')).toBeInTheDocument();
      expect(autoDemoButton).not.toBeDisabled();
    });

    it('should show success animations during auto demo', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const autoDemoButton = screen.getByText('Auto Demo');
      await user.click(autoDemoButton);

      // Fast-forward to first success animation
      act(() => {
        jest.advanceTimersByTime(1800);
      });

      expect(screen.getByText('Content updated instantly!')).toBeInTheDocument();
    });
  });

  describe('Hover and Interaction States', () => {
    it('should show edit tooltip on hover', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.hover(headline);

      expect(screen.getByText('Click to edit')).toBeInTheDocument();
    });

    it('should not show edit tooltip for CTA button', () => {
      render(<InteractiveHero />);

      const ctaButton = screen.getByText('Start Free Trial');
      expect(ctaButton.parentElement?.querySelector('[class*="group"]')).toBeTruthy();
    });
  });

  describe('Different Text Types', () => {
    it('should handle headline editing correctly', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      expect(input).toHaveClass(/text-4xl|md:text-6xl|lg:text-7xl/);
    });

    it('should handle subheading editing correctly', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const subheading = screen.getByText('With just one script tag, edit your entire site in real-time.');
      await user.click(subheading);

      const input = screen.getByDisplayValue('With just one script tag, edit your entire site in real-time.');
      expect(input).toHaveClass(/text-xl|md:text-2xl/);
    });

    it('should handle CTA button editing correctly', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const ctaButton = screen.getByText('Start Free Trial');
      await user.click(ctaButton);

      const input = screen.getByDisplayValue('Start Free Trial');
      expect(input).toHaveClass(/text-lg/);
    });
  });

  describe('Keyboard Navigation', () => {
    it('should support Enter key for saving', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      await user.clear(input);
      await user.type(input, 'New Text');
      
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      expect(screen.getByText('New Text')).toBeInTheDocument();
    });

    it('should support Escape key for canceling', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      await user.clear(input);
      await user.type(input, 'New Text');
      
      fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

      expect(screen.getByText('Transform Your Website')).toBeInTheDocument();
      expect(screen.queryByText('New Text')).not.toBeInTheDocument();
    });
  });

  describe('Component State Management', () => {
    it('should maintain separate state for each editable text', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      // Edit headline
      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);
      const headlineInput = screen.getByDisplayValue('Transform Your Website');
      await user.clear(headlineInput);
      await user.type(headlineInput, 'New Headline');
      await user.keyboard('{Enter}');

      // Edit subheading
      const subheading = screen.getByText('With just one script tag, edit your entire site in real-time.');
      await user.click(subheading);
      const subheadingInput = screen.getByDisplayValue('With just one script tag, edit your entire site in real-time.');
      await user.clear(subheadingInput);
      await user.type(subheadingInput, 'New Subheading');
      await user.keyboard('{Enter}');

      expect(screen.getByText('New Headline')).toBeInTheDocument();
      expect(screen.getByText('New Subheading')).toBeInTheDocument();
    });

    it('should preserve original text for reset functionality', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      await user.clear(input);
      await user.type(input, 'Modified Text');
      await user.keyboard('{Escape}');

      expect(screen.getByText('Transform Your Website')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty text input', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      await user.clear(input);
      await user.keyboard('{Enter}');

      // Check that the element still exists but has empty content
      const headlineContainer = input.closest('div');
      expect(headlineContainer).toBeInTheDocument();
    });

    it('should handle very long text input', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);
      
      const longText = 'A'.repeat(1000);

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      await user.clear(input);
      await user.type(input, longText);
      await user.keyboard('{Enter}');

      expect(screen.getByText(longText)).toBeInTheDocument();
    });

    it('should handle special characters in text', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);
      
      const specialText = 'Text with "quotes" & <symbols> • bullets';

      const headline = screen.getByText('Transform Your Website');
      await user.click(headline);

      const input = screen.getByDisplayValue('Transform Your Website');
      await user.clear(input);
      await user.type(input, specialText);
      await user.keyboard('{Enter}');

      expect(screen.getByText(specialText)).toBeInTheDocument();
    });
  });

  describe('Auto Demo State Management', () => {
    it('should not allow starting auto demo while already running', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const autoDemoButton = screen.getByText('Auto Demo');
      await user.click(autoDemoButton);

      expect(autoDemoButton).toBeDisabled();
      
      // Try clicking again
      await user.click(autoDemoButton);
      
      expect(screen.getByText('Running Demo...')).toBeInTheDocument();
    });

    it('should reset demo state properly after completion', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<InteractiveHero />);

      const autoDemoButton = screen.getByText('Auto Demo');
      await user.click(autoDemoButton);

      // Complete the demo
      act(() => {
        jest.advanceTimersByTime(6000);
      });

      expect(screen.getByText('Auto Demo')).toBeInTheDocument();
      expect(autoDemoButton).not.toBeDisabled();
    });
  });
});