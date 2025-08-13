/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent, 
  CardFooter 
} from '../card';

// Mock utils
jest.mock('@/lib/utils/cn', () => ({
  cn: (...classes: (string | undefined | null | boolean)[]) => classes.filter(Boolean).join(' ')
}));

afterEach(() => {
  cleanup();
});

describe('Card Components', () => {
  describe('Card Component', () => {
    it('should render as a div element', () => {
      render(<Card data-testid="card">Card Content</Card>);
      
      const card = screen.getByTestId('card');
      expect(card).toBeInTheDocument();
      expect(card.tagName).toBe('DIV');
    });

    it('should apply default card classes', () => {
      render(<Card data-testid="card">Content</Card>);
      
      const card = screen.getByTestId('card');
      expect(card.className).toContain('rounded-lg');
      expect(card.className).toContain('border');
      expect(card.className).toContain('bg-card');
      expect(card.className).toContain('text-card-foreground');
      expect(card.className).toContain('shadow-sm');
    });

    it('should merge custom className with default classes', () => {
      render(<Card className="custom-class" data-testid="card">Content</Card>);
      
      const card = screen.getByTestId('card');
      expect(card.className).toContain('custom-class');
      expect(card.className).toContain('rounded-lg');
    });

    it('should forward HTML attributes', () => {
      render(
        <Card 
          data-testid="card"
          id="custom-id"
          role="article"
          aria-label="Custom card"
        >
          Content
        </Card>
      );
      
      const card = screen.getByTestId('card');
      expect(card).toHaveAttribute('id', 'custom-id');
      expect(card).toHaveAttribute('role', 'article');
      expect(card).toHaveAttribute('aria-label', 'Custom card');
    });

    it('should forward ref correctly', () => {
      const ref = React.createRef<HTMLDivElement>();
      
      render(<Card ref={ref}>Content</Card>);
      
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
      expect(ref.current?.textContent).toBe('Content');
    });

    it('should have correct display name', () => {
      expect(Card.displayName).toBe('Card');
    });
  });

  describe('CardHeader Component', () => {
    it('should render as a div element', () => {
      render(<CardHeader data-testid="header">Header Content</CardHeader>);
      
      const header = screen.getByTestId('header');
      expect(header).toBeInTheDocument();
      expect(header.tagName).toBe('DIV');
    });

    it('should apply default header classes', () => {
      render(<CardHeader data-testid="header">Content</CardHeader>);
      
      const header = screen.getByTestId('header');
      expect(header.className).toContain('flex');
      expect(header.className).toContain('flex-col');
      expect(header.className).toContain('space-y-1.5');
      expect(header.className).toContain('p-6');
    });

    it('should merge custom className', () => {
      render(<CardHeader className="custom-header" data-testid="header">Content</CardHeader>);
      
      const header = screen.getByTestId('header');
      expect(header.className).toContain('custom-header');
      expect(header.className).toContain('flex');
    });

    it('should forward ref correctly', () => {
      const ref = React.createRef<HTMLDivElement>();
      
      render(<CardHeader ref={ref}>Header</CardHeader>);
      
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });

    it('should have correct display name', () => {
      expect(CardHeader.displayName).toBe('CardHeader');
    });
  });

  describe('CardTitle Component', () => {
    it('should render as an h3 element', () => {
      render(<CardTitle data-testid="title">Card Title</CardTitle>);
      
      const title = screen.getByTestId('title');
      expect(title).toBeInTheDocument();
      expect(title.tagName).toBe('H3');
    });

    it('should apply default title classes', () => {
      render(<CardTitle data-testid="title">Title</CardTitle>);
      
      const title = screen.getByTestId('title');
      expect(title.className).toContain('text-2xl');
      expect(title.className).toContain('font-semibold');
      expect(title.className).toContain('leading-none');
      expect(title.className).toContain('tracking-tight');
    });

    it('should merge custom className', () => {
      render(<CardTitle className="custom-title" data-testid="title">Title</CardTitle>);
      
      const title = screen.getByTestId('title');
      expect(title.className).toContain('custom-title');
      expect(title.className).toContain('text-2xl');
    });

    it('should forward ref correctly', () => {
      const ref = React.createRef<HTMLHeadingElement>();
      
      render(<CardTitle ref={ref}>Title</CardTitle>);
      
      expect(ref.current).toBeInstanceOf(HTMLHeadingElement);
      expect(ref.current?.textContent).toBe('Title');
    });

    it('should have correct display name', () => {
      expect(CardTitle.displayName).toBe('CardTitle');
    });

    it('should accept heading-specific attributes', () => {
      render(
        <CardTitle 
          id="card-title"
          role="heading"
          aria-level={2}
          data-testid="title"
        >
          Accessible Title
        </CardTitle>
      );
      
      const title = screen.getByTestId('title');
      expect(title).toHaveAttribute('id', 'card-title');
      expect(title).toHaveAttribute('role', 'heading');
      expect(title).toHaveAttribute('aria-level', '2');
    });
  });

  describe('CardDescription Component', () => {
    it('should render as a p element', () => {
      render(<CardDescription data-testid="description">Description text</CardDescription>);
      
      const description = screen.getByTestId('description');
      expect(description).toBeInTheDocument();
      expect(description.tagName).toBe('P');
    });

    it('should apply default description classes', () => {
      render(<CardDescription data-testid="description">Description</CardDescription>);
      
      const description = screen.getByTestId('description');
      expect(description.className).toContain('text-sm');
      expect(description.className).toContain('text-muted-foreground');
    });

    it('should merge custom className', () => {
      render(<CardDescription className="custom-desc" data-testid="description">Description</CardDescription>);
      
      const description = screen.getByTestId('description');
      expect(description.className).toContain('custom-desc');
      expect(description.className).toContain('text-sm');
    });

    it('should forward ref correctly', () => {
      const ref = React.createRef<HTMLParagraphElement>();
      
      render(<CardDescription ref={ref}>Description</CardDescription>);
      
      expect(ref.current).toBeInstanceOf(HTMLParagraphElement);
    });

    it('should have correct display name', () => {
      expect(CardDescription.displayName).toBe('CardDescription');
    });
  });

  describe('CardContent Component', () => {
    it('should render as a div element', () => {
      render(<CardContent data-testid="content">Content text</CardContent>);
      
      const content = screen.getByTestId('content');
      expect(content).toBeInTheDocument();
      expect(content.tagName).toBe('DIV');
    });

    it('should apply default content classes', () => {
      render(<CardContent data-testid="content">Content</CardContent>);
      
      const content = screen.getByTestId('content');
      expect(content.className).toContain('p-6');
      expect(content.className).toContain('pt-0');
    });

    it('should merge custom className', () => {
      render(<CardContent className="custom-content" data-testid="content">Content</CardContent>);
      
      const content = screen.getByTestId('content');
      expect(content.className).toContain('custom-content');
      expect(content.className).toContain('p-6');
    });

    it('should forward ref correctly', () => {
      const ref = React.createRef<HTMLDivElement>();
      
      render(<CardContent ref={ref}>Content</CardContent>);
      
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });

    it('should have correct display name', () => {
      expect(CardContent.displayName).toBe('CardContent');
    });
  });

  describe('CardFooter Component', () => {
    it('should render as a div element', () => {
      render(<CardFooter data-testid="footer">Footer content</CardFooter>);
      
      const footer = screen.getByTestId('footer');
      expect(footer).toBeInTheDocument();
      expect(footer.tagName).toBe('DIV');
    });

    it('should apply default footer classes', () => {
      render(<CardFooter data-testid="footer">Footer</CardFooter>);
      
      const footer = screen.getByTestId('footer');
      expect(footer.className).toContain('flex');
      expect(footer.className).toContain('items-center');
      expect(footer.className).toContain('p-6');
      expect(footer.className).toContain('pt-0');
    });

    it('should merge custom className', () => {
      render(<CardFooter className="custom-footer" data-testid="footer">Footer</CardFooter>);
      
      const footer = screen.getByTestId('footer');
      expect(footer.className).toContain('custom-footer');
      expect(footer.className).toContain('flex');
    });

    it('should forward ref correctly', () => {
      const ref = React.createRef<HTMLDivElement>();
      
      render(<CardFooter ref={ref}>Footer</CardFooter>);
      
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });

    it('should have correct display name', () => {
      expect(CardFooter.displayName).toBe('CardFooter');
    });
  });

  describe('Complete Card Composition', () => {
    it('should render a complete card with all components', () => {
      render(
        <Card data-testid="full-card">
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
            <CardDescription>Card description goes here</CardDescription>
          </CardHeader>
          <CardContent>
            <p>This is the main content of the card.</p>
          </CardContent>
          <CardFooter>
            <button>Action Button</button>
          </CardFooter>
        </Card>
      );

      expect(screen.getByTestId('full-card')).toBeInTheDocument();
      expect(screen.getByText('Card Title')).toBeInTheDocument();
      expect(screen.getByText('Card description goes here')).toBeInTheDocument();
      expect(screen.getByText('This is the main content of the card.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Action Button' })).toBeInTheDocument();
    });

    it('should maintain proper semantic structure', () => {
      render(
        <Card role="article">
          <CardHeader>
            <CardTitle>Article Title</CardTitle>
            <CardDescription>Article summary</CardDescription>
          </CardHeader>
          <CardContent>
            Article content
          </CardContent>
        </Card>
      );

      const card = screen.getByRole('article');
      const title = screen.getByText('Article Title');
      
      expect(card).toContainElement(title);
      expect(title.tagName).toBe('H3');
    });

    it('should handle nested components with custom classes', () => {
      render(
        <Card className="border-2">
          <CardHeader className="bg-gray-100">
            <CardTitle className="text-blue-600">Custom Title</CardTitle>
          </CardHeader>
          <CardContent className="bg-gray-50">
            Custom content
          </CardContent>
        </Card>
      );

      const card = screen.getByText('Custom Title').closest('[class*="border-2"]');
      expect(card).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should support ARIA attributes', () => {
      render(
        <Card 
          role="region"
          aria-labelledby="card-title"
          aria-describedby="card-desc"
        >
          <CardHeader>
            <CardTitle id="card-title">Accessible Card</CardTitle>
            <CardDescription id="card-desc">This card is accessible</CardDescription>
          </CardHeader>
        </Card>
      );

      const card = screen.getByRole('region');
      expect(card).toHaveAttribute('aria-labelledby', 'card-title');
      expect(card).toHaveAttribute('aria-describedby', 'card-desc');
    });

    it('should maintain focus management', () => {
      render(
        <Card tabIndex={0}>
          <CardContent>
            <button>Focusable Button</button>
          </CardContent>
        </Card>
      );

      const card = screen.getByRole('button').closest('[tabindex="0"]');
      expect(card).toBeInTheDocument();
    });
  });

  describe('Event Handling', () => {
    it('should handle click events on card components', () => {
      const handleCardClick = jest.fn();
      const handleButtonClick = jest.fn();

      render(
        <Card onClick={handleCardClick} data-testid="clickable-card">
          <CardContent>
            <button onClick={handleButtonClick}>Click me</button>
          </CardContent>
        </Card>
      );

      const card = screen.getByTestId('clickable-card');
      const button = screen.getByRole('button');

      card.click();
      expect(handleCardClick).toHaveBeenCalled();

      button.click();
      expect(handleButtonClick).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty components gracefully', () => {
      render(
        <Card data-testid="empty-card">
          <CardHeader></CardHeader>
          <CardContent></CardContent>
          <CardFooter></CardFooter>
        </Card>
      );

      expect(screen.getByTestId('empty-card')).toBeInTheDocument();
    });

    it('should handle components with only whitespace', () => {
      render(
        <Card data-testid="whitespace-card">
          <CardTitle data-testid="whitespace-title">   </CardTitle>
          <CardDescription data-testid="whitespace-desc"> </CardDescription>
        </Card>
      );

      expect(screen.getByTestId('whitespace-title')).toBeInTheDocument();
      expect(screen.getByTestId('whitespace-desc')).toBeInTheDocument();
    });

    it('should handle deeply nested content', () => {
      render(
        <Card>
          <CardContent>
            <div>
              <div>
                <p>Deeply nested content</p>
              </div>
            </div>
          </CardContent>
        </Card>
      );

      expect(screen.getByText('Deeply nested content')).toBeInTheDocument();
    });
  });

  describe('TypeScript Props', () => {
    it('should accept all standard HTML div attributes for Card', () => {
      render(
        <Card
          id="test-card"
          className="custom"
          style={{ backgroundColor: 'red' }}
          data-custom="value"
          onClick={() => {}}
          onMouseOver={() => {}}
        >
          Content
        </Card>
      );

      const card = screen.getByText('Content');
      expect(card).toHaveAttribute('id', 'test-card');
      expect(card).toHaveAttribute('data-custom', 'value');
    });

    it('should accept all standard HTML heading attributes for CardTitle', () => {
      render(
        <CardTitle
          id="test-title"
          className="custom"
          lang="en"
          dir="ltr"
        >
          Title
        </CardTitle>
      );

      const title = screen.getByText('Title');
      expect(title).toHaveAttribute('id', 'test-title');
      expect(title).toHaveAttribute('lang', 'en');
      expect(title).toHaveAttribute('dir', 'ltr');
    });
  });
});