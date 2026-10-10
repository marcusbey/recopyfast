import { GET, POST, PUT } from "@/app/api/ab-tests/route";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@supabase/ssr");
// Since s56 (ADR 042) the A/B writes go through the service role, behind the
// owner-plan gate. The gate itself is proved in owner-plan-gate.test.ts; here
// the owner holds a plan.
jest.mock("@/lib/supabase/service");
jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: () => Promise.resolve({ ok: true, ownerId: "owner-1" }),
}));

type QueryResult = { data?: unknown; error?: unknown };

/**
 * Supabase query-builder stub. Each `.from()` consumes the next queued result;
 * every chain link returns the builder, which is thenable and exposes
 * `.single()`, so chains ending in either form resolve.
 *
 * The previous version shared one `jest.fn().mockReturnThis()` per method
 * across every query in the route, so a `mockResolvedValueOnce` on `.single()`
 * broke the chain for the next call and the handler fell into its catch block.
 */
interface ClientLog {
  queue: QueryResult[];
  from: string[];
  insert: unknown[];
  update: unknown[];
  eq: Array<[string, unknown]>;
}
const newLog = (): ClientLog => ({
  queue: [],
  from: [],
  insert: [],
  update: [],
  eq: [],
});

/** The caller's cookie (RLS) client: reads only, since s56. */
let rls = newLog();
/** The service client: every A/B write, since s56 (ADR 042). */
let service = newLog();

const makeBuilder = (result: QueryResult, log: ClientLog) => {
  const settled = { data: null, error: null, ...result };
  const builder: Record<string, unknown> = {
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(settled).then(resolve, reject),
    single: jest.fn(() => Promise.resolve(settled)),
    insert: jest.fn((payload: unknown) => {
      log.insert.push(payload);
      return builder;
    }),
    update: jest.fn((payload: unknown) => {
      log.update.push(payload);
      return builder;
    }),
    eq: jest.fn((column: string, value: unknown) => {
      log.eq.push([column, value]);
      return builder;
    }),
  };
  for (const method of ["select", "order", "delete"]) {
    builder[method] = jest.fn(() => builder);
  }
  return builder;
};

const clientFor = (log: () => ClientLog) => ({
  auth: { getUser: jest.fn() },
  from: jest.fn((table: string) => {
    log().from.push(table);
    return makeBuilder(
      log().queue.shift() ?? { data: null, error: null },
      log(),
    );
  }),
});

const mockSupabase = clientFor(() => rls);
const mockService = clientFor(() => service);

(createServerClient as jest.Mock).mockReturnValue(mockSupabase);

/** Queue one result per cookie-client `.from()` call, in route order. */
const queue = (...results: QueryResult[]) => {
  rls.queue = [...results];
};
/** Queue one result per service-client `.from()` call, in route order. */
const queueService = (...results: QueryResult[]) => {
  service.queue = [...results];
};

const USER = { id: "user-123" };
const EDIT_PERMISSION = { data: { permission: "edit" } };

const jsonRequest = (method: "POST" | "PUT", body: unknown) =>
  new NextRequest("http://localhost/api/ab-tests", {
    method,
    body: JSON.stringify(body),
  });

const validVariants = [
  {
    content_element_id: "elem-1",
    variant_name: "control",
    content: "A",
    traffic_percentage: 50,
  },
  {
    content_element_id: "elem-1",
    variant_name: "treatment",
    content: "B",
    traffic_percentage: 50,
  },
];

const validTestBody = {
  site_id: "site-123",
  name: "Homepage Test",
  success_metric: "click_through_rate",
  variants: validVariants,
};

