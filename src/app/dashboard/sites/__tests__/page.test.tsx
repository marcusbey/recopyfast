import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SitesPage from "../page";

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

jest.mock("@/components/dashboard/SiteCard", () => ({
  SiteCard: ({ site, onViewDetails, onEdit, onDelete }: any) => (
    <div data-testid={`site-card-${site.id}`}>
      <p>{site.name}</p>
      <p>{site.domain}</p>
      <button onClick={() => onViewDetails(site.id)}>View Details</button>
      <button onClick={() => onEdit(site.id)}>Edit</button>
      <button onClick={() => onDelete(site.id)}>Delete</button>
    </div>
  ),
}));

jest.mock("@/components/dashboard/SiteDetailView", () => ({
  SiteDetailView: ({ site }: any) => (
    <div data-testid="site-detail-view">{site.name}</div>
  ),
}));

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
      status: "active",
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
      status: "verifying",
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
      status: "inactive",
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
    fireEvent.click(
      within(
        screen.getByRole("group", { name: /filter sites by status/i }),
      ).getByRole("button", { name: /^Active/ }),
    );

    await waitFor(() => {
      // Should only show active site
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
      expect(screen.queryByTestId("site-card-site-2")).not.toBeInTheDocument();
    });
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

  it("navigates to site detail view when clicking View Details", async () => {
    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
    });

    const viewButton = screen.getAllByText("View Details")[0];
    fireEvent.click(viewButton);

    await waitFor(() => {
      expect(screen.getByTestId("site-detail-view")).toBeInTheDocument();
      expect(screen.getByText("Back to Sites")).toBeInTheDocument();
    });
  });

  it("returns to sites list from detail view", async () => {
    render(<SitesPage />);

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
    });

    // Navigate to detail view
    const viewButton = screen.getAllByText("View Details")[0];
    fireEvent.click(viewButton);

    await waitFor(() => {
      expect(screen.getByTestId("site-detail-view")).toBeInTheDocument();
    });

    // Click back button
    const backButton = screen.getByText("Back to Sites");
    fireEvent.click(backButton);

    await waitFor(() => {
      expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
      expect(screen.queryByTestId("site-detail-view")).not.toBeInTheDocument();
    });
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
});
