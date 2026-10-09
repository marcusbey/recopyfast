/**
 * @jest-environment node
 *
 * s70b — GET /api/content/changes, the Changes page's one read.
 *
 * The old Content page waited on the ~4 s GET /api/sites, then downloaded
 * every row of every site from the widget's read and filtered in the browser.
 * This route returns the caller's sites itself and 50 rows of the
 * security-invoker view (ADR 054), filtered, counted and paged by Postgres.
 * Every read runs on the RLS client: the service role is never imported, so a
 * missing site filter here could never become a cross-tenant read.
 *
 * Pinned: the limiter runs before `getUser()` (AGENTS.md, rate limit before
 * authorization), 401 / 404 / 400 / generic 500, the filters each state maps
 * to, `q` regex-escaped and reaching one `imatch` filter only (never an
 * `.or()` string built from input), bounded offsets, and counts that share
 * the list's filters.
 */

import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));

// Set only if something imports the service client; it must stay unset: this
// route reads as the signed-in user, never around RLS. A global, because the
// factory runs when the route is imported, before this file's own `let`s exist.
const serviceImportFlag = "__rcfS70bServiceClientImported";
jest.mock("@/lib/supabase/service", () => {
  (globalThis as Record<string, unknown>).__rcfS70bServiceClientImported = true;
  return { createServiceRoleClient: jest.fn() };
});

type Call = [string, ...unknown[]];
interface RecordedQuery {
  table: string;
  calls: Call[];
}
interface QueryResult {
  data: unknown;
  error: unknown;
  count: number | null;
}

const mockRecorded: RecordedQuery[] = [];
let mockRespond: (query: RecordedQuery) => QueryResult;
const mockGetUser = jest.fn();

function mockBuilder(table: string): unknown {
  const query: RecordedQuery = { table, calls: [] };
  mockRecorded.push(query);
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === "then") {
          return (
            resolve: (value: QueryResult) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(mockRespond(query)).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          query.calls.push([property, ...args]);
          return builder;
        };
      },
    },
  );
  return builder;
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => mockBuilder(table),
  })),
}));

import { GET } from "@/app/api/content/changes/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SITE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SITE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STRANGER_SITE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const MEMBERSHIPS = [
  {
    permission: "admin",
    sites: { id: SITE_B, name: "Northwind Docs", domain: "docs.example" },
  },
  {
    permission: "edit",
    sites: { id: SITE_A, name: "Acme Studio", domain: "acme.example" },
  },
];

function viewRow(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `row-${index}`,
    site_id: SITE_A,
    element_id: `rcf-${index}`,
    page_path: "/",
    selector: "#root > main > h1",
    language: "en",
    variant: "default",
    element_type: "h1",
    original_content: "Original",
    published_content: "Live",
    staging_content: null,
    change_state: "published",
    changed_at: "2026-10-08T10:00:00+00:00",
    changed_by: "ana@example.com",
    created_at: "2026-09-28T09:00:00+00:00",
    ...overrides,
  };
}

const isHead = (query: RecordedQuery) =>
  query.calls.some(
    ([method, , options]) =>
      method === "select" &&
      (options as { head?: boolean } | undefined)?.head === true,
  );
const contentQueries = () =>
  mockRecorded.filter((query) => query.table === "content_changes");
const listQuery = () => contentQueries().find((query) => !isHead(query))!;
const countQueries = () => contentQueries().filter(isHead);
const callsOf = (query: RecordedQuery, method: string) =>
  query.calls.filter(([name]) => name === method).map(([, ...args]) => args);

function defaultResponder(rows: unknown[], total: number) {
  return (query: RecordedQuery): QueryResult => {
    if (query.table === "site_permissions") {
      return { data: MEMBERSHIPS, error: null, count: null };
    }
    if (isHead(query)) {
      const state = callsOf(query, "eq").find(
        ([column]) => column === "change_state",
      )?.[1];
      const counts: Record<string, number> = {
        pending: 3,
        published: 12,
        original: 1233,
      };
      return { data: null, error: null, count: counts[String(state)] ?? 0 };
    }
    return { data: rows, error: null, count: total };
  };
}

function get(query = ""): Promise<Response> {
  return GET(
    new NextRequest(`http://localhost/api/content/changes${query}`),
  ) as Promise<Response>;
}

