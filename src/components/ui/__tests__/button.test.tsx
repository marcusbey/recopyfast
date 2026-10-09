/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "../button";

// Mock class-variance-authority and utils
jest.mock("@/lib/utils/cn", () => ({
  cn: (...classes: (string | undefined | null | boolean)[]) =>
    classes.filter(Boolean).join(" "),
}));

afterEach(() => {
  cleanup();
});

describe("Button Component", () => {
  describe("Basic Rendering", () => {
    it("should render a button element by default", () => {
      render(<Button>Click me</Button>);

      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
      expect(button.tagName).toBe("BUTTON");
    });

    it("should render button text correctly", () => {
      render(<Button>Test Button</Button>);

      expect(screen.getByText("Test Button")).toBeInTheDocument();
    });

    it("should apply default variant and size classes", () => {
      render(<Button>Default Button</Button>);

      const button = screen.getByRole("button");
      expect(button).toHaveClass(
        "inline-flex",
        "items-center",
        "justify-center",
      );
    });
  });

  describe("Variant Prop", () => {
    it("should apply default variant styles", () => {
      render(<Button variant="default">Default</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("bg-primary");
    });

    it("should apply destructive variant styles", () => {
      render(<Button variant="destructive">Delete</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("bg-destructive");
    });

    it("should apply outline variant styles", () => {
      render(<Button variant="outline">Outline</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("border");
    });

    it("should apply secondary variant styles", () => {
      render(<Button variant="secondary">Secondary</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("bg-secondary");
    });

    it("should apply ghost variant styles", () => {
      render(<Button variant="ghost">Ghost</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("hover:bg-accent");
    });

    it("should apply link variant styles", () => {
      render(<Button variant="link">Link</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("underline-offset-4");
    });
  });

  describe("Size Prop", () => {
    it("should apply default size styles", () => {
      render(<Button size="default">Default Size</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("h-10");
    });

    it("should apply small size styles", () => {
      render(<Button size="sm">Small</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("h-8");
    });

    it("should apply large size styles", () => {
      render(<Button size="lg">Large</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("h-12");
    });

    it("should apply icon size styles", () => {
      render(<Button size="icon">Icon</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("h-10");
      expect(button.className).toContain("w-10");
    });
  });

  describe("AsChild Prop", () => {
    it("should render as Slot when asChild is true", () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>,
      );

      const link = screen.getByRole("link");
      expect(link).toBeInTheDocument();
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", "/test");
    });

    /**
     * s73 tombstone. Until s73, Button rendered <Slot> with one child: the
     * Fragment wrapping leftIcon/children/rightIcon. Radix Slot clones its one
     * child, so className, ref and every other prop landed on React.Fragment
     * and were dropped — React logged "Invalid prop `className` supplied to
     * `React.Fragment`", and ten call sites shipped a bare <a> where they asked
     * for a button. This test and the asChild ref test below were `it.failing`
     * while the defect stood; they are plain `it` since the fix.
     */
    it("should apply button classes to child element when asChild is true", () => {
      render(
        <Button asChild variant="destructive">
          <a href="/test">Delete Link</a>
        </Button>,
      );

      const link = screen.getByRole("link");
      expect(link.className).toContain("bg-destructive");
    });

    it("gives the child the base, variant, size and call-site classes, merged with its own", () => {
      render(
        <Button asChild variant="outline" size="sm" className="extra">
          <a href="/sites" className="mine">
            Sites
          </a>
        </Button>,
      );

      const link = screen.getByRole("link", { name: "Sites" });
      expect(link).toHaveClass("inline-flex", "border", "h-8", "extra", "mine");
      expect(link).toHaveAttribute("href", "/sites");
    });

    it("styles a next/link child, the shape of nine of the ten call sites", () => {
      render(
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/sites">Sites</Link>
        </Button>,
      );

      const link = screen.getByRole("link", { name: "Sites" });
      expect(link).toHaveClass("inline-flex", "border", "h-8");
      expect(link).toHaveAttribute("href", "/dashboard/sites");
    });

    it("renders leftIcon and rightIcon inside the child, around its content", () => {
      render(
        <Button
          asChild
          leftIcon={<svg data-testid="left" />}
          rightIcon={<svg data-testid="right" />}
        >
          <a href="/open">Open</a>
        </Button>,
      );

      const link = screen.getByRole("link", { name: "Open" });
      expect(link.innerHTML).toBe(
        '<svg data-testid="left"></svg>Open<svg data-testid="right"></svg>',
      );
    });

    it("marks a loading child busy, with the spinner in place of the icons and its content unwrapped", () => {
      render(
        <Button
          asChild
          loading
          leftIcon={<svg data-testid="left" />}
          rightIcon={<svg data-testid="right" />}
        >
          <a href="/open">Open</a>
        </Button>,
      );

      const link = screen.getByRole("link", { name: "Open" });
      expect(link).toHaveAttribute("aria-busy", "true");
      expect(link.firstElementChild).toHaveClass("animate-spin");
      expect(screen.queryByTestId("left")).not.toBeInTheDocument();
      expect(screen.queryByTestId("right")).not.toBeInTheDocument();
      // The dimmed <span> is a <button>-only detail: the child's own content
      // is not Button's to wrap.
      expect(link.lastChild?.nodeType).toBe(Node.TEXT_NODE);
      expect(link.textContent).toBe("Open");
    });

    it("logs nothing — no prop lands on React.Fragment", () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        render(
          <Button asChild variant="outline">
            <a href="/download" download>
              <svg data-testid="icon" />
              Download Markdown
            </a>
          </Button>,
        );
        render(
          <Button asChild loading rightIcon={<svg />}>
            <Link href="/dashboard/sites">Back to Sites</Link>
          </Button>,
        );

        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    });

    // s73 review minor 1: `disabled` is not valid on an <a> and stops nothing
    // there. With asChild it is not forwarded, and development says so; a
    // non-element child, which Slot drops, is reported the same way.
    // Devin review, PR #78: a native <button> child CAN be disabled, so
    // `disabled` and `loading` must reach it — a slotted submit button must not
    // submit again while its Button says it is busy.
    it.each([
      ["disabled", { disabled: true }],
      ["loading", { loading: true }],
    ])("disables a native button child when %s", (_name, extra) => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        render(
          <Button asChild {...extra}>
            <button type="submit">Save</button>
          </Button>,
        );

        expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    });

    it("does not put `disabled` on the child, and warns in development", () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        render(
          <Button asChild disabled>
            <a href="/x">Go</a>
          </Button>,
        );

        const link = screen.getByRole("link", { name: "Go" });
        expect(link).not.toHaveAttribute("disabled");
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining("`disabled` has no effect with asChild"),
        );
      } finally {
        consoleError.mockRestore();
      }
    });

    it("warns in development when asChild gets no single element", () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        render(<Button asChild>Plain text</Button>);

        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining("asChild needs one element child"),
        );
      } finally {
        consoleError.mockRestore();
      }
    });

    it("should render as button when asChild is false", () => {
      render(<Button asChild={false}>Normal Button</Button>);

      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
      expect(button.tagName).toBe("BUTTON");
    });
  });

  describe("HTML Attributes", () => {
    it("should pass through standard button attributes", () => {
      render(
        <Button
          type="submit"
          disabled
          data-testid="custom-button"
          aria-label="Custom button"
        >
          Submit
        </Button>,
      );

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("type", "submit");
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("data-testid", "custom-button");
      expect(button).toHaveAttribute("aria-label", "Custom button");
    });

    it("should handle onClick event", async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();

      render(<Button onClick={handleClick}>Clickable</Button>);

      const button = screen.getByRole("button");
      await user.click(button);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("should not call onClick when disabled", async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();

      render(
        <Button onClick={handleClick} disabled>
          Disabled
        </Button>,
      );

      const button = screen.getByRole("button");
      await user.click(button);

      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe("ClassName Prop", () => {
    it("should merge custom className with variant classes", () => {
      render(<Button className="custom-class">Custom</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("custom-class");
      expect(button.className).toContain("inline-flex"); // Base class
    });

    it("should allow overriding default classes", () => {
      render(<Button className="bg-red-500">Override</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("bg-red-500");
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to button element", () => {
      const ref = React.createRef<HTMLButtonElement>();

      render(<Button ref={ref}>Ref Button</Button>);

      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
      expect(ref.current?.textContent).toBe("Ref Button");
    });

    // s73: was `it.failing` — the ref landed on the wrapping React.Fragment,
    // never on the <a>. See the tombstone in "AsChild Prop".
    it("should forward ref when using asChild", () => {
      const ref = React.createRef<HTMLAnchorElement>();

      render(
        <Button asChild ref={ref as unknown as React.Ref<HTMLButtonElement>}>
          <a href="/test">Ref Link</a>
        </Button>,
      );

      expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
    });
  });

  describe("Variant Combinations", () => {
    it("should handle multiple variant and size combinations", () => {
      const combinations = [
        { variant: "default" as const, size: "sm" as const },
        { variant: "destructive" as const, size: "lg" as const },
        { variant: "outline" as const, size: "icon" as const },
        { variant: "secondary" as const, size: "default" as const },
        { variant: "ghost" as const, size: "sm" as const },
        { variant: "link" as const, size: "lg" as const },
      ];

      combinations.forEach(({ variant, size }, index) => {
        const testId = `test-button-${index}`;
        const { unmount } = render(
          <Button variant={variant} size={size} data-testid={testId}>
            Button {index}
          </Button>,
        );

        const button = screen.getByTestId(testId);
        expect(button).toBeInTheDocument();

        unmount();
      });
    });
  });

  describe("Children and Content", () => {
    it("should render children elements", () => {
      render(
        <Button>
          <span>Icon</span>
          Button Text
        </Button>,
      );

      expect(screen.getByText("Icon")).toBeInTheDocument();
      expect(screen.getByText("Button Text")).toBeInTheDocument();
    });

    it("should render JSX children", () => {
      render(
        <Button>
          <svg data-testid="icon" width="16" height="16">
            <circle cx="8" cy="8" r="4" />
          </svg>
          With Icon
        </Button>,
      );

      expect(screen.getByTestId("icon")).toBeInTheDocument();
      expect(screen.getByText("With Icon")).toBeInTheDocument();
    });

    it("should handle empty children", () => {
      render(<Button></Button>);

      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
      expect(button.textContent).toBe("");
    });
  });

  describe("Shape (s66a, ADR 050)", () => {
    const sizes = [
      "default",
      "sm",
      "lg",
      "xl",
      "icon",
      "icon-sm",
      "icon-lg",
    ] as const;
    const variants = [
      "default",
      "destructive",
      "outline",
      "secondary",
      "ghost",
      "link",
    ] as const;

    it.each(sizes)("carries the 2px control radius at size %s", (size) => {
      const classes = buttonVariants({ size }).split(/\s+/);
      expect(classes).toContain("rounded-control");
      // One radius per size: the legacy scale used to grow it to 16px at xl.
      expect(
        classes.filter((name) => /^rounded-(?!control$)/.test(name)),
      ).toEqual([]);
    });

    it.each(variants)("casts no shadow in the %s variant", (variant) => {
      expect(buttonVariants({ variant })).not.toMatch(/(^|\s|:)shadow-/);
    });
  });

  /**
   * s73 guard. The asChild fix restructures Button's children around Radix
   * `Slottable`; a `<button>` must come out byte for byte as it did before.
   * These pin today's markup, so they were green before the fix by design.
   */
  describe("Markup without asChild (s73)", () => {
    const leftIcon = <svg data-testid="left" />;
    const rightIcon = <svg data-testid="right" />;
    const icons = '<svg data-testid="left"></svg>';
    const trailing = '<svg data-testid="right"></svg>';
    // innerHTML escapes `&` in attributes (`[&_svg]:size-4`).
    const classes = buttonVariants().replace(/&/g, "&amp;");

    it("renders a plain button unchanged", () => {
      const { container } = render(<Button>Save</Button>);

      expect(container.innerHTML).toBe(
        `<button class="${classes}">Save</button>`,
      );
    });

    it("renders icons either side of the label unchanged", () => {
      const { container } = render(
        <Button leftIcon={leftIcon} rightIcon={rightIcon}>
          Save
        </Button>,
      );

      expect(container.innerHTML).toBe(
        `<button class="${classes}">${icons}Save${trailing}</button>`,
      );
    });

    it("renders loading as spinner plus dimmed label, icons dropped", () => {
      const { container: spinner } = render(
        <Loader2 className="animate-spin" aria-hidden="true" />,
      );
      const spinnerMarkup = spinner.innerHTML;
      cleanup();

      const { container } = render(
        <Button loading leftIcon={leftIcon} rightIcon={rightIcon}>
          Save
        </Button>,
      );

      expect(container.innerHTML).toBe(
        `<button class="${classes}" disabled="" aria-busy="true">` +
          `${spinnerMarkup}<span class="opacity-70">Save</span></button>`,
      );
    });
  });

  describe("Display Name", () => {
    it("should have correct display name", () => {
      expect(Button.displayName).toBe("Button");
    });
  });

  describe("ButtonVariants Function", () => {
    it("should generate correct classes for default variant", () => {
      const classes = buttonVariants();
      expect(classes).toContain("inline-flex");
      expect(classes).toContain("bg-primary");
      expect(classes).toContain("h-10");
    });

    it("should generate correct classes for custom variant and size", () => {
      const classes = buttonVariants({ variant: "destructive", size: "lg" });
      expect(classes).toContain("bg-destructive");
      expect(classes).toContain("h-12");
    });

    it("should handle custom className parameter", () => {
      const classes = buttonVariants({ className: "custom-class" });
      expect(classes).toContain("custom-class");
    });
  });

  describe("Accessibility", () => {
    it("should be focusable by default", () => {
      render(<Button>Focusable</Button>);

      const button = screen.getByRole("button");
      expect(button).not.toHaveAttribute("tabindex", "-1");
    });

    it("should support custom ARIA attributes", () => {
      render(
        <Button aria-expanded="false" aria-haspopup="menu" role="menubutton">
          Menu
        </Button>,
      );

      const button = screen.getByRole("menubutton");
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).toHaveAttribute("aria-haspopup", "menu");
    });

    it("should maintain focus styles", () => {
      render(<Button>Focus Test</Button>);

      const button = screen.getByRole("button");
      expect(button.className).toContain("focus-visible:outline-none");
      expect(button.className).toContain("focus-visible:ring-2");
    });
  });

  describe("Event Handling", () => {
    it("should handle multiple event handlers", async () => {
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
        </Button>,
      );

      const button = screen.getByRole("button");

      await user.hover(button);
      expect(handleMouseOver).toHaveBeenCalled();

      await user.click(button);
      expect(handleClick).toHaveBeenCalled();

      button.focus();
      expect(handleFocus).toHaveBeenCalled();
    });

    it("should handle keyboard events", async () => {
      const user = userEvent.setup();
      const handleKeyDown = jest.fn();

      render(<Button onKeyDown={handleKeyDown}>Keyboard</Button>);

      const button = screen.getByRole("button");
      button.focus();
      await user.keyboard("{Enter}");

      expect(handleKeyDown).toHaveBeenCalled();
    });
  });
});
