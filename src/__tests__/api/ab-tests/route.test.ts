import { GET, POST, PUT } from "@/app/api/ab-tests/route";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

jest.mock("@supabase/ssr");

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
let queryQueue: QueryResult[] = [];
const fromCalls: string[] = [];
const insertCalls: unknown[] = [];
const updateCalls: unknown[] = [];

const makeBuilder = (result: QueryResult) => {
  const settled = { data: null, error: null, ...result };
  const builder: Record<string, unknown> = {
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(settled).then(resolve, reject),
    single: jest.fn(() => Promise.resolve(settled)),
    insert: jest.fn((payload: unknown) => {
      insertCalls.push(payload);
      return builder;
    }),
    update: jest.fn((payload: unknown) => {
      updateCalls.push(payload);
      return builder;
    }),
  };
  for (const method of ["select", "eq", "order", "delete"]) {
    builder[method] = jest.fn(() => builder);
  }
  return builder;
};

const mockSupabase = {
  auth: { getUser: jest.fn() },
  from: jest.fn((table: string) => {
    fromCalls.push(table);
    return makeBuilder(queryQueue.shift() ?? { data: null, error: null });
  }),
};

(createServerClient as jest.Mock).mockReturnValue(mockSupabase);

/** Queue one result per `.from()` call, in the order the route issues them. */
const queue = (...results: QueryResult[]) => {
  queryQueue = [...results];
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
    queryQueue = [];
    fromCalls.length = 0;
    insertCalls.length = 0;
    updateCalls.length = 0;
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: USER } });
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
      expect(fromCalls).toEqual(["site_permissions", "ab_tests"]);
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
      queue(EDIT_PERMISSION, { data: mockTest }, { error: null });

      const response = await POST(jsonRequest("POST", validTestBody));
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toEqual(mockTest);
      expect(fromCalls).toEqual([
        "site_permissions",
        "ab_tests",
        "ab_test_variants",
      ]);
      expect(insertCalls[0]).toMatchObject({
        site_id: "site-123",
        name: "Homepage Test",
        created_by: USER.id,
        status: "draft",
      });
      expect(insertCalls[1]).toHaveLength(2);
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
      queue(
        EDIT_PERMISSION,
        { data: { id: "test-1" } },
        { error: { message: "variant insert failed" } },
      );

      const response = await POST(jsonRequest("POST", validTestBody));
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result.error).toBe("Failed to create A/B test");
      // The orphaned test row is deleted before the error is returned.
      expect(fromCalls).toEqual([
        "site_permissions",
        "ab_tests",
        "ab_test_variants",
        "ab_tests",
      ]);
    });
  });

  describe("PUT", () => {
    const updateBody = { test_id: "test-1", status: "running" };

    it("should update an A/B test", async () => {
      const mockUpdatedTest = { id: "test-1", status: "running" };
      queue(
        { data: { site_id: "site-123", created_by: USER.id } },
        EDIT_PERMISSION,
        { data: mockUpdatedTest },
      );

      const response = await PUT(jsonRequest("PUT", updateBody));
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toEqual(mockUpdatedTest);
      expect(updateCalls[0]).toMatchObject({ status: "running" });
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
