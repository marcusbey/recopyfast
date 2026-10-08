import { useLayoutEffect } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SiteProvider, useSiteContext } from "../SiteProvider";
import SiteLayout from "@/app/dashboard/sites/[siteId]/layout";
import { buildEmbedScript } from "@/lib/sites/embed-script";

/**
 * The real builder, watched. s07b task 5 turns on *which* of the two snippet
 * sources the site pages use: `site.embedScript` comes from `GET /api/sites`,
 * which reads `NEXT_PUBLIC_WS_URL` at request time, while the
 * `buildEmbedScript` fallback runs in the browser, where Next.js has already
 * inlined that value at build time. The two can disagree after a variable is
 * set without a redeploy, so the call count is the assertion — a stub
 * returning a fixed string would prove nothing about which path ran. (Moved
 * from SiteDetailView.test.tsx with the fallback itself.)
 */
jest.mock("@/lib/sites/embed-script", () => {
  const actual = jest.requireActual("@/lib/sites/embed-script");
  return { ...actual, buildEmbedScript: jest.fn(actual.buildEmbedScript) };
});

const mockBuildEmbedScript = buildEmbedScript as jest.MockedFunction<
  typeof buildEmbedScript
>;

/**
 * s66c1 AC 1 / AC 2 — one site record shared by every site subpage (ADR 052).
 *
 * The provider is the only thing that fetches the site for the four routed
 * subpages, so its states are the pages' states: loading, a failed fetch,
 * an id the account does not have, and the site itself.
 */

const mockSites = [
  {
    id: "site-1",
    domain: "example1.com",
    name: "Example Site 1",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T00:00:00Z",
    status: "live",
    siteToken: "token-1",
    embedScript: '<script data-site-token="token-1"></script>',
    stats: { edits_count: 10, views: 0, content_elements_count: 5 },
  },
  {
    id: "site-2",
    domain: "example2.com",
    name: "Example Site 2",
    created_at: "2024-01-02T00:00:00Z",
    updated_at: "2024-01-16T00:00:00Z",
    status: "awaiting-install",
    siteToken: "token-2",
    embedScript: '<script data-site-token="token-2"></script>',
    stats: { edits_count: 5, views: 0, content_elements_count: 3 },
  },
  {
    id: "site-3",
    domain: "example3.com",
    name: "Example Site 3",
    created_at: "2024-01-03T00:00:00Z",
    updated_at: "2024-01-17T00:00:00Z",
    status: "stale",
    stats: { edits_count: 0, views: 0, content_elements_count: 0 },
  },
];

function Probe() {
  const { site, isAdmin } = useSiteContext();
  return (
    <div data-testid="probe" data-admin={String(isAdmin)}>
      {site.name}
    </div>
  );
}

function renderSite(siteId: string) {
  return render(
    <SiteProvider siteId={siteId}>
      <Probe />
    </SiteProvider>,
  );
}

function respondWithSites(sites: unknown[]) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ sites }),
  });
}

const fetchCalls = () => (global.fetch as jest.Mock).mock.calls.length;

