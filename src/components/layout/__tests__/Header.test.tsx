import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "../Header";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";

let mockPathname = "/";

// Mock Next.js router
jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  usePathname: () => mockPathname,
}));

// Mock the useAuth hook
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

// Mock Next.js Link
jest.mock("next/link", () => {
  return {
    __esModule: true,
    default: ({
      children,
      href,
      className,
      ...props
    }: {
      children: React.ReactNode;
      href: string;
      className?: string;
      [key: string]: unknown;
    }) => (
      <a href={href} className={className} {...props}>
        {children}
      </a>
    ),
  };
});

// Mock user
const mockUser: Partial<User> = {
  id: "user-123",
  email: "test@example.com",
  user_metadata: {
    name: "Test User",
  },
};

describe("Header", () => {
  const mockRouter = { push: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = "/";
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
  });

  it("renders header with logo and brand name", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    expect(screen.getByText("ReCopyFast")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ReCopyFast/i })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it.each(["default", "editorial"] as const)(
    "keeps the %s desktop navigation to Demo, Pricing and Blog",
    (variant) => {
      (useAuth as jest.Mock).mockReturnValue({
        user: null,
        loading: false,
        signIn: jest.fn(),
        signUp: jest.fn(),
        signOut: jest.fn(),
        refreshSession: jest.fn(),
      });

      render(<Header variant={variant} />);

      const navigation = screen.getByRole("navigation");
      expect(
        within(navigation)
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Demo", "Pricing", "Blog"]);
      expect(
        within(navigation).getByRole("link", { name: "Demo" }),
      ).toHaveAttribute("href", "/demo");
      expect(
        within(navigation).getByRole("link", { name: "Pricing" }),
      ).toHaveAttribute("href", "/#pricing");
      expect(
        within(navigation).getByRole("link", { name: "Blog" }),
      ).toHaveAttribute("href", "/blog");
      expect(
        within(navigation).queryByRole("link", { name: "Features" }),
      ).toBeNull();
      expect(
        within(navigation).queryByRole("link", { name: "Try your site" }),
      ).toBeNull();
      expect(
        within(navigation).queryByRole("link", { name: "Product overview" }),
      ).toBeNull();
    },
  );

  it("keeps the legacy product page anchors on /product", () => {
    mockPathname = "/product";
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "/product#pricing",
    );
  });

  it("scrolls same-document marketing anchors without relying on router hash handling", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });
    const pricing = document.createElement("section");
    pricing.id = "pricing";
    pricing.scrollIntoView = jest.fn();
    document.body.appendChild(pricing);

    render(<Header />);
    fireEvent.click(screen.getByRole("link", { name: "Pricing" }));

    expect(pricing.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(window.location.hash).toBe("#pricing");
    pricing.remove();
    window.history.replaceState(null, "", "/");
  });

  it("shows loading skeleton when auth is loading", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: true,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    const loadingSkeleton = screen
      .getByText("ReCopyFast")
      .parentElement?.parentElement?.querySelector(".animate-pulse");
    expect(loadingSkeleton).toBeInTheDocument();
  });

  it("shows Sign In button when user is not authenticated", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: /get started/i })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it("shows UserMenu when user is authenticated", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    // UserMenu renders a trigger showing the first letter of the email.
    expect(screen.getByText("T")).toBeInTheDocument();
    // The signed-out CTAs are gone.
    expect(
      screen.queryByRole("button", { name: /get started/i }),
    ).not.toBeInTheDocument();
  });

  it("does not collect credentials inside the static marketing document", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    expect(screen.queryByText("Welcome to ReCopyFast")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^sign in$/i }),
    ).not.toBeInTheDocument();
  });

  it("pins the header to the top of the viewport", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    const header = screen.getByRole("banner");
    expect(header).toHaveClass("fixed", "top-0", "z-50");
  });

  it("applies the blurred background only after scrolling past the threshold", async () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    const header = screen.getByRole("banner");
    expect(header).toHaveClass("bg-transparent");
    expect(header.className).not.toContain("glass-sheet");

    act(() => {
      Object.defineProperty(window, "scrollY", {
        value: 100,
        configurable: true,
      });
      fireEvent.scroll(window);
    });

    // The frosted treatment moved from `backdrop-blur-xl` to the `.glass-sheet`
    // primitive in globals.css, which carries the blur, the saturation boost and
    // the lit top edge together. The behaviour under test is unchanged: the
    // header is transparent over the hero and frosted once scrolled past it.
    //
    // The wait is required because the handler no longer reads scrollY inside
    // the event — it defers the read to the next animation frame so the browser
    // is not forced to flush layout on every scroll event. The class therefore
    // lands a frame after the event, which is still the same frame the user sees.
    await waitFor(() => expect(header).toHaveClass("glass-sheet"));
    expect(header.className).not.toContain("bg-transparent");
  });

  it("hides navigation on mobile", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    const nav = screen.getByRole("navigation");
    expect(nav).toHaveClass("hidden", "md:flex");
  });

  it("keeps the mobile menu to Demo, Pricing and Blog", async () => {
    const user = userEvent.setup();
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const mobileMenu = document.getElementById("mobile-menu");
    expect(mobileMenu).not.toBeNull();
    expect(
      within(mobileMenu!)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Demo", "Pricing", "Blog"]);
    expect(
      within(mobileMenu!).queryByRole("link", { name: "Features" }),
    ).toBeNull();
    expect(
      within(mobileMenu!).queryByRole("link", { name: "Try your site" }),
    ).toBeNull();
    expect(
      within(mobileMenu!).queryByRole("link", { name: "Product overview" }),
    ).toBeNull();
  });

  it("supports keyboard navigation", async () => {
    const user = userEvent.setup();
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    await user.tab();
    expect(screen.getByRole("link", { name: /ReCopyFast/i })).toHaveFocus();

    for (const name of ["Demo", "Pricing", "Blog"]) {
      await user.tab();
      expect(screen.getByRole("link", { name })).toHaveFocus();
    }

    await user.tab();
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: /get started/i })).toHaveFocus();
  });
});
