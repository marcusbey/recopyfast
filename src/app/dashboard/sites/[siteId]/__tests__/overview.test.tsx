import { screen, waitFor, within } from "@testing-library/react";
import SiteOverviewPage from "../page";
import {
  FIXTURE_SNIPPET,
  buildSite,
  buildSiteContext,
  renderWithSite,
} from "@/components/dashboard/site/__tests__/site-context-fixture";

/**
 * s66c1 AC 9 — a site's Overview: the activation checklist (relabelled; s66c2
 * replaces it with the quick setup), three figures, and the site's details.
 * Moved from SiteDetailView.test.tsx where they were the detail view's.
 */

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/sites/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

jest.mock("date-fns", () => ({
  formatDistanceToNow: jest.fn(() => "5 hours ago"),
}));

jest.mock("@/components/dashboard/ActivationChecklist", () => ({
  ActivationChecklist: (props: {
    siteId: string;
    embedScript: string;
    userId: string;
  }) => (
    <div
      data-testid="activation-checklist"
      data-site-id={props.siteId}
      data-user-id={props.userId}
      data-snippet={props.embedScript}
    />
  ),
}));

describe("the site Overview", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("shows activation only to an admin, with the provider's current snippet", () => {
    renderWithSite(<SiteOverviewPage />);

    const checklist = screen.getByTestId("activation-checklist");
    expect(checklist).toHaveAttribute(
      "data-site-id",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(checklist).toHaveAttribute("data-user-id", "user-1");
    expect(checklist).toHaveAttribute("data-snippet", FIXTURE_SNIPPET);
  });

  // A rotation updates the checklist's snippet at once: it reads the
  // provider's credentials, not the stale record.
  it("gives the checklist the rotated snippet, not the record's", () => {
    const rotated = '<script data-site-token="rotated"></script>';
    renderWithSite(
      <SiteOverviewPage />,
      buildSiteContext({
        credentials: { siteToken: "rotated", embedScript: rotated },
      }),
    );

    expect(screen.getByTestId("activation-checklist")).toHaveAttribute(
      "data-snippet",
      rotated,
    );
  });

  it("hides activation from a member without install credentials", () => {
    renderWithSite(
      <SiteOverviewPage />,
      buildSiteContext({
        site: buildSite({ siteToken: undefined, embedScript: undefined }),
      }),
    );

    expect(
      screen.queryByTestId("activation-checklist"),
    ).not.toBeInTheDocument();
  });

  // "Page views" is dropped: GET /api/sites never computes it (views: 0).
  it("shows three figures: edits, content elements and last activity", () => {
    renderWithSite(<SiteOverviewPage />);

    const figures = screen.getByRole("region", { name: "Activity" });
    expect(within(figures).getByText("Edits")).toBeInTheDocument();
    expect(within(figures).getByText("42")).toBeInTheDocument();
    expect(within(figures).getByText("Content elements")).toBeInTheDocument();
    expect(within(figures).getByText("15")).toBeInTheDocument();
    expect(within(figures).getByText("Last activity")).toBeInTheDocument();
    expect(within(figures).getByText("5 hours ago")).toBeInTheDocument();
    expect(screen.queryByText(/page views/i)).not.toBeInTheDocument();
  });

  it("handles missing stats gracefully", () => {
    renderWithSite(
      <SiteOverviewPage />,
      buildSiteContext({ site: buildSite({ stats: undefined }) }),
    );

    const figures = screen.getByRole("region", { name: "Activity" });
    expect(within(figures).getAllByText("0")).toHaveLength(2);
    expect(within(figures).getByText("No activity yet")).toBeInTheDocument();
  });

  it("lists the site's details, with a copyable site ID", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderWithSite(<SiteOverviewPage />);

    const details = screen.getByRole("region", { name: "Site details" });
    expect(within(details).getByText("Created")).toBeInTheDocument();
    expect(within(details).getByText("Last updated")).toBeInTheDocument();

    within(details).getByRole("button", { name: "Copy site ID" }).click();
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
    );
  });
});
