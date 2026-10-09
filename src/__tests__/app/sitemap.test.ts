/**
 * @jest-environment node
 */

/**
 * s88 — the sitemap lists what is really published, read as `anon`.
 *
 * Until s88 the sitemap read blog posts through the cookie client: the route
 * rendered (and queried the database) on every crawler fetch, the read ran as
 * whoever's cookies arrived, a failed read dropped every post without a log
 * line, every static URL said it changed "now", /docs/install was missing, and
 * two bare auth forms were listed.
 *
 * The fake below is the `blog_posts` table with no RLS at all — the worst case,
 * as if someone pointed the sitemap at the service role. It applies the query's
 * own `eq` filters to its rows, so "drafts are never listed" is pinned to the
 * sitemap's own filter, not to a policy the test cannot see.
 */

import type { MetadataRoute } from "next";

jest.mock("@/lib/supabase/anon", () => ({ createAnonClient: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => {
    throw new Error("the sitemap must not read through the cookie client");
  }),
}));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => {
    throw new Error("the sitemap must not read through the service role");
  }),
}));

import sitemap, { revalidate } from "@/app/sitemap";
import { createAnonClient } from "@/lib/supabase/anon";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { comparisonList } from "@/lib/compare/comparisons";
import { resolveSiteUrl } from "@/lib/seo/site-url";

type Row = {
  slug: string;
  status: "draft" | "published" | "archived";
  published_at: string | null;
  updated_at: string | null;
  content?: string;
};

type QueryResult = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

/** `blog_posts` as a plain table: filters are the caller's, nothing else. */
function fakeTable(rows: Row[], failWith?: string) {
  return {
    from(table: string) {
      if (table !== "blog_posts") {
        throw new Error(`unexpected table ${table}`);
      }
      let visible: Row[] = [...rows];
      let columns: string[] = [];
      const query = {
        select(selection: string) {
          columns = selection.split(",").map((column) => column.trim());
          return query;
        },
        eq(column: keyof Row, value: unknown) {
          visible = visible.filter((row) => row[column] === value);
          return query;
        },
        order() {
          return query;
        },
        then(resolve: (result: QueryResult) => unknown) {
          if (failWith) {
            return Promise.resolve(
              resolve({ data: null, error: { message: failWith } }),
            );
          }
          const data = visible.map((row) =>
            Object.fromEntries(
              columns.map((column) => [column, row[column as keyof Row]]),
            ),
          );
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return query;
    },
  };
}

const mockedAnon = jest.mocked(createAnonClient);
const siteUrl = resolveSiteUrl();

function paths(entries: MetadataRoute.Sitemap): string[] {
  return entries.map((entry) => new URL(entry.url).pathname);
}

function entryFor(entries: MetadataRoute.Sitemap, pathname: string) {
  return entries.find((entry) => new URL(entry.url).pathname === pathname);
}

/** Every page that resolves a canonical to itself (seo-canonicals.test.ts). */
const INDEXABLE_STATIC = [
  "/",
  "/demo",
  "/try",
  "/compare",
  ...comparisonList.map((comparison) => `/compare/${comparison.slug}`),
  "/blog",
  "/privacy",
  "/terms",
  "/docs/install",
];

const ROWS: Row[] = [
  {
    slug: "client-editing-guide",
    status: "published",
    published_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
  },
  {
    slug: "never-edited",
    status: "published",
    published_at: "2026-08-15T00:00:00.000Z",
    updated_at: null,
  },
  {
    slug: "undated",
    status: "published",
    published_at: null,
    updated_at: null,
  },
  {
    slug: "unreviewed-ai-draft",
    status: "draft",
    published_at: null,
    updated_at: "2026-10-01T00:00:00.000Z",
  },
  {
    slug: "retired-post",
    status: "archived",
    published_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  },
];

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  mockedAnon.mockReturnValue(fakeTable(ROWS) as never);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("blog posts in the sitemap", () => {
  it("lists published posts and never a draft or an archived post", async () => {
    const listed = paths(await sitemap()).filter((path) =>
      path.startsWith("/blog/"),
    );

    expect(listed.sort()).toEqual(
      [
        "/blog/client-editing-guide",
        "/blog/never-edited",
        "/blog/undated",
      ].sort(),
    );
  });

  it("reads as anon: never the cookie client, never the service role", async () => {
    await sitemap();

    expect(mockedAnon).toHaveBeenCalled();
    expect(createCookieClient).not.toHaveBeenCalled();
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("dates a post by its last update, else its publication, else not at all", async () => {
    const entries = await sitemap();

    expect(
      entryFor(entries, "/blog/client-editing-guide")?.lastModified,
    ).toEqual(new Date("2026-09-20T00:00:00.000Z"));
    expect(entryFor(entries, "/blog/never-edited")?.lastModified).toEqual(
      new Date("2026-08-15T00:00:00.000Z"),
    );
    expect(entryFor(entries, "/blog/undated")).toBeDefined();
    expect(entryFor(entries, "/blog/undated")).not.toHaveProperty(
      "lastModified",
    );
  });
});

describe("pages in the sitemap", () => {
  it("lists exactly the indexable pages, /docs/install included", async () => {
    mockedAnon.mockReturnValue(fakeTable([]) as never);

    const listed = paths(await sitemap());

    expect([...listed].sort()).toEqual([...INDEXABLE_STATIC].sort());
  });

  it.each(["/login", "/signup", "/edit", "/dashboard", "/settings"])(
    "does not list %s",
    async (pathname) => {
      expect(paths(await sitemap())).not.toContain(pathname);
    },
  );

  it("lists nothing under /dashboard, /api or /auth, and no URL twice", async () => {
    const listed = paths(await sitemap());

    expect(
      listed.filter((path) => /^\/(dashboard|api|auth)(\/|$)/.test(path)),
    ).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("claims no modification date for a page that records none", async () => {
    const entries = await sitemap();

    for (const pathname of INDEXABLE_STATIC) {
      expect([pathname, entryFor(entries, pathname)]).toEqual([
        pathname,
        expect.not.objectContaining({ lastModified: expect.anything() }),
      ]);
    }
  });

  it("puts every URL on the configured origin", async () => {
    for (const entry of await sitemap()) {
      expect(entry.url.startsWith(`${siteUrl}/`)).toBe(true);
    }
  });
});

describe("when the database cannot answer", () => {
  it("logs a failed query and still lists every page", async () => {
    mockedAnon.mockReturnValue(fakeTable(ROWS, "permission denied") as never);

    const listed = paths(await sitemap());

    expect([...listed].sort()).toEqual([...INDEXABLE_STATIC].sort());
    expect(consoleError).toHaveBeenCalled();
  });

  it("logs an unconfigured client and still lists every page", async () => {
    mockedAnon.mockImplementation(() => {
      throw new Error("Supabase anon client is unconfigured");
    });

    const listed = paths(await sitemap());

    expect([...listed].sort()).toEqual([...INDEXABLE_STATIC].sort());
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("freshness", () => {
  it("is regenerated on a schedule, not on every request nor never", () => {
    // Without `cookies()` the route is static: with no `revalidate` it would be
    // built once per deploy and a post published afterwards would never appear.
    expect(typeof revalidate).toBe("number");
    expect(revalidate).toBeGreaterThan(0);
    expect(revalidate).toBeLessThanOrEqual(24 * 60 * 60);
  });
});
