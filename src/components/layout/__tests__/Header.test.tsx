import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "../Header";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";

// Mock Next.js router
jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
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

  it("renders navigation links", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });

    render(<Header />);

    expect(screen.getByRole("link", { name: "Features" })).toHaveAttribute(
      "href",
      "#features",
    );
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "#pricing",
    );
    expect(screen.getByRole("link", { name: "Demo" })).toHaveAttribute(
      "href",
      "/demo",
    );
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute(
      "href",
      "/blog",
    );
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

    expect(
      screen.getByRole("button", { name: /^sign in$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /get started/i }),
    ).toBeInTheDocument();
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

  it("opens AuthModal when Sign In button is clicked", async () => {
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

    const signInButton = screen.getByRole("button", { name: /^sign in$/i });
    await user.click(signInButton);

    // Check if modal is opened
    expect(screen.getByText("Welcome to ReCopyFast")).toBeInTheDocument();
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

  it("applies the blurred background only after scrolling past the threshold", () => {
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
    expect(header).toHaveClass("glass-sheet");
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

    for (const name of ["Features", "Pricing", "Demo", "Blog"]) {
      await user.tab();
      expect(screen.getByRole("link", { name })).toHaveFocus();
    }

    await user.tab();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toHaveFocus();

    // Open modal with Enter key
    await user.keyboard("{Enter}");
    expect(screen.getByText("Welcome to ReCopyFast")).toBeInTheDocument();
  });
});
