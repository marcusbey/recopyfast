/**
 * @jest-environment jsdom
 *
 * s119 (ADR 075) — the Changes page tells a developer that their deploy is
 * masked by an override, and lets a site admin decide.
 *
 * The scenario: the page said "5 to 10", the client published "5 to 11", the
 * developer deployed "5 to 9". Visitors still see "5 to 11". Pinned here,
 * against the list route's contract and the resolution route with `fetch`
 * answered by a small server that remembers the resolution:
 * - the row says "Source changed since this edit", and its detail shows what
 *   the edit was written against, what the page says now and what visitors see;
 * - Keep override and Use new source each ask first (as Revert does), send the
 *   observed text they showed, and the page reads the row again afterwards;
 * - a newer observation (409) closes the dialog on the re-read row, with the
 *   server's words under its actions;
 * - only a site admin is offered the two actions.
 */

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangesView } from "../ChangesView";

const ACME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NORTHWIND = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROW_ID = "11111111-1111-4111-8111-111111111111";
const DETECTED = "2026-10-22T10:00:00.123456+00:00";

type Row = Record<string, unknown> & { id: string; siteId: string };

function pricingRow(overrides: Record<string, unknown> = {}): Row {
  return {
    id: ROW_ID,
    siteId: ACME,
    elementId: "pricing-range",
    pagePath: "/pricing",
    elementType: "p",
    selector: "#pricing > p",
    language: "en",
    variant: "default",
    original: "5 to 10",
    live: "5 to 11",
    draft: null,
    draftAttributes: [],
    hasLiveText: true,
    state: "published",
    changedAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.123456+00:00",
    changedBy: null,
    createdAt: "2026-09-28T09:00:00.000Z",
    sourceDrift: {
      baseline: "5 to 10",
      observed: "5 to 9",
      detectedAt: DETECTED,
    },
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Resolve = (
  body: Record<string, unknown>,
  rows: Row[],
) => { status: number; body: unknown; rows: Row[] };

/** Keep / drop as the RPC does them, when the observation is still current. */
const resolveAsServer: Resolve = (body, rows) => {
  const target = rows.find((row) => row.id === body.contentElementId);
  const drift = target?.sourceDrift as { observed: string } | null | undefined;
  if (!target || !drift) {
    return { status: 404, body: { error: "No open source change" }, rows };
  }
  if (drift.observed !== body.expectedObserved) {
    return {
      status: 409,
      body: { error: "The page changed again since you looked." },
      rows,
    };
  }
  const resolved =
    body.resolution === "keep"
      ? { ...target, sourceDrift: null }
      : {
          ...target,
          original: drift.observed,
          live: drift.observed,
          sourceDrift: null,
          updatedAt: "2026-10-22T11:00:00.000001+00:00",
        };
  return {
    status: 200,
    body: { status: "resolved", resolution: body.resolution },
    rows: rows.map((row) => (row === target ? resolved : row)),
  };
};

let rows: Row[];
let resolve: Resolve;

function mockServer({
  permission = "admin",
  seed = [pricingRow()],
  onResolve = resolveAsServer,
}: {
  permission?: string;
  seed?: Row[];
  onResolve?: Resolve;
} = {}) {
  rows = seed;
  resolve = onResolve;
  const sites = [
    { id: ACME, name: "Acme Studio", domain: "acme.example", permission },
    {
      id: NORTHWIND,
      name: "Northwind Docs",
      domain: "docs.northwind.example",
      permission: "admin",
    },
  ];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = init?.method ?? "GET";
      if (/\/history$/.test(url.pathname)) {
        return json({
          historyVisible: true,
          discoveredAt: "2026-09-28T09:00:00.000Z",
          events: [],
        });
      }
      if (url.pathname === "/api/content/changes") {
        const site = url.searchParams.get("site");
        const element = url.searchParams.get("element");
        const listed = rows.filter(
          (row) =>
            (site === null || row.siteId === site) &&
            (element === null || row.elementId === element),
        );
        return json({
          sites,
          rows: listed,
          total: listed.length,
          counts: { pending: 0, published: listed.length, original: 0 },
          nextOffset: null,
        });
      }
      if (method === "POST" && url.pathname === "/api/content/source-drift") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const answer = resolve(body, rows);
        rows = answer.rows;
        return json(answer.body, answer.status);
      }
      throw new Error(`unexpected request: ${method} ${url.pathname}`);
    },
  ) as unknown as typeof fetch;
}

const resolutionRequests = () =>
  (global.fetch as jest.Mock).mock.calls
    .filter(
      ([input, init]) =>
        String(input).includes("/api/content/source-drift") &&
        (init as RequestInit | undefined)?.method === "POST",
    )
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

async function renderLoaded() {
  const user = userEvent.setup();
  render(<ChangesView />);
  await screen.findByText("5 to 11");
  return user;
}

