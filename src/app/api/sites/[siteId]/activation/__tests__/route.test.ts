import { NextRequest } from "next/server";
import { GET, POST } from "../route";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(),
}));

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SITE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface FakeQueryResult {
  data: unknown;
  error: unknown;
}

interface FakeQuery {
  select(columns: string): FakeQuery;
  eq(column: string, value: unknown): FakeQuery;
  is(column: string, value: unknown): FakeQuery;
  overlaps(column: string, values: readonly unknown[]): FakeQuery;
  limit(count: number): Promise<FakeQueryResult>;
  maybeSingle(): Promise<FakeQueryResult>;
  single(): Promise<FakeQueryResult>;
}

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;
const mockEnforceRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;

function request(
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>,
) {
  return new NextRequest(`http://localhost/api/sites/${SITE_ID}/activation`, {
    method,
    headers: { "x-forwarded-for": "203.0.113.20" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function context(siteId = SITE_ID) {
  return { params: Promise.resolve({ siteId }) };
}

function authClient(options?: {
  user?: { id: string; user_metadata?: Record<string, unknown> } | null;
  permissionRows?: Array<{
    site_id: string;
    user_id: string;
    permission: string;
  }>;
  permissionError?: unknown;
  updateError?: unknown;
  siteRows?: Array<{
    id: string;
    status: string;
    live_at?: string | null;
  }>;
  siteError?: unknown;
  editorRows?: Array<{
    id: string;
    site_id: string;
    permissions: string[];
    revoked_at: string | null;
  }> | null;
  editorError?: unknown;
  publishRows?: Array<{
    content_element_id: string;
    action: string;
    content_elements: { site_id: string };
  }> | null;
  publishError?: unknown;
}) {
  const permissionRows = options?.permissionRows ?? [
    { site_id: SITE_ID, user_id: USER_ID, permission: "admin" },
  ];
  const siteRows = options?.siteRows ?? [
    { id: SITE_ID, status: "live", live_at: new Date().toISOString() },
  ];
  const editorRows =
    options && "editorRows" in options
      ? options.editorRows
      : [
          {
            id: "editor-1",
            site_id: SITE_ID,
            permissions: ["publish"],
            revoked_at: null,
          },
        ];
  const publishRows =
    options && "publishRows" in options
      ? options.publishRows
      : [
          {
            content_element_id: "element-1",
            action: "publish",
            content_elements: { site_id: SITE_ID },
          },
        ];

  const queryFor = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const overlapFilters: Array<[string, readonly unknown[]]> = [];
    const selected = jest.fn();
    const eq: FakeQuery["eq"] = jest.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    });
    const is: FakeQuery["is"] = jest.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    });
    const overlaps: FakeQuery["overlaps"] = jest.fn(
      (column: string, values: readonly unknown[]) => {
        overlapFilters.push([column, values]);
        return query;
      },
    );
    const matches = (row: Record<string, unknown>) =>
      filters.every(([column, expected]) => {
        const actual = column
          .split(".")
          .reduce<unknown>(
            (value, key) =>
              typeof value === "object" && value !== null
                ? (value as Record<string, unknown>)[key]
                : undefined,
            row,
          );
        return actual === expected;
      }) &&
      overlapFilters.every(([column, expected]) => {
        const actual = row[column];
        return (
          Array.isArray(actual) &&
          actual.some((value) => expected.includes(value))
        );
      });
    const rows = () => {
      if (table === "site_permissions") return permissionRows;
      if (table === "sites") return siteRows;
      if (table === "site_editors") return editorRows;
      if (table === "staging_history") return publishRows;
      throw new Error(`Unexpected table ${table}`);
    };
    const error = () => {
      if (table === "site_permissions") return options?.permissionError ?? null;
      if (table === "sites") return options?.siteError ?? null;
      if (table === "site_editors") return options?.editorError ?? null;
      return options?.publishError ?? null;
    };
    const result = () => {
      const tableRows = rows();
      return {
        data: Array.isArray(tableRows)
          ? tableRows.filter((row) => matches(row))
          : tableRows,
        error: error(),
      };
    };
    const query: FakeQuery = {
      select: jest.fn((columns: string): FakeQuery => {
        selected(columns);
        return query;
      }),
      eq,
      is,
      overlaps,
      limit: jest.fn(async () => result()),
      maybeSingle: jest.fn(async () => {
        const resolved = result();
        return {
          data: Array.isArray(resolved.data)
            ? (resolved.data[0] ?? null)
            : null,
          error: resolved.error,
        };
      }),
      single: jest.fn(async () => {
        const resolved = result();
        return {
          data: Array.isArray(resolved.data)
            ? (resolved.data[0] ?? null)
            : null,
          error: resolved.error,
        };
      }),
    };
    return { query, filters, overlapFilters, selected };
  };

  const queries = new Map<string, ReturnType<typeof queryFor>>();
  const updateUser = jest.fn().mockResolvedValue({
    data: { user: options?.user ?? null },
    error: options?.updateError ?? null,
  });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user:
            options?.user === undefined
              ? { id: USER_ID, user_metadata: { theme: "dark" } }
              : options.user,
        },
        error: null,
      }),
      updateUser,
    },
    from: jest.fn((table: string) => {
      const tableQuery = queryFor(table);
      queries.set(table, tableQuery);
      return tableQuery.query;
    }),
    queries,
    updateUser,
  };
}

