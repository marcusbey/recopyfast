import { GET } from "../route";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildSiteToken } from "@/lib/security/site-auth";

// Mock Supabase clients
jest.mock("@/lib/supabase/server");
jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/site-auth");

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;
const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;
const mockBuildSiteToken = buildSiteToken as jest.MockedFunction<
  typeof buildSiteToken
>;

type QueryResult = {
  data?: unknown;
  count?: number | null;
  error?: unknown;
};

/**
 * The route issues a fixed sequence of Supabase queries, each terminating on a
 * different chain method (`.eq()`, `.in()`, `.single()`). Rather than stubbing
 * individual methods — which breaks as soon as two queries share one — this
 * queues one result per `.from()` call, in the order the route makes them.
 */
let queryQueue: QueryResult[] = [];
const fromCalls: string[] = [];

const makeBuilder = (result: QueryResult) => {
  const builder: Record<string, unknown> = {
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) =>
      Promise.resolve({ data: null, count: null, error: null, ...result }).then(
        resolve,
        reject,
      ),
    single: jest.fn(() =>
      Promise.resolve({ data: null, count: null, error: null, ...result }),
    ),
  };
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    builder[method] = jest.fn(() => builder);
  }
  return builder;
};

const mockServiceClient = {
  from: jest.fn((table: string) => {
    fromCalls.push(table);
    return makeBuilder(queryQueue.shift() ?? { data: null, error: null });
  }),
};

