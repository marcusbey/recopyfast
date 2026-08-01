import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "../AuthContext";

const mockAuth = {
  getSession: jest.fn(),
  onAuthStateChange: jest.fn(),
  signInWithOtp: jest.fn(),
  signOut: jest.fn(),
  refreshSession: jest.fn(),
};

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: mockAuth }),
}));

const ORIGIN = window.location.origin;

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function Probe({ next, name }: { next?: string; name?: string } = {}) {
  const { user, loading, signInWithMagicLink, signOut } = useAuth();
  return (
    <div>
      <span data-testid="state">
        {loading ? "loading" : (user?.email ?? "anonymous")}
      </span>
      <button
        onClick={() => signInWithMagicLink("a@example.com", { next, name })}
      >
        send
      </button>
      <button onClick={() => signOut()}>out</button>
    </div>
  );
}

function renderProbe(props: { next?: string; name?: string } = {}) {
  return render(
    <AuthProvider>
      <Probe {...props} />
    </AuthProvider>,
  );
}

describe("AuthContext — magic link", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/login");
    mockAuth.getSession.mockResolvedValue({ data: { session: null } });
    mockAuth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    mockAuth.signInWithOtp.mockResolvedValue({ error: null });
    mockAuth.signOut.mockResolvedValue({ error: null });
  });

  it("resolves to anonymous when there is no session", async () => {
    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("anonymous"),
    );
  });

  it("exposes the signed-in user from the active session", async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { email: "me@example.com" } } },
    });

    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("me@example.com"),
    );
  });

  it("requests an OTP link pointing at the callback route", async () => {
    const user = userEvent.setup();
    renderProbe();
    await screen.findByText("send");

    await user.click(screen.getByText("send"));

    await waitFor(() => expect(mockAuth.signInWithOtp).toHaveBeenCalled());
    const arg = mockAuth.signInWithOtp.mock.calls[0][0];
    expect(arg.email).toBe("a@example.com");
    expect(arg.options.emailRedirectTo).toBe(`${ORIGIN}/auth/callback`);
    expect(arg.options.data).toMatchObject({ source: "magic-link" });
  });

  it("carries a same-origin next path into the callback URL", async () => {
    const user = userEvent.setup();
    renderProbe({ next: "/dashboard/billing" });
    await screen.findByText("send");

    await user.click(screen.getByText("send"));

    await waitFor(() => expect(mockAuth.signInWithOtp).toHaveBeenCalled());
    expect(
      mockAuth.signInWithOtp.mock.calls[0][0].options.emailRedirectTo,
    ).toBe(`${ORIGIN}/auth/callback?next=%2Fdashboard%2Fbilling`);
  });

  it.each([
    ["absolute URL", "https://evil.test/steal"],
    ["protocol-relative", "//evil.test/steal"],
    ["backslash trick", "/\\evil.test"],
  ])("drops an open-redirect attempt via %s", async (_label, hostile) => {
    const user = userEvent.setup();
    renderProbe({ next: hostile });
    await screen.findByText("send");

    await user.click(screen.getByText("send"));

    await waitFor(() => expect(mockAuth.signInWithOtp).toHaveBeenCalled());
    const redirect = mockAuth.signInWithOtp.mock.calls[0][0].options
      .emailRedirectTo as string;
    expect(redirect).toBe(`${ORIGIN}/auth/callback`);
    expect(redirect).not.toContain("evil.test");
  });

  it("attaches the display name when one is supplied", async () => {
    const user = userEvent.setup();
    renderProbe({ name: "Ada" });
    await screen.findByText("send");

    await user.click(screen.getByText("send"));

    await waitFor(() => expect(mockAuth.signInWithOtp).toHaveBeenCalled());
    expect(mockAuth.signInWithOtp.mock.calls[0][0].options.data).toMatchObject({
      source: "magic-link",
      name: "Ada",
    });
  });

  it("surfaces a send failure to the caller", async () => {
    mockAuth.signInWithOtp.mockResolvedValue({
      error: new Error("over quota"),
    });
    const errors: string[] = [];
    function Failing() {
      const { signInWithMagicLink } = useAuth();
      return (
        <button
          onClick={() =>
            signInWithMagicLink("a@example.com").catch((e: Error) =>
              errors.push(e.message),
            )
          }
        >
          send
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Failing />
      </AuthProvider>,
    );

    await user.click(screen.getByText("send"));

    await waitFor(() => expect(errors).toEqual(["over quota"]));
  });

  it("signs out and returns to the landing page", async () => {
    const user = userEvent.setup();
    renderProbe();
    await screen.findByText("out");

    await user.click(screen.getByText("out"));

    await waitFor(() => expect(mockAuth.signOut).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith("/");
  });

  it("tracks the user across auth state changes", async () => {
    let emit: (event: string, session: unknown) => void = () => {};
    mockAuth.onAuthStateChange.mockImplementation(
      (cb: (event: string, session: unknown) => void) => {
        emit = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    );

    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("anonymous"),
    );

    act(() => emit("SIGNED_IN", { user: { email: "later@example.com" } }));

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent(
        "later@example.com",
      ),
    );
  });
});
