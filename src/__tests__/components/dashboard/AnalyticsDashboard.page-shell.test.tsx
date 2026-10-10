/**
 * @jest-environment jsdom
 *
 * s66b1 AC 3 — Analytics has a title, in every state.
 *
 * It was the only app page with no h1: an h2 "Analytics Dashboard" shown in
 * the ready state only, and before that the route returned a bare spinner
 * while the site list loaded, so the page had no title at all for its first
 * request. `AnalyticsDashboard` is now the page's delegate: one `PageShell`,
 * titled "Analytics" like the sidebar and the breadcrumb, around a body that
 * switches on loading, load error, no data and ready. The exports are header
 * actions, and the filters are one labelled group that wraps.
 *
 * The layout harness sees only the ready state; the per-state count is here.
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalyticsDashboard } from "@/components/dashboard/AnalyticsDashboard";
import type { AnalyticsDashboardData, Site } from "@/types";

const SITES: Site[] = [
  {
    id: "site-a",
    domain: "acme.example",
    name: "Acme",
    api_key: "fixture-key",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  },
];

const SERIES = [
  { date: "2026-10-07", value: 3 },
  { date: "2026-10-08", value: 5 },
];

const READY: AnalyticsDashboardData = {
  overview: {
    total_sites: 1,
    total_users: 2,
    total_page_views: 40,
    total_edits: 6,
    avg_load_time: 120,
    conversion_rate: 0.1,
  },
  trends: { page_views: SERIES, edits: SERIES, users: SERIES },
  top_sites: [
    { site_id: "site-a", domain: "acme.example", page_views: 40, edits: 6 },
  ],
  performance: { avg_load_time: 120, avg_edit_time: 300, error_rate: 0.01 },
};

function mockAnalytics(respond: () => Promise<Response>): void {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/analytics/track")) return respond();
    throw new Error(`unexpected request: ${url}`);
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

function expectOneAnalyticsTitle(): HTMLElement {
  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveAccessibleName("Analytics");
  const header = headings[0].closest<HTMLElement>("[data-page-header]");
  expect(header).not.toBeNull();
  return header as HTMLElement;
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("AnalyticsDashboard frame", () => {
  it("renders one h1 while the analytics load", () => {
    mockAnalytics(() => new Promise<Response>(() => {}));
    render(<AnalyticsDashboard sites={SITES} />);

    expectOneAnalyticsTitle();
  });

  // The route no longer returns its own titleless spinner while it fetches
  // the site list; it hands that state down instead.
  //
  // The analytics request settles first here, on purpose. Asserted straight
  // after render, the skeleton is there anyway (the analytics are loading
  // too), so the test passed with `|| isLoadingSites` deleted (s66b1 review
  // m-3). Only once the analytics are in does the skeleton prove the sites
  // are what holds it.
  it("renders one h1 and keeps the skeleton while the page is still loading its sites", async () => {
    let respond: (response: Response) => void = () => {};
    mockAnalytics(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    let markBodyRead: () => void = () => {};
    const bodyRead = new Promise<void>((resolve) => {
      markBodyRead = resolve;
    });
    const response = {
      ok: true,
      status: 200,
      json: async () => {
        markBodyRead();
        return READY;
      },
    } as unknown as Response;

    const { rerender } = render(
      <AnalyticsDashboard sites={[]} isLoadingSites />,
    );
    expectOneAnalyticsTitle();

    await act(async () => {
      respond(response);
      await bodyRead;
      // Let the component's continuation after `response.json()` run.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("status", { name: "Loading analytics" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Total Sites")).toBeNull();
    expectOneAnalyticsTitle();

    // Control: the data really had arrived. Once the sites are in, it shows
    // at once, with no second request, so the skeleton above was held by
    // `isLoadingSites` alone.
    rerender(<AnalyticsDashboard sites={SITES} />);
    expect(screen.getByText("Total Sites")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("renders one h1 when the analytics cannot be loaded", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockAnalytics(() => json({ error: "Forbidden" }, 403));
    render(<AnalyticsDashboard sites={SITES} />);

    expect(
      await screen.findByText("Couldn't load analytics"),
    ).toBeInTheDocument();
    expectOneAnalyticsTitle();
  });

  it("renders one h1 when there is no analytics data", async () => {
    mockAnalytics(() => json(null));
    render(<AnalyticsDashboard sites={SITES} />);

    expect(await screen.findByText("No analytics data")).toBeInTheDocument();
    expectOneAnalyticsTitle();
  });

  // The exports are header actions now, so they exist in every state. Their
  // failure notice used to live in the ready body only; from any other state
  // a failed export would have said nothing at all.
  it("reports a failed export outside the ready state too", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/analytics/track")) return json(null);
      if (url.startsWith("/api/analytics/export")) {
        return json({ error: "Export is unavailable" }, 503);
      }
      throw new Error(`unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    render(<AnalyticsDashboard sites={SITES} />);

    expect(await screen.findByText("No analytics data")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /JSON/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Export is unavailable",
    );
  });

  it("puts the exports in the header and the filters in one named group when ready", async () => {
    mockAnalytics(() => json(READY));
    render(<AnalyticsDashboard sites={SITES} />);

    expect(await screen.findByText("Total Sites")).toBeInTheDocument();
    const header = expectOneAnalyticsTitle();

    expect(
      within(header).getByRole("button", { name: /JSON/ }),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: /CSV/ }),
    ).toBeInTheDocument();

    const filters = screen.getByRole("group", { name: "Analytics filters" });
    expect(
      within(filters).getByLabelText("Filter by site"),
    ).toBeInTheDocument();
    expect(within(filters).getByLabelText("Start date")).toBeInTheDocument();
    expect(within(filters).getByLabelText("End date")).toBeInTheDocument();
  });
});
