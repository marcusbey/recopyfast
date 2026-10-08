import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SitesPage from "../page";
import { expectNoEmptyBodyBand } from "@/__tests__/helpers/dialog-body";

// Mock the auth context
// The returned object must be stable: the page refetches on `[user]`, so a new
// object per render would retrigger the effect on every render.
const mockAuthValue = {
  user: { id: "test-user-id", email: "test@example.com" },
};
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: jest.fn(() => mockAuthValue),
}));

// Mock the components
jest.mock("@/components/layout/Header", () => ({
  Header: () => <div data-testid="header">Header</div>,
}));

/*
 * s66c1: SiteCard (and the SiteDetailView it opened in place) became
 * SiteRow. The mock renders the real row, so the name link is the real one,
 * inside a test id the list assertions below find it by, with a direct
 * Delete trigger so a test can reach the page's confirmation without driving
 * the row's menu (SiteRow.test.tsx drives the menu itself).
 */
jest.mock("@/components/dashboard/SiteRow", () => {
  const actual = jest.requireActual<
    typeof import("@/components/dashboard/SiteRow")
  >("@/components/dashboard/SiteRow");
  return {
    SiteRow: (props: any) => (
      <div data-testid={`site-card-${props.site.id}`}>
        <actual.SiteRow {...props} />
        <button onClick={() => props.onDelete(props.site.id)}>Delete</button>
      </div>
    ),
  };
});

// Mock fetch
global.fetch = jest.fn();

