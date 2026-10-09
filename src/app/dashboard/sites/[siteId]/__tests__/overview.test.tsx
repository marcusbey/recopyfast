import { act, render, screen, waitFor, within } from "@testing-library/react";
import SiteOverviewPage from "../page";
import { SiteContext } from "@/components/dashboard/site/SiteProvider";
import {
  FIXTURE_SNIPPET,
  buildSite,
  buildSiteContext,
  renderWithSite,
} from "@/components/dashboard/site/__tests__/site-context-fixture";

/**
 * s66c1 AC 9 — a site's Overview: setup, three figures, and the site's
 * details. Moved from SiteDetailView.test.tsx where they were the detail
 * view's. s66c2: the quick setup replaces the activation checklist.
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

interface MockQuickSetupProps {
  site: { id: string; status?: string };
  embedScript: string;
  userId: string;
  variant?: string;
  focusFallbackRef?: { current: HTMLElement | null };
}

const mockQuickSetupProps = jest.fn<void, [MockQuickSetupProps]>();

jest.mock("@/components/dashboard/QuickSetup", () => ({
  QuickSetup: (props: MockQuickSetupProps) => {
    mockQuickSetupProps(props);
    return (
      <div
        data-testid="quick-setup"
        data-variant={props.variant ?? "full"}
        data-site-id={props.site.id}
        data-status={props.site.status}
        data-user-id={props.userId}
        data-snippet={props.embedScript}
      />
    );
  },
}));

describe("the site Overview", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("shows the full quick setup only to an admin, with the provider's current snippet", () => {
    renderWithSite(<SiteOverviewPage />);

    const quickSetup = screen.getByTestId("quick-setup");
    expect(quickSetup).toHaveAttribute("data-variant", "full");
    expect(quickSetup).toHaveAttribute(
      "data-site-id",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(quickSetup).toHaveAttribute("data-user-id", "user-1");
    expect(quickSetup).toHaveAttribute("data-snippet", FIXTURE_SNIPPET);
  });

  // A rotation updates the quick setup's snippet at once: it reads the
  // provider's credentials, not the stale record.
  it("gives quick setup the rotated snippet, not the record's", () => {
    const rotated = '<script data-site-token="rotated"></script>';
    renderWithSite(
      <SiteOverviewPage />,
      buildSiteContext({
        credentials: { siteToken: "rotated", embedScript: rotated },
      }),
    );

    expect(screen.getByTestId("quick-setup")).toHaveAttribute(
      "data-snippet",
      rotated,
    );
  });

  // Step 2's status row turns on the provider's 5 s install poll: the
  // Overview hands quick setup the provider's site, so a status the poll
  // brings back reaches it in the same render (s66c2 AC 1).
  it("hands quick setup the provider's site, so its poll reaches step 2", () => {
    const awaiting = buildSiteContext({
      site: buildSite({ status: "awaiting-install" }),
    });
    const view = render(
      <SiteContext.Provider value={awaiting}>
        <SiteOverviewPage />
      </SiteContext.Provider>,
    );
    expect(screen.getByTestId("quick-setup")).toHaveAttribute(
      "data-status",
      "awaiting-install",
    );

    view.rerender(
      <SiteContext.Provider
        value={{ ...awaiting, site: { ...awaiting.site, status: "live" } }}
      >
        <SiteOverviewPage />
      </SiteContext.Provider>,
    );

    expect(screen.getByTestId("quick-setup")).toHaveAttribute(
      "data-status",
      "live",
    );
  });

  // s66c2 review M-1: when the Add editor invite finishes setup, the panel
  // leaves the page while the dialog is open, and on Close focus needs
  // somewhere that is still drawn. The Overview gives it the heading of the
  // section right after the panel, focusable by script only.
  it("gives quick setup the Activity heading to hand focus to once the panel has left", () => {
    renderWithSite(<SiteOverviewPage />);

    const props = mockQuickSetupProps.mock.lastCall?.[0];
    act(() => props?.focusFallbackRef?.current?.focus());

    const activity = screen.getByRole("heading", {
      level: 2,
      name: "Activity",
    });
    expect(activity).toHaveFocus();
    expect(activity).toHaveAttribute("tabindex", "-1");
  });

  it("hides quick setup from a member without install credentials", () => {
    renderWithSite(
      <SiteOverviewPage />,
      buildSiteContext({
        site: buildSite({ siteToken: undefined, embedScript: undefined }),
      }),
    );

    expect(screen.queryByTestId("quick-setup")).not.toBeInTheDocument();
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
