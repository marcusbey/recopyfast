import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation";
import { usePathname } from "next/navigation";
import type { EntitlementSummary } from "@/types/billing";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
}));

/**
 * These used to be written against a `userPlan` prop fed from
 * `user.user_metadata.plan`. Nothing ever wrote that key, so the prop was
 * always undefined and the tests were pinning a default nobody could reach:
 * `userPlan="free"` described a state the app produced by accident rather than
 * one a real account could be in. They are rewritten against the entitlement
 * the server actually resolves, not deleted — the plan-gating and active-state
 * coverage they carried is still wanted.
 */
const onPlan = (planId: "starter" | "pro"): EntitlementSummary => ({
  kind: "plan",
  planId,
  planName: planId === "pro" ? "Pro" : "Starter",
});

const onCredits: EntitlementSummary = {
  kind: "credits",
  planId: null,
  planName: null,
};

const lockedOut: EntitlementSummary = {
  kind: "none",
  planId: null,
  planName: null,
};

/** The plan card at the foot of the sidebar, found via its own eyebrow. */
const planCard = () => screen.getByText("Plan").parentElement;

describe("DashboardNavigation", () => {
  const mockUsePathname = usePathname as jest.MockedFunction<
    typeof usePathname
  >;

  beforeEach(() => {
    mockUsePathname.mockReturnValue("/dashboard");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Navigation Rendering", () => {
    it("should render all navigation items", () => {
      render(<DashboardNavigation />);

      expect(screen.getByText("Overview")).toBeInTheDocument();
      expect(screen.getByText("Sites")).toBeInTheDocument();
      expect(screen.getByText("Content")).toBeInTheDocument();
      expect(screen.getByText("Analytics")).toBeInTheDocument();
      expect(screen.getByText("Teams")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
      expect(screen.getByText("Billing")).toBeInTheDocument();
    });

    it("should render the ReCopyFast logo", () => {
      render(<DashboardNavigation />);

      expect(screen.getByText("ReCopyFast")).toBeInTheDocument();
    });

    it("should name the plan a subscriber is actually on", () => {
      render(<DashboardNavigation entitlement={onPlan("pro")} />);

      // Scoped to the plan card: "Pro" also appears as the Teams badge, and a
      // bare getByText would pass on the badge alone even if the card were
      // still showing the old hardcoded label.
      expect(planCard()).toHaveTextContent("Pro");
    });

    it("should say 'No plan' rather than 'Free' for an unentitled account", () => {
      render(<DashboardNavigation entitlement={lockedOut} />);

      expect(screen.getByText("No plan")).toBeInTheDocument();
      // "Free" named a plan that has been retired; showing it told the user
      // they were on something.
      expect(screen.queryByText(/^free$/i)).not.toBeInTheDocument();
    });

    it("should describe a credit holder as holding credits, not a plan", () => {
      render(<DashboardNavigation entitlement={onCredits} />);

      expect(screen.getByText("Credits only")).toBeInTheDocument();
    });

    it("should offer checkout to an unentitled account", () => {
      render(<DashboardNavigation entitlement={lockedOut} />);

      expect(screen.getByText("Choose plan")).toBeInTheDocument();
    });

    it("should offer an upgrade to a credit holder", () => {
      render(<DashboardNavigation entitlement={onCredits} />);

      expect(screen.getByText("Upgrade")).toBeInTheDocument();
    });

    it("should not invite a subscriber to upgrade from a plan they are on", () => {
      render(<DashboardNavigation entitlement={onPlan("pro")} />);

      expect(screen.queryByText("Upgrade")).not.toBeInTheDocument();
      expect(screen.queryByText("Choose plan")).not.toBeInTheDocument();
    });

    it("should not offer checkout before the entitlement is known", () => {
      render(<DashboardNavigation />);

      expect(screen.queryByText("Upgrade")).not.toBeInTheDocument();
      expect(screen.queryByText("Choose plan")).not.toBeInTheDocument();
    });
  });

  describe("Locked-out accounts", () => {
    /**
     * Middleware bounces an unentitled session off every dashboard route back
     * to /dashboard/billing. A nav that still offers the other seven is a set
     * of links that all return you to where you started.
     */
    it.each([
      ["Overview"],
      ["Sites"],
      ["Content"],
      ["A/B Tests"],
      ["Analytics"],
      ["Teams"],
      ["Settings"],
    ])("should not offer %s to an unentitled account", (label) => {
      render(<DashboardNavigation entitlement={lockedOut} />);

      const link = screen.getByText(label).closest("a");
      expect(link).toHaveAttribute("href", "#");
      expect(link).toHaveAttribute("aria-disabled", "true");
    });

    it("should keep Billing reachable, since it is the only way out", () => {
      render(<DashboardNavigation entitlement={lockedOut} />);

      const billing = screen.getByText("Billing").closest("a");
      expect(billing).toHaveAttribute("href", "/dashboard/billing");
      expect(billing).not.toHaveAttribute("aria-disabled");
    });

    it("should not lock out an account that holds credits", () => {
      // A credit holder bought something that works. Middleware lets them in,
      // and the nav must agree with it.
      render(<DashboardNavigation entitlement={onCredits} />);

      expect(screen.getByText("Sites").closest("a")).toHaveAttribute(
        "href",
        "/dashboard/sites",
      );
    });

    it("should not lock out an account whose entitlement is still loading", () => {
      // Being wrong here for a moment costs a redirect. Being wrong the other
      // way tells a paying customer they have nothing.
      render(<DashboardNavigation />);

      expect(screen.getByText("Sites").closest("a")).toHaveAttribute(
        "href",
        "/dashboard/sites",
      );
    });
  });

  describe("Active State Highlighting", () => {
    it("should highlight Dashboard link when on dashboard page", () => {
      mockUsePathname.mockReturnValue("/dashboard");
      render(<DashboardNavigation />);

      const dashboardLink = screen.getByText("Overview").closest("a");
      expect(dashboardLink).toHaveAttribute("aria-current", "page");
    });

    it("should highlight Sites link when on sites page", () => {
      mockUsePathname.mockReturnValue("/dashboard/sites");
      render(<DashboardNavigation />);

      const sitesLink = screen.getByText("Sites").closest("a");
      expect(sitesLink).toHaveAttribute("aria-current", "page");
    });

    it("should highlight Content link when on content page", () => {
      mockUsePathname.mockReturnValue("/dashboard/content");
      render(<DashboardNavigation />);

      const contentLink = screen.getByText("Content").closest("a");
      expect(contentLink).toHaveAttribute("aria-current", "page");
    });

    it("should highlight Analytics link when on analytics page", () => {
      mockUsePathname.mockReturnValue("/dashboard/analytics");
      render(<DashboardNavigation />);

      const analyticsLink = screen.getByText("Analytics").closest("a");
      expect(analyticsLink).toHaveAttribute("aria-current", "page");
    });

    it("should highlight Settings link when on settings page", () => {
      mockUsePathname.mockReturnValue("/dashboard/settings");
      render(<DashboardNavigation />);

      const settingsLink = screen.getByText("Settings").closest("a");
      expect(settingsLink).toHaveAttribute("aria-current", "page");
    });
  });

  describe("Plan-Based Access Control", () => {
    it("should show Pro badge on Teams", () => {
      render(<DashboardNavigation entitlement={onPlan("starter")} />);

      const teamsLink = screen.getByText("Teams").closest("a");
      expect(teamsLink?.parentElement).toContainHTML("Pro");
    });

    it("should enable Teams link for pro users", () => {
      render(<DashboardNavigation entitlement={onPlan("pro")} />);

      const teamsLink = screen.getByText("Teams").closest("a");
      expect(teamsLink).not.toHaveClass("cursor-not-allowed");
    });

    it("should disable Teams link for starter users", () => {
      render(<DashboardNavigation entitlement={onPlan("starter")} />);

      const teamsLink = screen.getByText("Teams").closest("a");
      expect(teamsLink).toHaveClass("cursor-not-allowed");
    });

    it("should disable Teams link for a credit holder", () => {
      // Credits buy metered usage, never a plan capability.
      render(<DashboardNavigation entitlement={onCredits} />);

      const teamsLink = screen.getByText("Teams").closest("a");
      expect(teamsLink).toHaveClass("cursor-not-allowed");
    });

    it("should prevent navigation when clicking disabled link", () => {
      render(<DashboardNavigation entitlement={onPlan("starter")} />);

      const teamsLink = screen.getByText("Teams").closest("a");
      fireEvent.click(teamsLink!);

      // Link should have href="#" for disabled state
      expect(teamsLink).toHaveAttribute("href", "#");
    });
  });

  describe("Mobile Responsiveness", () => {
    it("should render mobile menu button", () => {
      render(<DashboardNavigation />);

      // Mobile menu button should exist (hidden on desktop)
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    });

    it("should toggle mobile menu when button is clicked", () => {
      render(<DashboardNavigation />);

      // Find and click the mobile menu button
      const menuButtons = screen.getAllByRole("button");
      const mobileMenuButton = menuButtons[0]; // First button should be the mobile menu toggle

      fireEvent.click(mobileMenuButton);

      // Menu should be visible after click
      const navigation = screen.getByRole("navigation");
      expect(navigation).toBeInTheDocument();
    });
  });

  describe("Navigation Links", () => {
    it("should have correct href attributes", () => {
      render(<DashboardNavigation entitlement={onPlan("pro")} />);

      expect(screen.getByText("Overview").closest("a")).toHaveAttribute(
        "href",
        "/dashboard",
      );
      expect(screen.getByText("Sites").closest("a")).toHaveAttribute(
        "href",
        "/dashboard/sites",
      );
      expect(screen.getByText("Content").closest("a")).toHaveAttribute(
        "href",
        "/dashboard/content",
      );
      expect(screen.getByText("Analytics").closest("a")).toHaveAttribute(
        "href",
        "/dashboard/analytics",
      );
      expect(screen.getByText("Settings").closest("a")).toHaveAttribute(
        "href",
        "/dashboard/settings",
      );
      expect(screen.getByText("Billing").closest("a")).toHaveAttribute(
        "href",
        "/dashboard/billing",
      );
    });
  });

  describe("Icons", () => {
    it("should render icons for each navigation item", () => {
      const { container } = render(<DashboardNavigation />);

      // Check that SVG icons are rendered
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBeGreaterThan(7); // At least one icon per nav item plus plan section
    });
  });
});