describe("SitesPage", () => {
  const mockSites = [
    {
      id: "site-1",
      domain: "example1.com",
      name: "Example Site 1",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-15T00:00:00Z",
      status: "live",
      stats: {
        edits_count: 10,
        views: 100,
        content_elements_count: 5,
      },
    },
    {
      id: "site-2",
      domain: "example2.com",
      name: "Example Site 2",
      created_at: "2024-01-02T00:00:00Z",
      updated_at: "2024-01-16T00:00:00Z",
      status: "awaiting-install",
      stats: {
        edits_count: 5,
        views: 50,
        content_elements_count: 3,
      },
    },
    {
      id: "site-3",
      domain: "example3.com",
      name: "Example Site 3",
      created_at: "2024-01-03T00:00:00Z",
      updated_at: "2024-01-17T00:00:00Z",
      status: "stale",
      stats: {
        edits_count: 0,
        views: 0,
        content_elements_count: 0,
      },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ sites: mockSites }),
    });
  });

  it("renders page header and title", async () => {
    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByText("Sites")).toBeInTheDocument();
      expect(
        screen.getByText("Every domain you have connected to ReCopyFast."),
      ).toBeInTheDocument();
    });
  });

  it("fetches and displays sites", async () => {
    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
      expect(screen.getByTestId("site-card-site-2")).toBeInTheDocument();
      expect(screen.getByTestId("site-card-site-3")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/sites");
  });

  it("displays loading state initially", () => {
    const { container } = render(<SitesPage />);

    // The redesign replaced the bare spinner with skeletons announced via
    // role="status". Assert the accessible loading affordance, not a class name.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("site-card-site-1")).not.toBeInTheDocument();
  });

  it("displays status counts correctly", async () => {
    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument(); // Total sites
    });
  });

  it("filters sites by status when clicking status cards", async () => {
    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
    });

    // The status filters are a real button group (aria-pressed) rather than
    // clickable cards, so query by role instead of a styling class.
    // The filter vocabulary follows the site state machine: Awaiting install /
    // Live / Stale, in place of the retired Active / No content yet / Inactive.
    fireEvent.click(
      within(
        screen.getByRole("group", { name: /filter sites by status/i }),
      ).getByRole("button", { name: /^Live/ }),
    );

    await waitFor(() => {
      // Should only show the live site
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
      expect(screen.queryByTestId("site-card-site-2")).not.toBeInTheDocument();
    });
  });

  it("filters down to the sites still waiting on their snippet", async () => {
    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-2")).toBeInTheDocument();
    });

    fireEvent.click(
      within(
        screen.getByRole("group", { name: /filter sites by status/i }),
      ).getByRole("button", { name: /^Awaiting install/ }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-2")).toBeInTheDocument();
      expect(screen.queryByTestId("site-card-site-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("site-card-site-3")).not.toBeInTheDocument();
    });
  });

  /*
   * The install poll moved to SiteProvider with the site itself (ADR 052):
   * its four tests are in
   * src/components/dashboard/site/__tests__/SiteProvider.test.tsx. This page
   * no longer polls at all.
   */
  it("never polls: the list is read once", async () => {
    jest.useFakeTimers();
    try {
      render(<SitesPage />);
      await screen.findByTestId("site-card-site-2");
      const callsAfterLoad = (global.fetch as jest.Mock).mock.calls.length;

      jest.advanceTimersByTime(60_000);

      expect((global.fetch as jest.Mock).mock.calls.length).toBe(
        callsAfterLoad,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("searches sites by name or domain", async () => {
    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search by name or domain");
    fireEvent.change(searchInput, { target: { value: "example1" } });

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
      expect(screen.queryByTestId("site-card-site-2")).not.toBeInTheDocument();
      expect(screen.queryByTestId("site-card-site-3")).not.toBeInTheDocument();
    });
  });

  it("sorts sites by name", async () => {
    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Sort sites/i }));

    await user.click(await screen.findByText("Sort by name"));

    // Sites should be reordered alphabetically
    await waitFor(() => {
      const cards = screen.getAllByTestId(/site-card-/);
      expect(cards[0]).toHaveAttribute("data-testid", "site-card-site-1");
    });
  });

  it("displays empty state when no sites exist", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ sites: [] }),
    });

    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByText("No sites connected yet")).toBeInTheDocument();
      expect(
        screen.getByText(
          "ReCopyFast turns a site you already have into one your team can edit in place.",
        ),
      ).toBeInTheDocument();
    });
  });

  it('displays "Add site" button', async () => {
    render(<SitesPage />);

    await waitFor(() => {
      const addButtons = screen.getAllByText("Add site");
      expect(addButtons.length).toBeGreaterThan(0);
    });
  });

  // Replaces "navigates to site detail view" and "returns to sites list from
  // detail view": a site has its own URL now (ADR 052), so the row's name is
  // a link to it and nothing on this page swaps in place.
  it("links each site's name to its own page", async () => {
    render(<SitesPage />);

    const row = await screen.findByTestId("site-card-site-1");
    expect(
      within(row).getByRole("link", { name: "Example Site 1" }),
    ).toHaveAttribute("href", "/dashboard/sites/site-1");
  });

  it("has no View Details and no Edit Website dialog anywhere", async () => {
    render(<SitesPage />);
    await screen.findByTestId("site-card-site-1");

    expect(screen.queryByText(/view details/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Back to Sites")).not.toBeInTheDocument();

    // The row's Edit website opens a tab, never a dialog on this page.
    const open = jest.spyOn(window, "open").mockReturnValue(null);
    const row = screen.getByTestId("site-card-site-1");
    fireEvent.click(within(row).getByRole("button", { name: /edit website/i }));
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    open.mockRestore();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /edit website/i }),
    ).not.toBeInTheDocument();
  });

  it("handles API errors gracefully", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
    });

    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByText("Could not load your sites")).toBeInTheDocument();
      expect(screen.getByText("Try again")).toBeInTheDocument();
    });
  });

  it("retries fetching sites after error", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
    });

    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByText("Try again")).toBeInTheDocument();
    });

    // Mock successful response for retry
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sites: mockSites }),
    });

    const retryButton = screen.getByText("Try again");
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
    });
  });

  it("clears filters when clicking Clear Filters button", async () => {
    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
    });

    // Set a search query
    const searchInput = screen.getByPlaceholderText("Search by name or domain");
    // Clear Filters only renders in the empty state, so filter everything out.
    fireEvent.change(searchInput, { target: { value: "no-such-site" } });

    await waitFor(() => {
      expect(screen.getByText("Clear filters")).toBeInTheDocument();
    });

    // Click clear filters
    const clearButton = screen.getByText("Clear filters");
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-2")).toBeInTheDocument();
      expect(screen.getByTestId("site-card-site-3")).toBeInTheDocument();
    });
  });

  // s66c1 review m6: the confirmation stays disabled after a delete succeeds,
  // until the dialog goes away. The list keeps one dialog mounted for every
  // row, so the next site's confirmation must start enabled again.
  it("lets a second site be deleted after the first", async () => {
    const user = userEvent.setup();
    render(<SitesPage />);
    const deleteRequests = () =>
      (global.fetch as jest.Mock).mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      );

    await user.click(
      within(await screen.findByTestId("site-card-site-1")).getByRole(
        "button",
        { name: "Delete" },
      ),
    );
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "Delete site?" }),
      ).getByRole("button", { name: "Delete site" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("site-card-site-1")).not.toBeInTheDocument(),
    );

    await user.click(
      within(screen.getByTestId("site-card-site-2")).getByRole("button", {
        name: "Delete",
      }),
    );
    const confirm = within(
      await screen.findByRole("dialog", { name: "Delete site?" }),
    ).getByRole("button", { name: "Delete site" });
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(screen.queryByTestId("site-card-site-2")).not.toBeInTheDocument(),
    );
    expect(deleteRequests().map(([url]) => url)).toEqual([
      "/api/sites/site-1",
      "/api/sites/site-2",
    ]);
  });

  it("draws no empty band under the delete confirmation when there is no error", async () => {
    render(<SitesPage />);
    const card = await screen.findByTestId("site-card-site-1");
    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));

    expectNoEmptyBodyBand(await screen.findByRole("dialog"));
  });
});
