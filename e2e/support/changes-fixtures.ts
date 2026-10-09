import type { Page, Request } from "@playwright/test";

/**
 * Fixture data for the Changes page harness (s70b). Every list the page reads
 * is fulfilled here by `page.route`, so the layout is measured on a known,
 * realistic shape — two sites, several pages, an author id, a pending draft —
 * and no real copy, domain or address reaches a capture: every domain ends in
 * `.example`, every address is `@example.com`.
 *
 * The element ids and selectors are the embed's real shapes (`rcf-…`,
 * `div:nth-child(…) > …`) on purpose: the spec asserts none of them reaches
 * the page.
 */

export const ACME_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const NORTHWIND_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const SITES = [
  {
    id: ACME_ID,
    name: "Acme Studio",
    domain: "acme.example",
    permission: "admin",
  },
  {
    id: NORTHWIND_ID,
    name: "Northwind Docs",
    domain: "docs.northwind.example",
    permission: "edit",
  },
] as const;

/** The published hero heading the revert test acts on. */
export const HERO = {
  id: "11111111-0000-4000-8000-000000000001",
  elementId: "rcf-1gom2eazz3g",
  original: "Copy changes without a developer",
  live: "Ship copy changes in minutes, not sprints",
  language: "en",
  variant: "default",
} as const;

/** Northwind's pending draft: the row a Northwind-only list shows. */
export const NORTHWIND_DRAFT =
  "Paste the snippet just before the closing body tag";

const MINUTE = 60 * 1000;
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * MINUTE).toISOString();

function rows() {
  const base = {
    language: "en",
    variant: "default",
    draft: null as string | null,
    // The list route's contract: the attributes a pending draft stages. None
    // here, so Discard is offered as for any text draft.
    draftAttributes: [] as Array<{ name: string; live: string | null }>,
    // Every fixture row has published text of its own (none is a translation
    // never published, which is offered no Discard).
    hasLiveText: true,
    changedBy: null as string | null,
    createdAt: "2026-09-28T09:00:00.000Z",
  };
  return [
    {
      ...base,
      id: "11111111-0000-4000-8000-000000000002",
      siteId: ACME_ID,
      elementId: "rcf-v6di4rh42g",
      pagePath: "/",
      elementType: "button",
      selector:
        "#root > main > section.hero > div.actions > button:nth-child(1)",
      original: "Start free trial",
      live: "Start free trial",
      draft: "Start your 14-day trial",
      state: "pending",
      changedAt: ago(25),
      changedBy: "sam@example.com",
    },
    {
      ...base,
      id: HERO.id,
      siteId: ACME_ID,
      elementId: HERO.elementId,
      pagePath: "/",
      elementType: "h1",
      selector: "#root > main > section.hero > h1",
      original: HERO.original,
      live: HERO.live,
      state: "published",
      changedAt: ago(120),
      changedBy: "ana@example.com",
    },
    {
      ...base,
      id: "11111111-0000-4000-8000-000000000003",
      siteId: ACME_ID,
      elementId: "rcf-t2e2dmuv2h",
      pagePath: "/",
      elementType: "p",
      selector: "#root > main > section.hero > p",
      original: "ReCopyFast lets your team edit the words on your site.",
      live: "Your team edits the words on your site. Developers keep shipping features, and nobody waits on a deploy to fix a typo in the pricing table.",
      state: "published",
      changedAt: ago(60 * 20),
      changedBy: "ana@example.com",
    },
    {
      ...base,
      id: "11111111-0000-4000-8000-000000000004",
      siteId: ACME_ID,
      elementId: "rcf-20ocfyq5in4",
      pagePath: "/pricing",
      elementType: "h2",
      selector: "#pricing > header > h2",
      original: "Pricing",
      live: "Simple pricing for every team",
      state: "published",
      changedAt: ago(60 * 72),
      changedBy: "ana@example.com",
    },
    {
      ...base,
      id: "11111111-0000-4000-8000-000000000005",
      siteId: ACME_ID,
      elementId: "footer-tagline",
      pagePath: null,
      elementType: "p",
      selector: '[data-rcf-id="footer-tagline"]',
      original: "Made with care",
      live: "Made in Lisbon, shipped everywhere",
      state: "published",
      changedAt: ago(60 * 120),
    },
    {
      ...base,
      id: "22222222-0000-4000-8000-000000000001",
      siteId: NORTHWIND_ID,
      elementId: "rcf-1w2a7y89hxn",
      pagePath: "/getting-started",
      elementType: "li",
      selector: "#__next > main > article > ol > li:nth-child(2)",
      original: "Paste the snippet in your head tag",
      live: "Paste the snippet in your head tag",
      draft: NORTHWIND_DRAFT,
      state: "pending",
      changedAt: ago(180),
    },
    {
      ...base,
      id: "22222222-0000-4000-8000-000000000002",
      siteId: NORTHWIND_ID,
      elementId: "rcf-12v7zi61en4",
      pagePath: "/changelog",
      elementType: "img",
      selector: "#__next > header > a > img",
      original: "https://cdn.northwind.example/img/logo.png",
      live: "https://cdn.northwind.example/img/logo-2026.png",
      state: "published",
      changedAt: ago(60 * 144),
    },
  ];
}

