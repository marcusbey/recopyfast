/**
 * @jest-environment node
 */

/**
 * s65a — GET /api/published/[siteId], the unauthenticated published-copy
 * snapshot (ADR 046).
 *
 * The real `next/server` runs here, not the global stub: the whole point of
 * this route is its headers (what Vercel's CDN may cache, what a browser
 * receives, whether a cookie is set), and the stub is more permissive than the
 * runtime about every one of those. Only `after()` is stubbed, because the
 * content GET used in the parity test schedules liveness work with it and the
 * real one throws outside a request scope.
 *
 * The limiter is the shipped `enforceRateLimit` over its in-memory store;
 * `checkLimit` is spied on only to exhaust the bucket or break the store. The
 * database is an in-memory PostgREST double that PROJECTS the selected
 * columns from full rows carrying every private column, so a route that
 * selected more than the public projection would be caught by its own guard
 * and by the parity test.
 */
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: jest.fn(),
}));

const mockFrom = jest.fn();
const mockCreateServiceRoleClient = jest.fn(() => ({ from: mockFrom }));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => mockCreateServiceRoleClient(),
}));

// Only the content GET (parity) authorizes. The snapshot route must never ask.
jest.mock("@/lib/security/site-auth", () => ({
  ...jest.requireActual("@/lib/security/site-auth"),
  authorizeFirstPartySiteRequest: jest.fn(async () => null),
  authorizeSiteRequest: jest.fn(async () => ({
    site: { id: "unused", domain: "customer.example" },
    allowedOrigin: "https://customer.example",
  })),
  authorizeSiteOrigin: jest.fn(),
}));

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import * as publishedRoute from "@/app/api/published/[siteId]/route";
import { GET as getContent } from "@/app/api/content/[siteId]/route";
import {
  authorizeFirstPartySiteRequest,
  authorizeSiteRequest,
} from "@/lib/security/site-auth";
import { MemoryRateLimiter, rateLimiter } from "@/lib/security/rate-limiter";

const { GET, OPTIONS } = publishedRoute;
const store = rateLimiter as MemoryRateLimiter;

const SITE_ID = "6f1c2b9e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const OTHER_SITE_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const APP = "https://www.recopyfa.st";
const CANONICAL_PRICING = "page=%2Fpricing&language=en&variant=default";

const EXPECTED_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const EXPECTED_CDN_CACHE_CONTROL = "max-age=30, stale-while-revalidate=30";

// ── In-memory PostgREST double ──────────────────────────────────────────────

type Row = Record<string, unknown>;

interface FakeDb {
  sites: Row[];
  content_elements: Row[];
  site_permissions: Row[];
  plan_entitlements: Row[];
}

let db: FakeDb;
let failingTable: keyof FakeDb | null;

function contentRow(overrides: Row): Row {
  return {
    id: `row-${Math.random().toString(36).slice(2, 10)}`,
    site_id: SITE_ID,
    selector: "p",
    original_content: "Authored copy",
    current_content: "Editor working value",
    published_content: "Published copy",
    staging_content: "Unpublished draft",
    staging_updated_at: "2026-10-05T00:00:00.000Z",
    staging_updated_by: "editor-user-id",
    published_by: "publisher-user-id",
    published_at: "2026-10-04T00:00:00.000Z",
    language: "en",
    variant: "default",
    page_path: "/pricing",
    metadata: { type: "p" },
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-05T00:00:00.000Z",
    ...overrides,
  };
}

