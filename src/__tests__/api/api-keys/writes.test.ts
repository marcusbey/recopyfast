/**
 * s42 — creating, pausing and deleting an API key must work against production.
 *
 * Production RLS on `api_keys` gives `authenticated` a SELECT policy and nothing
 * else, and s38 (20260925120000) removed every web-role write privilege from the
 * table. The route used to write through the user-scoped client, so every
 * create, pause and delete from /dashboard/settings failed with 42501 while the
 * suite — which mocked Supabase as permissive — stayed green.
 *
 * The user-scoped mock below therefore rejects any write on `api_keys` exactly
 * as production does. A test that passes here passes because the write went
 * through the service-role client, after the route's own checks, and not
 * because the mock was generous.
 */

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(),
  getClientIp: jest.fn(() => "203.0.113.7"),
}));

import { DELETE, GET, POST, PUT } from "@/app/api/api-keys/route";

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;
const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;
const mockEnforceRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";
const KEY_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_IP = "203.0.113.7";

const API_KEY_RESPONSE_COLUMNS =
  "id, user_id, site_id, name, key_prefix, scopes, rate_limit_per_minute, " +
  "is_active, last_used_at, expires_at, created_at, updated_at";

type Operation = "select" | "insert" | "update" | "delete";
type QueryResult = { data: unknown; error: unknown };

interface RecordedQuery {
  client: "user" | "service";
  table: string;
  operation: Operation;
  payload?: unknown;
  columns?: string;
  filters: Array<[string, unknown]>;
}

const RLS_WRITE_DENIED = {
  code: "42501",
  message: 'permission denied for table "api_keys"',
};
const NO_ROWS = { code: "PGRST116", message: "no rows returned" };

let queries: RecordedQuery[] = [];

interface Scenario {
  user: { id: string } | null;
  permission: "view" | "edit" | "admin" | null;
  ownsKey: boolean;
  serviceError: { code: string; message: string } | null;
}

let scenario: Scenario;

const apiKeyRow = () => ({
  id: KEY_ID,
  user_id: USER_ID,
  site_id: SITE_ID,
  name: "Production",
  key_prefix: "rcp_abcdef12",
  scopes: ["read", "write"],
  rate_limit_per_minute: 100,
  is_active: true,
  last_used_at: null,
  expires_at: null,
  created_at: "2026-09-25T12:00:00.000Z",
  updated_at: "2026-09-25T12:00:00.000Z",
});

/** Production's answer to a query issued as the signed-in user (RLS on). */
function resolveAsUser(query: RecordedQuery): QueryResult {
  if (query.table === "site_permissions") {
    return scenario.permission
      ? { data: { permission: scenario.permission }, error: null }
      : { data: null, error: NO_ROWS };
  }
  if (query.table === "api_keys" && query.operation !== "select") {
    return { data: null, error: RLS_WRITE_DENIED };
  }
  if (query.table === "api_keys" && query.columns === "id, site_id") {
    return scenario.ownsKey
      ? { data: { id: KEY_ID, site_id: SITE_ID }, error: null }
      : { data: null, error: NO_ROWS };
  }
  if (query.table === "api_keys") {
    return { data: [apiKeyRow()], error: null };
  }
  return { data: null, error: null };
}

/** The service role bypasses RLS; only a configured failure stops it. */
function resolveAsService(query: RecordedQuery): QueryResult {
  if (scenario.serviceError) {
    return { data: null, error: scenario.serviceError };
  }
  if (query.operation === "delete") return { data: null, error: null };
  const row = apiKeyRow();
  if (query.operation === "update") {
    return { data: { ...row, ...(query.payload as object) }, error: null };
  }
  if (query.operation === "insert") {
    const [inserted] = query.payload as Array<Record<string, unknown>>;
    return {
      data: { ...row, key_hash: inserted.key_hash, ...inserted },
      error: null,
    };
  }
  return { data: row, error: null };
}

