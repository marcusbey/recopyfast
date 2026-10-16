import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import Footer from "../Footer";
import { OPEN_COOKIE_SETTINGS_EVENT } from "@/lib/analytics/google-analytics/cookie-settings";

let mockPathname: string | null = "/";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

let mockDocumentPathname: string | null = "/";
jest.mock("@/lib/analytics/google-analytics/document-path", () => ({
  getDocumentPathname: () => mockDocumentPathname,
}));

describe("Footer", () => {
  beforeEach(() => {
    mockPathname = "/";
  });

  it("links the public installation guide", () => {
    render(<Footer />);

    expect(
      screen.getByRole("link", { name: "Installation guide" }),
    ).toHaveAttribute("href", "/docs/install");
  });

  it("keeps the pages removed from the compact header reachable", () => {
    render(<Footer variant="editorial" />);

    expect(
      screen.getByRole("link", { name: "Product overview" }),
    ).toHaveAttribute("href", "/product");
    expect(screen.getByRole("link", { name: "Try your site" })).toHaveAttribute(
      "href",
      "/try",
    );
    expect(screen.getByRole("link", { name: "Features" })).toHaveAttribute(
      "href",
      "/#features",
    );
  });

  it("keeps the legacy product anchors on /product", () => {
    mockPathname = "/product";
    render(<Footer />);

    expect(screen.getByRole("link", { name: "Features" })).toHaveAttribute(
      "href",
      "/product#features",
    );
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "/product#pricing",
    );
  });

  it("uses the flat editorial footer treatment only when requested", () => {
    const legacy = render(<Footer />);
    expect(screen.getByRole("contentinfo")).toHaveClass("bg-white");
    expect(
      screen
        .getAllByRole("link", { name: "GitHub" })
        .find((link) => link.hasAttribute("aria-label")),
    ).toHaveClass("rounded-xl");
    legacy.unmount();

    render(<Footer variant="editorial" />);
    expect(screen.getByRole("contentinfo")).toHaveClass("bg-[#ebe7dc]");
    const editorialSocialLink = screen
      .getAllByRole("link", { name: "GitHub" })
      .find((link) => link.hasAttribute("aria-label"));
    expect(editorialSocialLink).toHaveClass(
      "rounded-[3px]",
      "border-[#d9d3c6]",
    );
    expect(editorialSocialLink).not.toHaveClass("bg-sky-50");
  });

  /**
   * s107 — "Cookie settings" reopens the analytics consent banner from every
   * marketing page. It exists only where Google Analytics can run: configured,
   * on an allowlisted page, in a document loaded on one (independent review
   * F5 — elsewhere nothing listens and the button would do nothing).
   */
  describe("Cookie settings", () => {
    const saved = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

    beforeEach(() => {
      mockPathname = "/";
      mockDocumentPathname = "/";
    });

    afterEach(() => {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
      else process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = saved;
    });

    it("is a button in the Legal column that reopens the banner", async () => {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123456";
      const user = userEvent.setup();
      const opened = jest.fn();
      window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, opened);
      render(<Footer />);

      const button = screen.getByRole("button", { name: "Cookie settings" });
      expect(button.closest("ul")?.textContent).toContain("Privacy Policy");
      await user.click(button);

      expect(opened).toHaveBeenCalledTimes(1);
      window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, opened);
    });

    it("is absent when Google Analytics is not configured", () => {
      delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
      render(<Footer />);

      expect(
        screen.queryByRole("button", { name: "Cookie settings" }),
      ).toBeNull();
    });

    it.each([
      // s96's free-tool report and its not-found: off the allowlist.
      [
        "/tools/website-spell-checker/r/6f1c2b9e",
        "/tools/website-spell-checker/r/6f1c2b9e",
      ],
      // A marketing page reached by a client navigation from an app page.
      ["/terms", "/login"],
      ["/docs/install", "/dashboard/sites/abc"],
      // A page off the allowlist that renders this footer.
      ["/settings", "/settings"],
    ])(
      "is absent on %s in a document loaded as %s, where analytics never runs",
      (pathname, documentPathname) => {
        process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123456";
        mockPathname = pathname;
        mockDocumentPathname = documentPathname;

        render(<Footer />);

        expect(
          screen.queryByRole("button", { name: "Cookie settings" }),
        ).toBeNull();
      },
    );

    it("is not in the server-rendered HTML, so hydration matches whatever the document is", () => {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123456";

      expect(renderToString(<Footer />)).not.toContain("Cookie settings");
    });
  });
});