/** Each site's untouched rows, never listed by default, only counted. */
const ORIGINAL_ROWS: Record<string, number> = {
  [ACME_ID]: 412,
  [NORTHWIND_ID]: 826,
};

export interface FixtureCounts {
  pending: number;
  published: number;
  original: number;
}

/**
 * The status counts the list answers for one site, or every site (null).
 * Different per site on purpose (s70b re-review N3): with one set of counts
 * for every answer, "the counts stay put while the list reloads" held even
 * when the filter row was rebuilt from nothing.
 */
export function countsFor(site: string | null): FixtureCounts {
  return countsOf(rows(), site);
}

type FixtureRow = ReturnType<typeof rows>[number];

function countsOf(
  fixtureRows: FixtureRow[],
  site: string | null,
): FixtureCounts {
  const listed = fixtureRows.filter(
    (row) => site === null || row.siteId === site,
  );
  const sites = site === null ? Object.keys(ORIGINAL_ROWS) : [site];
  return {
    pending: listed.filter((row) => row.state === "pending").length,
    published: listed.filter((row) => row.state === "published").length,
    original: sites.reduce((sum, id) => sum + (ORIGINAL_ROWS[id] ?? 0), 0),
  };
}

/**
 * A draft saved through the staging PUT, as the view then reads the row:
 * pending while the draft differs from the live text (s70b fix pass: the page
 * reads the row again after every write, so the fixture must remember it).
 */
function withDraft(row: FixtureRow, content: string): FixtureRow {
  const state =
    content !== row.live
      ? "pending"
      : row.live !== row.original
        ? "published"
        : "original";
  return {
    ...row,
    draft: content,
    state,
    changedAt: new Date().toISOString(),
  };
}

/** A publish, as the RPC does it: every pending row of the element ids. */
function published(row: FixtureRow): FixtureRow {
  return {
    ...row,
    live: row.draft ?? row.live,
    draft: null,
    draftAttributes: [],
    state: "published",
    changedAt: new Date().toISOString(),
  };
}

/** Every element id the embed assigned in the fixture: none may be shown. */
export const EMBED_ELEMENT_IDS = rows()
  .map((row) => row.elementId)
  .filter((elementId) => elementId.startsWith("rcf-"));

/** Every recorded selector in the fixture: none may be shown either. */
export const SELECTORS = rows().map((row) => row.selector);

export interface ChangesFixtureLog {
  /** Every list read's `site` parameter (null: all sites), in order. */
  listSites: Array<string | null>;
  /** Every history read, by row id. */
  historyReads: string[];
  /** Every draft PUT body, parsed. */
  draftBodies: unknown[];
  /** Every publish POST body, parsed. */
  publishBodies: unknown[];
}