describe("site activation route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnforceRateLimit.mockResolvedValue(null);
  });

  it("rate limits the authenticated user and site before permission or data reads", async () => {
    const client = authClient();
    mockCreateClient.mockResolvedValue(client as never);
    mockEnforceRateLimit.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "limited" }), {
        status: 429,
      }) as never,
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(429);
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        identifier: `${USER_ID}:${SITE_ID}`,
        identifierType: "user",
        onStoreFailure: "deny",
      }),
    );
  });

  it("rejects an invalid site id", async () => {
    const response = await GET(request(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("rejects a missing session", async () => {
    mockCreateClient.mockResolvedValue(
      authClient({ user: null, permissionRows: [] }) as never,
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(401);
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("rejects a non-admin", async () => {
    mockCreateClient.mockResolvedValue(
      authClient({
        permissionRows: [
          { site_id: SITE_ID, user_id: USER_ID, permission: "view" },
        ],
      }) as never,
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(403);
  });

  it("rejects a foreign site with a filter-aware permission lookup", async () => {
    const client = authClient({
      permissionRows: [
        { site_id: OTHER_SITE_ID, user_id: USER_ID, permission: "admin" },
      ],
    });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(403);
    expect(client.queries.get("site_permissions")?.filters).toEqual([
      ["site_id", SITE_ID],
      ["user_id", USER_ID],
    ]);
  });

  it.each([
    ["awaiting-install", null, false],
    ["awaiting-install", undefined, false],
    ["live", new Date().toISOString(), true],
    ["live", "2020-01-01T00:00:00.000Z", true],
    ["awaiting-install", "2020-01-01T00:00:00.000Z", true],
  ])(
    "keeps the install milestone for %s with live_at %s",
    async (status, liveAt, installed) => {
      const client = authClient({
        siteRows: [{ id: SITE_ID, status, live_at: liveAt }],
      });
      mockCreateClient.mockResolvedValue(client as never);

      const response = await GET(request(), context());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.installed).toBe(installed);
      expect(client.queries.get("sites")?.selected).toHaveBeenCalledWith(
        "status, live_at",
      );
      expect(client.queries.get("sites")?.filters).toEqual([["id", SITE_ID]]);
    },
  );

  it("counts only active editors whose normalized permissions include publish", async () => {
    const client = authClient({
      user: {
        id: USER_ID,
        user_metadata: { [`activation_dismissed_${SITE_ID}`]: true },
      },
      editorRows: [
        {
          id: "view-editor",
          site_id: SITE_ID,
          permissions: ["edit"],
          revoked_at: null,
        },
        {
          id: "revoked-publisher",
          site_id: SITE_ID,
          permissions: ["publish"],
          revoked_at: "2026-09-24T00:00:00.000Z",
        },
        {
          id: "admin-editor",
          site_id: SITE_ID,
          permissions: ["admin"],
          revoked_at: null,
        },
        {
          id: "other-site-publisher",
          site_id: OTHER_SITE_ID,
          permissions: ["publish"],
          revoked_at: null,
        },
      ],
      publishRows: [],
    });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      installed: true,
      invited: true,
      published: false,
      dismissed: true,
    });
    expect(client.queries.get("site_editors")?.selected).toHaveBeenCalledWith(
      "id",
    );
    expect(client.queries.get("site_editors")?.filters).toEqual([
      ["site_id", SITE_ID],
      ["revoked_at", null],
    ]);
    expect(client.queries.get("site_editors")?.overlapFilters).toEqual([
      ["permissions", ["publish", "admin"]],
    ]);
    expect(
      client.queries.get("staging_history")?.selected,
    ).toHaveBeenCalledWith(
      "content_element_id, content_elements!inner(site_id)",
    );
    expect(client.queries.get("staging_history")?.filters).toEqual([
      ["action", "publish"],
      ["content_elements.site_id", SITE_ID],
    ]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not count an active editor without publish permission", async () => {
    mockCreateClient.mockResolvedValue(
      authClient({
        editorRows: [
          {
            id: "editor-1",
            site_id: SITE_ID,
            permissions: ["edit"],
            revoked_at: null,
          },
        ],
      }) as never,
    );

    const response = await GET(request(), context());

    expect((await response.json()).invited).toBe(false);
  });

  it("scopes the site read to the requested id", async () => {
    const client = authClient({
      siteRows: [
        { id: SITE_ID, status: "awaiting-install", live_at: null },
        {
          id: OTHER_SITE_ID,
          status: "live",
          live_at: "2026-09-24T00:00:00.000Z",
        },
      ],
    });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect((await response.json()).installed).toBe(false);
    expect(client.queries.get("sites")?.filters).toEqual([["id", SITE_ID]]);
  });

  it("ignores a dismissal stored for another site", async () => {
    mockCreateClient.mockResolvedValue(
      authClient({
        user: {
          id: USER_ID,
          user_metadata: {
            [`activation_dismissed_${OTHER_SITE_ID}`]: true,
          },
        },
      }) as never,
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect((await response.json()).dismissed).toBe(false);
  });

  it("treats a missing site row as an error", async () => {
    mockCreateClient.mockResolvedValue(authClient({ siteRows: [] }) as never);

    const response = await GET(request(), context());

    expect(response.status).toBe(500);
  });

  it.each(["editor", "publish"])(
    "treats a null %s result as unknown rather than incomplete",
    async (read) => {
      mockCreateClient.mockResolvedValue(
        authClient({
          ...(read === "editor" ? { editorRows: null } : {}),
          ...(read === "publish" ? { publishRows: null } : {}),
        }) as never,
      );

      const response = await GET(request(), context());

      expect(response.status).toBe(500);
    },
  );

  it.each(["site", "editor", "publish"])(
    "returns an error rather than fabricated progress when the %s read fails",
    async (read) => {
      mockCreateClient.mockResolvedValue(
        authClient({
          ...(read === "site" ? { siteError: { message: "boom" } } : {}),
          ...(read === "editor" ? { editorError: { message: "boom" } } : {}),
          ...(read === "publish" ? { publishError: { message: "boom" } } : {}),
        }) as never,
      );

      const response = await GET(request(), context());

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Failed to load activation progress",
      });
    },
  );

  it("dismisses only this site for the signed-in user and preserves other metadata", async () => {
    const client = authClient({
      user: {
        id: USER_ID,
        user_metadata: { theme: "dark", activation_dismissed_other: true },
      },
    });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await POST(
      request("POST", {
        userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        installed: true,
        invited: true,
        published: true,
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(client.updateUser).toHaveBeenCalledWith({
      data: { [`activation_dismissed_${SITE_ID}`]: true },
    });
    expect(await response.json()).toEqual({ dismissed: true });
  });

  it("does not save dismissal for a non-admin or another site", async () => {
    const client = authClient({ permissionRows: [] });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await POST(request("POST"), context(OTHER_SITE_ID));

    expect(response.status).toBe(403);
    expect(client.updateUser).not.toHaveBeenCalled();
  });

  it("returns non-success when dismissal persistence fails", async () => {
    const client = authClient({
      updateError: { message: "write failed" },
    });
    mockCreateClient.mockResolvedValue(client as never);

    const response = await POST(request("POST"), context());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to dismiss activation checklist",
    });
  });
});
