import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SiteSettingsPage from "../page";
import { renderWithSite } from "@/components/dashboard/site/__tests__/site-context-fixture";
import { expectNoEmptyBodyBand } from "@/__tests__/helpers/dialog-body";

/**
 * s66c1 AC 8 — Settings holds what a site does not need to start editing:
 * domain ownership, webhooks, import and export, and deleting it.
 *
 * In the old detail view these sat between 1,690 and 3,500 px down one page,
 * under the snippet; the only way to delete a site was a hover-only menu on
 * its card.
 */

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () =>
    "/dashboard/sites/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/settings",
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = jest.fn();

function respond({
  deleteResponse = jsonResponse({ success: true }),
}: { deleteResponse?: Response } = {}) {
  fetchMock.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/sites/${SITE_ID}` && init?.method === "DELETE") {
        return deleteResponse;
      }
      if (url.startsWith("/api/domains/verify")) {
        return jsonResponse({ verifications: [], canManage: true });
      }
      if (url.startsWith("/api/webhooks")) return jsonResponse([]);
      if (url.startsWith("/api/bulk/export")) return jsonResponse([]);
      return jsonResponse({});
    },
  );
}

const deleteCalls = () =>
  fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
  );

describe("the Settings page", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    mockReplace.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    respond();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("says up front that none of it is needed to start editing", () => {
    renderWithSite(<SiteSettingsPage />);

    expect(
      screen.getByText(
        "Advanced settings. You don't need any of these to start editing.",
      ),
    ).toBeInTheDocument();
  });

  // There is no API to rename a site or change its domain
  // (src/app/api/sites/[siteId]/route.ts exports only DELETE).
  it("shows the name and domain read-only, and says why", () => {
    renderWithSite(<SiteSettingsPage />);

    const general = screen.getByRole("region", { name: "General" });
    expect(
      within(general).getByText("Acme marketing site"),
    ).toBeInTheDocument();
    expect(within(general).getByText("acme.example")).toBeInTheDocument();
    expect(within(general).queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      within(general).getByText(
        "Renaming a site or changing its domain isn't available yet.",
      ),
    ).toBeInTheDocument();
  });

  // Moved from SiteDetailView.test.tsx: the three panels that shipped with
  // their APIs and no surface, now mounted here for this site.
  it("mounts domain ownership, webhooks and content portability for this site", async () => {
    renderWithSite(<SiteSettingsPage />);

    expect(await screen.findByText("Domain ownership")).toBeInTheDocument();
    expect(screen.getByText("Webhooks")).toBeInTheDocument();
    expect(screen.getByText("Content portability")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/domains/verify?siteId=${SITE_ID}`,
      );
      expect(fetchMock).toHaveBeenCalledWith(`/api/webhooks?siteId=${SITE_ID}`);
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/bulk/export?siteId=${SITE_ID}`,
      );
    });
  });

  // "History" meant two things: version history (the header action) and the
  // import/export log. The log is now "Operation history".
  it("names the import and export log Operation history", () => {
    renderWithSite(<SiteSettingsPage />);

    expect(
      screen.getByRole("tab", { name: "Operation history" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "History" }),
    ).not.toBeInTheDocument();
  });

  it("deletes the site from the Danger zone and replaces the URL with Sites", async () => {
    const user = userEvent.setup();
    renderWithSite(<SiteSettingsPage />);

    const dangerZone = screen.getByRole("region", { name: "Danger zone" });
    expect(dangerZone).toHaveTextContent(
      "Permanently delete Acme marketing site, its content, editors and preview links. This can't be undone.",
    );
    await user.click(
      within(dangerZone).getByRole("button", { name: "Delete site" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Delete site?" });
    expect(deleteCalls()).toHaveLength(0);
    await user.click(
      within(dialog).getByRole("button", { name: "Delete site" }),
    );

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/dashboard/sites"),
    );
    expect(deleteCalls()[0][0]).toBe(`/api/sites/${SITE_ID}`);
  });

  /**
   * s66c1 review m6. `router.replace` is in flight after the DELETE succeeds,
   * and the dialog is still on screen until the page leaves. The button used
   * to come back enabled in that window: a second tap sent another DELETE,
   * which the route refuses for a site that no longer exists, and the dialog
   * flashed that refusal while the page was leaving.
   */
  it("keeps the confirmation disabled once the site is deleted, so a second tap sends nothing", async () => {
    const user = userEvent.setup();
    renderWithSite(<SiteSettingsPage />);

    await user.click(
      within(screen.getByRole("region", { name: "Danger zone" })).getByRole(
        "button",
        { name: "Delete site" },
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "Delete site?" });
    await user.click(
      within(dialog).getByRole("button", { name: "Delete site" }),
    );
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/dashboard/sites"),
    );

    // The confirming button, whatever it now reads: still on screen, because
    // the mocked router never leaves the page.
    const confirm = within(dialog).getByRole("button", {
      name: /delete site|deleting/i,
    });
    await user.click(confirm);

    expect(deleteCalls()).toHaveLength(1);
    expect(confirm).toBeDisabled();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the creator-only refusal inside the dialog", async () => {
    respond({
      deleteResponse: jsonResponse(
        { error: "Only the site creator can delete this site" },
        403,
      ),
    });
    const user = userEvent.setup();
    renderWithSite(<SiteSettingsPage />);

    await user.click(
      within(screen.getByRole("region", { name: "Danger zone" })).getByRole(
        "button",
        { name: "Delete site" },
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "Delete site?" });
    await user.click(
      within(dialog).getByRole("button", { name: "Delete site" }),
    );

    expect(
      await within(dialog).findByText(
        "Only the site creator can delete this site",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("draws no empty band under the delete confirmation when there is no error", async () => {
    const user = userEvent.setup();
    renderWithSite(<SiteSettingsPage />);

    await user.click(
      within(screen.getByRole("region", { name: "Danger zone" })).getByRole(
        "button",
        { name: "Delete site" },
      ),
    );

    expectNoEmptyBodyBand(await screen.findByRole("dialog"));
  });
});
