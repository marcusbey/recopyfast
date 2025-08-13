/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, buttonVariants } from '../button';

// Mock class-variance-authority and utils
jest.mock('@/lib/utils/cn', () => ({
  cn: (...classes: (string | undefined | null | boolean)[]) => classes.filter(Boolean).join(' ')
}));

afterEach(() => {
  cleanup();
});

describe('Button Component', () => {
  describe('Basic Rendering', () => {
    it('should render a button element by default', () => {
      render(<Button>Click me</Button>);
      
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      expect(button.tagName).toBe('BUTTON');
    });

    it('should render button text correctly', () => {
      render(<Button>Test Button</Button>);
      
      expect(screen.getByText('Test Button')).toBeInTheDocument();
    });

    it('should apply default variant and size classes', () => {
      render(<Button>Default Button</Button>);
      
      const button = screen.getByRole('button');
      expect(button).toHaveClass('inline-flex', 'items-center', 'justify-center');
    });
  });

  describe('Variant Prop', () => {
    it('should apply default variant styles', () => {
      render(<Button variant="default">Default</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('bg-primary');
    });

    it('should apply destructive variant styles', () => {
      render(<Button variant="destructive">Delete</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('bg-destructive');
    });

    it('should apply outline variant styles', () => {
      render(<Button variant="outline">Outline</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('border');
    });

    it('should apply secondary variant styles', () => {
      render(<Button variant="secondary">Secondary</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('bg-secondary');
    });

    it('should apply ghost variant styles', () => {
      render(<Button variant="ghost">Ghost</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('hover:bg-accent');
    });

    it('should apply link variant styles', () => {
      render(<Button variant="link">Link</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('underline-offset-4');
    });
  });

  describe('Size Prop', () => {
    it('should apply default size styles', () => {
      render(<Button size="default">Default Size</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('h-10');
    });

    it('should apply small size styles', () => {
      render(<Button size="sm">Small</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('h-9');
    });

    it('should apply large size styles', () => {
      render(<Button size="lg">Large</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('h-11');
    });

    it('should apply icon size styles', () => {
      render(<Button size="icon">Icon</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('h-10');
      expect(button.className).toContain('w-10');
    });
  });

  describe('AsChild Prop', () => {
    it('should render as Slot when asChild is true', () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      );
      
      const link = screen.getByRole('link');
      expect(link).toBeInTheDocument();
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('href', '/test');
    });

    it('should apply button classes to child element when asChild is true', () => {
      render(
        <Button asChild variant="destructive">
          <a href="/test">Delete Link</a>
        </Button>
      );
      
      const link = screen.getByRole('link');
      expect(link.className).toContain('bg-destructive');
    });

    it('should render as button when asChild is false', () => {
      render(<Button asChild={false}>Normal Button</Button>);
      
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      expect(button.tagName).toBe('BUTTON');
    });
  });

  describe('HTML Attributes', () => {
    it('should pass through standard button attributes', () => {
      render(
        <Button 
          type="submit" 
          disabled 
          data-testid="custom-button"
          aria-label="Custom button"
        >
          Submit
        </Button>
      );
      
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('type', 'submit');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('data-testid', 'custom-button');
      expect(button).toHaveAttribute('aria-label', 'Custom button');
    });

    it('should handle onClick event', async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();
      
      render(<Button onClick={handleClick}>Clickable</Button>);
      
      const button = screen.getByRole('button');
      await user.click(button);
      
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should not call onClick when disabled', async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();
      
      render(<Button onClick={handleClick} disabled>Disabled</Button>);
      
      const button = screen.getByRole('button');
      await user.click(button);
      
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('ClassName Prop', () => {
    it('should merge custom className with variant classes', () => {
      render(<Button className="custom-class">Custom</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('custom-class');
      expect(button.className).toContain('inline-flex'); // Base class
    });

    it('should allow overriding default classes', () => {
      render(<Button className="bg-red-500">Override</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('bg-red-500');
    });
  });

  describe('Ref Forwarding', () => {
    it('should forward ref to button element', () => {
      const ref = React.createRef<HTMLButtonElement>();
      
      render(<Button ref={ref}>Ref Button</Button>);
      
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
      expect(ref.current?.textContent).toBe('Ref Button');
    });

    it('should forward ref when using asChild', () => {
      const ref = React.createRef<HTMLAnchorElement>();
      
      render(
        <Button asChild ref={ref as any}>
          <a href="/test">Ref Link</a>
        </Button>
      );
      
      expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
    });
  });

  describe('Variant Combinations', () => {
    it('should handle multiple variant and size combinations', () => {
      const combinations = [
        { variant: 'default' as const, size: 'sm' as const },
        { variant: 'destructive' as const, size: 'lg' as const },
        { variant: 'outline' as const, size: 'icon' as const },
        { variant: 'secondary' as const, size: 'default' as const },
        { variant: 'ghost' as const, size: 'sm' as const },
        { variant: 'link' as const, size: 'lg' as const }
      ];

      combinations.forEach(({ variant, size }, index) => {
        const { unmount } = render(
          <Button variant={variant} size={size} key={index}>
            Button {index}
          </Button>
        );
        
        const button = screen.getByText(`Button ${index}`);
        expect(button).toBeInTheDocument();
        
        unmount();
      });
    });
  });

  describe('Children and Content', () => {
    it('should render children elements', () => {
      render(
        <Button>
          <span>Icon</span>
          Button Text
        </Button>
      );
      
      expect(screen.getByText('Icon')).toBeInTheDocument();
      expect(screen.getByText('Button Text')).toBeInTheDocument();
    });

    it('should render JSX children', () => {
      render(
        <Button>
          <svg data-testid="icon" width="16" height="16">
            <circle cx="8" cy="8" r="4" />
          </svg>
          With Icon
        </Button>
      );
      
      expect(screen.getByTestId('icon')).toBeInTheDocument();
      expect(screen.getByText('With Icon')).toBeInTheDocument();
    });

    it('should handle empty children', () => {
      render(<Button></Button>);
      
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      expect(button.textContent).toBe('');
    });
  });

  describe('Display Name', () => {
    it('should have correct display name', () => {
      expect(Button.displayName).toBe('Button');
    });
  });

  describe('ButtonVariants Function', () => {
    it('should generate correct classes for default variant', () => {
      const classes = buttonVariants();
      expect(classes).toContain('inline-flex');
      expect(classes).toContain('bg-primary');
      expect(classes).toContain('h-10');
    });

    it('should generate correct classes for custom variant and size', () => {
      const classes = buttonVariants({ variant: 'destructive', size: 'lg' });
      expect(classes).toContain('bg-destructive');
      expect(classes).toContain('h-11');
    });

    it('should handle custom className parameter', () => {
      const classes = buttonVariants({ className: 'custom-class' });
      expect(classes).toContain('custom-class');
    });
  });

  describe('Accessibility', () => {
    it('should be focusable by default', () => {
      render(<Button>Focusable</Button>);
      
      const button = screen.getByRole('button');
      expect(button).not.toHaveAttribute('tabindex', '-1');
    });

    it('should support custom ARIA attributes', () => {
      render(
        <Button 
          aria-expanded="false"
          aria-haspopup="menu"
          role="menubutton"
        >
          Menu
        </Button>
      );
      
      const button = screen.getByRole('menubutton');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button).toHaveAttribute('aria-haspopup', 'menu');
    });

    it('should maintain focus styles', () => {
      render(<Button>Focus Test</Button>);
      
      const button = screen.getByRole('button');
      expect(button.className).toContain('focus-visible:outline-none');
      expect(button.className).toContain('focus-visible:ring-2');
    });
  });

  describe('Event Handling', () => {
    it('should handle multiple event handlers', async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();
      const handleMouseOver = jest.fn();
      const handleFocus = jest.fn();
      
      render(
        <Button 
          onClick={handleClick}
          onMouseOver={handleMouseOver}
          onFocus={handleFocus}
        >
          Events
        </Button>
      );
      
      const button = screen.getByRole('button');
      
      await user.hover(button);
      expect(handleMouseOver).toHaveBeenCalled();
      
      await user.click(button);
      expect(handleClick).toHaveBeenCalled();
      
      button.focus();
      expect(handleFocus).toHaveBeenCalled();
    });

    it('should handle keyboard events', async () => {
      const user = userEvent.setup();
      const handleKeyDown = jest.fn();
      
      render(<Button onKeyDown={handleKeyDown}>Keyboard</Button>);
      
      const button = screen.getByRole('button');
      button.focus();
      await user.keyboard('{Enter}');
      
      expect(handleKeyDown).toHaveBeenCalled();
    });
  });
});