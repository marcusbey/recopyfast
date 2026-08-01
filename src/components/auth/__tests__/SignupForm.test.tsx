import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignupForm } from "../SignupForm";
import { useAuth } from "@/contexts/AuthContext";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

const signInWithMagicLink = jest.fn();

describe("SignupForm — magic link only", () => {
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
  });

  it("collects a name and email, never a password", () => {
    render(<SignupForm />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/confirm password/i),
    ).not.toBeInTheDocument();
  });

  it("passes the name through so it lands on user metadata", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/name/i), "Ada Lovelace");
    await user.type(screen.getByLabelText(/email/i), "ada@example.com");
    await user.click(screen.getByRole("button", { name: /magic link/i }));

    await waitFor(() => {
      expect(signInWithMagicLink).toHaveBeenCalledWith("ada@example.com", {
        name: "Ada Lovelace",
      });
    });
  });

  it("omits the name when it is left blank", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/email/i), "anon@example.com");
    await user.click(screen.getByRole("button", { name: /magic link/i }));

    await waitFor(() => {
      expect(signInWithMagicLink).toHaveBeenCalledWith("anon@example.com", {
        name: undefined,
      });
    });
  });

  it("confirms the link was sent", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.click(screen.getByRole("button", { name: /magic link/i }));

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  });

  it("surfaces an error when sending the link fails", async () => {
    const user = userEvent.setup();
    signInWithMagicLink.mockRejectedValueOnce(new Error("smtp unavailable"));
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.click(screen.getByRole("button", { name: /magic link/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
  });
});