describe("SiteProvider", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    respondWithSites(mockSites);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("gives its pages the site the URL names, from GET /api/sites", async () => {
    renderSite("site-2");

    expect(await screen.findByTestId("probe")).toHaveTextContent(
      "Example Site 2",
    );
    expect(global.fetch).toHaveBeenCalledWith("/api/sites");
  });

  it("frames its loading state in a PageShell, with a skeleton", () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderSite("site-1");

    expect(
      screen.getByRole("heading", { level: 1, name: "Loading site…" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: /loading site/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  /**
   * GET /api/sites filters `site_permissions` by the session user, so an id
   * missing from it is a site this account cannot see. The page must say so
   * and show nothing else from the response.
   */
  it("renders Site not found for an id the account does not have, and no other site", async () => {
    renderSite("someone-elses-site");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Site not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to sites/i }),
    ).toHaveAttribute("href", "/dashboard/sites");
    for (const site of mockSites) {
      expect(screen.queryByText(site.name)).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  it("renders a failed fetch as an error with Try again, never as not found", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Failed to fetch sites" }),
    });

    renderSite("site-1");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Could not load this site",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to fetch sites",
    );
    expect(screen.queryByText("Site not found")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("probe")).toHaveTextContent(
      "Example Site 1",
    );
    expect(fetchCalls()).toBe(2);
  });

  // `GET /api/sites` mints install credentials for admins only — the route's
  // own admin test (src/app/api/sites/route.ts, `canInstall`). A site token in
  // the response is therefore exactly "this user is an admin of this site".
  it.each([
    ["site-1", "true"],
    ["site-3", "false"],
  ])(
    "reports %s as admin=%s, from the install credentials",
    async (id, admin) => {
      renderSite(id);

      expect(await screen.findByTestId("probe")).toHaveAttribute(
        "data-admin",
        admin,
      );
    },
  );

  it("refuses to be read outside a SiteProvider", () => {
    expect(() => render(<Probe />)).toThrow(/SiteProvider/);
  });

  /**
   * AC 3 of s02, moved here from the Sites page with s66c1 — "the dashboard
   * reflects the flip within 10 seconds while the page stays open, with no
   * manual refresh".
   *
   * The moment this exists for is the owner pasting the snippet into another
   * tab and coming back. Watching a card that says "awaiting install" while
   * their script is already reporting is the whole failure this story removes,
   * and telling them to hit reload is not an answer — they do not know whether
   * anything changed.
   *
   * Polling stops the instant it has nothing to watch for. A site that is live
   * or stale is not going to flip while they look at it, and an unbounded timer
   * on an open dashboard tab is a request every few seconds, forever.
   */
  describe("waiting for the install to be detected", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const openSite = async (siteId: string) => {
      const view = renderSite(siteId);
      await screen.findByTestId("probe");
      return view;
    };

    it("keeps checking while an awaiting-install site is open", async () => {
      await openSite("site-2");
      const callsAfterOpen = (global.fetch as jest.Mock).mock.calls.length;

      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });

      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(
        callsAfterOpen,
      );
    });

    it("stops checking once the site reports itself live", async () => {
      await openSite("site-2");

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          sites: mockSites.map((site) =>
            site.id === "site-2" ? { ...site, status: "live" } : site,
          ),
        }),
      });

      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
      const callsAfterFlip = (global.fetch as jest.Mock).mock.calls.length;

      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });

      expect((global.fetch as jest.Mock).mock.calls.length).toBe(
        callsAfterFlip,
      );
    });

    it("does not poll for a site that is already live", async () => {
      await openSite("site-1");
      const callsAfterOpen = (global.fetch as jest.Mock).mock.calls.length;

      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });

      expect((global.fetch as jest.Mock).mock.calls.length).toBe(
        callsAfterOpen,
      );
    });

    // Replaces "stops checking when the owner goes back to the list": the
    // list no longer holds the site, so leaving the site is the provider
    // unmounting.
    it("stops checking when the owner leaves the site", async () => {
      const view = await openSite("site-2");

      view.unmount();
      const callsAfterClose = (global.fetch as jest.Mock).mock.calls.length;

      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });

      expect((global.fetch as jest.Mock).mock.calls.length).toBe(
        callsAfterClose,
      );
    });
  });
});

/**
 * s66c1 AC 2 — the install credentials, moved out of SiteDetailView with
 * their guards (SiteDetailView.test.tsx:298-516, assertions unchanged where
 * they were about the credentials; the copy-button and checklist assertions
 * moved to the Install and Overview page tests, which now own those
 * controls).
 *
 * The probe is any consumer: it prints the token and the snippet the provider
 * says are current, and offers regeneration only when there are credentials,
 * the way the Install page does.
 */
function CredentialProbe() {
  const { site, credentials, regenerateSnippet, regeneration, refetch } =
    useSiteContext();
  return (
    <div data-testid="credential-probe">
      <p>{site.name}</p>
      {credentials.siteToken && <code>{credentials.siteToken}</code>}
      {credentials.embedScript && <code>{credentials.embedScript}</code>}
      {regeneration.error && <p role="alert">{regeneration.error}</p>}
      {credentials.siteToken && (
        <button
          type="button"
          disabled={regeneration.isPending}
          onClick={() => void regenerateSnippet()}
        >
          Regenerate snippet
        </button>
      )}
      <button type="button" onClick={() => void refetch()}>
        Refresh site
      </button>
    </div>
  );
}

