import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TryPage, { metadata } from "@/app/try/page";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signInWithMagicLink: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

describe("Try page", () => {
  it("offers the stable production bookmarklet after hydration", async () => {
    render(<TryPage />);

    const bookmarklet = screen.getByRole("link", {
      name: /drag “try recopyfast” to your bookmarks bar/i,
    });

    await waitFor(() => {
      expect(bookmarklet.getAttribute("href")).toContain("javascript:");
    });
    expect(bookmarklet.getAttribute("href")).toContain(
      "https://www.recopyfa.st/try/rcf-try.js",
    );
    expect(bookmarklet.getAttribute("href")).not.toContain("?v=");
    expect(bookmarklet.getAttribute("href")).toContain(".resume()");
    expect(bookmarklet.getAttribute("href")).toContain("scrollIntoView");
    expect(bookmarklet).toHaveAttribute("draggable", "true");
  });

  it("explains the desktop flow, mobile limitation, local-only behavior and CSP fallback", () => {
    render(<TryPage />);

    expect(
      screen.getByRole("heading", {
        name: "See your site editable in one click",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chrome" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Safari" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Firefox" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/on mobile, use desktop/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is saved/i)).toBeInTheDocument();
    expect(
      screen.getByText(/every link navigates on a plain click/i),
    ).toHaveTextContent(
      "Alt+click (Option+click on macOS) a link to edit its text",
    );
    expect(screen.getByText(/content security policy/i)).toBeInTheDocument();
  });

  it("includes a scoped sample activated by the same runtime", async () => {
    const user = userEvent.setup();
    const append = jest.spyOn(document.body, "appendChild");
    render(<TryPage />);

    const sample = screen.getByTestId("try-live-sample");
    expect(
      within(sample).getByRole("heading", {
        name: /make good coffee feel easy/i,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /edit this sample/i }));

    const injected = append.mock.calls
      .map(([node]) => node)
      .find(
        (node): node is HTMLScriptElement =>
          node instanceof HTMLScriptElement &&
          node.src.endsWith("/try/rcf-try.js"),
      );
    expect(injected).toBeDefined();
    expect(injected?.dataset.rcfTryRoot).toBe("#rcf-try-sample");
    append.mockRestore();
  });

  it("invalidates a pending sample load when reset", async () => {
    const user = userEvent.setup();
    const append = jest.spyOn(document.body, "appendChild");
    render(<TryPage />);

    await user.click(screen.getByRole("button", { name: /edit this sample/i }));
    const injected = append.mock.calls
      .map(([node]) => node)
      .find(
        (node): node is HTMLScriptElement =>
          node instanceof HTMLScriptElement &&
          node.src.endsWith("/try/rcf-try.js"),
      );
    expect(injected).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(injected?.dataset.rcfTryRoot).toMatch(/^#rcf-try-cancelled-/);
    expect(injected?.onload).toBeNull();
    expect(injected?.onerror).toBeNull();
    expect(screen.queryByText(/preview active/i)).not.toBeInTheDocument();
    append.mockRestore();
  });

  it("publishes canonical and social metadata for /try", () => {
    expect(metadata.alternates).toMatchObject({ canonical: "/try" });
    expect(metadata.openGraph).toMatchObject({
      url: "/try",
      siteName: "ReCopyFast",
      locale: "en_US",
      images: ["/opengraph-image"],
    });
    expect(metadata.twitter).toMatchObject({
      images: ["/twitter-image"],
    });
    expect(metadata.title).toMatch(/editable/i);
  });

  it("marks the static sample as a demo surface without a large shadow", () => {
    render(<TryPage />);

    const sample = screen.getByTestId("try-live-sample");
    expect(sample).toHaveAttribute("data-demo-surface");
    expect(sample).not.toHaveClass("shadow-xl");
    expect(
      screen.getByText(/choose a local raster image/i),
    ).toBeInTheDocument();
  });

  it("links to the trial with campaign attribution", () => {
    render(<TryPage />);

    expect(
      screen.getByRole("link", { name: /start your free trial/i }),
    ).toHaveAttribute(
      "href",
      "/signup?utm_source=try&utm_medium=page&utm_campaign=try_on_any_site",
    );
  });
});
