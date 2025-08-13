/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge, badgeVariants } from '../badge';

// Mock utils
jest.mock('@/lib/utils/cn', () => ({
  cn: (...classes: (string | undefined | null | boolean)[]) => classes.filter(Boolean).join(' ')
}));

afterEach(() => {
  cleanup();
});

describe('Badge Component', () => {
  describe('Basic Rendering', () => {
    it('should render as a div element', () => {
      render(<Badge data-testid="badge">Badge Text</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge).toBeInTheDocument();
      expect(badge.tagName).toBe('DIV');
    });

    it('should render badge text correctly', () => {
      render(<Badge>Test Badge</Badge>);
      
      expect(screen.getByText('Test Badge')).toBeInTheDocument();
    });

    it('should apply default badge classes', () => {
      render(<Badge data-testid="badge">Default Badge</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('inline-flex');
      expect(badge.className).toContain('items-center');
      expect(badge.className).toContain('rounded-full');
      expect(badge.className).toContain('border');
      expect(badge.className).toContain('px-2.5');
      expect(badge.className).toContain('py-0.5');
      expect(badge.className).toContain('text-xs');
      expect(badge.className).toContain('font-semibold');
      expect(badge.className).toContain('transition-colors');
    });

    it('should apply focus styles', () => {
      render(<Badge data-testid="badge">Focus Badge</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('focus:outline-none');
      expect(badge.className).toContain('focus:ring-2');
      expect(badge.className).toContain('focus:ring-ring');
      expect(badge.className).toContain('focus:ring-offset-2');
    });
  });

  describe('Variant Prop', () => {
    it('should apply default variant styles when no variant specified', () => {
      render(<Badge data-testid="badge">Default</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('border-transparent');
      expect(badge.className).toContain('bg-primary');
      expect(badge.className).toContain('text-primary-foreground');
      expect(badge.className).toContain('hover:bg-primary/80');
    });

    it('should apply default variant styles explicitly', () => {
      render(<Badge variant="default" data-testid="badge">Default</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('bg-primary');
      expect(badge.className).toContain('text-primary-foreground');
    });

    it('should apply secondary variant styles', () => {
      render(<Badge variant="secondary" data-testid="badge">Secondary</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('border-transparent');
      expect(badge.className).toContain('bg-secondary');
      expect(badge.className).toContain('text-secondary-foreground');
      expect(badge.className).toContain('hover:bg-secondary/80');
    });

    it('should apply destructive variant styles', () => {
      render(<Badge variant="destructive" data-testid="badge">Destructive</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('border-transparent');
      expect(badge.className).toContain('bg-destructive');
      expect(badge.className).toContain('text-destructive-foreground');
      expect(badge.className).toContain('hover:bg-destructive/80');
    });

    it('should apply outline variant styles', () => {
      render(<Badge variant="outline" data-testid="badge">Outline</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('text-foreground');
      expect(badge.className).not.toContain('border-transparent');
    });
  });

  describe('ClassName Prop', () => {
    it('should merge custom className with default classes', () => {
      render(<Badge className="custom-class" data-testid="badge">Custom</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('custom-class');
      expect(badge.className).toContain('inline-flex'); // Base class
      expect(badge.className).toContain('bg-primary'); // Default variant
    });

    it('should allow overriding default classes with custom className', () => {
      render(<Badge className="bg-red-500 text-white" data-testid="badge">Override</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('bg-red-500');
      expect(badge.className).toContain('text-white');
    });

    it('should work without custom className', () => {
      render(<Badge data-testid="badge">No Custom Class</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('inline-flex');
    });
  });

  describe('HTML Attributes', () => {
    it('should pass through standard HTML div attributes', () => {
      render(
        <Badge 
          data-testid="badge"
          id="custom-badge"
          role="status"
          aria-label="Notification badge"
          title="Badge tooltip"
        >
          Accessible Badge
        </Badge>
      );
      
      const badge = screen.getByTestId('badge');
      expect(badge).toHaveAttribute('id', 'custom-badge');
      expect(badge).toHaveAttribute('role', 'status');
      expect(badge).toHaveAttribute('aria-label', 'Notification badge');
      expect(badge).toHaveAttribute('title', 'Badge tooltip');
    });

    it('should handle data attributes', () => {
      render(
        <Badge 
          data-testid="badge"
          data-count="5"
          data-type="notification"
        >
          Data Badge
        </Badge>
      );
      
      const badge = screen.getByTestId('badge');
      expect(badge).toHaveAttribute('data-count', '5');
      expect(badge).toHaveAttribute('data-type', 'notification');
    });

    it('should handle style attribute', () => {
      render(
        <Badge 
          data-testid="badge"
          style={{ fontSize: '14px', marginTop: '10px' }}
        >
          Styled Badge
        </Badge>
      );
      
      const badge = screen.getByTestId('badge');
      expect(badge).toHaveStyle('font-size: 14px');
      expect(badge).toHaveStyle('margin-top: 10px');
    });
  });

  describe('Event Handling', () => {
    it('should handle click events', async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();
      
      render(<Badge onClick={handleClick} data-testid="badge">Clickable</Badge>);
      
      const badge = screen.getByTestId('badge');
      await user.click(badge);
      
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should handle mouse events', async () => {
      const user = userEvent.setup();
      const handleMouseOver = jest.fn();
      const handleMouseLeave = jest.fn();
      
      render(
        <Badge 
          onMouseOver={handleMouseOver}
          onMouseLeave={handleMouseLeave}
          data-testid="badge"
        >
          Hover Badge
        </Badge>
      );
      
      const badge = screen.getByTestId('badge');
      
      await user.hover(badge);
      expect(handleMouseOver).toHaveBeenCalled();
      
      await user.unhover(badge);
      expect(handleMouseLeave).toHaveBeenCalled();
    });

    it('should handle keyboard events', async () => {
      const user = userEvent.setup();
      const handleKeyDown = jest.fn();
      
      render(
        <Badge 
          onKeyDown={handleKeyDown}
          tabIndex={0}
          data-testid="badge"
        >
          Keyboard Badge
        </Badge>
      );
      
      const badge = screen.getByTestId('badge');
      badge.focus();
      await user.keyboard('{Enter}');
      
      expect(handleKeyDown).toHaveBeenCalled();
    });
  });

  describe('Children and Content', () => {
    it('should render text children', () => {
      render(<Badge>Simple Text</Badge>);
      
      expect(screen.getByText('Simple Text')).toBeInTheDocument();
    });

    it('should render JSX children', () => {
      render(
        <Badge>
          <span data-testid="icon">🎯</span>
          <span>With Icon</span>
        </Badge>
      );
      
      expect(screen.getByTestId('icon')).toBeInTheDocument();
      expect(screen.getByText('With Icon')).toBeInTheDocument();
    });

    it('should render multiple children elements', () => {
      render(
        <Badge>
          <strong>Bold</strong>
          <em>Italic</em>
          Normal
        </Badge>
      );
      
      expect(screen.getByText('Bold')).toBeInTheDocument();
      expect(screen.getByText('Italic')).toBeInTheDocument();
      expect(screen.getByText('Normal')).toBeInTheDocument();
    });

    it('should handle empty children', () => {
      render(<Badge data-testid="empty-badge"></Badge>);
      
      const badge = screen.getByTestId('empty-badge');
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toBe('');
    });

    it('should handle numeric children', () => {
      render(<Badge>{42}</Badge>);
      
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('should handle boolean children', () => {
      render(<Badge>{true && 'Conditional Text'}</Badge>);
      
      expect(screen.getByText('Conditional Text')).toBeInTheDocument();
    });
  });

  describe('Variant Combinations with Custom Classes', () => {
    it('should combine variant styles with custom classes', () => {
      const testCases = [
        { variant: 'default' as const, className: 'shadow-lg' },
        { variant: 'secondary' as const, className: 'border-2' },
        { variant: 'destructive' as const, className: 'animate-pulse' },
        { variant: 'outline' as const, className: 'bg-opacity-50' }
      ];

      testCases.forEach(({ variant, className }, index) => {
        const { unmount } = render(
          <Badge variant={variant} className={className} data-testid={`badge-${index}`}>
            Badge {index}
          </Badge>
        );
        
        const badge = screen.getByTestId(`badge-${index}`);
        expect(badge.className).toContain(className);
        
        unmount();
      });
    });
  });

  describe('BadgeVariants Function', () => {
    it('should generate correct classes for default variant', () => {
      const classes = badgeVariants();
      expect(classes).toContain('inline-flex');
      expect(classes).toContain('bg-primary');
      expect(classes).toContain('border-transparent');
    });

    it('should generate correct classes for custom variant', () => {
      const classes = badgeVariants({ variant: 'destructive' });
      expect(classes).toContain('bg-destructive');
      expect(classes).toContain('text-destructive-foreground');
    });

    it('should handle custom className parameter', () => {
      const classes = badgeVariants({ variant: 'secondary', className: 'extra-class' });
      expect(classes).toContain('extra-class');
      expect(classes).toContain('bg-secondary');
    });

    it('should handle undefined variant gracefully', () => {
      const classes = badgeVariants({ variant: undefined });
      expect(classes).toContain('bg-primary'); // Should default
    });
  });

  describe('Accessibility', () => {
    it('should be focusable when tabIndex is provided', () => {
      render(<Badge tabIndex={0} data-testid="badge">Focusable</Badge>);
      
      const badge = screen.getByTestId('badge');
      expect(badge).toHaveAttribute('tabIndex', '0');
    });

    it('should support ARIA attributes', () => {
      render(
        <Badge 
          role="status"
          aria-live="polite"
          aria-label="Notification count"
          data-testid="badge"
        >
          5
        </Badge>
      );
      
      const badge = screen.getByTestId('badge');
      expect(badge).toHaveAttribute('role', 'status');
      expect(badge).toHaveAttribute('aria-live', 'polite');
      expect(badge).toHaveAttribute('aria-label', 'Notification count');
    });

    it('should work with screen readers', () => {
      render(
        <Badge aria-label="3 unread messages">
          3
        </Badge>
      );
      
      const badge = screen.getByLabelText('3 unread messages');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Real-world Usage Scenarios', () => {
    it('should work as a notification badge', () => {
      render(
        <div>
          <span>Messages</span>
          <Badge variant="destructive" aria-label="3 unread messages">
            3
          </Badge>
        </div>
      );
      
      expect(screen.getByText('Messages')).toBeInTheDocument();
      expect(screen.getByLabelText('3 unread messages')).toBeInTheDocument();
    });

    it('should work as a status indicator', () => {
      render(
        <Badge variant="secondary" role="status">
          Online
        </Badge>
      );
      
      const badge = screen.getByRole('status');
      expect(badge).toHaveTextContent('Online');
    });

    it('should work as a tag or label', () => {
      render(
        <div>
          <Badge variant="outline">React</Badge>
          <Badge variant="outline">TypeScript</Badge>
          <Badge variant="outline">Testing</Badge>
        </div>
      );
      
      expect(screen.getByText('React')).toBeInTheDocument();
      expect(screen.getByText('TypeScript')).toBeInTheDocument();
      expect(screen.getByText('Testing')).toBeInTheDocument();
    });

    it('should work in navigation or menu contexts', () => {
      render(
        <nav>
          <a href="/dashboard">
            Dashboard
            <Badge variant="destructive" className="ml-2">
              2
            </Badge>
          </a>
        </nav>
      );
      
      expect(screen.getByRole('link')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long text content', () => {
      const longText = 'This is a very long badge text that might wrap or overflow';
      
      render(<Badge data-testid="long-badge">{longText}</Badge>);
      
      const badge = screen.getByTestId('long-badge');
      expect(badge).toHaveTextContent(longText);
    });

    it('should handle special characters', () => {
      const specialText = '🎯 Special & "Characters" <test>';
      
      render(<Badge>{specialText}</Badge>);
      
      expect(screen.getByText(specialText)).toBeInTheDocument();
    });

    it('should handle whitespace-only content', () => {
      render(<Badge data-testid="whitespace-badge">   </Badge>);
      
      const badge = screen.getByTestId('whitespace-badge');
      expect(badge).toBeInTheDocument();
    });

    it('should handle zero as content', () => {
      render(<Badge>{0}</Badge>);
      
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('TypeScript Interface', () => {
    it('should accept all HTMLDivElement attributes', () => {
      // This test ensures the TypeScript interface is correctly defined
      render(
        <Badge
          id="test-id"
          className="test-class"
          style={{ color: 'red' }}
          onClick={() => {}}
          onMouseEnter={() => {}}
          data-custom="value"
          aria-label="test"
          role="button"
          tabIndex={0}
          variant="destructive"
        >
          Test
        </Badge>
      );
      
      const badge = screen.getByText('Test');
      expect(badge).toHaveAttribute('id', 'test-id');
      expect(badge).toHaveAttribute('data-custom', 'value');
      expect(badge).toHaveAttribute('role', 'button');
    });
  });
});