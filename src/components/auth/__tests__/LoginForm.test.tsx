import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "../LoginForm";
import { useAuth } from "@/contexts/AuthContext";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

const signInWithMagicLink = jest.fn();

function setSearch(search: string) {
  window.history.replaceState({}, "", `/login${search}`);
}

describe("LoginForm — magic link only", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    signInWithMagicLink.mockResolvedValue(undefined);
    (useAuth as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      signInWithMagicLink,
      signOut: jest.fn(),
      refreshSession: jest.fn(),
    });
    setSearch("");
  });

  it("renders an email field and no password field", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("offers no password-recovery escape hatch", () => {
    render(<LoginForm />);

    expect(
      screen.queryByRole("link", { name: /forgot password/i }),
    ).not.toBeInTheDocument();
  });

  it("sends a magic link for the entered email", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email address/i), "a@example.com");
    await user.click(screen.getByRole("button", { name: /send magic link/i }));

    await waitFor(() => {
      expect(signInWithMagicLink).toHaveBeenCalledWith("a@example.com", {
        next: undefined,
      });
    });
  });

  it("trims surrounding whitespace off the email", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(
      screen.getByLabelText(/email address/i),
      "  spaced@example.com  ",
    );
    await user.click(screen.getByRole("button", { name: /send magic link/i }));

    await waitFor(() => {
      expect(signInWithMagicLink).toHaveBeenCalledWith("spaced@example.com", {
        next: undefined,
      });
    });
  });

  it("forwards redirectedFrom so the link lands on the intended route", async () => {
    const user = userEvent.setup();
    setSearch("?redirectedFrom=%2Fdashboard%2Fbilling");
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email address/i), "a@example.com");
    await user.click(screen.getByRole("button", { name: /send magic link/i }));

    await waitFor(() => {
      expect(signInWithMagicLink).toHaveBeenCalledWith("a@example.com", {
        next: "/dashboard/billing",
      });
    });
  });

  it("confirms the link was sent rather than closing silently", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email address/i), "a@example.com");
    await user.click(screen.getByRole("button", { name: /send magic link/i }));

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.getByText("a@example.com")).toBeInTheDocument();
  });

  it("lets the user go back and correct a mistyped address", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(
      screen.getByLabelText(/email address/i),
      "typo@example.com",
    );
    await user.click(screen.getByRole("button", { name: /send magic link/i }));
    await screen.findByText(/check your email/i);

    await user.click(
      screen.getByRole("button", { name: /try different email/i }),
    );

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it("surfaces an error when sending the link fails", async () => {
    const user = userEvent.setup();
    signInWithMagicLink.mockRejectedValueOnce(new Error("rate limit exceeded"));
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email address/i), "a@example.com");
    await user.click(screen.getByRole("button", { name: /send magic link/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
  });

  it("rejects an empty email without calling the auth layer", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email address/i), "   ");
    const submit = screen.getByRole("button", { name: /send magic link/i });

    // Whitespace-only input leaves the button disabled, so the request can
    // never be issued in the first place.
    expect(submit).toBeDisabled();
    expect(signInWithMagicLink).not.toHaveBeenCalled();
  });
});
