/**
 * Integration coverage for the public /demo route.
 *
 * This file used to assert the page's old shape: a hand-built "simulated
 * customer site", an injected embed script, and a redirect into staging mode
 * carrying `test_staging_token_valid_123`. Every one of those assertions passed
 * while the live page showed nothing but "Access Denied — Invalid or expired
 * staging link", because the token was a fixture that exists in no database and
 * the tests mocked away the only thing that would have noticed.
 *
 * The page now runs the same in-memory `InteractiveHero` as the landing page, so
 * the contract these tests hold it to is different: it must render a working
 * demo, and it must never again reach for a credential to do it.
 */
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import Demo from "@/app/demo/page";

// The demo page renders <Header/>, which consumes the auth context. Provide a
// signed-out context so the page can mount standalone.
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signInWithMagicLink: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

describe("Demo page", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/demo");
  });

  describe("page content", () => {
    it("renders the demo headline and instructions", () => {
      render(<Demo />);

      expect(
        screen.getByRole("heading", { name: /edit a real website/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/three customer sites, three different designers/i),
      ).toBeInTheDocument();
    });

    it("renders the interactive demo itself", () => {
      const { container } = render(<Demo />);

      // The demo's editable strings are what make this page a demo rather than
      // a description of one.
      const editables = container.querySelectorAll("[data-editable-id]");
      expect(editables.length).toBeGreaterThan(5);
    });

    it("renders the closing call to action", () => {
      render(<Demo />);

      const cta = screen.getByRole("link", { name: /add it to your site/i });
      expect(cta).toHaveAttribute("href", "/signup");
    });

    it("explains the three things a visitor can do", () => {
      render(<Demo />);

      expect(
        screen.getByRole("heading", { name: /click anything/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /type over it/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /swap the photographs/i }),
      ).toBeInTheDocument();
    });
  });

  /**
   * The regression guard. Each of these is a way the page previously made
   * itself dependent on a credential, and each one is why it 403'd in
   * production while every test here was green.
   */
  describe("needs no credential to run", () => {
    it("injects no embed script", () => {
      render(<Demo />);

      expect(
        document.querySelector('script[src="/embed/recopyfast.js"]'),
      ).toBeNull();
    });

    it("never puts the page into staging mode", () => {
      render(<Demo />);

      expect(window.location.search).not.toContain("rcf_staging");
      expect(window.location.search).not.toContain("rcf_token");
    });

    it("carries no site id or staging token anywhere in its markup", () => {
      const { container } = render(<Demo />);

      const html = container.innerHTML;
      expect(html).not.toContain("test_staging_token_valid_123");
      expect(html).not.toContain("7e3b2d6c-1ab1-46f3-92fd-493173fa3e17");
      expect(container.querySelector("[data-site-token]")).toBeNull();
      expect(container.querySelector("[data-site-id]")).toBeNull();
    });

    it("publishes no widget endpoints onto window", () => {
      render(<Demo />);

      // Read through a cast rather than a global augmentation. The `Window`
      // declaration for these lived in ReCopyFastLoader and went with it —
      // there is no longer any code that legitimately sets them, which is the
      // property being asserted.
      const globals = window as unknown as Record<string, unknown>;
      expect(globals.RECOPYFAST_API).toBeUndefined();
      expect(globals.RECOPYFAST_WS).toBeUndefined();
    });

    it("shows no access-denied state", () => {
      render(<Demo />);

      expect(screen.queryByText(/access denied/i)).toBeNull();
      expect(screen.queryByText(/invalid or expired/i)).toBeNull();
    });
  });

  describe("the demo is genuinely editable", () => {
    it("gives every editable element a stable id to key edits on", () => {
      const { container } = render(<Demo />);

      const ids = [...container.querySelectorAll("[data-editable-id]")].map(
        (el) => el.getAttribute("data-editable-id"),
      );

      expect(ids.every((id) => !!id)).toBe(true);
      // Ids are what an edit is stored against, so duplicates would mean two
      // elements sharing one edit.
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("puts the demo inside the page rather than linking out to it", () => {
      const { container } = render(<Demo />);

      const main = container.querySelector("main");
      expect(main).not.toBeNull();
      expect(
        within(main as HTMLElement).getAllByText(/./).length,
      ).toBeGreaterThan(0);
      expect(
        (main as HTMLElement).querySelectorAll("[data-editable-id]").length,
      ).toBeGreaterThan(5);
    });
  });
});
