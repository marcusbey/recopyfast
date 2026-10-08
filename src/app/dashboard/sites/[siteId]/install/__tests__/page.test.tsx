import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SiteInstallPage from "../page";
import { SiteProvider } from "@/components/dashboard/site/SiteProvider";
import {
  FIXTURE_SNIPPET,
  FIXTURE_TOKEN,
  buildSite,
  buildSiteContext,
  renderWithSite,
} from "@/components/dashboard/site/__tests__/site-context-fixture";
import { expectNoEmptyBodyBand } from "@/__tests__/helpers/dialog-body";

/**
 * s66c1 AC 5 — Install shows the snippet exactly once, in every state.
 *
 * The old detail view showed it three times (the checklist, "Embed Script",
 * and the Installation card's per-recipe copies), and hid the live site's
 * behind "View install snippet". After "Regenerate snippet" an old copy left
 * in a less visible place is a dead snippet an owner can paste.
 */

jest.mock("next/navigation", () => ({
  usePathname: () =>
    "/dashboard/sites/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/install",
}));

jest.mock("date-fns", () => ({
  formatDistanceToNow: jest.fn(() => "5 hours ago"),
}));

const writeText = jest.fn();

describe("the Install page", () => {
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    global.fetch = jest.fn();
  });

  it.each(["awaiting-install", "live", "stale"] as const)(
    "shows the snippet exactly once while the site is %s",
    (status) => {
      renderWithSite(
        <SiteInstallPage />,
        buildSiteContext({ site: buildSite({ status }) }),
      );

      expect(screen.getAllByText(/data-site-token/)).toHaveLength(1);
      expect(screen.getByText(FIXTURE_SNIPPET)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /view install snippet/i }),
      ).not.toBeInTheDocument();
    },
  );

  it("copies exactly the provider's snippet", async () => {
    renderWithSite(<SiteInstallPage />);

    fireEvent.click(screen.getByRole("button", { name: "Copy snippet" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(FIXTURE_SNIPPET),
    );
  });

  it("copies the site token", async () => {
    renderWithSite(<SiteInstallPage />);

    expect(screen.getByText("Site token")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy site token" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FIXTURE_TOKEN));
  });

  // Moved from SiteDetailView.test.tsx ("renders site token section…"): the
  // token's explainer, unchanged.
  it("explains what the token is and what regenerating it does", () => {
    renderWithSite(<SiteInstallPage />);

    expect(
      screen.getByText(/visible in your page's HTML by design/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/requesting page's origin/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Regenerate snippet revokes old snippets/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/never expose it publicly/i),
    ).not.toBeInTheDocument();
  });

  // Moved from SiteDetailView.test.tsx: the confirmation says what happens
  // before anything is sent.
  it("explains the HTTP and existing WebSocket revocation timing before regenerating", async () => {
    renderWithSite(<SiteInstallPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );

    expect(
      await screen.findByRole("heading", { name: /regenerate snippet/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/old snippets stop working for new requests/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /existing live editing connections may continue until they reconnect/i,
      ),
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("draws no empty band under the regenerate confirmation when there is no error", async () => {
    renderWithSite(<SiteInstallPage />);
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );

    expectNoEmptyBodyBand(await screen.findByRole("dialog"));
  });

  it("tells a member without credentials that only admins see the snippet", () => {
    renderWithSite(
      <SiteInstallPage />,
      buildSiteContext({
        site: buildSite({ siteToken: undefined, embedScript: undefined }),
      }),
    );

    expect(
      screen.getByText("Only this site's admins can see its install snippet."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/data-site-token/)).not.toBeInTheDocument();
    expect(screen.queryByText(/YOUR_SITE_TOKEN/)).not.toBeInTheDocument();
    expect(screen.queryByText("Site token")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /regenerate snippet/i }),
    ).not.toBeInTheDocument();
  });

  /**
   * The rotation end to end, through the real provider: the POST is the same
   * one the detail view sent, and both the snippet and the token block show
   * the new values — the old token survives nowhere on the page (moved from
   * SiteDetailView.test.tsx, "replaces every displayed credential and copies
   * the regenerated values").
   */
  it("regenerates through the confirmation and replaces both blocks", async () => {
    const site = buildSite();
    const newToken = "new-site-token-456";
    const newScript = `<script src="https://app.example/embed/recopyfast.js" data-site-token="${newToken}"></script>`;
    (global.fetch as jest.Mock).mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/regenerate-snippet")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              siteToken: newToken,
              embedScript: newScript,
            }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ sites: [site] }),
        } as Response;
      },
    );

    render(
      <SiteProvider siteId={site.id}>
        <SiteInstallPage />
      </SiteProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /regenerate snippet/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /regenerate now/i }),
    );

    expect(await screen.findByText("Snippet regenerated")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/sites/${site.id}/regenerate-snippet`,
      { method: "POST" },
    );
    expect(screen.getByText(newScript)).toBeInTheDocument();
    expect(screen.getByText(newToken)).toBeInTheDocument();
    expect(screen.queryByText(FIXTURE_TOKEN)).not.toBeInTheDocument();
    expect(screen.queryByText(FIXTURE_SNIPPET)).not.toBeInTheDocument();
    expect(screen.getAllByText(/data-site-token/)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Copy snippet" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(newScript));
    fireEvent.click(screen.getByRole("button", { name: "Copy site token" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(newToken));
  });

  it("keeps a failed regeneration inside its dialog", async () => {
    const regenerateSnippet = jest.fn(async () => false);
    renderWithSite(
      <SiteInstallPage />,
      buildSiteContext({
        regenerateSnippet,
        regeneration: {
          isPending: false,
          error: "Failed to regenerate snippet",
          hasSucceeded: false,
        },
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent("Snippet was not regenerated");
    expect(dialog).toHaveTextContent("Failed to regenerate snippet");
  });
});
