import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { SiteDetailView } from "../SiteDetailView";
import { buildEmbedScript } from "@/lib/sites/embed-script";
import type { Site } from "@/types";

// Mock date-fns
jest.mock("date-fns", () => ({
  formatDistanceToNow: jest.fn(() => "5 hours ago"),
}));

/**
 * The real builder, watched. s07b task 5 turns on *which* of the two snippet
 * sources this screen uses: `site.embedScript` comes from `GET /api/sites`,
 * which reads `NEXT_PUBLIC_WS_URL` at request time, while the
 * `buildEmbedScript` fallback below runs in the browser, where Next.js has
 * already inlined that value at build time. The two can disagree after a
 * variable is set without a redeploy, so the call count is the assertion —
 * a stub returning a fixed string would prove nothing about which path ran.
 */
jest.mock("@/lib/sites/embed-script", () => {
  const actual = jest.requireActual("@/lib/sites/embed-script");
  return { ...actual, buildEmbedScript: jest.fn(actual.buildEmbedScript) };
});
jest.mock("../ActivationChecklist", () => ({
  ActivationChecklist: (props: {
    siteId: string;
    embedScript: string;
    userId: string;
  }) => (
    <div
      data-testid="activation-checklist"
      data-site-id={props.siteId}
      data-user-id={props.userId}
      data-snippet={props.embedScript}
    />
  ),
}));

const mockBuildEmbedScript = buildEmbedScript as jest.MockedFunction<
  typeof buildEmbedScript
>;

