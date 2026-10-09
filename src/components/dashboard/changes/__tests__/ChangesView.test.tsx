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

interface Api {
  list: (url: URL) => Response | Promise<Response>;
  history: (rowId: string) => Response;
  put: () => Response;
  publish: () => Response;
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

function mockApi(overrides: Partial<Api> = {}) {
  api = {
    list: () => json(listBody()),
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
    put: () => json({ success: true }),
    publish: () => json({ success: true }),
    ...overrides,
  };
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = init?.method ?? "GET";
      const history = /^\/api\/content\/changes\/([^/]+)\/history$/.exec(
        url.pathname,
      );
      if (history) return api.history(history[1]);
      if (url.pathname === "/api/content/changes") return api.list(url);
      if (
        method === "PUT" &&
        url.pathname.startsWith("/api/staging/content/")
      ) {
        return api.put();
      }
      if (method === "POST" && url.pathname === "/api/staging/publish") {
        return api.publish();
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