describe("GET /api/content/changes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecorded.length = 0;
    (enforceRateLimit as jest.Mock).mockResolvedValue(null);
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockRespond = defaultResponder([viewRow(1)], 1);
  });

  it("runs an IP limiter, failing open, before it asks who the caller is", async () => {
    await get();

    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        limit: "IP_GENERAL",
        identifierType: "ip",
        onStoreFailure: "allow",
      }),
    );
    expect(
      (enforceRateLimit as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(mockGetUser.mock.invocationCallOrder[0]);
  });

  it("answers the limiter's refusal without reading anything", async () => {
    (enforceRateLimit as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
    );

    const response = await get();

    expect(response.status).toBe(429);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockRecorded).toEqual([]);
  });

  it("answers 401 to a caller who is not signed in, and reads nothing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await get();

    expect(response.status).toBe(401);
    expect(mockRecorded).toEqual([]);
  });

  it("reads the caller's sites from site_permissions with sites(id, name, domain), for this user only", async () => {
    const response = await get();
    const body = await response.json();

    const [membership] = mockRecorded.filter(
      (query) => query.table === "site_permissions",
    );
    expect(callsOf(membership, "select")).toEqual([
      ["permission, sites(id, name, domain)"],
    ]);
    expect(callsOf(membership, "eq")).toEqual([["user_id", USER_ID]]);
    expect(body.sites).toEqual([
      {
        id: SITE_A,
        name: "Acme Studio",
        domain: "acme.example",
        permission: "edit",
      },
      {
        id: SITE_B,
        name: "Northwind Docs",
        domain: "docs.example",
        permission: "admin",
      },
    ]);
    expect(mockRecorded.map((query) => query.table)).not.toContain("sites");
  });

  it("scopes every content read to the caller's sites when no site is named", async () => {
    await get();

    for (const query of contentQueries()) {
      expect(callsOf(query, "in")).toContainEqual([
        "site_id",
        [SITE_A, SITE_B],
      ]);
    }
  });

  it("answers 404 for a site that is not one of the caller's, with no content query", async () => {
    const response = await get(`?site=${STRANGER_SITE}`);

    expect(response.status).toBe(404);
    expect(contentQueries()).toEqual([]);
  });

  it("narrows to one of the caller's sites when it is named", async () => {
    await get(`?site=${SITE_A}`);

    for (const query of contentQueries()) {
      expect(callsOf(query, "eq")).toContainEqual(["site_id", SITE_A]);
    }
  });

  it.each([
    ["", ["pending", "published"]],
    ["?state=changes", ["pending", "published"]],
  ])("filters %p to pending and published", async (query, states) => {
    await get(query);

    expect(callsOf(listQuery(), "in")).toContainEqual(["change_state", states]);
  });

  it.each(["pending", "published"])(
    "filters state=%s to that state",
    async (state) => {
      await get(`?state=${state}`);

      expect(callsOf(listQuery(), "eq")).toContainEqual([
        "change_state",
        state,
      ]);
    },
  );

  it("adds original rows under state=all", async () => {
    await get("?state=all");

    expect(
      [...callsOf(listQuery(), "eq"), ...callsOf(listQuery(), "in")].filter(
        ([column]) => column === "change_state",
      ),
    ).toEqual([]);
  });

  it("orders newest change first, 50 rows from the offset, with an exact count", async () => {
    await get("?offset=100");

    const list = listQuery();
    expect(callsOf(list, "select")[0][1]).toEqual({ count: "exact" });
    expect(callsOf(list, "order")).toEqual([
      ["changed_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(callsOf(list, "range")).toEqual([[100, 149]]);
  });

  // `.filter(column, "imatch", value)`: one `search_text=imatch.<value>`
  // query parameter, the value percent-encoded by URLSearchParams and bound
  // by PostgREST as one literal (postgrest-js PostgrestFilterBuilder.filter).
  const searchFilters = (query: RecordedQuery) =>
    callsOf(query, "filter").filter(([column]) => column === "search_text");

  it("regex-escapes q and sends it to one imatch filter on search_text only", async () => {
    await get(`?q=${encodeURIComponent("50%_off\\")}`);

    for (const query of contentQueries()) {
      expect(searchFilters(query)).toEqual([
        ["search_text", "imatch", "50%_off\\\\"],
      ]);
      expect(callsOf(query, "ilike")).toEqual([]);
    }
    const everyCall = mockRecorded.flatMap((query) => query.calls);
    expect(everyCall.filter(([method]) => method === "or")).toEqual([]);
    const carryingQ = everyCall.filter((call) =>
      JSON.stringify(call).includes("50"),
    );
    expect(carryingQ.every(([method]) => method === "filter")).toBe(true);
  });

  // s70b re-review N1 (after review m1): `*` was refused with a 400, which
  // the page showed as "could not be loaded", its Try again repeating the
  // 400. Under `imatch` PostgREST leaves `*` alone (it rewrites `*` to `%`
  // for like/ilike only), so `\*` is a literal star and the search works.
  it("answers 5* with 200, searching for a literal star", async () => {
    const response = await get(`?q=${encodeURIComponent("5*")}`);

    expect(response.status).toBe(200);
    expect(contentQueries()).toHaveLength(4);
    for (const query of contentQueries()) {
      expect(searchFilters(query)).toEqual([["search_text", "imatch", "5\\*"]]);
    }
  });

  it("keeps % and _ literal: 50%_off is sent as typed, not as a wildcard", async () => {
    const response = await get(`?q=${encodeURIComponent("50%_off")}`);

    expect(response.status).toBe(200);
    for (const query of contentQueries()) {
      expect(searchFilters(query)).toEqual([
        ["search_text", "imatch", "50%_off"],
      ]);
    }
  });

  it.each([
    ["offset=-1"],
    ["offset=10001"],
    ["offset=abc"],
    ["offset=1.5"],
    ["state=edited"],
    [`q=${"a".repeat(201)}`],
  ])("answers 400 to %s, with no content query", async (query) => {
    const response = await get(`?${query}`);

    expect(response.status).toBe(400);
    expect(contentQueries()).toEqual([]);
  });

  it("counts pending, published and original with head queries carrying the same filters", async () => {
    const response = await get(`?site=${SITE_A}&q=hero`);
    const body = await response.json();

    const heads = countQueries();
    expect(heads).toHaveLength(3);
    for (const head of heads) {
      expect(callsOf(head, "select")[0][1]).toEqual({
        count: "exact",
        head: true,
      });
      expect(callsOf(head, "eq")).toContainEqual(["site_id", SITE_A]);
      expect(searchFilters(head)).toEqual([["search_text", "imatch", "hero"]]);
    }
    expect(
      heads
        .map(
          (head) =>
            callsOf(head, "eq").find(
              ([column]) => column === "change_state",
            )?.[1],
        )
        .sort(),
    ).toEqual(["original", "pending", "published"]);
    expect(body.counts).toEqual({ pending: 3, published: 12, original: 1233 });
  });

  it("maps rows to the contract and offers the next offset while more remain", async () => {
    mockRespond = defaultResponder(
      Array.from({ length: 50 }, (_, index) => viewRow(index)),
      120,
    );

    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(120);
    expect(body.nextOffset).toBe(50);
    expect(body.rows[0]).toEqual({
      id: "row-0",
      siteId: SITE_A,
      elementId: "rcf-0",
      pagePath: "/",
      elementType: "h1",
      selector: "#root > main > h1",
      language: "en",
      variant: "default",
      original: "Original",
      live: "Live",
      draft: null,
      state: "published",
      changedAt: "2026-10-08T10:00:00+00:00",
      changedBy: "ana@example.com",
      createdAt: "2026-09-28T09:00:00+00:00",
    });
  });

  it("reads Live now as the original when the row was never published, and hides a writer that is not an address", async () => {
    mockRespond = defaultResponder(
      [viewRow(1, { published_content: null, changed_by: "edit-session" })],
      1,
    );

    const body = await (await get()).json();

    expect(body.rows[0].live).toBe("Original");
    expect(body.rows[0].changedBy).toBeNull();
  });

  it("answers nextOffset null on the last page", async () => {
    mockRespond = defaultResponder([viewRow(1), viewRow(2)], 52);

    const body = await (await get("?offset=50")).json();

    expect(body.nextOffset).toBeNull();
  });

  it("answers an empty account without querying content", async () => {
    mockRespond = (query) =>
      query.table === "site_permissions"
        ? { data: [], error: null, count: null }
        : defaultResponder([], 0)(query);

    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      sites: [],
      rows: [],
      total: 0,
      counts: { pending: 0, published: 0, original: 0 },
      nextOffset: null,
    });
    expect(contentQueries()).toEqual([]);
  });

  it.each(["site_permissions", "list", "count"])(
    "answers a generic 500 when the %s read fails, with no detail",
    async (which) => {
      const failure = {
        code: "42P01",
        message: 'relation "public.content_changes" does not exist',
      };
      const base = defaultResponder([viewRow(1)], 1);
      mockRespond = (query) => {
        const failing =
          (which === "site_permissions" &&
            query.table === "site_permissions") ||
          (which === "list" &&
            query.table === "content_changes" &&
            !isHead(query)) ||
          (which === "count" && isHead(query));
        return failing
          ? { data: null, error: failure, count: null }
          : base(query);
      };
      const errorLog = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const response = await get();

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Failed to load changes",
      });
      expect(errorLog).toHaveBeenCalled();
      errorLog.mockRestore();
    },
  );

  it("never imports the service-role client", async () => {
    await get();

    expect(
      (globalThis as Record<string, unknown>)[serviceImportFlag],
    ).toBeUndefined();
  });
});
