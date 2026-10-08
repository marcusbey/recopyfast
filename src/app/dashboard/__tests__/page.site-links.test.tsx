import { render, screen, within } from "@testing-library/react";
import DashboardPage from "../page";

/**
 * s66c1 AC 9 — the Overview's "Your sites" rows open each site's own page.
 * They all pointed at `/dashboard/sites`, the list, because a site had no
 * URL of its own until ADR 052.
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
jest.mock("@/components/dashboard/ActivationChecklist", () => ({
  ActivationChecklist: () => null,
}));

const sites = [
  {
    id: "site-a",
    name: "Site A",
    domain: "a.example.com",
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    status: "live",
  },
  {
    id: "site-b",
    name: "Site B",
    domain: "b.example.com",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    status: "awaiting-install",
  },
];

describe("the Overview's site rows", () => {
  it("link each site to its own page", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return {
        ok: true,
        json: async () =>
          url === "/api/sites" ? { sites } : { currentUsage: { aiUsage: 0 } },
      } as Response;
    }) as typeof fetch;

    render(<DashboardPage />);

    for (const site of sites) {
      const name = await screen.findByText(site.name);
      const row = name.closest("a") as HTMLElement;
      expect(row).toHaveAttribute("href", `/dashboard/sites/${site.id}`);
      expect(within(row).getByText(site.domain)).toBeInTheDocument();
    }
  });
});