async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /^Compare and history: / }),
  );
  return screen.getByRole("region", { name: /^Compare and history: / });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("source drift on the Changes page (ADR 075)", () => {
  it("marks the row and shows written against, page now says and visitors see", async () => {
    mockServer();
    const user = await renderLoaded();

    expect(
      screen.getByText("Source changed since this edit"),
    ).toBeInTheDocument();

    const detail = await expand(user);
    const drift = within(detail).getByRole("group", {
      name: "Source changed since this edit",
    });
    expect(within(drift).getByText("Written against")).toBeInTheDocument();
    expect(within(drift).getByText("Page now says")).toBeInTheDocument();
    expect(within(drift).getByText("Visitors see")).toBeInTheDocument();
    expect(within(drift).getByText("5 to 10")).toBeInTheDocument();
    expect(within(drift).getByText("5 to 9")).toBeInTheDocument();
    expect(within(drift).getByText("5 to 11")).toBeInTheDocument();
  });

  it("does not mark a row without an open drift", async () => {
    mockServer({ seed: [pricingRow({ sourceDrift: null })] });
    await renderLoaded();

    expect(
      screen.queryByText("Source changed since this edit"),
    ).not.toBeInTheDocument();
  });

  it("ignores a malformed sourceDrift rather than drawing a guess", async () => {
    mockServer({ seed: [pricingRow({ sourceDrift: { observed: 42 } })] });
    await renderLoaded();

    expect(
      screen.queryByText("Source changed since this edit"),
    ).not.toBeInTheDocument();
  });

  it("Keep override asks first, sends what it showed, and the re-read row is no longer marked", async () => {
    mockServer();
    const user = await renderLoaded();
    const detail = await expand(user);

    await user.click(
      within(detail).getByRole("button", { name: "Keep override" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Keep the override?",
    });
    expect(resolutionRequests()).toEqual([]);
    await user.click(
      within(dialog).getByRole("button", { name: "Keep override" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByText("Source changed since this edit"),
      ).not.toBeInTheDocument(),
    );
    expect(resolutionRequests()).toEqual([
      {
        siteId: ACME,
        contentElementId: ROW_ID,
        resolution: "keep",
        expectedObserved: "5 to 9",
      },
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByText("5 to 11").length).toBeGreaterThan(0);
    expect(
      (await screen.findByText(/^Override kept\./)).closest("[aria-live]"),
    ).toHaveAttribute("aria-live", "polite");
  });

  it("Use new source puts the deployed text live after the re-read", async () => {
    mockServer();
    const user = await renderLoaded();
    const detail = await expand(user);

    await user.click(
      within(detail).getByRole("button", { name: "Use new source" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Use the new source?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Use new source" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByText("Source changed since this edit"),
      ).not.toBeInTheDocument(),
    );
    expect(resolutionRequests()).toEqual([
      expect.objectContaining({
        resolution: "drop",
        expectedObserved: "5 to 9",
      }),
    ]);
    expect(screen.queryByText("5 to 11")).not.toBeInTheDocument();
  });

  it("Cancel sends nothing", async () => {
    mockServer();
    const user = await renderLoaded();
    const detail = await expand(user);

    await user.click(
      within(detail).getByRole("button", { name: "Use new source" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(resolutionRequests()).toEqual([]);
    expect(
      screen.getByText("Source changed since this edit"),
    ).toBeInTheDocument();
  });

  it("a newer observation is refused, and the row is read again with the server's words", async () => {
    mockServer({
      onResolve: (_body, current) => ({
        status: 409,
        body: { error: "The page changed again since you looked." },
        rows: current.map((row) => ({
          ...row,
          sourceDrift: {
            baseline: "5 to 10",
            observed: "5 to 8",
            detectedAt: DETECTED,
          },
        })),
      }),
    });
    const user = await renderLoaded();
    const detail = await expand(user);

    await user.click(
      within(detail).getByRole("button", { name: "Keep override" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Keep override" }),
    );

    expect(
      await screen.findByText(/The page changed again since you looked\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const reread = screen.getByRole("group", {
      name: "Source changed since this edit",
    });
    expect(within(reread).getByText("5 to 8")).toBeInTheDocument();
  });

  it("a refusal that changed nothing stays in the dialog", async () => {
    mockServer({
      onResolve: (_body, current) => ({
        status: 402,
        body: {
          error: "This site's plan has ended — the owner can reactivate it.",
        },
        rows: current,
      }),
    });
    const user = await renderLoaded();
    const detail = await expand(user);

    await user.click(
      within(detail).getByRole("button", { name: "Use new source" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Use new source" }),
    );

    expect(
      await within(dialog).findByText(/plan has ended/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it.each(["edit", "publish", "view"])(
    "a member with %s rights sees the conflict but is not offered the resolutions",
    async (permission) => {
      mockServer({ permission });
      const user = await renderLoaded();
      const detail = await expand(user);

      expect(
        within(detail).getByRole("group", {
          name: "Source changed since this edit",
        }),
      ).toBeInTheDocument();
      expect(
        within(detail).queryByRole("button", { name: "Keep override" }),
      ).not.toBeInTheDocument();
      expect(
        within(detail).queryByRole("button", { name: "Use new source" }),
      ).not.toBeInTheDocument();
      expect(
        within(detail).getByText("Only a site admin can resolve this."),
      ).toBeInTheDocument();
    },
  );
});