function makeClient(
  client: RecordedQuery["client"],
  resolve: (query: RecordedQuery) => QueryResult,
) {
  return {
    from: jest.fn((table: string) => {
      const query: RecordedQuery = {
        client,
        table,
        operation: "select",
        filters: [],
      };
      queries.push(query);
      const settle = () => Promise.resolve(resolve(query));

      const builder: Record<string, unknown> = {
        then: (
          onFulfilled: (value: QueryResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => settle().then(onFulfilled, onRejected),
        single: jest.fn(settle),
        maybeSingle: jest.fn(settle),
      };
      builder.select = jest.fn((columns?: string) => {
        query.columns = columns;
        return builder;
      });
      for (const operation of ["insert", "update"] as const) {
        builder[operation] = jest.fn((payload: unknown) => {
          query.operation = operation;
          query.payload = payload;
          return builder;
        });
      }
      builder.delete = jest.fn(() => {
        query.operation = "delete";
        return builder;
      });
      builder.eq = jest.fn((column: string, value: unknown) => {
        query.filters.push([column, value]);
        return builder;
      });
      builder.order = jest.fn(() => builder);
      return builder;
    }),
  };
}

function useClients() {
  const userClient = {
    ...makeClient("user", resolveAsUser),
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: scenario.user },
        error: null,
      }),
    },
  };
  const serviceClient = makeClient("service", resolveAsService);
  mockCreateClient.mockResolvedValue(userClient as never);
  mockCreateServiceRoleClient.mockReturnValue(serviceClient as never);
  return { userClient, serviceClient };
}

const jsonHeaders = {
  "content-type": "application/json",
  "x-forwarded-for": CLIENT_IP,
};

const postRequest = (
  body: Record<string, unknown> = {
    siteId: SITE_ID,
    name: "Production",
  },
) =>
  new NextRequest("http://localhost/api/api-keys", {
    method: "POST",
    body: JSON.stringify(body),
    headers: jsonHeaders,
  });

const putRequest = (
  body: Record<string, unknown> = {
    apiKeyId: KEY_ID,
    isActive: false,
  },
) =>
  new NextRequest("http://localhost/api/api-keys", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: jsonHeaders,
  });

const deleteRequest = (apiKeyId = KEY_ID) =>
  new NextRequest(`http://localhost/api/api-keys?apiKeyId=${apiKeyId}`, {
    method: "DELETE",
    headers: { "x-forwarded-for": CLIENT_IP },
  });

const getRequest = (siteId = SITE_ID) =>
  new NextRequest(`http://localhost/api/api-keys?siteId=${siteId}`, {
    headers: { "x-forwarded-for": CLIENT_IP },
  });

const writes = [
  ["POST", () => POST(postRequest())],
  ["PUT", () => PUT(putRequest())],
  ["DELETE", () => DELETE(deleteRequest())],
] as const;

const limited = () =>
  NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

const serviceWrites = () =>
  queries.filter(
    (query) => query.client === "service" && query.operation !== "select",
  );

