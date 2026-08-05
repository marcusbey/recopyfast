import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteCard } from "../SiteCard";
import type { Site } from "@/types";

// Mock date-fns
jest.mock("date-fns", () => ({
  formatDistanceToNow: jest.fn(() => "2 days ago"),
}));

describe("SiteCard", () => {
  const mockSite: Site & {
    stats?: {
      edits_count?: number;
      views?: number;
      last_activity?: string;
    };
    status?: "active" | "inactive" | "verifying";
  } = {
    id: "test-site-id",
    domain: "example.com",
    name: "Example Site",
    api_key: "test-api-key",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T00:00:00Z",
    status: "active",
    stats: {
      edits_count: 42,
      views: 1337,
      last_activity: "2024-01-15T00:00:00Z",
    },
  };

  const mockHandlers = {
    onViewDetails: jest.fn(),
    onEdit: jest.fn(),
    onDelete: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders site information correctly", () => {
    render(<SiteCard site={mockSite} {...mockHandlers} />);

    expect(screen.getByText("Example Site")).toBeInTheDocument();
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("displays status badge correctly", () => {
    render(<SiteCard site={mockSite} {...mockHandlers} />);

    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders site statistics", () => {
    render(<SiteCard site={mockSite} {...mockHandlers} />);

    expect(screen.getByText("42")).toBeInTheDocument(); // edits_count
    expect(screen.getByText("1337")).toBeInTheDocument(); // views
  });

  it("displays last edited time", () => {
    render(<SiteCard site={mockSite} {...mockHandlers} />);

    expect(screen.getByText(/Last edited 2 days ago/i)).toBeInTheDocument();
  });

  it("calls onViewDetails when View Details button is clicked", () => {
    render(<SiteCard site={mockSite} {...mockHandlers} />);

    const viewButtons = screen.getAllByText("View Details");
    fireEvent.click(viewButtons[0]);

    expect(mockHandlers.onViewDetails).toHaveBeenCalledWith("test-site-id");
  });

  it("calls onEdit when Settings button is clicked", () => {
    render(<SiteCard site={mockSite} {...mockHandlers} />);

    const settingsButtons = screen.getAllByText("Settings");
    fireEvent.click(settingsButtons[0]);

    expect(mockHandlers.onEdit).toHaveBeenCalledWith("test-site-id");
  });

  it("opens dropdown menu and calls onDelete", async () => {
    // Radix's dropdown trigger opens on pointerdown, which fireEvent.click does
    // not dispatch — userEvent drives the full pointer sequence.
    const user = userEvent.setup();
    render(<SiteCard site={mockSite} {...mockHandlers} />);

    await user.click(screen.getByRole("button", { name: /open menu/i }));

    const deleteButton = await screen.findByText("Delete Site");
    await user.click(deleteButton);

    expect(mockHandlers.onDelete).toHaveBeenCalledWith("test-site-id");
  });

  it("copies domain to clipboard when copy button is clicked", async () => {
    // Once any test in this file has called userEvent.setup(), navigator.clipboard
    // is a getter-only stub, so Object.assign no longer works — spy on it instead.
    const writeText = jest
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    render(<SiteCard site={mockSite} {...mockHandlers} />);

    // Hover over the card to reveal the copy button
    const card = screen.getByText("Example Site").closest(".group");
    if (card) {
      fireEvent.mouseEnter(card);
    }

    // Find and click the copy button
    const copyButtons = screen.getAllByTitle("Copy domain");
    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("example.com");
    });

    writeText.mockRestore();
  });

  it("renders with different status types", () => {
    const { rerender } = render(
      <SiteCard
        site={{ ...mockSite, status: "verifying" }}
        {...mockHandlers}
      />,
    );
    expect(screen.getByText("No content yet")).toBeInTheDocument();

    rerender(
      <SiteCard site={{ ...mockSite, status: "inactive" }} {...mockHandlers} />,
    );
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  /**
   * The API's `verifying` flag means "no content_elements rows", and nothing in
   * this product gates a site on `domain_verifications`. Calling it "Verifying"
   * put two working sites in a queue that does not exist and that no owner
   * action could clear.
   */
  it("never labels a site as verifying, because nothing verifies it", () => {
    render(
      <SiteCard
        site={{ ...mockSite, status: "verifying" }}
        {...mockHandlers}
      />,
    );

    expect(screen.queryByText(/verifying/i)).not.toBeInTheDocument();
    expect(
      screen.getByTitle(/has not recorded any content from this site yet/i),
    ).toBeInTheDocument();
  });

  it("does not assume an unknown status is healthy", () => {
    const siteWithoutStatus = { ...mockSite };
    delete siteWithoutStatus.status;

    render(<SiteCard site={siteWithoutStatus} {...mockHandlers} />);

    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("handles sites with no stats gracefully", () => {
    const siteWithoutStats = { ...mockSite };
    delete siteWithoutStats.stats;

    render(<SiteCard site={siteWithoutStats} {...mockHandlers} />);

    // Both the edits and views counters fall back to 0.
    expect(screen.getAllByText("0")).toHaveLength(2);
  });
});
