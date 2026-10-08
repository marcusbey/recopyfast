import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePathname } from "next/navigation";
import SiteOverviewPage from "../page";
import SiteInstallPage from "../install/page";
import SitePeoplePage from "../people/page";
import SiteSettingsPage from "../settings/page";
import {
  buildSiteContext,
  renderWithSite,
} from "@/components/dashboard/site/__tests__/site-context-fixture";

/**
 * s66c1 AC 1 — every site subpage is one frame: the site's name as the page's
 * only h1, its status beside it, its domain under it, "Edit website" and
 * "Version history" as the actions, and the Site sub-navigation (ADR 052,
 * ADR 053's `nav` slot).
 *
 * The frame comes from `useSitePageShell`, so each page renders
 * `<PageShell {...shell}>` itself and the page-shell guard sees it.
 */

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }),
}));

const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASE = `/dashboard/sites/${SITE_ID}`;

const PAGES = [
  { label: "Overview", path: BASE, Page: SiteOverviewPage },
  { label: "Install", path: `${BASE}/install`, Page: SiteInstallPage },
  { label: "People & access", path: `${BASE}/people`, Page: SitePeoplePage },
  { label: "Settings", path: `${BASE}/settings`, Page: SiteSettingsPage },
] as const;

describe("the site frame", () => {
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    // The pages' own panels load their data; the frame is what is under
    // test, so every request answers with an empty, successful body.
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/api/edit-board/history")
        ? { versions: [], hasMore: false }
        : url.includes("/api/domains/verify")
          ? { verifications: [], canManage: true }
          : url.includes("/activation")
            ? {
                installed: true,
                invited: true,
                published: true,
                dismissed: true,
              }
            : url.includes("/api/staging/access")
              ? { success: true, accessList: [] }
              : url.includes("/api/editor/editors")
                ? { ok: true, editors: [] }
                : {};
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as unknown as typeof fetch;
  });

  describe.each(PAGES)("$label", ({ label, path, Page }) => {
    beforeEach(() => {
      mockUsePathname.mockReturnValue(path);
    });

    it("has one h1, the site's name, with its status beside it", () => {
      renderWithSite(<Page />);

      const headings = screen.getAllByRole("heading", { level: 1 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent("Acme marketing site");
      const header = headings[0].closest("[data-page-header]") as HTMLElement;
      expect(within(header).getByText("Live")).toBeInTheDocument();
    });

    it("links the domain out, in a new tab with no opener", () => {
      renderWithSite(<Page />);

      const link = screen.getByRole("link", { name: /acme\.example/ });
      expect(link).toHaveAttribute("href", "https://acme.example");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toMatch(/noopener/);
    });

    it("offers Edit website and Version history in the header", () => {
      renderWithSite(<Page />);

      const header = screen
        .getByRole("heading", { level: 1 })
        .closest("[data-page-header]") as HTMLElement;
      expect(
        within(header).getByRole("button", { name: "Edit website" }),
      ).toBeInTheDocument();
      expect(
        within(header).getByRole("button", { name: "Version history" }),
      ).toBeInTheDocument();
    });

    it("navigates the four subpages by link, marking only this one current", () => {
      renderWithSite(<Page />);

      const nav = screen.getByRole("navigation", { name: "Site" });
      const links = within(nav).getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual([
        "Overview",
        "Install",
        "People & access",
        "Settings",
      ]);
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        BASE,
        `${BASE}/install`,
        `${BASE}/people`,
        `${BASE}/settings`,
      ]);
      const current = links.filter(
        (link) => link.getAttribute("aria-current") === "page",
      );
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent(label);
    });
  });

  it("opens the version history from the header", async () => {
    mockUsePathname.mockReturnValue(BASE);
    const user = userEvent.setup();
    renderWithSite(<SiteOverviewPage />);

    await user.click(screen.getByRole("button", { name: "Version history" }));

    expect(
      await screen.findByRole("dialog", { name: /version history/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/edit-board/history?siteId=${SITE_ID}`),
      ),
    );
  });

  it("sends the owner's edit-session body from the header", async () => {
    mockUsePathname.mockReturnValue(BASE);
    const popup = { opener: {}, location: { href: "" }, close: jest.fn() };
    jest.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ editUrl: "https://acme.example/?rcf_edit_token=t" }),
    });
    const user = userEvent.setup();
    renderWithSite(<SiteInstallPage />, buildSiteContext());

    await user.click(screen.getByRole("button", { name: "Edit website" }));

    await waitFor(() =>
      expect(popup.location.href).toBe(
        "https://acme.example/?rcf_edit_token=t",
      ),
    );
    const call = (global.fetch as jest.Mock).mock.calls.find(
      ([url]) => url === "/api/edit-sessions/create",
    );
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      siteId: SITE_ID,
      permissions: ["edit", "admin"],
      durationHours: 2,
    });
  });
});