export interface ChangesFixtures extends ChangesFixtureLog {
  /**
   * The next list read is answered only once the returned function is
   * called, so a spec can look at the page while the list reloads.
   */
  holdNextList(): () => void;
}

function json(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

/**
 * Answers the Changes page's reads and writes from the fixture: the list,
 * each row's history, the staging draft PUT and the publish POST. Nothing
 * reaches the real routes. The list answers as the route does for its `site`
 * (and `element`, the page's re-read after a write): that site's rows and
 * counts, or every site's. Writes change the fixture, so a read after a
 * write sees them, as on the real routes. Returns a log the spec asserts on,
 * and a hold on the next list read.
 */
export async function routeChangesFixtures(
  page: Page,
): Promise<ChangesFixtures> {
  let held: Promise<void> | null = null;
  const log: ChangesFixtures = {
    listSites: [],
    historyReads: [],
    draftBodies: [],
    publishBodies: [],
    holdNextList() {
      let release: () => void = () => {};
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release();
    },
  };
  let fixtureRows = rows();

  await page.route(
    (url) => url.pathname === "/api/content/changes",
    async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const params = new URL(route.request().url()).searchParams;
      const site = params.get("site");
      const element = params.get("element");
      log.listSites.push(site);
      const gate = held;
      held = null;
      if (gate) await gate;
      const listed = fixtureRows.filter(
        (row) =>
          (site === null || row.siteId === site) &&
          (element === null || row.elementId === element),
      );
      await route.fulfill(
        json({
          sites: SITES,
          rows: listed,
          total: listed.length,
          counts: countsOf(fixtureRows, site),
          nextOffset: null,
        }),
      );
    },
  );

  await page.route(
    (url) => /^\/api\/content\/changes\/[^/]+\/history$/.test(url.pathname),
    async (route) => {
      const rowId = new URL(route.request().url()).pathname.split("/")[4];
      log.historyReads.push(rowId);
      const isAcme = fixtureRows.some(
        (row) => row.id === rowId && row.siteId === ACME_ID,
      );
      await route.fulfill(
        json(
          isAcme
            ? {
                historyVisible: true,
                discoveredAt: "2026-09-28T09:00:00.000Z",
                events: [
                  {
                    id: "33333333-0000-4000-8000-000000000001",
                    action: "publish",
                    by: "ana@example.com",
                    at: ago(120),
                    previous: HERO.original,
                    content: HERO.live,
                  },
                  {
                    id: "33333333-0000-4000-8000-000000000002",
                    action: "update",
                    by: "sam@example.com",
                    at: ago(130),
                    previous: HERO.original,
                    content: HERO.live,
                  },
                ],
              }
            : {
                historyVisible: false,
                events: [],
                discoveredAt: "2026-09-28T09:00:00.000Z",
              },
        ),
      );
    },
  );

  await page.route(
    (url) => url.pathname.startsWith("/api/staging/content/"),
    async (route) => {
      const request: Request = route.request();
      if (request.method() !== "PUT") return route.continue();
      const body = request.postDataJSON() as {
        elementId: string;
        content: string;
        language: string;
        variant: string;
      };
      log.draftBodies.push(body);
      const siteId = new URL(request.url()).pathname.split("/").pop();
      fixtureRows = fixtureRows.map((row) =>
        row.siteId === siteId &&
        row.elementId === body.elementId &&
        row.language === body.language &&
        row.variant === body.variant
          ? withDraft(row, body.content)
          : row,
      );
      await route.fulfill(
        json({
          success: true,
          elementId: body.elementId,
          updatedAt: new Date().toISOString(),
        }),
      );
    },
  );

  await page.route(
    (url) => url.pathname === "/api/staging/publish",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON() as {
        siteId: string;
        elementIds: string[];
      };
      log.publishBodies.push(body);
      fixtureRows = fixtureRows.map((row) =>
        row.siteId === body.siteId &&
        body.elementIds.includes(row.elementId) &&
        row.state === "pending"
          ? published(row)
          : row,
      );
      await route.fulfill(json({ success: true }));
    },
  );

  return log;
}
