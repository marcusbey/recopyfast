/**
 * @jest-environment jsdom
 *
 * s70b — the Changes view: what changed on an owner's sites, grouped site →
 * page, in words they understand (docs/designs/s70-content-changes.md).
 *
 * The page it replaces titled every card with the embed's element id and a
 * CSS selector, defaulted to every untouched string, and rendered a refused
 * read as "No content found". Pinned here, against the list route's contract
 * with `fetch` mocked:
 * - grouping (site `h2`, page `h3`, counts) and the row's anatomy, with no
 *   element id and no selector anywhere in a collapsed row;
 * - Open on the row's own page, ⋮ visible at rest (a touch screen has no
 *   hover: s66c's Delete was unreachable on phones that way);
 * - expand: compare, history read once, the non-admin line;
 * - actions by state × grant (design table) through the existing routes,
 *   success in place with a polite announcement, failure kept in the dialog;
 * - every state: loading, no sites, no changes, no match, error — and an
 *   error is never the empty state (the content-load-states cases this
 *   replaces: a refused read or a malformed body is a failure, not an empty
 *   account).
 *
 * Devin review (PR #77): Discard sends a staged link back to its live value,
 * or is not offered when it cannot; a revert whose publish failed shows as
 * the pending draft it is, with Publish to retry; Revert is not offered when
 * the live text is already the original; past the offset ceiling the list
 * says it is capped instead of offering a page the route refuses.
 *
 * s70b fix pass (C1, M1, m1): after a write the page reads the server again
 * instead of drawing what the write meant to do, so the routes are answered
 * by an in-memory server that remembers writes (`changes-server-fake.ts`,
 * the save and publish RPCs' rules). Pinned: Publish and Revert and publish
 * on one language row show its sibling rows as the server left them; a
 * Discard whose row changed in another tab sends nothing; a filter changed
 * while Publish is in flight never draws the row as it was before it.
 *
 * Verification of 63d7ba2: one write at a time per element (every language
 * and variant row is disabled while one of them is written, and each write
 * frees only its own row); a Discard whose answer was lost reads the row
 * again; a draft on text never published is offered no Discard; focus after
 * Publish, in both orders.
 */

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangesView } from "../ChangesView";
import {
  createFakeChangesServer,
  type FakeChangesServer,
} from "./changes-server-fake";

const ACME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NORTHWIND = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VIEWER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PLAN_ENDED =
  "This site's plan has ended. Ask the site owner to renew, then try again.";

const SITES = [
  {
    id: ACME,
    name: "Acme Studio",
    domain: "acme.example",
    permission: "admin",
  },
  {
    id: NORTHWIND,
    name: "Northwind Docs",
    domain: "docs.northwind.example",
    permission: "edit",
  },
  {
    id: VIEWER,
    name: "Viewer Co",
    domain: "viewer.example",
    permission: "view",
  },
];

const HOUR = 60 * 60 * 1000;
const ago = (hours: number) =>
  new Date(Date.now() - hours * HOUR).toISOString();

type Row = Record<string, unknown> & { id: string };

function row(id: string, overrides: Record<string, unknown>): Row {
  return {
    id,
    siteId: ACME,
    elementId: `rcf-${id}`,
    pagePath: "/",
    elementType: "p",
    selector: "#root > main > p",
    language: "en",
    variant: "default",
    original: `Original ${id}`,
    live: `Live ${id}`,
    draft: null,
    draftAttributes: [],
    hasLiveText: true,
    state: "published",
    changedAt: ago(2),
    changedBy: null,
    createdAt: "2026-09-28T09:00:00.000Z",
    ...overrides,
  };
}

const HERO = row("r1", {
  elementId: "rcf-1gom2eazz3g",
  elementType: "h1",
  selector: "#root > main > section.hero > h1",
  original: "Copy changes without a developer",
  live: "Ship copy changes in minutes, not sprints",
  changedBy: "ana@example.com",
});
const HERO_BUTTON = row("r2", {
  elementId: "rcf-v6di4rh42g",
  elementType: "button",
  selector: "#root > main > section.hero > div.actions > button:nth-child(1)",
  original: "Start free trial",
  live: "Start free trial",
  draft: "Start your 14-day trial",
  state: "pending",
  changedBy: "sam@example.com",
  changedAt: ago(1),
});
const PRICING = row("r3", {
  pagePath: "/pricing",
  elementType: "h2",
  selector: "#pricing > header > h2",
  original: "Pricing",
  live: "Simple pricing for every team",
});
const FOOTER = row("r4", {
  pagePath: null,
  elementId: "footer-tagline",
  selector: '[data-rcf-id="footer-tagline"]',
  original: "Made with care",
  live: "Made in Lisbon, shipped everywhere",
});
const NW_STEP = row("r5", {
  siteId: NORTHWIND,
  pagePath: "/getting-started",
  elementType: "li",
  selector: "#__next > main > article > ol > li:nth-child(2)",
  original: "Paste the snippet in your head tag",
  live: "Paste the snippet in your head tag",
  draft: "Paste the snippet just before the closing body tag",
  state: "pending",
  // Never shown: an edit member is not an admin of Northwind.
  changedBy: "sam@example.com",
});
const NW_TITLE = row("r6", {
  siteId: NORTHWIND,
  pagePath: "/getting-started",
  elementType: "h1",
  selector: "#__next > main > article > h1",
  original: "Getting started",
  live: "Get started in five minutes",
});
const VIEWER_ROW = row("r7", {
  siteId: VIEWER,
  pagePath: "/",
  elementType: "h1",
  selector: "main > h1",
  original: "Welcome",
  live: "Welcome aboard",
});

const ALL_ROWS = [
  HERO,
  HERO_BUTTON,
  PRICING,
  FOOTER,
  NW_STEP,
  NW_TITLE,
  VIEWER_ROW,
];

function listBody(
  rows: Row[] = ALL_ROWS,
  overrides: Record<string, unknown> = {},
) {
  return {
    sites: SITES,
    rows,
    total: rows.length,
    counts: { pending: 2, published: 5, original: 1238 },
    nextOffset: null,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Answer = Response | Promise<Response>;
type Body = Record<string, unknown>;

interface Api {
  list: (url: URL) => Answer;
  history: (rowId: string) => Response;
  put: (url: URL, body: Body) => Answer;
  publish: (body: Body) => Answer;
}

const ADMIN_HISTORY = {
  historyVisible: true,
  discoveredAt: "2026-09-28T09:00:00.000Z",
  events: [
    {
      id: "h2",
      action: "publish",
      by: "ana@example.com",
      at: "2026-10-08T14:05:00.000Z",
      previous: "Copy changes without a developer",
      content: "Ship copy changes in minutes, not sprints",
    },
    {
      id: "h1",
      action: "update",
      by: "sam@example.com",
      at: "2026-10-08T13:58:00.000Z",
      previous: "Copy changes without a developer",
      content: "Ship copy changes in minutes, not sprints",
    },
  ],
};

let api: Api;
/** The routes' state: every write lands here, every read is answered from it. */
let server: FakeChangesServer;

/** What the routes answer when a test does not say otherwise. */
const served = {
  list: (url: URL) => {
    const body = server.list(url);
    return body ? json(body) : json({ error: "Site not found" }, 404);
  },
  put: (url: URL, body: Body) =>
    server.put(url.pathname.split("/").pop() ?? "", body)
      ? json({ success: true })
      : json({ error: "Content element not found" }, 404),
  publish: (body: Body) => {
    server.publish(body);
    return json({ success: true });
  },
};

function mockApi(overrides: Partial<Api> & { rows?: Row[] } = {}) {
  const { rows = ALL_ROWS, ...handlers } = overrides;
  server = createFakeChangesServer(rows, {
    sites: SITES,
    // Untouched rows: counted under "All text", never listed by default.
    unlistedOriginals: 1238,
  });
  api = {
    list: served.list,
    history: (rowId) =>
      json(
        [NW_STEP.id, NW_TITLE.id, VIEWER_ROW.id].includes(rowId)
          ? {
              historyVisible: false,
              events: [],
              discoveredAt: "2026-09-28T09:00:00.000Z",
            }
          : ADMIN_HISTORY,
      ),
    put: served.put,
    publish: served.publish,
    ...handlers,
  };
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = init?.method ?? "GET";
      const body = (): Body => JSON.parse(String(init?.body ?? "{}")) as Body;
      const history = /^\/api\/content\/changes\/([^/]+)\/history$/.exec(
        url.pathname,
      );
      if (history) return api.history(history[1]);
      if (url.pathname === "/api/content/changes") return api.list(url);
      if (
        method === "PUT" &&
        url.pathname.startsWith("/api/staging/content/")
      ) {
        return api.put(url, body());
      }
      if (method === "POST" && url.pathname === "/api/staging/publish") {
        return api.publish(body());
      }
      throw new Error(`unexpected request: ${method} ${url.pathname}`);
    },
  ) as unknown as typeof fetch;
}