describe("GET /api/sites", () => {
  const mockUser = { id: "user-123", email: "test@example.com" };

  /**
   * A `sites` row as the route now reads it.
   *
   * `status` and the four transition timestamps are columns since
   * 20260817001000_sites_install_status.sql. The route used to derive a status
   * from a `content_elements` count on every request; it reads the persisted
   * state machine instead and resolves `stale` from `last_reported_at`.
   */
  const siteRow = (overrides: Record<string, unknown> = {}) => ({
    id: "site-1",
    domain: "example.com",
    name: "Example Site",
    api_key: "test-api-key-1",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T00:00:00Z",
    status: "awaiting-install",
    live_at: null,
    last_reported_at: null,
    last_mismatch_domain: null,
    last_mismatch_at: null,
    ...overrides,
  });

  const mockSites = [siteRow()];

  const mockPermissions = [{ site_id: "site-1", permission: "admin" }];

  let mockSupabaseClient: {
    auth: { getUser: jest.Mock };
  };

  /**
   * Queue the per-site stats queries the route runs after it has the site list:
   * elements count, element id rows, edits count, last-activity row.
   */
  const queueSiteStats = ({
    elementsCount = 0,
    elementIds = [] as string[],
    editsCount = 0,
    lastActivity = null as { created_at: string } | null,
  } = {}) => {
    queryQueue.push({ count: elementsCount });
    queryQueue.push({ data: elementIds.map((id) => ({ id })) });
    if (elementIds.length > 0) {
      queryQueue.push({ count: editsCount });
      queryQueue.push({ data: lastActivity });
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    queryQueue = [];
    fromCalls.length = 0;

    mockSupabaseClient = {
      auth: {
        getUser: jest
          .fn()
          .mockResolvedValue({ data: { user: mockUser }, error: null }),
      },
    };

    mockCreateClient.mockResolvedValue(
      mockSupabaseClient as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    mockCreateServiceRoleClient.mockReturnValue(
      mockServiceClient as unknown as ReturnType<
        typeof createServiceRoleClient
      >,
    );
    mockBuildSiteToken.mockReturnValue("site-token-abc");
  });

  it("returns sites for authenticated user", async () => {
    queryQueue.push({ data: mockPermissions });
    queryQueue.push({ data: mockSites });
    queueSiteStats();

    const response = await GET(
      new NextRequest("http://localhost:3000/api/sites"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.sites)).toBe(true);
    expect(data.sites).toHaveLength(1);
    expect(data.sites[0]).toMatchObject({
      id: "site-1",
      domain: "example.com",
      name: "Example Site",
    });
    expect(fromCalls[0]).toBe("site_permissions");
    expect(fromCalls[1]).toBe("sites");
  });

  it("returns 401 for unauthenticated users", async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/sites"),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns empty array when user has no sites", async () => {
    queryQueue.push({ data: [] });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/sites"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sites).toEqual([]);
    // The sites table is never queried when there are no permissions.
    expect(fromCalls).toEqual(["site_permissions"]);
  });

  it("handles permission lookup errors gracefully", async () => {
    queryQueue.push({ data: null, error: { message: "Database error" } });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/sites"),
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to fetch site permissions");
  });

  it("handles site lookup errors gracefully", async () => {
    queryQueue.push({ data: mockPermissions });
    queryQueue.push({ data: null, error: { message: "Database error" } });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/sites"),
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to fetch sites");
  });

  it("includes site statistics in response", async () => {
    queryQueue.push({ data: mockPermissions });
    queryQueue.push({ data: mockSites });
    queueSiteStats({
      elementsCount: 5,
      elementIds: ["element-1"],
      editsCount: 10,
      lastActivity: { created_at: "2024-01-15T00:00:00Z" },
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/sites"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sites[0].stats).toEqual({
      content_elements_count: 5,
      edits_count: 10,
      views: 0,
      last_activity: "2024-01-15T00:00:00Z",
    });
  });

  /**
   * The status the API reports is the persisted state machine, resolved once
   * per site — not a `content_elements` count wearing a status's clothes.
   *
   * The count answered a different question and answered it badly: it could not
   * say when anything happened, and a site that reported for months and then
   * went quiet was indistinguishable from one whose script was never installed.
   */
  describe("site status", () => {
    const respondWith = async (site: Record<string, unknown>) => {
      queryQueue.push({ data: mockPermissions });
      queryQueue.push({ data: [site] });
      queueSiteStats({ elementsCount: 5, elementIds: ["element-1"] });

      const response = await GET(
        new NextRequest("http://localhost:3000/api/sites"),
      );
      return (await response.json()).sites[0];
    };

    it("reports a site that has never been heard from as awaiting-install", async () => {
      // Content elements exist in this fixture; the persisted status still wins.
      const site = await respondWith(siteRow({ status: "awaiting-install" }));

      expect(site.status).toBe("awaiting-install");
    });

    it("reports a recently-reporting live site as live", async () => {
      const site = await respondWith(
        siteRow({
          status: "live",
          live_at: "2026-01-01T00:00:00Z",
          last_reported_at: new Date().toISOString(),
        }),
      );

      expect(site.status).toBe("live");
    });

    it("reports a live site that has gone quiet as stale", async () => {
      const site = await respondWith(
        siteRow({
          status: "live",
          live_at: "2026-01-01T00:00:00Z",
          last_reported_at: new Date(
            Date.now() - 60 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        }),
      );

      // Derived, never stored — `sites.status` still holds 'live'.
      expect(site.status).toBe("stale");
    });

    /** AC 8: s03 reads these off the sites API rather than re-deriving them. */
    it("passes the transition timestamps through verbatim", async () => {
      const site = await respondWith(
        siteRow({
          status: "live",
          live_at: "2026-02-03T04:05:06Z",
          last_reported_at: "2026-02-04T04:05:06Z",
          last_mismatch_domain: "staging.example.net",
          last_mismatch_at: "2026-02-02T04:05:06Z",
        }),
      );

      expect(site).toMatchObject({
        live_at: "2026-02-03T04:05:06Z",
        last_reported_at: "2026-02-04T04:05:06Z",
        last_mismatch_domain: "staging.example.net",
        last_mismatch_at: "2026-02-02T04:05:06Z",
      });
    });
  });

  it("includes the site token and embed script in response", async () => {
    queryQueue.push({ data: mockPermissions });
    queryQueue.push({ data: mockSites });
    queueSiteStats();

    const response = await GET(
      new NextRequest("http://localhost:3000/api/sites"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockBuildSiteToken).toHaveBeenCalledWith("site-1", "test-api-key-1");
    expect(data.sites[0].siteToken).toBe("site-token-abc");
    expect(data.sites[0].embedScript).toContain("recopyfast.js");
    expect(data.sites[0].embedScript).toContain("site-1");
    expect(data.sites[0].embedScript).toContain("site-token-abc");
  });

  it("never leaks the raw api_key to the client", async () => {
    queryQueue.push({ data: mockPermissions });
    queryQueue.push({ data: mockSites });
    queueSiteStats();

    const response = await GET(
      new NextRequest("http://localhost:3000/api/sites"),
    );
    const data = await response.json();

    expect(JSON.stringify(data)).not.toContain("test-api-key-1");
  });

  it("does not mint a site token or embed script for a viewer", async () => {
    queryQueue.push({
      data: [{ site_id: "site-1", permission: "view" }],
    });
    queryQueue.push({ data: mockSites });
    queueSiteStats();

    const response = await GET(
      new NextRequest("http://localhost:3000/api/sites"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockBuildSiteToken).not.toHaveBeenCalled();
    expect(data.sites[0].siteToken).toBeUndefined();
    expect(data.sites[0].embedScript).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("test-api-key-1");
  });

  it("does not mint a site token for an editor either", async () => {
    queryQueue.push({
      data: [{ site_id: "site-1", permission: "edit" }],
    });
    queryQueue.push({ data: mockSites });
    queueSiteStats();

    const response = await GET(
      new NextRequest("http://localhost:3000/api/sites"),
    );
    const data = await response.json();

    expect(mockBuildSiteToken).not.toHaveBeenCalled();
    expect(data.sites[0].siteToken).toBeUndefined();
    expect(data.sites[0].embedScript).toBeUndefined();
  });
});
