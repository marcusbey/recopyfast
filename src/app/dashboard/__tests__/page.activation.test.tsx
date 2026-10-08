import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "../page";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", user_metadata: {} } }),
}));
jest.mock("@/components/dashboard/TrialStatusBadge", () => ({
  TrialStatusBadge: () => null,
}));
jest.mock("@/components/dashboard/SiteRegistrationModal", () => ({
  SiteRegistrationModal: () => null,
}));
jest.mock("@/components/dashboard/ActivationChecklist", () => ({
  ActivationChecklist: ({
    siteId,
    userId,
  }: {
    siteId: string;
    userId: string;
  }) => (
    <div
      data-testid="activation-checklist"
      data-site-id={siteId}
      data-user-id={userId}
    />
  ),
}));

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

describe("dashboard activation integration", () => {
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
    "renders no empty checklist section when the account %s",
    async (_case, list, readyText) => {
      respondWithSites(list);

      render(<DashboardPage />);

      // The sites have loaded: the section's own condition is now decided.
      expect(await screen.findByText(readyText)).toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Activation checklists" }),
      ).toBeNull();
    },
  );

  it("renders a checklist for every admin site beyond the five recent rows", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      return {
        ok: true,
        json: async () =>
          url === "/api/sites" ? { sites } : { currentUsage: { aiUsage: 0 } },
      } as Response;
    }) as typeof fetch;

    render(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getAllByTestId("activation-checklist")).toHaveLength(6),
    );
    expect(screen.getAllByTestId("activation-checklist")[5]).toHaveAttribute(
      "data-site-id",
      "site-6",
    );
    expect(
      screen
        .getAllByTestId("activation-checklist")
        .map((checklist) => checklist.getAttribute("data-site-id")),
    ).not.toContain("site-7");
    expect(screen.getAllByTestId("activation-checklist")[0]).toHaveAttribute(
      "data-user-id",
      "user-1",
    );
  });
});