const requests = (pathname: string | RegExp, method = "GET") =>
  (global.fetch as jest.Mock).mock.calls.filter(([input, init]) => {
    const url = new URL(String(input), "http://localhost");
    return (
      (typeof pathname === "string"
        ? url.pathname === pathname
        : pathname.test(url.pathname)) &&
      ((init as RequestInit | undefined)?.method ?? "GET") === method
    );
  });

async function renderLoaded(props: { siteId?: string } = {}) {
  const user = userEvent.setup();
  render(<ChangesView {...props} />);
  await screen.findByText("Ship copy changes in minutes, not sprints");
  return user;
}

/** The `li` of a row, found by the text that matters for its state. */
function rowOf(text: string): HTMLElement {
  const item = screen
    .getByText(text, { selector: "[data-row-text] *, [data-row-text]" })
    .closest("li");
  if (!item) throw new Error(`No row holds "${text}"`);
  return item;
}

/** The row's one line (status, location, text…), without its open detail. */
function rowLine(text: string): HTMLElement {
  const line = rowOf(text).firstElementChild;
  if (!(line instanceof HTMLElement)) throw new Error(`No line for "${text}"`);
  return line;
}

beforeEach(() => {
  mockApi();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("ChangesView — grouping", () => {
  it("groups site → page with h2 / h3 headers, site counts and band counts", async () => {
    await renderLoaded();

    const acme = screen.getByRole("region", { name: "Acme Studio" });
    expect(
      within(acme).getByRole("heading", { level: 2, name: "Acme Studio" }),
    ).toBeInTheDocument();
    expect(within(acme).getByText("acme.example")).toBeInTheDocument();
    expect(within(acme).getByText("1 pending")).toBeInTheDocument();
    expect(within(acme).getByText("3 published")).toBeInTheDocument();
    expect(
      within(acme)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["Homepage", "Pricing", "Every page"]);
    expect(within(acme).getByText("2 changes")).toBeInTheDocument();
    expect(within(acme).getAllByText("1 change")).toHaveLength(2);
    expect(
      within(acme).getByText("Shared by every page (set with data-rcf-id)"),
    ).toBeInTheDocument();
    expect(
      within(acme).getByRole("link", { name: /site page/i }),
    ).toHaveAttribute("href", `/dashboard/sites/${ACME}`);

    const northwind = screen.getByRole("region", { name: "Northwind Docs" });
    expect(
      within(northwind).getByRole("heading", {
        level: 3,
        name: "Getting started",
      }),
    ).toBeInTheDocument();
    expect(within(northwind).getByText("1 pending")).toBeInTheDocument();
    expect(within(northwind).getByText("1 published")).toBeInTheDocument();
  });

  it("says how many changes there are, on how many sites", async () => {
    await renderLoaded();

    expect(screen.getByText("7 changes on 3 sites")).toBeInTheDocument();
  });

  // Review m5: "on M sites" counted every site the caller has, changed or
  // not. It now counts the sites the list holds, and only once the whole list
  // is loaded: with more rows to come, a site further down is not known yet.
  it("counts only the sites that hold a change", async () => {
    mockApi({ list: () => json(listBody([HERO, PRICING])) });

    await renderLoaded();

    expect(screen.getByText("2 changes on 1 site")).toBeInTheDocument();
  });

  it("names no site count while more changes are still to load", async () => {
    mockApi({
      list: () => json(listBody([HERO], { total: 40, nextOffset: 1 })),
    });

    await renderLoaded();

    expect(screen.getByText("40 changes")).toBeInTheDocument();
    expect(screen.queryByText(/ on \d+ sites?/)).not.toBeInTheDocument();
  });
});

describe("ChangesView — a row", () => {
  it("shows the status, a readable location, the live text, who (admin) and when", async () => {
    await renderLoaded();

    const hero = rowOf("Ship copy changes in minutes, not sprints");
    expect(within(hero).getByText("Published")).toBeInTheDocument();
    expect(within(hero).getByText("Hero · Main heading")).toBeInTheDocument();
    expect(within(hero).getByText(/ana@example\.com/)).toBeInTheDocument();
    expect(within(hero).getByText(/ago/)).toBeInTheDocument();
  });

  // s70b re-review N2: at 375 the who·when line is ~174 px, and a long address
  // cut "when" ("sam@example.com · 25 minut…"). The address truncates on its
  // own; "when" never shrinks.
  it("truncates a long address, never the time", async () => {
    await renderLoaded();

    const hero = rowOf("Ship copy changes in minutes, not sprints");
    const address = within(hero).getByText("ana@example.com");
    expect(address).toHaveClass("min-w-0", "truncate");
    const time = within(hero).getByText(/ago/).closest("time");
    expect(time).not.toBeNull();
    expect(time).toHaveClass("shrink-0", "whitespace-nowrap");
  });

  it("shows the draft for a pending row", async () => {
    await renderLoaded();

    const button = rowOf("Start your 14-day trial");
    expect(within(button).getByText("Pending")).toBeInTheDocument();
    expect(within(button).getByText("Hero · Button")).toBeInTheDocument();
  });

  it("never shows who to a member who is not the site's admin", async () => {
    await renderLoaded();

    const step = rowOf("Paste the snippet just before the closing body tag");
    expect(
      within(step).queryByText(/sam@example\.com/),
    ).not.toBeInTheDocument();
    expect(within(step).getByText(/ago/)).toBeInTheDocument();
  });

  it("lets an author id name the row: footer-tagline reads Footer tagline", async () => {
    await renderLoaded();

    expect(
      within(rowOf("Made in Lisbon, shipped everywhere")).getByText(
        "Footer tagline",
      ),
    ).toBeInTheDocument();
  });

  it("puts no element id and no selector anywhere in a row", async () => {
    await renderLoaded();

    for (const fixture of ALL_ROWS) {
      const text =
        fixture.state === "pending"
          ? String(fixture.draft)
          : String(fixture.live);
      const html = rowOf(text).outerHTML;
      expect(html).not.toContain(String(fixture.elementId));
      expect(html).not.toContain(String(fixture.selector));
      expect(rowOf(text).textContent).not.toMatch(/rcf-|:nth|#root|#__next|>/);
    }
  });

  it.each([
    [
      "Ship copy changes in minutes, not sprints",
      "Hero · Main heading",
      "https://acme.example/",
      "acme.example/",
    ],
    [
      "Simple pricing for every team",
      "Header · Heading",
      "https://acme.example/pricing",
      "acme.example/pricing",
    ],
    [
      "Made in Lisbon, shipped everywhere",
      "Footer tagline",
      "https://acme.example/",
      "acme.example/",
    ],
  ])(
    "opens %p on its own page in a new tab",
    async (text, location, href, where) => {
      await renderLoaded();

      const open = within(rowOf(text)).getByRole("link", {
        name: `Open ${location} on ${where} in a new tab`,
      });
      expect(open).toHaveAttribute("href", href);
      expect(open).toHaveAttribute("target", "_blank");
      expect(open.getAttribute("rel")).toContain("noopener");
    },
  );

  // Review m3: the link was `https://${domain}${path}` with no check, and
  // `page_path` is recorded by the embed. ".evil.example/" made it
  // https://acme.example.evil.example/; a URL built from "//evil.example/x"
  // leaves the site outright, and the URL parser drops a tab, so "/\t/…" is
  // "//…" once parsed. A path that is not one same-site absolute path gets no
  // Open at all, on the row or in ⋮.
  it.each([
    [".evil.example/"],
    ["//evil.example/x"],
    ["/\\evil.example/x"],
    ["/\t/evil.example/x"],
  ])(
    "offers no Open for a stored path %p that is not a same-site path",
    async (pagePath) => {
      mockApi({
        list: () =>
          json(listBody([HERO, row("bad", { pagePath, live: "Off-site" })])),
      });
      const user = await renderLoaded();
      const bad = rowOf("Off-site");

      expect(
        within(bad).queryByRole("link", { name: /^Open / }),
      ).not.toBeInTheDocument();
      await user.click(
        within(bad).getByRole("button", { name: /^More actions for / }),
      );
      expect(
        await screen.findByRole("menuitem", { name: "Compare and history" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("menuitem", { name: "Open on page" }),
      ).not.toBeInTheDocument();
      // The open menu hides the page from the accessibility tree.
      for (const link of screen.getAllByRole("link", { hidden: true })) {
        expect(link.getAttribute("href")).not.toMatch(/evil\.example/);
      }
    },
  );

  it("opens the page from ⋮ too, on the row's own site", async () => {
    const user = await renderLoaded();

    await user.click(
      within(rowOf("Simple pricing for every team")).getByRole("button", {
        name: /^More actions for /,
      }),
    );

    expect(
      await screen.findByRole("menuitem", { name: "Open on page" }),
    ).toHaveAttribute("href", "https://acme.example/pricing");
  });

  it("keeps ⋮ visible at rest on every row", async () => {
    await renderLoaded();

    const menus = screen.getAllByRole("button", { name: /^More actions for / });
    expect(menus).toHaveLength(ALL_ROWS.length);
    for (const menu of menus) {
      expect(menu.className).not.toMatch(/opacity-0/);
    }
  });
});

describe("ChangesView — expand", () => {
  it("compares Original and Live now, reads the history once, and shows who to an admin", async () => {
    const user = await renderLoaded();
    const hero = rowOf("Ship copy changes in minutes, not sprints");
    const toggle = within(hero).getByRole("button", {
      name: "Compare and history: Hero · Main heading",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const region = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("role", "region");
    expect(within(region!).getByText("Original")).toBeInTheDocument();
    expect(within(region!).getByText("Live now")).toBeInTheDocument();
    expect(within(region!).queryByText("Draft")).not.toBeInTheDocument();
    expect(
      within(region!).getByText("Copy changes without a developer"),
    ).toBeInTheDocument();
    expect(await within(region!).findByText("Draft saved")).toBeInTheDocument();
    expect(within(region!).getAllByText(/Published/).length).toBeGreaterThan(0);
    expect(within(region!).getByText("Discovered")).toBeInTheDocument();
    expect(
      within(region!).getAllByText(/ana@example\.com/).length,
    ).toBeGreaterThan(0);

    await user.click(toggle);
    await user.click(toggle);
    await within(hero).findByText("Draft saved");
    expect(requests(/\/history$/)).toHaveLength(1);
  });

  it("shows the draft beside Original and Live now for a pending row", async () => {
    const user = await renderLoaded();
    const button = rowOf("Start your 14-day trial");

    await user.click(
      within(button).getByRole("button", {
        name: "Compare and history: Hero · Button",
      }),
    );

    const region = within(button).getByRole("region");
    expect(within(region).getByText("Draft")).toBeInTheDocument();
    expect(within(region).getByText("Original")).toBeInTheDocument();
    expect(within(region).getByText("Live now")).toBeInTheDocument();
  });

  it("tells a non-admin that only admins see who changed what", async () => {
    const user = await renderLoaded();
    const title = rowOf("Get started in five minutes");

    await user.click(
      within(title).getByRole("button", {
        name: "Compare and history: Main heading",
      }),
    );

    expect(
      await within(title).findByText(
        "Only this site's admins can see who changed what.",
      ),
    ).toBeInTheDocument();
    expect(within(title).getByText("Discovered")).toBeInTheDocument();
  });

  it("keeps the element id and selector under Technical details only", async () => {
    const user = await renderLoaded();
    const hero = rowOf("Ship copy changes in minutes, not sprints");

    await user.click(
      within(hero).getByRole("button", {
        name: "Compare and history: Hero · Main heading",
      }),
    );

    const details = within(hero)
      .getByText("Technical details")
      .closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(within(details!).getByText("rcf-1gom2eazz3g")).toBeInTheDocument();
  });
});

describe("ChangesView — actions by state and grant", () => {
  async function expand(
    user: ReturnType<typeof userEvent.setup>,
    text: string,
  ) {
    const item = rowOf(text);
    await user.click(
      within(item).getByRole("button", { name: /^Compare and history: / }),
    );
    return within(item).getByRole("region");
  }

  const actionNames = (region: HTMLElement) =>
    within(region)
      .queryAllByRole("button")
      .map((button) => button.textContent?.trim())
      .filter((name) =>
        [
          "Publish",
          "Discard draft",
          "Revert to original",
          "Edit on page",
        ].includes(name ?? ""),
      );

  it.each([
    [
      "an admin's pending row",
      "Start your 14-day trial",
      ["Publish", "Discard draft", "Edit on page"],
    ],
    [
      "an admin's published row",
      "Ship copy changes in minutes, not sprints",
      ["Revert to original", "Edit on page"],
    ],
    [
      "an edit member's pending row",
      "Paste the snippet just before the closing body tag",
      ["Discard draft", "Edit on page"],
    ],
    [
      "an edit member's published row",
      "Get started in five minutes",
      ["Revert to original", "Edit on page"],
    ],
    ["a view member's published row", "Welcome aboard", []],
  ])("offers %s exactly %j", async (_label, text, expected) => {
    const user = await renderLoaded();

    expect(actionNames(await expand(user, text))).toEqual(expected);
  });

  it("tells an edit member why there is no Publish", async () => {
    const user = await renderLoaded();

    const region = await expand(
      user,
      "Paste the snippet just before the closing body tag",
    );

    expect(
      within(region).getByText("Publishing needs publish rights on this site."),
    ).toBeInTheDocument();
  });

  it("offers only Edit on page on an original row", async () => {
    mockApi({
      list: () =>
        json(
          listBody([
            HERO,
            row("r8", {
              state: "original",
              original: "No credit card needed",
              live: "No credit card needed",
            }),
          ]),
        ),
    });
    const user = await renderLoaded();

    expect(actionNames(await expand(user, "No credit card needed"))).toEqual([
      "Edit on page",
    ]);
  });

  it("opens the revert dialog, saves the original as a draft, and updates the row in place", async () => {
    const user = await renderLoaded();
    const region = await expand(
      user,
      "Ship copy changes in minutes, not sprints",
    );

    await user.click(
      within(region).getByRole("button", { name: "Revert to original" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Revert to the original text?",
    });
    expect(
      within(dialog).getByText("Hero · Main heading on Homepage, acme.example"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Revert and publish" }),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Save as draft" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const [[, init]] = requests(`/api/staging/content/${ACME}`, "PUT");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      elementId: "rcf-1gom2eazz3g",
      content: "Copy changes without a developer",
      language: "en",
      variant: "default",
    });
    expect(requests("/api/staging/publish", "POST")).toHaveLength(0);
    expect(
      within(rowLine("Copy changes without a developer")).getByText("Pending"),
    ).toBeInTheDocument();
    expect(screen.getByText("Reverted. Saved as a draft.")).toBeInTheDocument();
    expect(
      screen.getByText("Reverted. Saved as a draft.").closest("[aria-live]"),
    ).toHaveAttribute("aria-live", "polite");
  });

  it("reverts and publishes with the PUT then the POST", async () => {
    const user = await renderLoaded();
    const region = await expand(
      user,
      "Ship copy changes in minutes, not sprints",
    );

    await user.click(
      within(region).getByRole("button", { name: "Revert to original" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Revert and publish" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(requests(`/api/staging/content/${ACME}`, "PUT")).toHaveLength(1);
    expect(requests("/api/staging/publish", "POST")).toHaveLength(1);
    expect(screen.getByText("Reverted and published.")).toBeInTheDocument();
    expect(
      within(rowLine("Copy changes without a developer")).getByText(
        "Published",
      ),
    ).toBeInTheDocument();
  });

  it("offers an edit member Save as draft only, and says when it goes live", async () => {
    const user = await renderLoaded();
    const region = await expand(user, "Get started in five minutes");

    await user.click(
      within(region).getByRole("button", { name: "Revert to original" }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByRole("button", { name: "Save as draft" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Revert and publish" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "It goes live when someone with publish rights publishes it.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the dialog open with the server's words when the draft is refused", async () => {
    mockApi({
      put: () => json({ error: PLAN_ENDED, reason: "plan_ended" }, 402),
    });
    const user = await renderLoaded();
    const region = await expand(
      user,
      "Ship copy changes in minutes, not sprints",
    );

    await user.click(
      within(region).getByRole("button", { name: "Revert to original" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Revert and publish" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      PLAN_ENDED,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(requests("/api/staging/publish", "POST")).toHaveLength(0);
    expect(
      within(rowLine("Ship copy changes in minutes, not sprints")).getByText(
        "Published",
      ),
    ).toBeInTheDocument();
  });

  it("discards a draft with the live text after a confirm", async () => {
    const user = await renderLoaded();
    const region = await expand(user, "Start your 14-day trial");

    await user.click(
      within(region).getByRole("button", { name: "Discard draft" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Discard this draft?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Discard draft" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const [[, init]] = requests(`/api/staging/content/${ACME}`, "PUT");
    expect(JSON.parse(String((init as RequestInit).body)).content).toBe(
      "Start free trial",
    );
    expect(screen.getByText("Draft discarded.")).toBeInTheDocument();
  });

  it("discards a draft and the link it stages: the live link goes back in the same PUT", async () => {
    mockApi({
      rows: [
        HERO,
        {
          ...HERO_BUTTON,
          draftAttributes: [{ name: "href", live: "/signup" }],
        },
      ],
    });
    const user = await renderLoaded();
    const region = await expand(user, "Start your 14-day trial");

    await user.click(
      within(region).getByRole("button", { name: "Discard draft" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Discard draft" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const [[, init]] = requests(`/api/staging/content/${ACME}`, "PUT");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      elementId: "rcf-v6di4rh42g",
      content: "Start free trial",
      language: "en",
      variant: "default",
      href: "/signup",
    });
    expect(screen.getByText("Draft discarded.")).toBeInTheDocument();
  });

  it("offers no Discard for a draft whose link change can't be sent back, and says why", async () => {
    mockApi({
      list: () =>
        json(
          listBody([
            HERO,
            {
              ...HERO_BUTTON,
              draftAttributes: [{ name: "href", live: null }],
            },
          ]),
        ),
    });
    const user = await renderLoaded();
    const region = await expand(user, "Start your 14-day trial");

    expect(actionNames(region)).toEqual(["Publish", "Edit on page"]);
    expect(
      within(region).getByText(
        "This draft changes a link or image attribute, which can't be discarded here. Change it on the page.",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(rowOf("Start your 14-day trial")).getByRole("button", {
        name: /^More actions for /,
      }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Compare and history" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Discard draft" }),
    ).not.toBeInTheDocument();
  });

  // Devin re-review N2 / N4: a pending row whose staged attributes the route
  // could not read (null), or an answer without the field (which threw "not
  // iterable" while the row was drawn), may stage a link that a text-only
  // discard would leave staged. No Discard, and the line says why, without
  // claiming the draft changes a link it may not change.
  it.each([
    ["could not be read", { draftAttributes: null }],
    ["are missing from the answer", { draftAttributes: undefined }],
  ])(
    "offers no Discard for a pending row whose staged attributes %s, and says why",
    async (_label, overrides) => {
      mockApi({
        list: () => json(listBody([HERO, { ...HERO_BUTTON, ...overrides }])),
      });
      const user = await renderLoaded();
      const region = await expand(user, "Start your 14-day trial");

      expect(actionNames(region)).toEqual(["Publish", "Edit on page"]);
      expect(
        within(region).getByText(
          "This draft could not be read in full, so it can't be discarded here. Reload the page to try again.",
        ),
      ).toBeInTheDocument();
      expect(
        within(region).queryByText(/changes a link or image attribute/),
      ).not.toBeInTheDocument();
    },
  );

  // Verification of 63d7ba2 (minor 6): a translation is written with no
  // published text (src/app/api/ai/translate/route.ts), and "Live now" stands
  // in the original for it. Discard saved that original as the draft, which
  // the view still reads as differing from the NULL published text: the row
  // stayed Pending, under "Draft discarded."
  it("offers no Discard on a draft over text that was never published, and says why", async () => {
    mockApi({
      rows: [
        HERO,
        row("t-fr", {
          elementId: "rcf-cta",
          language: "fr",
          original: "Start free trial",
          live: "Start free trial",
          draft: "Essai gratuit de 14 jours",
          state: "pending",
          hasLiveText: false,
        }),
      ],
    });
    const user = await renderLoaded();
    const region = await expand(user, "Essai gratuit de 14 jours");

    expect(actionNames(region)).toEqual(["Publish", "Edit on page"]);
    expect(
      within(region).getByText(
        "This text was never published, so its draft can't be discarded here. Edit or publish it on the page.",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(rowOf("Essai gratuit de 14 jours")).getByRole("button", {
        name: /^More actions for /,
      }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Compare and history" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Discard draft" }),
    ).not.toBeInTheDocument();
  });

  // Devin re-review N1 (critical): the row kept the link's old live value
  // after Publish made the staged link live. Revert → Save as draft, then
  // Discard, sent that old value back, and the save RPC STAGED it, because it
  // now differed from the live link: the next Publish silently put the old
  // link back on the customer's page.
  const STAGED_LINK_ROW = {
    ...HERO_BUTTON,
    draftAttributes: [{ name: "href", live: "/signup" }],
  };

  it("never sends back a link it has published: Publish, Revert → Save as draft, then Discard carries no href", async () => {
    mockApi({ rows: [HERO, STAGED_LINK_ROW] });
    const user = await renderLoaded();
    const item = rowOf("Start your 14-day trial");
    await expand(user, "Start your 14-day trial");
    const region = () => within(item).getByRole("region");

    await user.click(within(region()).getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Published.")).toBeInTheDocument();
    await user.click(
      within(region()).getByRole("button", { name: "Revert to original" }),
    );
    const revert = await screen.findByRole("dialog", {
      name: "Revert to the original text?",
    });
    await user.click(
      within(revert).getByRole("button", { name: "Save as draft" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(
      within(region()).getByRole("button", { name: "Discard draft" }),
    );
    const discard = await screen.findByRole("dialog", {
      name: "Discard this draft?",
    });
    await user.click(
      within(discard).getByRole("button", { name: "Discard draft" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    const puts = requests(`/api/staging/content/${ACME}`, "PUT");
    expect(puts).toHaveLength(2);
    expect(JSON.parse(String((puts[1][1] as RequestInit).body))).toEqual({
      elementId: "rcf-v6di4rh42g",
      content: "Start your 14-day trial",
      language: "en",
      variant: "default",
    });
    expect(screen.getByText("Draft discarded.")).toBeInTheDocument();
  });

  it("never sends back a link it has published after a revert whose publish failed", async () => {
    let publishes = 0;
    mockApi({
      rows: [HERO, STAGED_LINK_ROW],
      publish: (body) =>
        (publishes += 1) === 1
          ? served.publish(body)
          : json({ error: "Publish rate limit exceeded for this site." }, 429),
    });
    const user = await renderLoaded();
    const item = rowOf("Start your 14-day trial");
    await expand(user, "Start your 14-day trial");
    const region = () => within(item).getByRole("region");

    await user.click(within(region()).getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Published.")).toBeInTheDocument();
    await user.click(
      within(region()).getByRole("button", { name: "Revert to original" }),
    );
    const revert = await screen.findByRole("dialog");
    await user.click(
      within(revert).getByRole("button", { name: "Revert and publish" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(within(region()).getByRole("alert")).toHaveTextContent(
      "The revert was saved as a draft but not published.",
    );
    await user.click(
      within(region()).getByRole("button", { name: "Discard draft" }),
    );
    const discard = await screen.findByRole("dialog", {
      name: "Discard this draft?",
    });
    await user.click(
      within(discard).getByRole("button", { name: "Discard draft" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    const puts = requests(`/api/staging/content/${ACME}`, "PUT");
    expect(puts).toHaveLength(2);
    expect(JSON.parse(String((puts[1][1] as RequestInit).body))).toEqual({
      elementId: "rcf-v6di4rh42g",
      content: "Start your 14-day trial",
      language: "en",
      variant: "default",
    });
    expect(requests("/api/staging/publish", "POST")).toHaveLength(2);
  });

  it("shows a revert whose publish failed as the pending draft it is, with the reason and Publish to retry", async () => {
    let publishes = 0;
    mockApi({
      publish: (body) =>
        (publishes += 1) === 1
          ? json({ error: "Publish rate limit exceeded for this site." }, 429)
          : served.publish(body),
    });
    const user = await renderLoaded();

    // From ⋮ on a collapsed row: the outcome has to open the row to be seen.
    await user.click(
      within(rowOf("Ship copy changes in minutes, not sprints")).getByRole(
        "button",
        { name: /^More actions for / },
      ),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Revert to original" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Revert and publish" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const reverted = rowOf("Copy changes without a developer");
    expect(
      within(rowLine("Copy changes without a developer")).getByText("Pending"),
    ).toBeInTheDocument();
    const region = within(reverted).getByRole("region");
    expect(within(region).getByRole("alert")).toHaveTextContent(
      "The revert was saved as a draft but not published. Publish rate limit exceeded for this site.",
    );
    expect(
      screen.queryByText("Reverted and published."),
    ).not.toBeInTheDocument();

    await user.click(within(region).getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Published.")).toBeInTheDocument();
    expect(
      within(rowLine("Copy changes without a developer")).getByText(
        "Published",
      ),
    ).toBeInTheDocument();
    expect(within(region).queryByRole("alert")).not.toBeInTheDocument();
    expect(requests(`/api/staging/content/${ACME}`, "PUT")).toHaveLength(1);
    expect(requests("/api/staging/publish", "POST")).toHaveLength(2);
  });

  it("offers no Revert on a published row whose text is already the original", async () => {
    mockApi({
      list: () =>
        json(
          listBody([
            HERO,
            row("r9", {
              state: "published",
              original: "Hello",
              live: "Hello",
            }),
          ]),
        ),
    });
    const user = await renderLoaded();
    const region = await expand(user, "Hello");

    expect(actionNames(region)).toEqual(["Edit on page"]);
    expect(
      within(region).getByText("Text is the same as the original."),
    ).toBeInTheDocument();
    await user.click(
      within(rowOf("Hello")).getByRole("button", {
        name: /^More actions for /,
      }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Compare and history" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Revert to original" }),
    ).not.toBeInTheDocument();
  });

  it("publishes a pending row with the POST alone and shows a refusal under the actions", async () => {
    mockApi({
      publish: () =>
        json({ error: "Publish rate limit exceeded for this site." }, 429),
    });
    const user = await renderLoaded();
    const region = await expand(user, "Start your 14-day trial");

    await user.click(within(region).getByRole("button", { name: "Publish" }));

    expect(await within(region).findByRole("alert")).toHaveTextContent(
      "Publish rate limit exceeded for this site.",
    );
    expect(requests("/api/staging/publish", "POST")).toHaveLength(1);
    expect(requests(/^\/api\/staging\/content\//, "PUT")).toHaveLength(0);
  });
});

describe("ChangesView — after a write, the server is read again (s70b fix pass)", () => {
  // One element in two languages: translation upserts the same element_id
  // with another language (src/app/api/ai/translate/route.ts), and the
  // publish RPC promotes every language and variant row of the element ids
  // it is given (20260924060000).
  const CTA_EN = row("cta-en", {
    elementId: "rcf-cta",
    elementType: "button",
    selector: "#root > main > a.cta",
    original: "Start free trial",
    live: "Start free trial",
    draft: "Start your 14-day trial",
    state: "pending",
  });
  const CTA_FR = row("cta-fr", {
    elementId: "rcf-cta",
    elementType: "button",
    selector: "#root > main > a.cta",
    language: "fr",
    original: "Essai gratuit",
    live: "Essai gratuit",
    draft: "Essai gratuit de 14 jours",
    state: "pending",
  });
  const HERO_FR = row("hero-fr", {
    elementId: HERO.elementId,
    elementType: "h1",
    selector: HERO.selector,
    language: "fr",
    original: "Modifiez vos textes sans développeur",
    live: "Modifiez vos textes sans développeur",
    draft: "Livrez vos textes en quelques minutes",
    state: "pending",
  });
  const UPDATED_ELSEWHERE =
    "This change was updated elsewhere — review it again.";

  async function expandRow(
    user: ReturnType<typeof userEvent.setup>,
    text: string,
  ) {
    const item = rowOf(text);
    const toggle = within(item).getByRole("button", {
      name: /^Compare and history: /,
    });
    await user.click(toggle);
    return { item, toggle, region: () => within(item).getByRole("region") };
  }

  const actionsOf = (region: HTMLElement) =>
    within(region)
      .queryAllByRole("button")
      .map((button) => button.textContent?.trim())
      .filter((name) =>
        [
          "Publish",
          "Discard draft",
          "Revert to original",
          "Edit on page",
        ].includes(name ?? ""),
      );

  const statusOptions = () =>
    within(screen.getByRole("combobox", { name: "Filter by status" }))
      .getAllByRole("option")
      .map((option) => option.textContent);

  const elementReads = (elementId: string) =>
    requests("/api/content/changes").filter(
      ([input]) =>
        new URL(String(input), "http://localhost").searchParams.get(
          "element",
        ) === elementId,
    );

  // C1 (critical): Publish sent this element id, the server published the fr
  // row too, and the page redrew the en row alone. The fr row kept its old
  // draft and Discard; Discard re-staged the old text, and the next Publish
  // silently put it back live.
  it("Publish on one language row shows its sibling as the server left it: published, no Discard", async () => {
    mockApi({ rows: [HERO, CTA_EN, CTA_FR] });
    const user = await renderLoaded();
    const en = await expandRow(user, "Start your 14-day trial");

    await user.click(
      within(en.region()).getByRole("button", { name: "Publish" }),
    );

    expect(await screen.findByText("Published.")).toBeInTheDocument();
    expect(
      within(rowLine("Essai gratuit de 14 jours")).getByText("Published"),
    ).toBeInTheDocument();
    expect(elementReads("rcf-cta").length).toBeGreaterThan(0);
    const fr = await expandRow(user, "Essai gratuit de 14 jours");
    expect(actionsOf(fr.region())).toEqual([
      "Revert to original",
      "Edit on page",
    ]);
    // The counts are the server's after the write, not a guess.
    expect(statusOptions()).toEqual([
      "Changes (3)",
      "Pending (0)",
      "Published (3)",
      "All text (1,241)",
    ]);
  });

  it("Revert and publish on one language row shows its pending sibling published too", async () => {
    mockApi({ rows: [HERO, HERO_FR] });
    const user = await renderLoaded();
    const en = await expandRow(
      user,
      "Ship copy changes in minutes, not sprints",
    );

    await user.click(
      within(en.region()).getByRole("button", { name: "Revert to original" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Revert and publish" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Reverted and published.")).toBeInTheDocument();
    expect(
      within(rowLine("Copy changes without a developer")).getByText(
        "Published",
      ),
    ).toBeInTheDocument();
    expect(
      within(rowLine("Livrez vos textes en quelques minutes")).getByText(
        "Published",
      ),
    ).toBeInTheDocument();
    const fr = await expandRow(user, "Livrez vos textes en quelques minutes");
    expect(actionsOf(fr.region())).toEqual([
      "Revert to original",
      "Edit on page",
    ]);
  });

  // M1: Discard sent the live text and links as this page had loaded them.
  // Another tab (or an editor on the live page) changed the row since: the
  // PUT then staged copy the server no longer had as live.
  it.each([
    [
      "saved another draft",
      () =>
        server.put(ACME, {
          elementId: HERO_BUTTON.elementId,
          content: "Start your free trial",
          language: "en",
          variant: "default",
        }),
      "Start your free trial",
      "Pending",
    ],
    [
      "published it",
      () =>
        server.publish({ siteId: ACME, elementIds: [HERO_BUTTON.elementId] }),
      "Start your 14-day trial",
      "Published",
    ],
  ])(
    "sends no Discard when another tab %s, says so, and shows the row as it is now",
    async (_label, elsewhere, textNow, statusNow) => {
      mockApi({ rows: [HERO, HERO_BUTTON] });
      const user = await renderLoaded();
      const button = await expandRow(user, "Start your 14-day trial");
      elsewhere();

      await user.click(
        within(button.region()).getByRole("button", { name: "Discard draft" }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Discard this draft?",
      });
      await user.click(
        within(dialog).getByRole("button", { name: "Discard draft" }),
      );

      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(requests(/^\/api\/staging\/content\//, "PUT")).toHaveLength(0);
      expect(within(button.region()).getByRole("alert")).toHaveTextContent(
        UPDATED_ELSEWHERE,
      );
      expect(within(rowLine(textNow)).getByText(statusNow)).toBeInTheDocument();
      expect(screen.queryByText("Draft discarded.")).not.toBeInTheDocument();
    },
  );

  // m1: the status filter changed while Publish was in flight. The reload,
  // read before the publish committed, landed after it and drew the row as
  // Pending, Discard offered, because the in-place patch had found no list.
  it("never draws a row as it was before a Publish when the filter changed while it was in flight", async () => {
    let releasePublish: (() => void) | null = null;
    let releaseOldList: (() => void) | null = null;
    mockApi({
      rows: [HERO, HERO_BUTTON, NW_STEP],
      // The publish commits when it is released.
      publish: (body) =>
        new Promise<Response>((resolve) => {
          releasePublish = () => resolve(served.publish(body));
        }),
      // Each read is answered with what the server held when it arrived.
      list: (url) => {
        const answer = served.list(url);
        if (url.searchParams.get("state") === "pending" && !releaseOldList) {
          return new Promise<Response>((resolve) => {
            releaseOldList = () => resolve(answer);
          });
        }
        return answer;
      },
    });
    const user = await renderLoaded();
    const button = await expandRow(user, "Start your 14-day trial");
    await user.click(
      within(button.region()).getByRole("button", { name: "Publish" }),
    );
    await waitFor(() => expect(releasePublish).not.toBeNull());

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by status" }),
      "pending",
    );
    await waitFor(() => expect(releaseOldList).not.toBeNull());
    await act(async () => {
      releasePublish!();
    });
    expect(await screen.findByText("Published.")).toBeInTheDocument();
    await act(async () => {
      releaseOldList!();
    });

    expect(
      await screen.findByText(
        "Paste the snippet just before the closing body tag",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Start your 14-day trial"),
    ).not.toBeInTheDocument();
  });

  it("keeps a published row open, with focus on its expand button once Publish has gone", async () => {
    mockApi({ rows: [HERO, HERO_BUTTON] });
    const user = await renderLoaded();
    const button = await expandRow(user, "Start your 14-day trial");

    await user.click(
      within(button.region()).getByRole("button", { name: "Publish" }),
    );

    expect(await screen.findByText("Published.")).toBeInTheDocument();
    expect(button.toggle).toHaveAttribute("aria-expanded", "true");
    expect(button.region()).toBeInTheDocument();
    expect(document.activeElement).toBe(button.toggle);
  });

  // Verification of 63d7ba2 (minor 7): the other order. The element's rows
  // are read again and drawn (Publish leaves, focus falls to the page) while
  // the counts read is still out; when the action then settles, focus has
  // already fallen, and the row has no later commit to look again on.
  it("moves focus to the expand button at once when Publish has already gone as the action settles", async () => {
    let listReads = 0;
    let releaseCounts: (() => void) | null = null;
    mockApi({
      rows: [HERO, HERO_BUTTON],
      list: (url) => {
        const answer = served.list(url);
        if (url.searchParams.has("element") || (listReads += 1) !== 2) {
          return answer;
        }
        return new Promise<Response>((resolve) => {
          releaseCounts = () => resolve(answer);
        });
      },
    });
    const user = await renderLoaded();
    const button = await expandRow(user, "Start your 14-day trial");

    await user.click(
      within(button.region()).getByRole("button", { name: "Publish" }),
    );
    await waitFor(() =>
      expect(
        within(button.region()).queryByRole("button", { name: "Publish" }),
      ).not.toBeInTheDocument(),
    );
    expect(releaseCounts).not.toBeNull();
    expect(document.activeElement).toBe(document.body);

    await act(async () => {
      releaseCounts!();
    });

    expect(await screen.findByText("Published.")).toBeInTheDocument();
    expect(document.activeElement).toBe(button.toggle);
  });

  // Verification of 63d7ba2 (major): the busy state was one slot, per row.
  // Discard on the fr row stayed enabled while Publish on the en row of the
  // same element was in flight; its pre-read landed before the publish
  // committed and its PUT after, so the old text was staged again, and
  // "Draft discarded." was shown over a row the server held as Pending.
  it("disables every row of an element while a write to it is in flight, and both settle as the server holds them", async () => {
    let releasePublish: (() => void) | null = null;
    mockApi({
      rows: [HERO, CTA_EN, CTA_FR],
      publish: (body) =>
        new Promise<Response>((resolve) => {
          releasePublish = () => resolve(served.publish(body));
        }),
    });
    const user = await renderLoaded();
    const en = await expandRow(user, "Start your 14-day trial");
    const fr = await expandRow(user, "Essai gratuit de 14 jours");

    await user.click(
      within(en.region()).getByRole("button", { name: "Publish" }),
    );
    await waitFor(() => expect(releasePublish).not.toBeNull());

    const frDiscard = within(fr.region()).getByRole("button", {
      name: "Discard draft",
    });
    expect(frDiscard).toBeDisabled();
    expect(
      within(fr.region()).getByRole("button", { name: "Publish" }),
    ).toBeDisabled();
    await user.click(
      within(fr.item).getByRole("button", { name: /^More actions for / }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Discard draft" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    await user.click(frDiscard);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      releasePublish!();
    });

    expect(await screen.findByText("Published.")).toBeInTheDocument();
    expect(
      within(rowLine("Essai gratuit de 14 jours")).getByText("Published"),
    ).toBeInTheDocument();
    expect(actionsOf(fr.region())).toEqual([
      "Revert to original",
      "Edit on page",
    ]);
    expect(
      within(fr.region()).getByRole("button", { name: "Revert to original" }),
    ).toBeEnabled();
    expect(requests(/^\/api\/staging\/content\//, "PUT")).toHaveLength(0);
    expect(screen.queryByText("Draft discarded.")).not.toBeInTheDocument();
  });

  // The same slot, with two writes on two elements: starting the second
  // freed the first row's buttons while its write was still in flight, and
  // the first one ending freed the second's.
  it("keeps each write's row busy until that write ends, whatever another write does", async () => {
    const releases = new Map<string, () => void>();
    mockApi({
      rows: [HERO, HERO_BUTTON, CTA_FR],
      publish: (body) =>
        new Promise<Response>((resolve) => {
          const [elementId] = body.elementIds as string[];
          releases.set(elementId, () => resolve(served.publish(body)));
        }),
    });
    const user = await renderLoaded();
    const button = await expandRow(user, "Start your 14-day trial");
    const cta = await expandRow(user, "Essai gratuit de 14 jours");
    const publishOf = (target: { region: () => HTMLElement }) =>
      within(target.region()).getByRole("button", { name: "Publish" });

    await user.click(publishOf(button));
    await waitFor(() =>
      expect(releases.has(HERO_BUTTON.elementId as string)).toBe(true),
    );
    await user.click(publishOf(cta));
    await waitFor(() => expect(releases.has("rcf-cta")).toBe(true));
    expect(publishOf(button)).toBeDisabled();
    expect(publishOf(cta)).toBeDisabled();

    await act(async () => {
      releases.get(HERO_BUTTON.elementId as string)!();
    });
    await waitFor(() =>
      expect(
        within(rowLine("Start your 14-day trial")).getByText("Published"),
      ).toBeInTheDocument(),
    );
    expect(publishOf(cta)).toBeDisabled();

    await act(async () => {
      releases.get("rcf-cta")!();
    });
    await waitFor(() =>
      expect(
        within(rowLine("Essai gratuit de 14 jours")).getByText("Published"),
      ).toBeInTheDocument(),
    );
    expect(requests("/api/staging/publish", "POST")).toHaveLength(2);
  });

  // Verification of 63d7ba2 (minor 5): a stale Discard whose re-read failed
  // said "review it again" over the row as it was, which looked current.
  it("says a Discard found the row changed elsewhere and could not read it again", async () => {
    let elementReads = 0;
    mockApi({
      rows: [HERO, HERO_BUTTON],
      // Discard's own read before the PUT works; the read after it fails.
      list: (url) =>
        url.searchParams.has("element") && (elementReads += 1) > 1
          ? json({ error: "Failed to load changes" }, 500)
          : served.list(url),
    });
    const user = await renderLoaded();
    const button = await expandRow(user, "Start your 14-day trial");
    server.put(ACME, {
      elementId: HERO_BUTTON.elementId,
      content: "Start your free trial",
      language: "en",
      variant: "default",
    });

    await user.click(
      within(button.region()).getByRole("button", { name: "Discard draft" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Discard this draft?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Discard draft" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(within(button.region()).getByRole("alert")).toHaveTextContent(
      `${UPDATED_ELSEWHERE} The row could not be read again and may be out of date. Reload the page to see it as it is now.`,
    );
    expect(requests(/^\/api\/staging\/content\//, "PUT")).toHaveLength(0);
  });

  // Verification of 63d7ba2 (minor 5): the connection dropped after the
  // server had discarded the draft. The page said "Not discarded. Could not
  // save the draft." and kept drawing the row as Pending.
  it("reads a row again when a Discard's answer was lost, and says the draft may or may not be gone", async () => {
    mockApi({
      rows: [HERO, HERO_BUTTON],
      put: (url, body) => {
        served.put(url, body);
        return Promise.reject(new TypeError("Failed to fetch"));
      },
    });
    const user = await renderLoaded();
    const button = await expandRow(user, "Start your 14-day trial");

    await user.click(
      within(button.region()).getByRole("button", { name: "Discard draft" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Discard this draft?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Discard draft" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(within(button.region()).getByRole("alert")).toHaveTextContent(
      "The connection dropped before the server answered, so the draft may or may not have been discarded. Check the row before trying again.",
    );
    expect(
      within(rowLine("Start free trial")).getByText("Original"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Draft discarded.")).not.toBeInTheDocument();
  });

  it("says a published row may be out of date when it cannot be read again", async () => {
    mockApi({
      rows: [HERO, HERO_BUTTON],
      list: (url) =>
        url.searchParams.has("element")
          ? json({ error: "Failed to load changes" }, 500)
          : served.list(url),
    });
    const user = await renderLoaded();
    const button = await expandRow(user, "Start your 14-day trial");

    await user.click(
      within(button.region()).getByRole("button", { name: "Publish" }),
    );

    expect(await within(button.region()).findByRole("alert")).toHaveTextContent(
      "This went through, but the row could not be read again and may be out of date. Reload the page to see it as it is now.",
    );
    expect(screen.queryByText("Published.")).not.toBeInTheDocument();
  });
});

describe("ChangesView — states", () => {
  it("shows a skeleton while loading, with the filters usable", async () => {
    mockApi({ list: () => new Promise<Response>(() => {}) });

    render(<ChangesView />);

    expect(
      screen.getByRole("status", { name: "Loading changes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Search text or page" }),
    ).toBeEnabled();
  });

  it("asks for a site when the account has none", async () => {
    mockApi({
      list: () =>
        json(
          listBody([], {
            sites: [],
            counts: { pending: 0, published: 0, original: 0 },
          }),
        ),
    });

    render(<ChangesView />);

    expect(
      await screen.findByText("Add a site to see its changes here."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add site" })).toHaveAttribute(
      "href",
      "/dashboard/sites",
    );
  });

  it("says nothing changed yet, and Show all text switches the filter", async () => {
    mockApi({
      list: (url) =>
        url.searchParams.get("state") === "all"
          ? json(
              listBody([
                row("o1", {
                  state: "original",
                  original: "Docs",
                  live: "Docs",
                }),
              ]),
            )
          : json(
              listBody([], {
                counts: { pending: 0, published: 0, original: 1 },
              }),
            ),
    });
    const user = userEvent.setup();
    render(<ChangesView />);

    expect(await screen.findByText("No changes yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all text" }));

    expect(
      await screen.findByText("Docs", {
        selector: "[data-row-text] *, [data-row-text]",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Filter by status" }),
    ).toHaveValue("all");
  });

  it("says nothing matches a search, and Clear search clears it", async () => {
    mockApi({
      list: (url) =>
        url.searchParams.get("q") === "pricng"
          ? json(
              listBody([], {
                counts: { pending: 0, published: 0, original: 0 },
              }),
            )
          : json(listBody()),
    });
    const user = await renderLoaded();

    await user.type(
      screen.getByRole("searchbox", { name: "Search text or page" }),
      "pricng",
    );

    expect(
      await screen.findByText("Nothing matches “pricng”."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(
      screen.getByRole("searchbox", { name: "Search text or page" }),
    ).toHaveValue("");
    expect(
      await screen.findByText("Ship copy changes in minutes, not sprints"),
    ).toBeInTheDocument();
  });

  it.each([
    [
      "a refused read",
      () => json({ error: "Failed to load changes" }, 500),
      "Failed to load changes",
    ],
    [
      "a body that is not a list",
      () => json({ sites: [] }),
      /unexpected response/,
    ],
  ])(
    "reports %s as an error with Try again, never as the empty state",
    async (_label, failing, reason) => {
      let failed = false;
      mockApi({
        list: () => {
          if (failed) return json(listBody());
          failed = true;
          return failing();
        },
      });
      const user = userEvent.setup();
      render(<ChangesView />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Changes could not be loaded.");
      expect(alert).toHaveTextContent(reason);
      expect(screen.queryByText("No changes yet.")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Add a site to see its changes here."),
      ).not.toBeInTheDocument();

      await user.click(
        within(alert).getByRole("button", { name: "Try again" }),
      );
      expect(
        await screen.findByText("Ship copy changes in minutes, not sprints"),
      ).toBeInTheDocument();
    },
  );

  it("offers Show 50 more while the server has more, and appends", async () => {
    mockApi({
      list: (url) =>
        url.searchParams.get("offset") === "0"
          ? json(listBody([HERO], { total: 2, nextOffset: 1 }))
          : json(listBody([PRICING], { total: 2 })),
    });
    const user = await renderLoaded();

    expect(screen.getByText("Showing 1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show 50 more" }));

    expect(
      await screen.findByText("Simple pricing for every team"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ship copy changes in minutes, not sprints"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show 50 more" }),
    ).not.toBeInTheDocument();
  });
});

describe("ChangesView — the list ceiling", () => {
  it("says the list is capped when more match than the route pages to, and offers no next page", async () => {
    mockApi({
      list: () =>
        json(listBody([HERO, PRICING], { total: 12_000, nextOffset: null })),
    });
    await renderLoaded();

    expect(
      screen.getByText(
        "Showing the first 2 of 12,000 — use the filters or search to see more.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show 50 more" }),
    ).not.toBeInTheDocument();
  });

  it("says nothing about a ceiling when every row is shown", async () => {
    await renderLoaded();

    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });
});

describe("ChangesView — filters", () => {
  it("lists the statuses with the server's counts", async () => {
    await renderLoaded();

    const status = screen.getByRole("combobox", { name: "Filter by status" });
    expect(
      within(status)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Changes (7)",
      "Pending (2)",
      "Published (5)",
      "All text (1,245)",
    ]);
  });

  // s70b review M1: a reload emptied the hook's data, and the site select and
  // the status counts are drawn from it, so picking a site unmounted the
  // select under the owner's hand and focus fell to <body>.
  const statusOptions = () =>
    within(screen.getByRole("combobox", { name: "Filter by status" }))
      .getAllByRole("option")
      .map((option) => option.textContent);

  it("keeps the site select, its focus and the counts while the picked site loads", async () => {
    let answer!: () => void;
    mockApi({
      list: (url) =>
        url.searchParams.get("site") === NORTHWIND
          ? new Promise<Response>((resolve) => {
              answer = () => resolve(json(listBody([NW_STEP, NW_TITLE])));
            })
          : json(listBody()),
    });
    const user = await renderLoaded();
    const siteSelect = screen.getByRole("combobox", { name: "Filter by site" });
    const countsBefore = statusOptions();

    await user.selectOptions(siteSelect, NORTHWIND);
    await waitFor(() =>
      expect(
        requests("/api/content/changes").filter(([input]) =>
          String(input).includes(`site=${NORTHWIND}`),
        ),
      ).toHaveLength(1),
    );

    // The rows reload; the filter row does not.
    expect(
      screen.getByRole("status", { name: "Loading changes" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by site" })).toBe(
      siteSelect,
    );
    expect(document.activeElement).toBe(siteSelect);
    expect(siteSelect).toHaveValue(NORTHWIND);
    expect(statusOptions()).toEqual(countsBefore);

    answer();
    expect(
      await screen.findByText("Get started in five minutes"),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(siteSelect);
  });

  it("keeps the filter row mounted while a search reloads the list", async () => {
    mockApi({
      list: (url) =>
        url.searchParams.get("q")
          ? new Promise<Response>(() => {})
          : json(listBody()),
    });
    const user = await renderLoaded();
    const search = screen.getByRole("searchbox", {
      name: "Search text or page",
    });
    const siteSelect = screen.getByRole("combobox", { name: "Filter by site" });
    const countsBefore = statusOptions();

    await user.type(search, "pricing");
    // After the 250 ms debounce, the search is asked for and left pending.
    await waitFor(() =>
      expect(
        requests("/api/content/changes").filter(([input]) =>
          String(input).includes("q=pricing"),
        ),
      ).toHaveLength(1),
    );

    expect(
      screen.getByRole("status", { name: "Loading changes" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by site" })).toBe(
      siteSelect,
    );
    expect(document.activeElement).toBe(search);
    expect(statusOptions()).toEqual(countsBefore);
  });

  it("asks the server for one site when one is picked", async () => {
    const user = await renderLoaded();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by site" }),
      NORTHWIND,
    );

    await waitFor(() =>
      expect(
        requests("/api/content/changes").some(([input]) =>
          String(input).includes(`site=${NORTHWIND}`),
        ),
      ).toBe(true),
    );
  });
});

describe("ChangesView — one site (siteId fixed)", () => {
  it("shows no site select and no site header, and asks for that site only", async () => {
    mockApi({
      list: () => json(listBody([HERO, PRICING])),
    });

    await renderLoaded({ siteId: ACME });

    expect(
      screen.queryByRole("combobox", { name: "Filter by site" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Homepage" }),
    ).toBeInTheDocument();
    for (const [input] of requests("/api/content/changes")) {
      expect(
        new URL(String(input), "http://localhost").searchParams.get("site"),
      ).toBe(ACME);
    }
  });
});