describe("SiteProvider credentials", () => {
  const admin = mockSites[0];
  const viewer = mockSites[2];

  function respond({
    sites = mockSites as unknown[],
    regenerate,
  }: {
    sites?: unknown[] | (() => unknown[]);
    regenerate?: () => Promise<Response> | Response;
  } = {}) {
    (global.fetch as jest.Mock).mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/regenerate-snippet")) {
          if (!regenerate) throw new Error("unexpected regeneration");
          return regenerate();
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sites: typeof sites === "function" ? sites() : sites,
          }),
        } as Response;
      },
    );
  }

  const renderProbe = (siteId = admin.id) =>
    render(
      <SiteProvider siteId={siteId}>
        <CredentialProbe />
      </SiteProvider>,
    );

  const sitesCalls = () =>
    (global.fetch as jest.Mock).mock.calls.filter(
      ([input]) => String(input) === "/api/sites",
    ).length;

  beforeEach(() => {
    global.fetch = jest.fn();
    mockBuildEmbedScript.mockClear();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the snippet the API supplied without rebuilding it", async () => {
    respond();
    renderProbe();

    expect(await screen.findByText(admin.embedScript!)).toBeInTheDocument();
    expect(mockBuildEmbedScript).not.toHaveBeenCalled();
  });

  it("builds one itself only when the API supplied a token but no snippet", async () => {
    respond({
      sites: [{ ...admin, embedScript: undefined }],
    });
    renderProbe();

    await screen.findByText(admin.siteToken!);
    expect(mockBuildEmbedScript).toHaveBeenCalledWith({
      siteId: admin.id,
      siteToken: admin.siteToken,
    });
    const built = mockBuildEmbedScript.mock.results[0].value as string;
    expect(screen.getByText(built)).toBeInTheDocument();
  });

  // The placeholder snippet the detail view used to build for a member with
  // no credentials (`YOUR_SITE_TOKEN`) is gone (s66c1 AC 5).
  it("gives a member without install credentials no credentials at all", async () => {
    respond();
    renderProbe(viewer.id);

    await screen.findByText(viewer.name);
    expect(screen.queryByText(/data-site-token/)).not.toBeInTheDocument();
    expect(mockBuildEmbedScript).not.toHaveBeenCalled();
  });

  it("replaces every displayed credential after a rotation, then refetches the site", async () => {
    const newToken = "new-site-token-456";
    const newScript =
      '<script src="http://localhost:3000/embed/recopyfast.js" data-site-token="new-site-token-456"></script>';
    respond({
      regenerate: () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            siteToken: newToken,
            embedScript: newScript,
          }),
        }) as Response,
    });

    renderProbe();
    await screen.findByText(admin.siteToken!);
    const callsBeforeRotation = sitesCalls();
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );

    expect(await screen.findByText(newToken)).toBeInTheDocument();
    expect(screen.getAllByText(newScript).length).toBeGreaterThan(0);
    expect(screen.queryByText(admin.siteToken!)).not.toBeInTheDocument();
    expect(screen.queryByText(admin.embedScript!)).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/sites/${admin.id}/regenerate-snippet`,
      { method: "POST" },
    );
    await waitFor(() => expect(sitesCalls()).toBe(callsBeforeRotation + 1));
  });

  it("keeps a same-site rotation through a stale refresh", async () => {
    const newToken = "rotated-token";
    const newScript = '<script data-site-token="rotated-token"></script>';
    // The list keeps answering with the pre-rotation token: the refetch after
    // the rotation, and any refresh after it, are stale.
    respond({
      regenerate: () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            siteToken: newToken,
            embedScript: newScript,
          }),
        }) as Response,
    });

    renderProbe();
    await screen.findByText(admin.siteToken!);
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );
    expect(await screen.findByText(newToken)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh site" }));
    });
    expect(screen.getByText(newToken)).toBeInTheDocument();
    expect(screen.queryByText(admin.siteToken!)).not.toBeInTheDocument();
  });

  // Renamed in the s66c1 review (m2): its assertions run after the effects
  // have flushed, so it cannot tell "in the same render" from "one render
  // later". The commit-level proof is "clears the credentials in the very
  // commit that loses install access" below.
  it("clears same-site credentials after permission loss and ignores a late rotation", async () => {
    let resolveRegeneration!: (response: Response) => void;
    const pendingRegeneration = new Promise<Response>((resolve) => {
      resolveRegeneration = resolve;
    });
    let hasLostAccess = false;
    respond({
      sites: () =>
        hasLostAccess
          ? mockSites.map((site) =>
              site.id === admin.id
                ? { ...site, siteToken: undefined, embedScript: undefined }
                : site,
            )
          : mockSites,
      regenerate: () => pendingRegeneration,
    });

    renderProbe();
    await screen.findByText(admin.siteToken!);
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );

    hasLostAccess = true;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh site" }));
    });

    expect(screen.queryByText(admin.siteToken!)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /regenerate snippet/i }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveRegeneration({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          siteToken: "late-rotated-token",
          embedScript: '<script data-site-token="late-rotated-token"></script>',
        }),
      } as Response);
      await pendingRegeneration;
    });

    await waitFor(() => {
      expect(screen.queryByText("late-rotated-token")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /regenerate snippet/i }),
      ).not.toBeInTheDocument();
    });
  });

  /**
   * s66c1 review m2 — the first-render guard (`displayedCredentials`), proved
   * at commit time. Every other test reads the screen after React has run the
   * scope's effects, by which point the effect has already put the right
   * credentials in state; removing the guard left them all green. This log is
   * written in a layout effect, which runs on each commit before any passive
   * effect, so it records exactly what reached the screen in the render that
   * changed the record.
   */
  interface CommittedCredentials {
    siteId: string;
    recordToken?: string;
    shownToken?: string;
    shownSnippet?: string;
  }

  function CommitLog({ log }: { log: CommittedCredentials[] }) {
    const { site, credentials } = useSiteContext();
    useLayoutEffect(() => {
      log.push({
        siteId: site.id,
        recordToken: site.siteToken,
        shownToken: credentials.siteToken,
        shownSnippet: credentials.embedScript,
      });
    });
    return null;
  }

  const showsToken = (entry: CommittedCredentials, token: string) =>
    entry.shownToken === token || Boolean(entry.shownSnippet?.includes(token));

  it("clears the credentials in the very commit that loses install access", async () => {
    let hasLostAccess = false;
    respond({
      sites: () =>
        hasLostAccess
          ? mockSites.map((site) =>
              site.id === admin.id
                ? { ...site, siteToken: undefined, embedScript: undefined }
                : site,
            )
          : mockSites,
    });
    const log: CommittedCredentials[] = [];
    render(
      <SiteProvider siteId={admin.id}>
        <CommitLog log={log} />
        <CredentialProbe />
      </SiteProvider>,
    );
    await screen.findByText(admin.siteToken!);

    hasLostAccess = true;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh site" }));
    });

    const afterLoss = log.filter((entry) => entry.recordToken === undefined);
    expect(afterLoss.length).toBeGreaterThan(0);
    expect(
      afterLoss.filter((entry) => showsToken(entry, admin.siteToken!)),
    ).toEqual([]);
  });

  // The layout's `key` remounts the provider on a site change; this is the
  // guard for the day the router keeps it mounted (ADR 052 "Watch"), so the
  // provider is re-rendered here without a key.
  it("never commits the site it left's credentials under another site, even kept mounted", async () => {
    const other = mockSites[1];
    respond();
    const log: CommittedCredentials[] = [];
    const view = render(
      <SiteProvider siteId={admin.id}>
        <CommitLog log={log} />
      </SiteProvider>,
    );
    await waitFor(() =>
      expect(log.some((entry) => showsToken(entry, admin.siteToken!))).toBe(
        true,
      ),
    );

    view.rerender(
      <SiteProvider siteId={other.id}>
        <CommitLog log={log} />
      </SiteProvider>,
    );
    await waitFor(() =>
      expect(log[log.length - 1].shownToken).toBe(other.siteToken),
    );

    const forOther = log.filter((entry) => entry.siteId === other.id);
    expect(forOther.length).toBeGreaterThan(0);
    expect(
      forOther.filter((entry) => showsToken(entry, admin.siteToken!)),
    ).toEqual([]);
  });

  /**
   * s66c1 review m3 — the late-rotation check in `regenerateSnippet`. A
   * rotation requested on one site and answered after the owner moved to
   * another (provider kept mounted, as above) belongs to the first site only.
   * Nothing else catches it: by then the scope has adopted the new site, and
   * the first-render guard trusts its state for that site.
   */
  it("ignores a rotation that answers after the site changed", async () => {
    const other = mockSites[1];
    let resolveRegeneration!: (response: Response) => void;
    const pendingRegeneration = new Promise<Response>((resolve) => {
      resolveRegeneration = resolve;
    });
    respond({ regenerate: () => pendingRegeneration });

    const view = render(
      <SiteProvider siteId={admin.id}>
        <CredentialProbe />
      </SiteProvider>,
    );
    await screen.findByText(admin.siteToken!);
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );

    view.rerender(
      <SiteProvider siteId={other.id}>
        <CredentialProbe />
      </SiteProvider>,
    );
    expect(await screen.findByText(other.siteToken!)).toBeInTheDocument();

    await act(async () => {
      resolveRegeneration({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          siteToken: "late-token-for-the-first-site",
          embedScript:
            '<script data-site-token="late-token-for-the-first-site"></script>',
        }),
      } as Response);
      await pendingRegeneration;
    });
    // The rotation has been handled once the button is offered again.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /regenerate snippet/i }),
      ).toBeEnabled(),
    );

    expect(
      screen.queryByText(/late-token-for-the-first-site/),
    ).not.toBeInTheDocument();
    expect(screen.getByText(other.siteToken!)).toBeInTheDocument();
    expect(screen.getByText(other.embedScript!)).toBeInTheDocument();
  });

  it("keeps the current credentials visible when regeneration fails", async () => {
    respond({
      regenerate: () =>
        ({
          ok: false,
          status: 500,
          json: async () => ({ error: "Failed to regenerate snippet" }),
        }) as Response,
    });

    renderProbe();
    await screen.findByText(admin.siteToken!);
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );

    expect(
      await screen.findByText(/failed to regenerate snippet/i),
    ).toBeInTheDocument();
    expect(screen.getByText(admin.siteToken!)).toBeInTheDocument();
    expect(screen.getAllByText(admin.embedScript!).length).toBeGreaterThan(0);
  });

  it("does not offer regeneration without install credentials", async () => {
    respond();
    renderProbe(viewer.id);

    await screen.findByText(viewer.name);
    expect(
      screen.queryByRole("button", { name: /regenerate snippet/i }),
    ).not.toBeInTheDocument();
  });

  /**
   * ADR 052, "Watch": if the router ever keeps the provider mounted across a
   * `siteId` change, the layout's `key` is the guard. Re-rendering the layout
   * with another site must remount the provider, so not one render shows the
   * first site's token under the second site's id.
   */
  it("shows none of the first site's token in the render that switches sites", async () => {
    respond();
    const layoutFor = (siteId: string) =>
      SiteLayout({
        params: Promise.resolve({ siteId }),
        children: <CredentialProbe />,
      });

    const view = render(await layoutFor(admin.id));
    expect(await screen.findByText(admin.siteToken!)).toBeInTheDocument();

    view.rerender(await layoutFor(viewer.id));

    // The same render: no effect has run and no fetch has answered yet.
    expect(screen.queryByText(admin.siteToken!)).not.toBeInTheDocument();
    expect(screen.queryByText(admin.embedScript!)).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: /loading site/i }),
    ).toBeInTheDocument();

    expect(await screen.findByText(viewer.name)).toBeInTheDocument();
    expect(screen.queryByText(admin.siteToken!)).not.toBeInTheDocument();
  });
});
