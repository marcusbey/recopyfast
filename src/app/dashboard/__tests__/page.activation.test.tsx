import { render, screen, within } from "@testing-library/react";
import DashboardPage from "../page";
import {
  useSiteActivation,
  type SiteActivationProgress,
} from "@/hooks/useSiteActivation";

/**
 * s66c2 AC 3 — the dashboard Overview shows one summary row per admin site
 * whose quick setup is unfinished, with "Continue setup" to that site's
 * Overview, where the full quick setup is. It used to render the whole
 * activation checklist once per admin site, stacked above the summary.
 *
 * The real `QuickSetup` renders here, in its summary variant, over a mocked
 * `useSiteActivation`: whether a site is unfinished is its decision, and its
 * rows and links are what this page shows.
 */

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", user_metadata: {} } }),
}));
jest.mock("@/components/dashboard/TrialStatusBadge", () => ({
  TrialStatusBadge: () => null,
}));
jest.mock("@/components/dashboard/SiteRegistrationModal", () => ({
  SiteRegistrationModal: () => null,
}));
jest.mock("@/hooks/useSiteActivation", () => ({
  useSiteActivation: jest.fn(),
}));

const mockUseSiteActivation = useSiteActivation as jest.MockedFunction<
  typeof useSiteActivation
>;

const NOT_STARTED: SiteActivationProgress = {
  installed: false,
  invited: false,
  published: false,
  dismissed: false,
};

/** Each site's server-side progress, by id; unlisted sites have not started. */
function progressBySite(
  progress: Record<string, Partial<SiteActivationProgress>>,
): void {
  mockUseSiteActivation.mockImplementation(({ siteId }) => ({
    data: { ...NOT_STARTED, ...progress[siteId] },
    loading: false,
    error: null,
    refetch: jest.fn(),
    dismiss: jest.fn(),
    dismissing: false,
    dismissError: null,
  }));
}

const sites = Array.from({ length: 7 }, (_, index) => ({
  id: `site-${index + 1}`,
  name: `Site ${index + 1}`,
  domain: `site-${index + 1}.example.com`,
  created_at: new Date(2026, 0, index + 1).toISOString(),
  updated_at: new Date(2026, 0, index + 1).toISOString(),
  status: "awaiting-install",
  ...(index < 6
    ? {
        siteToken: `token-${index + 1}`,
        embedScript: `<script data-site-id="site-${index + 1}"></script>`,
      }
    : {}),
}));

function respondWithSites(list: unknown[]): void {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    return {
      ok: true,
      json: async () =>
        url === "/api/sites"
          ? { sites: list }
          : { currentUsage: { aiUsage: 0 } },
    } as Response;
  }) as typeof fetch;
}

describe("dashboard quick setup summary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    progressBySite({});
  });

  /*
   * s66b1 review m-6. The section rendered whenever the sites had loaded,
   * empty or not. Empty, it is still a flex item of `[data-page-shell]`, so
   * the shell's gap was drawn twice above the summary for every account with
   * no installable site: the zero-site account, the one the page most needs
   * to look finished for.
   */
  it.each([
    ["has no sites", [], "No sites connected yet"],
    ["has no site with an install script", [{ ...sites[6] }], "Site 7"],
  ])(
    "renders no empty quick-setup list when the account %s",
    async (_case, list, readyText) => {
      respondWithSites(list);

      render(<DashboardPage />);

      // The sites have loaded: the list's own condition is now decided.
      expect(await screen.findByText(readyText)).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Quick setup" })).toBeNull();
    },
  );

  // Sites 1 and 2 are older than the five recent rows of "Your sites": their
  // setup is still listed. Site 7 is not an admin's (no install credentials).
  // Site 5 was hidden by its owner; site 6 is live with an editor added, so
  // its setup is done (done means Live).
  it("renders one summary row per unfinished admin site, beyond the five recent rows", async () => {
    progressBySite({
      "site-5": { dismissed: true },
      "site-6": { installed: true, invited: true },
    });
    respondWithSites(sites);

    render(<DashboardPage />);

    const list = await screen.findByRole("list", { name: "Quick setup" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual(
      ["Site 1", "Site 2", "Site 3", "Site 4"].map(
        (name) =>
          `${name} · Step 2 of 3: Install the snippet` + "Continue setup",
      ),
    );
    rows.forEach((row, index) => {
      expect(
        within(row).getByRole("link", { name: "Continue setup" }),
      ).toHaveAttribute("href", `/dashboard/sites/site-${index + 1}`);
    });
    expect(mockUseSiteActivation).toHaveBeenCalledWith({
      siteId: "site-1",
      userId: "user-1",
    });
    expect(
      mockUseSiteActivation.mock.calls.map(([options]) => options.siteId),
    ).not.toContain("site-7");
  });

  it("names step 3 for a live site that has not started editing", async () => {
    progressBySite({ "site-1": { installed: true } });
    respondWithSites([{ ...sites[0], status: "live" }]);

    render(<DashboardPage />);

    const list = await screen.findByRole("list", { name: "Quick setup" });
    expect(within(list).getByRole("listitem")).toHaveTextContent(
      "Site 1 · Step 3 of 3: Start editing",
    );
  });
});
