import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteRow, type SiteRowSite } from "../SiteRow";

// Mock date-fns
jest.mock("date-fns", () => ({
  formatDistanceToNow: jest.fn(() => "2 days ago"),
}));

/**
 * s66c1 AC 3 — one row per site on a light Sites list. It replaces
 * SiteCard: these are SiteCard.test.tsx's surviving cases (`:44-55`,
 * `:64-68`, `:128-172`), plus the row's own.
 *
 * The card carried seven controls, two of them hover-only (copy domain, and
 * the ⋮ that held the only Delete), so a touch screen could not delete a
 * site. Its "Settings" button started an edit session. A row holds three:
 * the name (a link to the site's page), one primary action, and ⋮, all
 * visible at rest.
 */

describe("SiteRow", () => {
  const mockSite: SiteRowSite = {
    id: "test-site-id",
    domain: "example.com",
    name: "Example Site",
    updated_at: "2024-01-15T00:00:00Z",
    status: "live",
  };

  const handlers = {
    onDelete: jest.fn(),
    onShare: jest.fn(),
  };

  const renderRow = (site: Partial<SiteRowSite> = {}) =>
    render(
      <ul>
        <SiteRow site={{ ...mockSite, ...site }} {...handlers} />
      </ul>,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders site information correctly", () => {
    renderRow();

    expect(screen.getByText("Example Site")).toBeInTheDocument();
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("displays status badge correctly", () => {
    renderRow();

    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("displays last edited time", () => {
    renderRow();

    expect(screen.getByText(/Last edited 2 days ago/i)).toBeInTheDocument();
  });

  it("renders with different status types", () => {
    const { rerender } = renderRow({ status: "awaiting-install" });
    expect(screen.getByText("Awaiting install")).toBeInTheDocument();

    rerender(
      <ul>
        <SiteRow site={{ ...mockSite, status: "stale" }} {...handlers} />
      </ul>,
    );
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  /**
   * The API's old `verifying` flag meant "no content_elements rows", and nothing
   * in this product gates a site on `domain_verifications`. Calling it
   * "Verifying" put two working sites in a queue that does not exist and that no
   * owner action could clear. The state is now named for what is actually true —
   * we are waiting on their script, not on ourselves.
   */
  it("never labels a site as verifying, because nothing verifies it", () => {
    renderRow({ status: "awaiting-install" });

    expect(screen.queryByText(/verifying/i)).not.toBeInTheDocument();
    expect(
      screen.getByTitle(/Add the snippet to your site/i),
    ).toBeInTheDocument();
  });

  it("does not assume an unknown status is healthy", () => {
    renderRow({ status: undefined });

    expect(screen.getByText("Awaiting install")).toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });

  it("links the site's name to its own page", () => {
    renderRow();

    expect(screen.getByRole("link", { name: "Example Site" })).toHaveAttribute(
      "href",
      "/dashboard/sites/test-site-id",
    );
  });

  it("offers Continue setup, to the site's Overview, while it awaits install", () => {
    renderRow({ status: "awaiting-install" });

    expect(
      screen.getByRole("link", { name: "Continue setup" }),
    ).toHaveAttribute("href", "/dashboard/sites/test-site-id");
    expect(
      screen.queryByRole("button", { name: /edit website/i }),
    ).not.toBeInTheDocument();
  });

  it.each(["live", "stale"] as const)(
    "offers Edit website once the site is %s",
    (status) => {
      renderRow({ status });

      expect(
        screen.getByRole("button", { name: /edit website/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Continue setup" }),
      ).not.toBeInTheDocument();
    },
  );

  // A touch screen has no hover: the menu that holds Delete is always there.
  it("shows the menu at rest, named for its site", () => {
    renderRow();

    const trigger = screen.getByRole("button", {
      name: "Open menu for Example Site",
    });
    expect(trigger).toBeVisible();
    expect(trigger.className).not.toMatch(/opacity-0/);
  });

  it("holds Open site page, Edit website, Share preview link and Delete site in its menu", async () => {
    // Radix's dropdown trigger opens on pointerdown, which fireEvent.click does
    // not dispatch — userEvent drives the full pointer sequence.
    const user = userEvent.setup();
    renderRow();

    await user.click(
      screen.getByRole("button", { name: "Open menu for Example Site" }),
    );
    const menu = await screen.findByRole("menu");

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Open site page",
      "Edit website",
      "Share preview link",
      "Delete site",
    ]);
    expect(
      within(menu).getByRole("menuitem", { name: "Open site page" }),
    ).toHaveAttribute("href", "/dashboard/sites/test-site-id");
  });

  it("asks to delete from the menu", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(
      screen.getByRole("button", { name: "Open menu for Example Site" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete site" }),
    );

    expect(handlers.onDelete).toHaveBeenCalledWith("test-site-id");
  });

  it("opens Share preview link from the menu", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(
      screen.getByRole("button", { name: "Open menu for Example Site" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Share preview link" }),
    );

    expect(handlers.onShare).toHaveBeenCalledWith("test-site-id");
  });

  it("sends the owner's edit-session body from the menu, opening the tab on the click", async () => {
    const popup = { opener: {}, location: { href: "" }, close: jest.fn() };
    const open = jest
      .spyOn(window, "open")
      .mockReturnValue(popup as unknown as Window);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ editUrl: "https://example.com/?rcf_edit_token=t" }),
    }) as unknown as typeof fetch;
    const user = userEvent.setup();
    renderRow();

    await user.click(
      screen.getByRole("button", { name: "Open menu for Example Site" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Edit website" }),
    );

    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      siteId: "test-site-id",
      permissions: ["edit", "admin"],
      durationHours: 2,
    });
    open.mockRestore();
  });

  // The hover-only "Copy domain" is gone (s66c1 design, "Removed from the
  // face of the card"), and so are the Edits / Views / Activity figures:
  // views were never computed.
  it("has no copy-domain control and no figures", () => {
    renderRow();

    expect(screen.queryByTitle("Copy domain")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /copy domain/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Views")).not.toBeInTheDocument();
  });
});