describe("/api/ab-tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rls = newLog();
    service = newLog();
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: USER } });
    (createServiceRoleClient as jest.Mock).mockReturnValue(mockService);
    (enforceRateLimit as jest.Mock).mockResolvedValue(null);
  });

  describe("GET", () => {
    it("should return A/B tests for a site", async () => {
      const mockTests = [
        {
          id: "test-1",
          name: "Homepage Test",
          status: "running",
          variants: [{ id: "var-1", variant_name: "control" }],
        },
      ];
      queue({ data: { permission: "admin" } }, { data: mockTests });

      const response = await GET(
        new NextRequest("http://localhost/api/ab-tests?siteId=site-123"),
      );
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toEqual(mockTests);
      expect(rls.from).toEqual(["site_permissions", "ab_tests"]);
    });

    it("should return 400 when siteId is missing", async () => {
      const response = await GET(
        new NextRequest("http://localhost/api/ab-tests"),
      );
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result.error).toBe("Missing siteId parameter");
    });

    it("should return 401 for unauthenticated requests", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const response = await GET(
        new NextRequest("http://localhost/api/ab-tests?siteId=site-123"),
      );

      expect(response.status).toBe(401);
    });

    it("should return 403 when the caller has no permission on the site", async () => {
      queue({ data: null });

      const response = await GET(
        new NextRequest("http://localhost/api/ab-tests?siteId=site-123"),
      );
      const result = await response.json();

      expect(response.status).toBe(403);
      expect(result.error).toBe("Insufficient permissions");
    });
  });

  describe("POST", () => {
    it("should create a new A/B test and its variants", async () => {
      const mockTest = { id: "test-1", name: "Homepage Test", status: "draft" };
      queue(EDIT_PERMISSION);
      queueService({ data: mockTest }, { error: null });

      const response = await POST(jsonRequest("POST", validTestBody));
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toEqual(mockTest);
      // s56: the permission read stays on the cookie client; both inserts go
      // through the service client, and the variants hang off the test just
      // inserted.
      expect(rls.from).toEqual(["site_permissions"]);
      expect(rls.insert).toEqual([]);
      expect(service.from).toEqual(["ab_tests", "ab_test_variants"]);
      expect(service.insert[0]).toMatchObject({
        site_id: "site-123",
        name: "Homepage Test",
        created_by: USER.id,
        status: "draft",
      });
      expect(service.insert[1]).toEqual([
        expect.objectContaining({ test_id: "test-1" }),
        expect.objectContaining({ test_id: "test-1" }),
      ]);
    });

    it("should return 400 when required fields are missing", async () => {
      const response = await POST(
        jsonRequest("POST", { site_id: "site-123", name: "No metric" }),
      );
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result.error).toContain("Missing required fields");
    });

    it("should return 400 when fewer than two variants are supplied", async () => {
      const response = await POST(
        jsonRequest("POST", { ...validTestBody, variants: [validVariants[0]] }),
      );

      expect(response.status).toBe(400);
    });

    it("should return 401 for unauthenticated requests", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const response = await POST(jsonRequest("POST", validTestBody));

      expect(response.status).toBe(401);
    });

    it("should return 403 when the caller cannot edit the site", async () => {
      queue({ data: { permission: "view" } });

      const response = await POST(jsonRequest("POST", validTestBody));
      const result = await response.json();

      expect(response.status).toBe(403);
      expect(result.error).toBe("Insufficient permissions");
    });

    it("should return 400 when traffic percentages do not sum to 100", async () => {
      queue(EDIT_PERMISSION);

      const response = await POST(
        jsonRequest("POST", {
          ...validTestBody,
          variants: [
            { ...validVariants[0], traffic_percentage: 30 },
            { ...validVariants[1], traffic_percentage: 30 },
          ],
        }),
      );
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result.error).toBe("Traffic percentages must sum to 100%");
    });

    it("should roll back the test when variant creation fails", async () => {
      queue(EDIT_PERMISSION);
      queueService(
        { data: { id: "test-1" } },
        { error: { message: "variant insert failed" } },
      );

      const response = await POST(jsonRequest("POST", validTestBody));
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result.error).toBe("Failed to create A/B test");
      // The orphaned test row is deleted before the error is returned.
      expect(service.from).toEqual([
        "ab_tests",
        "ab_test_variants",
        "ab_tests",
      ]);
    });

    it("answers 429 before reading the session when the limiter refuses", async () => {
      (enforceRateLimit as jest.Mock).mockResolvedValue(
        NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
      );

      const response = await POST(jsonRequest("POST", validTestBody));

      expect(response.status).toBe(429);
      expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
      expect(service.from).toEqual([]);
      expect(enforceRateLimit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ onStoreFailure: "deny" }),
      );
    });
  });

  describe("PUT", () => {
    const updateBody = { test_id: "test-1", status: "running" };

    it("should update an A/B test", async () => {
      const mockUpdatedTest = { id: "test-1", status: "running" };
      queue(
        { data: { site_id: "site-123", created_by: USER.id } },
        EDIT_PERMISSION,
      );
      queueService({ data: mockUpdatedTest });

      const response = await PUT(jsonRequest("PUT", updateBody));
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toEqual(mockUpdatedTest);
      // s56: the update goes through the service client, scoped to the test
      // AND the site read back through the caller's own client.
      expect(rls.update).toEqual([]);
      expect(service.update[0]).toMatchObject({ status: "running" });
      expect(service.eq).toEqual(
        expect.arrayContaining([
          ["id", "test-1"],
          ["site_id", "site-123"],
        ]),
      );
    });

    /**
     * s56. The update used to spread the request body into the row
     * (`...updates`), and RLS `WITH CHECK` was the only thing stopping a caller
     * moving a test to another site or rewriting its author. The service role
     * that writes it now checks nothing, so the route writes an allowlist.
     */
    it("writes only allowlisted fields: never site_id, created_by, id or created_at", async () => {
      queue(
        { data: { site_id: "site-123", created_by: USER.id } },
        EDIT_PERMISSION,
      );
      queueService({ data: { id: "test-1", status: "active" } });

      const response = await PUT(
        jsonRequest("PUT", {
          test_id: "test-1",
          status: "active",
          site_id: "another-tenants-site",
          created_by: "someone-else",
          id: "another-test",
          created_at: "2020-01-01T00:00:00Z",
          // What the parked A/B UI sends (useABTests, useABTestCreation).
          auto_complete: false,
          min_sample_size: 250,
          confidence_threshold: 0.99,
          name: "Renamed",
        }),
      );

      expect(response.status).toBe(200);
      const written = service.update[0] as Record<string, unknown>;
      for (const forbidden of ["site_id", "created_by", "id", "created_at"]) {
        expect(written).not.toHaveProperty(forbidden);
      }
      expect(written).toMatchObject({
        status: "active",
        auto_complete: false,
        min_sample_size: 250,
        confidence_threshold: 0.99,
        name: "Renamed",
      });
    });

    it("answers 429 before reading the session when the limiter refuses", async () => {
      (enforceRateLimit as jest.Mock).mockResolvedValue(
        NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
      );

      const response = await PUT(jsonRequest("PUT", updateBody));

      expect(response.status).toBe(429);
      expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
      expect(service.from).toEqual([]);
      expect(enforceRateLimit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ onStoreFailure: "deny" }),
      );
    });

    it("should return 400 when test_id is missing", async () => {
      const response = await PUT(jsonRequest("PUT", { status: "running" }));
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result.error).toBe("Missing test_id");
    });

    it("should return 404 for a non-existent test", async () => {
      queue({ data: null, error: { message: "not found" } });

      const response = await PUT(jsonRequest("PUT", updateBody));
      const result = await response.json();

      expect(response.status).toBe(404);
      expect(result.error).toBe("Test not found");
    });

    it("should return 403 when the caller cannot edit the test's site", async () => {
      queue(
        { data: { site_id: "site-123", created_by: "someone-else" } },
        { data: { permission: "view" } },
      );

      const response = await PUT(jsonRequest("PUT", updateBody));
      const result = await response.json();

      expect(response.status).toBe(403);
      expect(result.error).toBe("Insufficient permissions");
    });
  });
});
