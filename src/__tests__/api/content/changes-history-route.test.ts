/**
 * @jest-environment node
 *
 * s70b — GET /api/content/changes/[rowId]/history, one row's draft and
 * publish trail.
 *
 * `staging_history` has held one row per draft save and per publish since the
 * staging workflow, and no route read it: the old Content card's History
 * button was never even rendered. RLS lets only a site's admins read it
 * (20251230000000), so this route reads on the signed-in user's client and
 * tells everyone else that history is admin-only rather than pretending the
 * row has none. `user_email` can hold a user id or an access kind (the staging
 * PUT writes `access.email || access.userId || access.kind`): only an address
 * is ever shown as a "who".
 */

import { NextRequest } from "next/server";
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

import { GET } from "@/app/api/content/changes/[rowId]/history/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DISCOVERED_AT = "2026-09-28T09:00:00+00:00";

function historyRow(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `history-${index}`,
    action: "update",
    user_email: "ana@example.com",
    previous_content: `Text ${index - 1}`,
    new_content: `Text ${index}`,
    created_at: `2026-10-0${(index % 9) + 1}T10:00:00+00:00`,
    ...overrides,
  };
}

function responder({
  row = { id: ROW_ID, site_id: SITE_ID, created_at: DISCOVERED_AT },
  permission = "admin",
  history = [historyRow(2), historyRow(1)],
}: {
  row?: unknown;
  permission?: string | null;
  history?: unknown[];
} = {}) {
  return (query: RecordedQuery): QueryResult => {
    if (query.table === "content_elements") return { data: row, error: null };
    if (query.table === "site_permissions") {
      return {
        data: permission ? { permission } : null,
        error: null,
      };
    }
    return { data: history, error: null };
  };
}

const callsOf = (table: string, method: string) =>
  mockRecorded
    .filter((query) => query.table === table)
    .flatMap((query) => query.calls)
    .filter(([name]) => name === method)
    .map(([, ...args]) => args);

function get(rowId = ROW_ID): Promise<Response> {
  return GET(
    new NextRequest(`http://localhost/api/content/changes/${rowId}/history`),
    { params: Promise.resolve({ rowId }) },
  ) as Promise<Response>;
}

describe("GET /api/content/changes/[rowId]/history", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecorded.length = 0;
    (enforceRateLimit as jest.Mock).mockResolvedValue(null);
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockRespond = responder();
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

  it("answers 401 to a caller who is not signed in, and reads nothing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await get();

    expect(response.status).toBe(401);
    expect(mockRecorded).toEqual([]);
  });

  it.each(["not-a-uuid", "1 OR 1=1", ""])(
    "answers 400 to the row id %p, with no read",
    async (rowId) => {
      const response = await get(rowId);

      expect(response.status).toBe(400);
      expect(mockRecorded).toEqual([]);
    },
  );

  it("answers 404 when the RLS client does not return the row, and reads no history", async () => {
    mockRespond = responder({ row: null });

    const response = await get();

    expect(response.status).toBe(404);
    expect(mockRecorded.map((query) => query.table)).not.toContain(
      "staging_history",
    );
  });

  it("gives an admin at most 20 events, newest first, plus discoveredAt", async () => {
    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(callsOf("staging_history", "eq")).toEqual([
      ["content_element_id", ROW_ID],
    ]);
    expect(callsOf("staging_history", "order")).toEqual([
      ["created_at", { ascending: false }],
    ]);
    expect(callsOf("staging_history", "limit")).toEqual([[20]]);
    expect(callsOf("site_permissions", "eq")).toEqual([
      ["site_id", SITE_ID],
      ["user_id", USER_ID],
    ]);
    expect(body).toEqual({
      historyVisible: true,
      discoveredAt: DISCOVERED_AT,
      events: [
        {
          id: "history-2",
          action: "update",
          by: "ana@example.com",
          at: "2026-10-03T10:00:00+00:00",
          previous: "Text 1",
          content: "Text 2",
        },
        {
          id: "history-1",
          action: "update",
          by: "ana@example.com",
          at: "2026-10-02T10:00:00+00:00",
          previous: "Text 0",
          content: "Text 1",
        },
      ],
    });
  });

  it.each(["edit", "publish", "view"])(
    "tells a %s member that history is admin-only, with discoveredAt and no history read",
    async (permission) => {
      mockRespond = responder({ permission });

      const response = await get();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        historyVisible: false,
        events: [],
        discoveredAt: DISCOVERED_AT,
      });
      expect(mockRecorded.map((query) => query.table)).not.toContain(
        "staging_history",
      );
    },
  );

  it.each(["edit-session", USER_ID, "staging", "unknown"])(
    "returns a writer recorded as %p as null",
    async (userEmail) => {
      mockRespond = responder({
        history: [historyRow(1, { user_email: userEmail })],
      });

      const body = await (await get()).json();

      expect(body.events[0].by).toBeNull();
    },
  );

  it.each(["content_elements", "staging_history"])(
    "answers a generic 500 when the %s read fails",
    async (table) => {
      const base = responder();
      mockRespond = (query) =>
        query.table === table
          ? { data: null, error: { code: "XX000", message: "boom" } }
          : base(query);
      const errorLog = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const response = await get();

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Failed to load history",
      });
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