describe("SiteDetailView", () => {
  const mockSite: Site & {
    stats?: {
      edits_count?: number;
      views?: number;
      content_elements_count?: number;
      last_activity?: string;
    };
    status?: "awaiting-install" | "live" | "stale";
    live_at?: string | null;
    last_reported_at?: string | null;
    last_mismatch_domain?: string | null;
    embedScript?: string;
    siteToken?: string;
  } = {
    id: "test-site-id",
    domain: "example.com",
    name: "Example Site",
    api_key: "test-api-key",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T00:00:00Z",
    status: "live",
    live_at: "2026-08-01T00:00:00Z",
    last_reported_at: "2026-08-16T00:00:00Z",
    stats: {
      edits_count: 42,
      views: 1337,
      content_elements_count: 15,
      last_activity: "2024-01-15T00:00:00Z",
    },
    embedScript:
      '<script src="http://localhost:3000/embed/recopyfast.js"></script>',
    siteToken: "test-site-token-123",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // SiteEditorsCard and the domain ownership panel both fetch on mount.
    // Without a stub they reject into their own catch blocks and every test in
    // the file renders an error state it did not ask for.
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      const body = url.includes("/api/domains/verify")
        ? { verifications: [], canManage: true }
        : {};
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as unknown as typeof fetch;
  });

  it("renders site information correctly", () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText("Example Site")).toBeInTheDocument();
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  /**
   * REWRITTEN with s02. The header used to carry a status pill and a "Status"
   * paragraph beside a separate "Integration Status" card — three readings of
   * one `content_elements` count, worded three ways. The install state now has
   * exactly one home on this screen.
   */
  it("shows the install state once, in the installation card", () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText("Installation")).toBeInTheDocument();
    expect(screen.getAllByText("Live")).toHaveLength(1);
    expect(screen.queryByText("Integration Status")).not.toBeInTheDocument();
  });

  it("renders all quick stats correctly", () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText("42")).toBeInTheDocument(); // edits_count
    expect(screen.getByText("1337")).toBeInTheDocument(); // views
    expect(screen.getByText("15")).toBeInTheDocument(); // content_elements_count
  });

  it("displays created and updated timestamps", () => {
    render(<SiteDetailView site={mockSite} />);

    // Both dates should show "5 hours ago" due to our mock
    const timeElements = screen.getAllByText("5 hours ago");
    expect(timeElements.length).toBeGreaterThan(0);
  });

  it("renders embed script section", () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText("Embed Script")).toBeInTheDocument();
    expect(
      screen.getByText(/Add this script to your website/i),
    ).toBeInTheDocument();
  });

  /**
   * s07b task 5. The dashboard is a *consumer* of the snippet: whatever
   * `GET /api/sites` returned is what an owner copies. The fallback at
   * `SiteDetailView.tsx:93-98` exists for the case where it returned none, and
   * it is the one path on this screen that reads a build-time
   * `NEXT_PUBLIC_WS_URL` rather than the serving runtime's. It must therefore
   * stay unreachable whenever the API did supply a snippet — otherwise the
   * screen would show a `data-ws-url` from the build while the API hands out
   * one from the runtime, and the two look right on their own.
   */
  it("renders the snippet the API supplied without rebuilding it", () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getAllByText(mockSite.embedScript!).length).toBeGreaterThan(
      0,
    );
    expect(mockBuildEmbedScript).not.toHaveBeenCalled();
  });

  it("builds one itself only when the API supplied none", () => {
    const siteWithoutScript = { ...mockSite };
    delete siteWithoutScript.embedScript;

    render(<SiteDetailView site={siteWithoutScript} />);

    expect(mockBuildEmbedScript).toHaveBeenCalledWith({
      siteId: mockSite.id,
      siteToken: mockSite.siteToken,
    });

    const built = mockBuildEmbedScript.mock.results[0].value as string;
    expect(screen.getAllByText(built).length).toBeGreaterThan(0);
  });

  it("copies embed script to clipboard", async () => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });

    render(<SiteDetailView site={mockSite} />);

    const copyButton = screen.getByText("Copy Embed Script");
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        mockSite.embedScript,
      );
    });

    // Check for "Copied!" confirmation
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });
  });

  it("renders site token section when token is present", () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText("Site Token")).toBeInTheDocument();
    expect(screen.getByText("test-site-token-123")).toBeInTheDocument();
    expect(
      screen.getByText(/visible in your page's HTML by design/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Site Token").parentElement).toHaveTextContent(
      /requesting page's origin/i,
    );
    expect(
      screen.getByText(/Regenerate snippet revokes old snippets/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/never expose it publicly/i),
    ).not.toBeInTheDocument();
  });

  it("shows activation only to an admin with current install credentials", () => {
    render(<SiteDetailView site={mockSite} userId="user-1" />);

    const checklist = screen.getByTestId("activation-checklist");
    expect(checklist).toHaveAttribute("data-site-id", mockSite.id);
    expect(checklist).toHaveAttribute("data-user-id", "user-1");
    expect(checklist).toHaveAttribute("data-snippet", mockSite.embedScript);
  });

  it("hides activation from a non-admin without install credentials", () => {
    render(
      <SiteDetailView
        site={{ ...mockSite, siteToken: undefined, embedScript: undefined }}
        userId="user-1"
      />,
    );

    expect(
      screen.queryByTestId("activation-checklist"),
    ).not.toBeInTheDocument();
  });

  it("copies site token to clipboard", async () => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });

    render(<SiteDetailView site={mockSite} />);

    const copyButton = screen.getByText("Copy Site Token");
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "test-site-token-123",
      );
    });
  });

  it("explains the HTTP and existing WebSocket revocation timing", async () => {
    render(<SiteDetailView site={mockSite} />);

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
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("regenerate-snippet"),
      expect.anything(),
    );
  });

  it("replaces every displayed credential and copies the regenerated values", async () => {
    const newToken = "new-site-token-456";
    const newScript =
      '<script src="http://localhost:3000/embed/recopyfast.js" data-site-token="new-site-token-456"></script>';
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
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
        json: async () =>
          url.includes("/api/domains/verify")
            ? { verifications: [], canManage: true }
            : {},
      } as Response;
    });
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });

    render(<SiteDetailView site={mockSite} userId="user-1" />);
    fireEvent.click(screen.getByRole("button", { name: /copy embed script/i }));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /regenerate now/i }),
    );

    expect(await screen.findByText(newToken)).toBeInTheDocument();
    expect(screen.getAllByText(newScript).length).toBeGreaterThan(0);
    expect(screen.getByTestId("activation-checklist")).toHaveAttribute(
      "data-snippet",
      newScript,
    );
    expect(screen.queryByText(mockSite.siteToken!)).not.toBeInTheDocument();
    expect(screen.queryByText(mockSite.embedScript!)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy embed script/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /copy embed script/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(newScript);
    });

    fireEvent.click(screen.getByRole("button", { name: /copy site token/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(newToken);
    });

    fireEvent.click(
      screen.getByRole("button", { name: /view install snippet/i }),
    );
    expect(screen.getAllByText(newScript).length).toBeGreaterThan(1);
  });

  it("keeps a same-site rotation through stale props and clears it when the selected site changes", async () => {
    const newToken = "rotated-token";
    const newScript = '<script data-site-token="rotated-token"></script>';
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.includes("/regenerate-snippet")
            ? { ok: true, siteToken: newToken, embedScript: newScript }
            : url.includes("/api/domains/verify")
              ? { verifications: [], canManage: true }
              : {},
      } as Response;
    });

    const { rerender } = render(<SiteDetailView site={mockSite} />);
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /regenerate now/i }),
    );
    expect(await screen.findByText(newToken)).toBeInTheDocument();

    rerender(<SiteDetailView site={{ ...mockSite }} />);
    expect(screen.getByText(newToken)).toBeInTheDocument();
    expect(screen.queryByText(mockSite.siteToken!)).not.toBeInTheDocument();

    rerender(
      <SiteDetailView
        site={{
          ...mockSite,
          id: "viewer-site",
          name: "Viewer site",
          domain: "viewer.example.com",
          siteToken: undefined,
          embedScript: undefined,
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText(newToken)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /regenerate snippet/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("immediately clears same-site credentials after permission loss and ignores a late rotation", async () => {
    let resolveRegeneration!: (response: Response) => void;
    const pendingRegeneration = new Promise<Response>((resolve) => {
      resolveRegeneration = resolve;
    });
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/regenerate-snippet")) return pendingRegeneration;
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.includes("/api/domains/verify")
            ? { verifications: [], canManage: true }
            : {},
      } as Response;
    });

    const { rerender } = render(<SiteDetailView site={mockSite} />);
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /regenerate now/i }),
    );

    rerender(
      <SiteDetailView
        site={{ ...mockSite, siteToken: undefined, embedScript: undefined }}
      />,
    );

    expect(screen.queryByText(mockSite.siteToken!)).not.toBeInTheDocument();
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

  it("keeps the current credentials visible when regeneration fails", async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/regenerate-snippet")) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "Failed to regenerate snippet" }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.includes("/api/domains/verify")
            ? { verifications: [], canManage: true }
            : {},
      } as Response;
    });

    render(<SiteDetailView site={mockSite} />);
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate snippet/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /regenerate now/i }),
    );

    expect(
      await screen.findByText(/failed to regenerate snippet/i),
    ).toBeInTheDocument();
    expect(screen.getByText(mockSite.siteToken!)).toBeInTheDocument();
    expect(screen.getAllByText(mockSite.embedScript!).length).toBeGreaterThan(
      0,
    );
  });

  it("does not offer regeneration without install credentials", () => {
    const siteWithoutCredentials = { ...mockSite };
    delete siteWithoutCredentials.siteToken;
    delete siteWithoutCredentials.embedScript;

    render(<SiteDetailView site={siteWithoutCredentials} />);

    expect(
      screen.queryByRole("button", { name: /regenerate snippet/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render site token section when token is missing", () => {
    const siteWithoutToken = { ...mockSite };
    delete siteWithoutToken.siteToken;

    render(<SiteDetailView site={siteWithoutToken} />);

    expect(screen.queryByText("Site Token")).not.toBeInTheDocument();
  });

  /**
   * REWRITTEN with s02. "Integration Status" is gone: its two rows were
   * hardcoded to "Verified"/"Connected" until they were rewired to the same
   * count that drove the header pill, at which point the screen said the same
   * thing three times. The installation card replaces all three.
   */
  it("renders the installation card in place of the integration status rows", () => {
    render(<SiteDetailView site={mockSite} />);

    expect(screen.getByText("Installation")).toBeInTheDocument();
    expect(screen.queryByText("Script Installation")).not.toBeInTheDocument();
    expect(screen.queryByText("API Connection")).not.toBeInTheDocument();
    // "Content Elements" now labels only the stats tile.
    expect(screen.getAllByText("Content Elements")).toHaveLength(1);
  });

  it("displays external link to site", () => {
    render(<SiteDetailView site={mockSite} />);

    // The view also renders a "Manage Tests" link, so select the site link by href.
    const link = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "https://example.com")!;

    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("calls onClose when provided", () => {
    const mockOnClose = jest.fn();
    render(<SiteDetailView site={mockSite} onClose={mockOnClose} />);

    // Test would require a close button in the component
    // For now, just verify the prop is accepted
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  /**
   * REWRITTEN with s02, along with the two `hasReportedContent` message tests
   * it replaces.
   *
   * F-10: two live sites sat on "Verifying" with nothing in the dashboard
   * saying what was being waited on. Nothing was — the embed script is admitted
   * by its signed site token and its origin, and `domain_verifications` is
   * never consulted on that path. The old answer was a paragraph of reassurance
   * under a pill that still said the wrong thing. The answer now is that the
   * state itself names what is true, and says what to do about it.
   */
  it("handles different status types correctly", () => {
    const { rerender } = render(
      <SiteDetailView site={{ ...mockSite, status: "awaiting-install" }} />,
    );
    expect(screen.getByText("Awaiting install")).toBeInTheDocument();
    expect(screen.getByText(/no refresh needed/i)).toBeInTheDocument();

    rerender(<SiteDetailView site={{ ...mockSite, status: "stale" }} />);
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(
      screen.getByText(/keeps working and stays editable/i),
    ).toBeInTheDocument();
  });

  it("tells an owner with no recorded content exactly where the snippet goes", () => {
    render(
      <SiteDetailView
        site={{
          ...mockSite,
          status: "awaiting-install",
          stats: { ...mockSite.stats, content_elements_count: 0 },
        }}
      />,
    );

    expect(screen.getByRole("tab", { name: "WordPress" })).toBeInTheDocument();
    expect(screen.getByText(/footer\.php/i)).toBeInTheDocument();
  });

  it("does not ask for an install once the site has reported", () => {
    render(<SiteDetailView site={mockSite} />);

    expect(
      screen.queryByText(/add this snippet to your site/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/editing is on/i)).toBeInTheDocument();
  });

  /**
   * The component and the `domain_verifications` table shipped together and the
   * component was mounted nowhere, so the only trace of the feature an owner
   * could find was a status pill implying it was already running.
   */
  it("mounts the domain ownership panel with the site's own domain", async () => {
    render(<SiteDetailView site={mockSite} />);

    expect(await screen.findByText("Domain ownership")).toBeInTheDocument();
    expect(
      screen.getByText(/Your embed script does not wait on this/i),
    ).toBeInTheDocument();
  });

  /**
   * Same class of defect as the domain panel above: the webhook config API,
   * the delivery engine and its tables all existed while nothing in the
   * dashboard rendered any of them, so the feature was unreachable by an owner.
   */
  it("mounts the webhooks panel for this site", async () => {
    render(<SiteDetailView site={mockSite} />);

    expect(await screen.findByText("Webhooks")).toBeInTheDocument();
    expect(
      screen.getByText(/Call an endpoint on your build system/i),
    ).toBeInTheDocument();
  });

  /**
   * Same defect class as the domain ownership panel above: `BulkOperations`
   * and its three API routes shipped together and the component was imported
   * by nothing, so an owner had no way to export their own content — the one
   * feature that answers "what happens to my copy if I leave". It lives at the
   * foot of the site page, next to the version history it writes to.
   */
  it("mounts the content portability card at the foot of the page", async () => {
    render(<SiteDetailView site={mockSite} />);

    const portability = await screen.findByText("Content portability");
    const domainOwnership = screen.getByText("Domain ownership");

    expect(
      domainOwnership.compareDocumentPosition(portability) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("handles missing stats gracefully", () => {
    const siteWithoutStats = { ...mockSite };
    delete siteWithoutStats.stats;

    render(<SiteDetailView site={siteWithoutStats} />);

    // Should display 0 for missing stats
    const zeroElements = screen.getAllByText("0");
    expect(zeroElements.length).toBeGreaterThan(0);
  });
});
