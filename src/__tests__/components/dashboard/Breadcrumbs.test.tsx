import React from "react";
import { render, screen } from "@testing-library/react";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { usePathname } from "next/navigation";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
}));

describe("Breadcrumbs", () => {
  const mockUsePathname = usePathname as jest.MockedFunction<
    typeof usePathname
  >;

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should not render on dashboard root page", () => {
      mockUsePathname.mockReturnValue("/dashboard");
      const { container } = render(<Breadcrumbs />);

      expect(container.firstChild).toBeNull();
    });

    it("should render breadcrumbs on sub-pages", () => {
      mockUsePathname.mockReturnValue("/dashboard/sites");
      render(<Breadcrumbs />);

      expect(screen.getByText("Sites")).toBeInTheDocument();
    });

    it("should render home icon", () => {
      mockUsePathname.mockReturnValue("/dashboard/sites");
      const { container } = render(<Breadcrumbs />);

      const homeLink = screen.getByRole("link", { name: "Dashboard" });
      expect(homeLink).toHaveAttribute("href", "/dashboard");
      expect(container.querySelector("svg")).toBeInTheDocument();
    });
  });

  describe("Navigation Paths", () => {
    it("should render correct breadcrumbs for sites page", () => {
      mockUsePathname.mockReturnValue("/dashboard/sites");
      render(<Breadcrumbs />);

      expect(screen.getByText("Sites")).toBeInTheDocument();
    });

    // s70b: the Content page became Changes, at /dashboard/changes.
    it("should render correct breadcrumbs for the changes page", () => {
      mockUsePathname.mockReturnValue("/dashboard/changes");
      render(<Breadcrumbs />);

      expect(screen.getByText("Changes")).toBeInTheDocument();
    });

    it("should render correct breadcrumbs for analytics page", () => {
      mockUsePathname.mockReturnValue("/dashboard/analytics");
      render(<Breadcrumbs />);

      expect(screen.getByText("Analytics")).toBeInTheDocument();
    });

    it("should render correct breadcrumbs for settings page", () => {
      mockUsePathname.mockReturnValue("/dashboard/settings");
      render(<Breadcrumbs />);

      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("should render correct breadcrumbs for teams page", () => {
      mockUsePathname.mockReturnValue("/dashboard/teams");
      render(<Breadcrumbs />);

      expect(screen.getByText("Teams")).toBeInTheDocument();
    });

    it("should render correct breadcrumbs for billing page", () => {
      mockUsePathname.mockReturnValue("/dashboard/billing");
      render(<Breadcrumbs />);

      expect(screen.getByText("Billing")).toBeInTheDocument();
    });
  });

  describe("Nested Paths", () => {
    it("should render multiple breadcrumb levels", () => {
      mockUsePathname.mockReturnValue("/dashboard/sites/123/settings");
      render(<Breadcrumbs />);

      expect(screen.getByText("Sites")).toBeInTheDocument();
      expect(screen.getByText("123")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("should make non-last breadcrumbs clickable", () => {
      mockUsePathname.mockReturnValue("/dashboard/sites/123");
      render(<Breadcrumbs />);

      const sitesLink = screen.getByText("Sites").closest("a");
      expect(sitesLink).toHaveAttribute("href", "/dashboard/sites");
    });

    it("should make last breadcrumb non-clickable", () => {
      mockUsePathname.mockReturnValue("/dashboard/sites/123");
      render(<Breadcrumbs />);

      const lastCrumb = screen.getByText("123");
      expect(lastCrumb.tagName).not.toBe("A");
      expect(lastCrumb).toHaveClass("font-medium", "text-foreground");
    });
  });

  /**
   * s66c1 AC 9: a site's pages live at `/dashboard/sites/<uuid>/…`. The UUID
   * is not a label anyone can read, so it reads "Site", and `people` reads
   * as its page is titled. Only these two labels change (Breadcrumbs is
   * s66b's; s66c1 owns only this map).
   */
  describe("Site pages", () => {
    const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    it("reads a site id segment as Site", () => {
      mockUsePathname.mockReturnValue(`/dashboard/sites/${SITE_ID}`);
      render(<Breadcrumbs />);

      expect(screen.getByText("Site")).toHaveAttribute("aria-current", "page");
      expect(screen.queryByText(SITE_ID)).not.toBeInTheDocument();
    });

    it("reads Dashboard › Sites › Site › People & access", () => {
      mockUsePathname.mockReturnValue(`/dashboard/sites/${SITE_ID}/people`);
      render(<Breadcrumbs />);

      const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(trail).toHaveTextContent("DashboardSitesSitePeople & access");
      expect(screen.getByRole("link", { name: "Site" })).toHaveAttribute(
        "href",
        `/dashboard/sites/${SITE_ID}`,
      );
    });
  });

  describe("Formatting", () => {
    it("should capitalize single-word paths", () => {
      mockUsePathname.mockReturnValue("/dashboard/settings");
      render(<Breadcrumbs />);

      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("should format hyphenated paths correctly", () => {
      mockUsePathname.mockReturnValue("/dashboard/my-sites");
      render(<Breadcrumbs />);

      expect(screen.getByText("My Sites")).toBeInTheDocument();
    });
  });

  describe("Separators", () => {
    it("should render chevron separators between breadcrumbs", () => {
      mockUsePathname.mockReturnValue("/dashboard/sites");
      const { container } = render(<Breadcrumbs />);

      const chevrons = container.querySelectorAll("svg");
      expect(chevrons.length).toBeGreaterThan(1); // Home icon + at least one chevron
    });
  });

  describe("Links", () => {
    it("should have correct href for home icon", () => {
      mockUsePathname.mockReturnValue("/dashboard/sites");
      const { container } = render(<Breadcrumbs />);

      const homeLink = container.querySelector('a[href="/dashboard"]');
      expect(homeLink).toBeInTheDocument();
    });

    it("should have correct hrefs for intermediate crumbs", () => {
      mockUsePathname.mockReturnValue("/dashboard/sites/123");
      render(<Breadcrumbs />);

      const sitesLink = screen.getByText("Sites").closest("a");
      expect(sitesLink).toHaveAttribute("href", "/dashboard/sites");
    });
  });
});