describe("/api/api-keys writes (s42)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queries = [];
    scenario = {
      user: { id: USER_ID },
      permission: "admin",
      ownsKey: true,
      serviceError: null,
    };
    mockEnforceRateLimit.mockResolvedValue(null);
  });

  describe("rate limiting precedes authorization", () => {
    it.each(writes)(
      "%s sheds an IP flood before authentication, failing closed",
      async (_verb, call) => {
        const { userClient } = useClients();
        mockEnforceRateLimit.mockResolvedValueOnce(limited());

        const response = await call();

        expect(response.status).toBe(429);
        expect(userClient.auth.getUser).not.toHaveBeenCalled();
        expect(queries).toEqual([]);
        expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1);
        expect(mockEnforceRateLimit).toHaveBeenCalledWith(
          expect.any(NextRequest),
          expect.objectContaining({
            limit: "IP_GENERAL",
            endpoint: "api-keys:ip",
            identifier: CLIENT_IP,
            onStoreFailure: "deny",
          }),
        );
      },
    );

    it("GET sheds an IP flood before authentication, failing open", async () => {
      const { userClient } = useClients();
      mockEnforceRateLimit.mockResolvedValueOnce(limited());

      const response = await GET(getRequest());

      expect(response.status).toBe(429);
      expect(userClient.auth.getUser).not.toHaveBeenCalled();
      expect(mockEnforceRateLimit).toHaveBeenCalledWith(
        expect.any(NextRequest),
        expect.objectContaining({
          limit: "IP_GENERAL",
          endpoint: "api-keys:ip",
          identifier: CLIENT_IP,
          onStoreFailure: "allow",
        }),
      );
    });

    it.each(writes)(
      "%s applies a per-user write limit after authentication and before any data access",
      async (_verb, call) => {
        const { userClient } = useClients();
        mockEnforceRateLimit
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(limited());

        const response = await call();

        expect(response.status).toBe(429);
        expect(userClient.auth.getUser).toHaveBeenCalledTimes(1);
        expect(queries).toEqual([]);
        expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
        expect(mockEnforceRateLimit).toHaveBeenLastCalledWith(
          expect.any(NextRequest),
          expect.objectContaining({
            limit: "API_UPLOAD",
            endpoint: "api-keys:write",
            identifier: USER_ID,
            identifierType: "user",
            onStoreFailure: "deny",
          }),
        );
      },
    );

    it.each(writes)(
      "%s answers 401 to an anonymous caller without spending the user bucket",
      async (_verb, call) => {
        scenario.user = null;
        useClients();

        const response = await call();

        expect(response.status).toBe(401);
        expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1);
        expect(queries).toEqual([]);
        expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
      },
    );
  });

  describe("POST creates a key through the service role", () => {
    it("inserts the admin's key with the service role, after the RLS-scoped admin check", async () => {
      useClients();

      const response = await POST(postRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      const key: string = body.apiKey.key;
      expect(key).toMatch(/^rcp_[0-9a-f]{64}$/);

      expect(serviceWrites()).toHaveLength(1);
      const [insert] = serviceWrites();
      expect(insert).toMatchObject({
        table: "api_keys",
        operation: "insert",
        columns: API_KEY_RESPONSE_COLUMNS,
      });
      const keyHash = createHash("sha256").update(key).digest("hex");
      expect(insert.payload).toEqual([
        {
          user_id: USER_ID,
          site_id: SITE_ID,
          name: "Production",
          key_hash: keyHash,
          key_prefix: key.slice(0, 12),
          is_active: true,
        },
      ]);

      const permissionCheck = queries.findIndex(
        (query) =>
          query.client === "user" && query.table === "site_permissions",
      );
      expect(queries[permissionCheck]?.filters).toEqual([
        ["site_id", SITE_ID],
        ["user_id", USER_ID],
      ]);
      expect(permissionCheck).toBeLessThan(queries.indexOf(insert));
      expect(
        queries.filter(
          (query) => query.client === "user" && query.operation !== "select",
        ),
      ).toEqual([]);

      expect(body.apiKey).not.toHaveProperty("key_hash");
      expect(JSON.stringify(body)).not.toContain(keyHash);
    });

    it("binds the key to the session user, never to an id in the body", async () => {
      useClients();

      const response = await POST(
        postRequest({
          siteId: SITE_ID,
          name: "Production",
          user_id: "44444444-4444-4444-8444-444444444444",
          userId: "44444444-4444-4444-8444-444444444444",
        }),
      );

      expect(response.status).toBe(200);
      const [insert] = serviceWrites();
      expect(insert.payload).toEqual([
        expect.objectContaining({ user_id: USER_ID }),
      ]);
    });

    it.each([["edit"], ["view"], [null]] as const)(
      "refuses a caller whose permission is %s without creating the service client",
      async (permission) => {
        scenario.permission = permission;
        useClients();

        const response = await POST(postRequest());

        expect(response.status).toBe(403);
        expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
        expect(serviceWrites()).toEqual([]);
      },
    );

    it("reports a failed insert as a generic 500 without the database detail", async () => {
      scenario.serviceError = {
        code: "23505",
        message: 'duplicate key value violates "api_keys_key_hash_key"',
      };
      useClients();
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const response = await POST(postRequest());
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: "Failed to create API key" });
      consoleError.mockRestore();
    });
  });

  describe("PUT pauses and resumes a key through the service role", () => {
    it.each([[false], [true]])(
      "sets is_active=%s on the caller's own key, scoped by id and user_id",
      async (isActive) => {
        useClients();

        const response = await PUT(putRequest({ apiKeyId: KEY_ID, isActive }));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.apiKey).toMatchObject({ id: KEY_ID, is_active: isActive });
        expect(body.apiKey).not.toHaveProperty("key_hash");

        expect(serviceWrites()).toHaveLength(1);
        const [update] = serviceWrites();
        expect(update).toMatchObject({
          table: "api_keys",
          operation: "update",
          columns: API_KEY_RESPONSE_COLUMNS,
          filters: [
            ["id", KEY_ID],
            ["user_id", USER_ID],
          ],
        });
        expect(update.payload).toEqual({
          is_active: isActive,
          updated_at: expect.any(String),
        });

        const ownershipRead = queries.findIndex(
          (query) =>
            query.client === "user" &&
            query.table === "api_keys" &&
            query.operation === "select",
        );
        const adminCheck = queries.findIndex(
          (query) =>
            query.client === "user" && query.table === "site_permissions",
        );
        expect(queries[ownershipRead]?.filters).toEqual([
          ["id", KEY_ID],
          ["user_id", USER_ID],
        ]);
        expect(queries[adminCheck]?.filters).toEqual([
          ["site_id", SITE_ID],
          ["user_id", USER_ID],
        ]);
        expect(ownershipRead).toBeLessThan(queries.indexOf(update));
        expect(adminCheck).toBeLessThan(queries.indexOf(update));
      },
    );

    it("answers 404 for a key the caller does not own, without a service write", async () => {
      scenario.ownsKey = false;
      useClients();

      const response = await PUT(putRequest());

      expect(response.status).toBe(404);
      expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
      expect(serviceWrites()).toEqual([]);
    });

    it("answers 403 to an owner who is no longer admin of the key's site", async () => {
      scenario.permission = "edit";
      useClients();

      const response = await PUT(putRequest());

      expect(response.status).toBe(403);
      expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
      expect(serviceWrites()).toEqual([]);
    });
  });

  describe("DELETE removes a key through the service role", () => {
    it("deletes the caller's own key, scoped by id and user_id", async () => {
      useClients();

      const response = await DELETE(deleteRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        success: true,
        message: "API key deleted successfully",
      });

      expect(serviceWrites()).toHaveLength(1);
      const [removal] = serviceWrites();
      expect(removal).toMatchObject({
        table: "api_keys",
        operation: "delete",
        filters: [
          ["id", KEY_ID],
          ["user_id", USER_ID],
        ],
      });

      const adminCheck = queries.findIndex(
        (query) =>
          query.client === "user" && query.table === "site_permissions",
      );
      expect(queries[adminCheck]?.filters).toEqual([
        ["site_id", SITE_ID],
        ["user_id", USER_ID],
      ]);
      expect(adminCheck).toBeLessThan(queries.indexOf(removal));
    });

    it("answers 404 for a key the caller does not own, without a service write", async () => {
      scenario.ownsKey = false;
      useClients();

      const response = await DELETE(deleteRequest());

      expect(response.status).toBe(404);
      expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
      expect(serviceWrites()).toEqual([]);
    });

    it("answers 403 to an owner who is no longer admin of the key's site", async () => {
      scenario.permission = "view";
      useClients();

      const response = await DELETE(deleteRequest());

      expect(response.status).toBe(403);
      expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
      expect(serviceWrites()).toEqual([]);
    });

    it("reports a failed delete as a generic 500 without the database detail", async () => {
      scenario.serviceError = {
        code: "57014",
        message: "canceling statement due to statement timeout",
      };
      useClients();
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const response = await DELETE(deleteRequest());
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: "Failed to delete API key" });
      expect(serviceWrites()).toHaveLength(1);
      consoleError.mockRestore();
    });
  });
});
