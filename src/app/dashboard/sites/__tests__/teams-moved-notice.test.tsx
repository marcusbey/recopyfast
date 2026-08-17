/**
 * s04 AC2, second half — landing on `/dashboard/sites` from a retired
 * `/dashboard/teams` link has to explain itself.
 *
 * The redirect alone satisfies "not a 404" and fails the sentence it is part
 * of: "redirects to the site sharing surface — not a 404, **not a broken
 * page**". A user who asked for team management and silently received a list of
 * sites has no way to tell whether the feature moved, broke, or was never
 * there, and the answer they need — invite editors from a site's own Share
 * panel — is nowhere on the screen.
 *
 * The notice is driven by the query param alone and needs no fetch, so it must
 * render in every state the list can be in, including the ones where the list
 * itself has nothing to show. An owner redirected here may well have zero sites
 * and still needs to know why they are here.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SitesPage from "../page";

const mockSearchParams = { current: new URLSearchParams() };

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams.current,
}));

const mockAuthValue = {
  user: { id: "test-user-id", email: "test@example.com" },
};
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: jest.fn(() => mockAuthValue),
}));

jest.mock("@/components/dashboard/SiteCard", () => ({
  SiteCard: ({ site }: { site: { id: string; name: string } }) => (
    <div data-testid={`site-card-${site.id}`}>{site.name}</div>
  ),
}));

jest.mock("@/components/dashboard/SiteDetailView", () => ({
  SiteDetailView: ({ site }: { site: { name: string } }) => (
    <div data-testid="site-detail-view">{site.name}</div>
  ),
}));

const NOTICE_TITLE = "Team management has moved";

const ONE_SITE = [
  {
    id: "site-1",
    domain: "example1.com",
    name: "Example Site 1",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T00:00:00Z",
    status: "active",
  },
];

/** The list's four states, each pinned by what it puts on screen. */
const respondWith = {
  success: () =>
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ sites: ONE_SITE }),
    }),
  empty: () =>
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ sites: [] }),
    }),
  error: () => (global.fetch as jest.Mock).mockResolvedValue({ ok: false }),
  // Never settles: the page stays on its skeletons.
  loading: () =>
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {})),
};

describe("the teams-moved notice on /dashboard/sites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    mockSearchParams.current = new URLSearchParams("notice=teams-moved");
  });

  it("names the notice and points at where sharing now happens", async () => {
    respondWith.success();
    render(<SitesPage />);

    expect(await screen.findByText(NOTICE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/Share panel/i)).toBeInTheDocument();
  });

  describe("renders in every list state, since it is about navigation, not data", () => {
    it("shows while the sites are still loading", async () => {
      respondWith.loading();
      render(<SitesPage />);

      // GUARD: the list really is in its loading state, not merely empty.
      expect(
        screen.getByRole("status", { name: /loading sites/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(NOTICE_TITLE)).toBeInTheDocument();
    });

    it("shows when the account has no sites at all", async () => {
      respondWith.empty();
      render(<SitesPage />);

      expect(
        await screen.findByText("No sites connected yet"),
      ).toBeInTheDocument();
      expect(screen.getByText(NOTICE_TITLE)).toBeInTheDocument();
    });

    it("shows when the site list failed to load", async () => {
      respondWith.error();
      render(<SitesPage />);

      expect(
        await screen.findByText("Could not load your sites"),
      ).toBeInTheDocument();
      expect(screen.getByText(NOTICE_TITLE)).toBeInTheDocument();
    });

    it("shows alongside a populated list", async () => {
      respondWith.success();
      render(<SitesPage />);

      expect(await screen.findByTestId("site-card-site-1")).toBeInTheDocument();
      expect(screen.getByText(NOTICE_TITLE)).toBeInTheDocument();
    });
  });

  it("stays out of the way of everyone who did not come from /dashboard/teams", async () => {
    mockSearchParams.current = new URLSearchParams();
    respondWith.success();
    render(<SitesPage />);

    expect(await screen.findByTestId("site-card-site-1")).toBeInTheDocument();
    expect(screen.queryByText(NOTICE_TITLE)).not.toBeInTheDocument();
  });

  it("ignores an unrelated notice value", async () => {
    mockSearchParams.current = new URLSearchParams("notice=something-else");
    respondWith.success();
    render(<SitesPage />);

    expect(await screen.findByTestId("site-card-site-1")).toBeInTheDocument();
    expect(screen.queryByText(NOTICE_TITLE)).not.toBeInTheDocument();
  });

  it("can be dismissed", async () => {
    respondWith.success();
    const user = userEvent.setup();
    render(<SitesPage />);

    expect(await screen.findByText(NOTICE_TITLE)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    await waitFor(() => {
      expect(screen.queryByText(NOTICE_TITLE)).not.toBeInTheDocument();
    });
    // Dismissing the explanation must not take the site list with it.
    expect(screen.getByTestId("site-card-site-1")).toBeInTheDocument();
  });
});
