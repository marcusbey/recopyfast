import { NextRequest } from "next/server";

type QueryResult = { data: unknown; error: unknown };
type SelectCall = { table: string; columns: string | undefined };

const mockGetUser = jest.fn();
const selectCalls: SelectCall[] = [];
let resultQueue: QueryResult[] = [];

const makeBuilder = (table: string, result: QueryResult) => {
  const builder: Record<string, unknown> = {
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
    single: jest.fn(() => Promise.resolve(result)),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
  };

  for (const method of ["insert", "update", "delete", "eq", "order"] as const) {
    builder[method] = jest.fn(() => builder);
  }

  builder.select = jest.fn((columns?: string) => {
    selectCalls.push({ table, columns });
    return builder;
  });

  return builder;
};

const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: jest.fn((table: string) =>
    makeBuilder(table, resultQueue.shift() ?? { data: null, error: null }),
  ),
};

/*
 * s42 moved the route's writes onto the service-role client, which CAN read
 * key_hash. The explicit returning projection is therefore the whole secret
 * boundary for POST/PUT, so both clients feed the same `selectCalls` record and
 * result queue: the assertions below hold whichever client runs the statement.
 */
const mockServiceSupabase = {
  from: jest.fn((table: string) =>
    makeBuilder(table, resultQueue.shift() ?? { data: null, error: null }),
  ),
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => mockServiceSupabase),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(() => Promise.resolve(null)),
  getClientIp: jest.fn(() => "203.0.113.7"),
}));

import { GET, POST, PUT } from "@/app/api/api-keys/route";

const API_KEY_MUTATION_COLUMNS = [
  "id",
  "user_id",
  "site_id",
  "name",
  "key_prefix",
  "scopes",
  "rate_limit_per_minute",
  "is_active",
  "last_used_at",
  "expires_at",
  "created_at",
  "updated_at",
];

const API_KEY_LIST_COLUMNS = [
  "id",
  "name",
  "key_prefix",
  "site_id",
  "scopes",
  "rate_limit_per_minute",
  "is_active",
  "last_used_at",
  "expires_at",
  "created_at",
  "updated_at",
];

const apiKeyRow = {
  id: "key-id",
  user_id: "user-id",
  site_id: "site-id",
  name: "Production",
  key_hash: "must-never-leave-the-database",
  key_prefix: "rcp_abcdef12",
  scopes: ["read", "write"],
  rate_limit_per_minute: 100,
  is_active: true,
  last_used_at: null,
  expires_at: null,
  created_at: "2026-09-25T12:00:00.000Z",
  updated_at: "2026-09-25T12:00:00.000Z",
};

const columnsForApiKeys = () =>
  selectCalls
    .filter((call) => call.table === "api_keys")
    .map((call) => call.columns);

const expectPublicApiKeyProjection = (expected: string[]) => {
  const projections = columnsForApiKeys();
  expect(projections.every((projection) => projection !== undefined)).toBe(
    true,
  );
  expect(projections.join(",")).not.toContain("key_hash");
  const returningProjection = projections.at(-1);
  expect(
    returningProjection
      ?.split(",")
      .map((column) => column.trim())
      .filter(Boolean),
  ).toEqual(expected);
};

describe("/api/api-keys secret projections", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    selectCalls.length = 0;
    resultQueue = [];
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-id" } },
      error: null,
    });
  });

  it("lists keys without requesting key_hash and strips an unexpected hash from the response", async () => {
    resultQueue = [
      { data: { permission: "view" }, error: null },
      { data: [apiKeyRow], error: null },
    ];

    const response = await GET(
      new NextRequest("http://localhost/api/api-keys?siteId=site-id"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expectPublicApiKeyProjection(API_KEY_LIST_COLUMNS);
    expect(body.apiKeys[0]).toEqual({
      ...Object.fromEntries(
        Object.entries(apiKeyRow).filter(([column]) => column !== "key_hash"),
      ),
      keyPreview: "rcp_abcdef12...",
    });
    expect(JSON.stringify(body)).not.toContain(apiKeyRow.key_hash);
  });

  it("creates a key with an explicit nonsecret returning projection", async () => {
    resultQueue = [
      { data: { permission: "admin" }, error: null },
      { data: apiKeyRow, error: null },
    ];

    const response = await POST(
      new NextRequest("http://localhost/api/api-keys", {
        method: "POST",
        body: JSON.stringify({ siteId: "site-id", name: "Production" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expectPublicApiKeyProjection(API_KEY_MUTATION_COLUMNS);
    expect(body.apiKey.key).toMatch(/^rcp_/);
    expect(body.apiKey).not.toHaveProperty("key_hash");
    expect(JSON.stringify(body)).not.toContain(apiKeyRow.key_hash);
  });

  it("updates a key with an explicit nonsecret returning projection", async () => {
    resultQueue = [
      { data: { id: "key-id", site_id: "site-id" }, error: null },
      { data: { permission: "admin" }, error: null },
      { data: apiKeyRow, error: null },
    ];

    const response = await PUT(
      new NextRequest("http://localhost/api/api-keys", {
        method: "PUT",
        body: JSON.stringify({ apiKeyId: "key-id", isActive: false }),
        headers: { "content-type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expectPublicApiKeyProjection(API_KEY_MUTATION_COLUMNS);
    expect(body.apiKey).not.toHaveProperty("key_hash");
    expect(JSON.stringify(body)).not.toContain(apiKeyRow.key_hash);
  });
});