class FakeQuery
  implements
    PromiseLike<{
      data: Row[] | null;
      error: { message: string } | null;
      count?: number | null;
    }>
{
  private columns: string[] = ["*"];
  private isCountExact = false;
  private readonly filters: Array<(row: Row) => boolean> = [];
  private readonly orders: string[] = [];
  private start = 0;
  private end = Number.POSITIVE_INFINITY;

  constructor(private readonly table: keyof FakeDb) {}

  select(columns: string, options?: { count?: "exact" }) {
    this.columns = columns.split(",").map((column) => column.trim());
    this.isCountExact = options?.count === "exact";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: null) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  order(column: string) {
    this.orders.push(column);
    return this;
  }

  range(start: number, end: number) {
    this.start = start;
    this.end = end;
    return this;
  }

  async maybeSingle() {
    const { data, error } = await this.execute();
    return { data: data?.[0] ?? null, error };
  }

  private project(row: Row): Row {
    if (this.columns.includes("*")) return { ...row };
    return Object.fromEntries(
      this.columns.map((column) => [column, row[column]]),
    );
  }

  private async execute() {
    if (failingTable === this.table) {
      return { data: null, error: { message: "boom" }, count: null };
    }
    const matching = db[this.table].filter((row) =>
      this.filters.every((filter) => filter(row)),
    );
    const sorted = [...matching].sort((left, right) => {
      for (const column of this.orders) {
        const order = String(left[column]).localeCompare(String(right[column]));
        if (order !== 0) return order;
      }
      return 0;
    });
    return {
      data: sorted
        .slice(this.start, this.end + 1)
        .map((row) => this.project(row)),
      error: null,
      count: this.isCountExact ? matching.length : null,
    };
  }

  then<TResult1, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: Row[] | null;
          error: { message: string } | null;
          count?: number | null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

function seedFixture(): FakeDb {
  return {
    sites: [
      { id: SITE_ID, domain: "customer.example", api_key: "secret-api-key" },
      { id: OTHER_SITE_ID, domain: "other.example", api_key: "other-key" },
    ],
    content_elements: [
      contentRow({ id: "p-1", element_id: "hero-title", selector: "h1" }),
      contentRow({
        id: "p-2",
        element_id: "cta-link",
        selector: "a",
        metadata: {
          type: "a",
          attributes: { href: "/signup" },
          staging_attributes: { href: "/unpublished" },
        },
      }),
      contentRow({
        id: "p-3",
        element_id: "never-published",
        published_content: null,
        published_at: null,
      }),
      contentRow({
        id: "p-4",
        element_id: "empty-row",
        published_content: null,
        original_content: null,
        metadata: null,
      }),
      contentRow({ id: "s-1", element_id: "nav-home", page_path: null }),
      contentRow({ id: "o-1", element_id: "about-title", page_path: "/about" }),
      contentRow({
        id: "fr-1",
        element_id: "hero-title",
        language: "fr",
        published_content: "Titre publié",
        metadata: { translatedFrom: "en", aiGenerated: true, tokensUsed: 42 },
      }),
      contentRow({
        id: "v-1",
        element_id: "hero-title",
        variant: "Spring Promo",
        published_content: "Spring headline",
      }),
      contentRow({
        id: "x-1",
        site_id: OTHER_SITE_ID,
        element_id: "hero-title",
        published_content: "Another tenant",
      }),
    ],
    // A lapsed owner: an admin row and no plan. Public delivery never asks.
    site_permissions: [
      { site_id: SITE_ID, user_id: "owner-1", permission: "admin" },
    ],
    plan_entitlements: [],
  };
}

function published(
  query: string,
  init: { siteId?: string; headers?: Record<string, string> } = {},
) {
  const siteId = init.siteId ?? SITE_ID;
  return GET(
    new NextRequest(
      `${APP}/api/published/${siteId}${query ? `?${query}` : ""}`,
      {
        headers: { "x-forwarded-for": "203.0.113.9", ...init.headers },
      },
    ),
    { params: Promise.resolve({ siteId }) },
  );
}

function tablesRead(): string[] {
  return mockFrom.mock.calls.map(([table]) => table as string);
}

async function bodyOf(response: Response) {
  return JSON.parse(await response.text()) as {
    format: string;
    siteId: string;
    pagePath: string;
    language: string;
    variant: string;
    rows: Row[];
  };
}

beforeEach(async () => {
  await store.clearAll();
  db = seedFixture();
  failingTable = null;
  mockFrom.mockReset();
  mockFrom.mockImplementation((table: keyof FakeDb) => new FakeQuery(table));
  mockCreateServiceRoleClient.mockClear();
  jest.mocked(authorizeFirstPartySiteRequest).mockClear();
  jest.mocked(authorizeSiteRequest).mockClear();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/published/[siteId] — a served snapshot", () => {
  it("returns the page and shared rows in the rcf-published-v1 envelope", async () => {
    const response = await published(CANONICAL_PRICING);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);
    expect(Object.keys(body)).toEqual([
      "format",
      "siteId",
      "pagePath",
      "language",
      "variant",
      "rows",
    ]);
    expect(body).toMatchObject({
      format: "rcf-published-v1",
      siteId: SITE_ID,
      pagePath: "/pricing",
      language: "en",
      variant: "default",
    });
    expect(body.rows.map((row) => row.element_id)).toEqual([
      "cta-link",
      "empty-row",
      "hero-title",
      "nav-home",
      "never-published",
    ]);
  });

  it("serves only the public projection, never staging or publisher data", async () => {
    const { rows } = await bodyOf(await published(CANONICAL_PRICING));

    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "current_content",
          "element_id",
          "id",
          "language",
          "metadata",
          "original_content",
          "page_path",
          "published_at",
          "published_content",
          "selector",
          "site_id",
          "variant",
        ].sort(),
      );
      expect(row.metadata).not.toHaveProperty("staging_attributes");
    }
    expect(JSON.stringify(rows)).not.toContain("Unpublished draft");
    expect(JSON.stringify(rows)).not.toContain("/unpublished");
    expect(JSON.stringify(rows)).not.toContain("publisher-user-id");
    expect(JSON.stringify(rows)).not.toContain("Editor working value");
  });

  it("sends the exact cache, validator and CORS headers", async () => {
    const response = await published(CANONICAL_PRICING);
    const text = await response.text();

    expect(response.headers.get("cache-control")).toBe(EXPECTED_CACHE_CONTROL);
    expect(response.headers.get("vercel-cdn-cache-control")).toBe(
      EXPECTED_CDN_CACHE_CONTROL,
    );
    expect(response.headers.get("cdn-cache-control")).toBeNull();
    expect(response.headers.get("etag")).toBe(
      `"${createHash("sha256").update(text).digest("hex")}"`,
    );
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET,OPTIONS",
    );
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("bounds CDN staleness to 60 seconds in total, with no stale-if-error", async () => {
    const response = await published(CANONICAL_PRICING);
    const directives = Object.fromEntries(
      (response.headers.get("vercel-cdn-cache-control") ?? "")
        .split(",")
        .map((directive) => directive.trim().split("="))
        .map(([name, value]) => [name, Number(value)]),
    );

    expect(directives["max-age"] + directives["stale-while-revalidate"]).toBe(
      60,
    );
    for (const header of ["cache-control", "vercel-cdn-cache-control"]) {
      expect(response.headers.get(header)).not.toMatch(/stale-if-error/);
      expect(response.headers.get(header)).not.toMatch(/s-maxage/);
    }
  });

  it("sets no cookie and asks no authorizer even when a session cookie is sent", async () => {
    const response = await published(CANONICAL_PRICING, {
      headers: {
        cookie: "sb-access-token=session; sb-refresh-token=refresh",
        origin: "https://anyone.example",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(authorizeFirstPartySiteRequest).not.toHaveBeenCalled();
    expect(authorizeSiteRequest).not.toHaveBeenCalled();
  });

  it("returns 200 with no rows for a page with no copy", async () => {
    db.content_elements = db.content_elements.filter(
      (row) => row.page_path !== null,
    );

    const response = await published(
      "page=%2Fempty&language=en&variant=default",
    );

    expect(response.status).toBe(200);
    expect((await bodyOf(response)).rows).toEqual([]);
  });

  it("keeps serving a lapsed owner's site and never looks at a plan", async () => {
    const response = await published(CANONICAL_PRICING);

    expect(response.status).toBe(200);
    expect((await bodyOf(response)).rows).toHaveLength(5);
    expect(new Set(tablesRead())).toEqual(
      new Set(["sites", "content_elements"]),
    );
  });
});

describe("retraction and freshness at the origin", () => {
  it("serves the current value once a published value is superseded", async () => {
    const before = await published(CANONICAL_PRICING);
    const beforeTag = before.headers.get("etag");
    db.content_elements = db.content_elements.map((row) =>
      row.id === "p-1"
        ? { ...row, published_content: "Superseding copy" }
        : row,
    );

    const after = await published(CANONICAL_PRICING);
    const afterTag = after.headers.get("etag");
    const { rows } = await bodyOf(after);
    const hero = rows.find((row) => row.id === "p-1");

    expect(hero).toMatchObject({
      published_content: "Superseding copy",
      current_content: "Superseding copy",
    });
    expect(afterTag).not.toBe(beforeTag);
  });

  it("drops a deleted element", async () => {
    db.content_elements = db.content_elements.filter((row) => row.id !== "p-1");

    const { rows } = await bodyOf(await published(CANONICAL_PRICING));

    expect(rows.map((row) => row.id)).not.toContain("p-1");
  });

  it("answers 404 once the site is deleted", async () => {
    db.sites = db.sites.filter((site) => site.id !== SITE_ID);
    db.content_elements = db.content_elements.filter(
      (row) => row.site_id !== SITE_ID,
    );

    const response = await published(CANONICAL_PRICING);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Published copy");
  });

  it("derives a stable strong ETag from unchanged rows", async () => {
    const first = await published(CANONICAL_PRICING);
    const second = await published(CANONICAL_PRICING);

    expect(first.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
  });
});

describe("conditional requests", () => {
  it.each([
    ["the exact tag", (tag: string) => tag],
    ["the weak form of the tag", (tag: string) => `W/${tag}`],
    ["a list containing the tag", (tag: string) => `"other", ${tag}`],
    ["a wildcard", () => "*"],
  ])("answers 304 with no body for %s", async (_label, condition) => {
    const tag = (await published(CANONICAL_PRICING)).headers.get("etag")!;

    const response = await published(CANONICAL_PRICING, {
      headers: { "if-none-match": condition(tag) },
    });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe(tag);
    expect(response.headers.get("cache-control")).toBe(EXPECTED_CACHE_CONTROL);
    expect(response.headers.get("vercel-cdn-cache-control")).toBe(
      EXPECTED_CDN_CACHE_CONTROL,
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers 200 for a stale tag", async () => {
    const response = await published(CANONICAL_PRICING, {
      headers: { "if-none-match": `"${"0".repeat(64)}"` },
    });

    expect(response.status).toBe(200);
  });
});

describe("refusals", () => {
  it.each([
    ["an uppercase site id", SITE_ID.toUpperCase(), CANONICAL_PRICING],
    ["a non-UUID site id", "site-1", CANONICAL_PRICING],
    ["no query", SITE_ID, ""],
    ["a missing parameter", SITE_ID, "page=%2Fpricing&language=en"],
    ["an extra parameter", SITE_ID, `${CANONICAL_PRICING}&cb=1`],
    [
      "a duplicate parameter",
      SITE_ID,
      "page=%2Fpricing&page=%2Fpricing&language=en&variant=default",
    ],
    [
      "reordered parameters",
      SITE_ID,
      "language=en&page=%2Fpricing&variant=default",
    ],
    // Route-level only. These two spellings are refused when the handler is
    // given the raw query, as here. A real Next server re-serializes the query
    // before the handler runs, so in production they arrive as
    // `page=%2Fpricing` and are served as the canonical key (owner decision
    // 2026-10-07, ADR 046; asserted on `next start` by
    // e2e/published-snapshot-ssr.spec.ts). Kept because the parser must still
    // refuse them wherever the raw query is visible.
    ["a literal slash", SITE_ID, "page=/pricing&language=en&variant=default"],
    [
      "lowercase percent hex",
      SITE_ID,
      "page=%2fpricing&language=en&variant=default",
    ],
    [
      "a trailing-slash page",
      SITE_ID,
      "page=%2Fpricing%2F&language=en&variant=default",
    ],
    ["a relative page", SITE_ID, "page=pricing&language=en&variant=default"],
    [
      "an oversized language",
      SITE_ID,
      `page=%2Fpricing&language=${"x".repeat(65)}&variant=default`,
    ],
    [
      "a control character in the variant",
      SITE_ID,
      "page=%2Fpricing&language=en&variant=default%0A",
    ],
  ])(
    "refuses %s with 400 before the limiter or the database",
    async (_label, siteId, query) => {
      const checkLimit = jest.spyOn(rateLimiter, "checkLimit");

      const response = await published(query, { siteId });

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("vercel-cdn-cache-control")).toBeNull();
      expect(response.headers.get("etag")).toBeNull();
      expect(await response.json()).toEqual({ error: expect.any(String) });
      expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
      expect(mockFrom).not.toHaveBeenCalled();
      expect(checkLimit).not.toHaveBeenCalled();
    },
  );

  it("does not echo the rejected value", async () => {
    const response = await published(
      "page=%2Fpricing&language=en&variant=%3Cscript%3E%0A",
    );

    expect(await response.text()).not.toContain("script");
  });

  it("answers an unknown but well-formed site with a negative-cached 404 after one query", async () => {
    const response = await published(CANONICAL_PRICING, {
      siteId: "11111111-2222-4333-8444-555555555555",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Site not found" });
    expect(response.headers.get("cache-control")).toBe(EXPECTED_CACHE_CONTROL);
    expect(response.headers.get("vercel-cdn-cache-control")).toBe(
      EXPECTED_CDN_CACHE_CONTROL,
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(tablesRead()).toEqual(["sites"]);
  });

  it("refuses with 429, uncached, once the IP bucket is spent, before the database", async () => {
    jest.spyOn(rateLimiter, "checkLimit").mockResolvedValue({
      allowed: false,
      totalRequests: 201,
      remaining: 0,
      resetTime: Date.now() + 30_000,
    });

    const response = await published(CANONICAL_PRICING);

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vercel-cdn-cache-control")).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fails open when the limiter store is down — a public read", async () => {
    jest
      .spyOn(rateLimiter, "checkLimit")
      .mockRejectedValue(new Error("redis down"));

    const response = await published(CANONICAL_PRICING);

    expect(response.status).toBe(200);
  });

  it.each(["sites", "content_elements"] as const)(
    "answers an uncached 500 when the %s read fails",
    async (table) => {
      failingTable = table;

      const response = await published(CANONICAL_PRICING);

      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("vercel-cdn-cache-control")).toBeNull();
      expect(await response.text()).not.toContain("boom");
    },
  );

  it("answers an uncached 500 when the service client cannot be built", async () => {
    mockCreateServiceRoleClient.mockImplementationOnce(() => {
      throw new Error(
        "Supabase service role environment variables are not configured",
      );
    });

    const response = await published(CANONICAL_PRICING);

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("environment");
  });

  it("refuses a snapshot over 1 MiB with an uncached, logged 500", async () => {
    db.content_elements.push(
      contentRow({
        id: "huge",
        element_id: "huge",
        published_content: "x".repeat(1024 * 1024),
      }),
    );

    const response = await published(CANONICAL_PRICING);

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vercel-cdn-cache-control")).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("1048576"),
      expect.anything(),
    );
  });
});

describe("OPTIONS /api/published/[siteId]", () => {
  it("is the public 204 preflight, GET only", async () => {
    const response = await OPTIONS(
      new NextRequest(`${APP}/api/published/${SITE_ID}`, { method: "OPTIONS" }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET,OPTIONS",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("no second cache layer", () => {
  it("exports only its handlers — no revalidate, dynamic or fetchCache segment config", () => {
    expect(Object.keys(publishedRoute).sort()).toEqual(["GET", "OPTIONS"]);
  });

  it("uses no Next data cache, reads no cookie and sets no stale-if-error", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/api/published/[siteId]/route.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

    for (const forbidden of [
      "unstable_cache",
      '"use cache"',
      "export const",
      "fetch(",
      "cookies",
      "stale-if-error",
    ]) {
      expect([forbidden, code.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });
});

describe("parity with the widget-authorized content GET", () => {
  it.each([
    ["/pricing", "en", "default"],
    ["/pricing", "fr", "default"],
    ["/pricing", "en", "Spring Promo"],
    ["/", "en", "default"],
  ])(
    "serves the same rows for page %s, language %s, variant %s",
    async (pagePath, language, variant) => {
      const contentResponse = await getContent(
        new NextRequest(
          `${APP}/api/content/${SITE_ID}?${new URLSearchParams({
            page_path: pagePath,
            language,
            variant,
          }).toString()}`,
          {
            headers: {
              authorization: "Bearer site-token",
              origin: "https://customer.example",
              "x-forwarded-for": "203.0.113.9",
            },
          },
        ),
        { params: Promise.resolve({ siteId: SITE_ID }) },
      );
      expect(contentResponse.status).toBe(200);
      expect(authorizeSiteRequest).toHaveBeenCalled();
      const contentRows = (await contentResponse.json()) as Row[];

      const snapshot = await bodyOf(
        await published(
          new URLSearchParams([
            ["page", pagePath],
            ["language", language],
            ["variant", variant],
          ]).toString(),
        ),
      );

      expect(contentRows.length).toBeGreaterThan(0);
      expect(snapshot.rows).toStrictEqual(contentRows);
    },
  );
});
