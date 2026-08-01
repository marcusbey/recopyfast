import { POST, GET } from "@/app/api/bulk/import/route";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

jest.mock("@supabase/ssr");

type QueryResult = { data?: unknown; error?: unknown };

/**
 * Supabase query-builder stub keyed by table. The route touches three tables
 * with different chain shapes, so a single shared set of `mockReturnThis`
 * methods (the previous approach) desynchronised as soon as one query consumed
 * a `mockResolvedValueOnce` meant for another.
 */
let resultsByTable: Record<string, QueryResult> = {};
const fromCalls: string[] = [];
const upsertCalls: unknown[] = [];
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
    upsert: jest.fn((payload: unknown) => {
      upsertCalls.push(payload);
      return builder;
    }),
    update: jest.fn((payload: unknown) => {
      updateCalls.push(payload);
      return builder;
    }),
  };
  for (const method of ["select", "eq"]) {
    builder[method] = jest.fn(() => builder);
  }
  return builder;
};

const mockSupabase = {
  auth: { getUser: jest.fn() },
  from: jest.fn((table: string) => {
    fromCalls.push(table);
    return makeBuilder(resultsByTable[table] ?? { data: null, error: null });
  }),
};

(createServerClient as jest.Mock).mockReturnValue(mockSupabase);

const USER = { id: "user-123" };

const postRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/bulk/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const jsonElement = {
  element_id: "header-1",
  selector: ".header",
  current_content: "Hello World",
  language: "en",
  variant: "default",
};

const permissive = {
  overwrite_existing: true,
  create_missing_elements: true,
  validate_content: false,
};

describe("/api/bulk/import", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resultsByTable = {};
    fromCalls.length = 0;
    upsertCalls.length = 0;
    insertCalls.length = 0;
    updateCalls.length = 0;
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: USER } });
  });

  describe("POST", () => {
    it("should handle JSON import successfully", async () => {
      resultsByTable.site_permissions = { data: { permission: "admin" } };

      const response = await POST(
        postRequest({
          site_id: "site-123",
          format: "json",
          data: [jsonElement],
          options: {
            overwrite_existing: false,
            create_missing_elements: true,
            validate_content: true,
          },
        }),
      );
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toHaveProperty("operation_id");
      expect(result.status).toBe("completed");
      expect(result.results).toEqual({
        total: 1,
        successful: 1,
        failed: 0,
        errors: [],
      });
      // overwrite_existing is false, so the element is inserted rather than upserted.
      expect(insertCalls).toHaveLength(2); // bulk_operations row + content element
      expect(upsertCalls).toHaveLength(0);
    });

    it("should upsert when overwrite_existing is set", async () => {
      resultsByTable.site_permissions = { data: { permission: "admin" } };

      const response = await POST(
        postRequest({
          site_id: "site-123",
          format: "json",
          data: [jsonElement],
          options: permissive,
        }),
      );

      expect(response.status).toBe(200);
      expect(upsertCalls).toHaveLength(1);
      expect(upsertCalls[0]).toMatchObject({
        site_id: "site-123",
        element_id: "header-1",
        current_content: "Hello World",
      });
    });

    it("should return 400 for missing required fields", async () => {
      const response = await POST(postRequest({}));

      expect(response.status).toBe(400);
    });

    it("should return 401 for unauthenticated requests", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const response = await POST(
        postRequest({ site_id: "site-123", format: "json", data: [] }),
      );

      expect(response.status).toBe(401);
    });

    it("should return 403 for insufficient permissions", async () => {
      resultsByTable.site_permissions = { data: { permission: "view" } };

      const response = await POST(
        postRequest({ site_id: "site-123", format: "json", data: [] }),
      );

      expect(response.status).toBe(403);
    });

    it("should handle CSV import", async () => {
      resultsByTable.site_permissions = { data: { permission: "admin" } };

      const response = await POST(
        postRequest({
          site_id: "site-123",
          format: "csv",
          data: "element_id,selector,current_content,language,variant\nheader-1,.header,Hello World,en,default",
          options: permissive,
        }),
      );
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.results.successful).toBe(1);
    });

    it("should return 500 when the payload does not match the declared format", async () => {
      resultsByTable.site_permissions = { data: { permission: "admin" } };

      // `format: "json"` with a string body: parseJSONImport rejects it.
      const response = await POST(
        postRequest({
          site_id: "site-123",
          format: "json",
          data: "invalid-json",
          options: {},
        }),
      );
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result.error).toBe("Failed to process bulk import");
      // The operation row is marked failed before the error propagates.
      expect(updateCalls[0]).toMatchObject({ status: "failed" });
    });
  });

  describe("GET", () => {
    it("should return operation status", async () => {
      const mockOperation = {
        id: "op-123",
        status: "completed",
        total_items: 5,
        processed_items: 5,
        failed_items: 0,
      };
      resultsByTable.bulk_operations = { data: mockOperation };

      const response = await GET(
        new NextRequest("http://localhost/api/bulk/import?operationId=op-123"),
      );
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toEqual(mockOperation);
    });

    it("should return 400 for missing operationId", async () => {
      const response = await GET(
        new NextRequest("http://localhost/api/bulk/import"),
      );

      expect(response.status).toBe(400);
    });

    it("should return 401 for unauthenticated requests", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const response = await GET(
        new NextRequest("http://localhost/api/bulk/import?operationId=op-123"),
      );

      expect(response.status).toBe(401);
    });

    it("should return 404 for non-existent operation", async () => {
      resultsByTable.bulk_operations = {
        data: null,
        error: { message: "Not found" },
      };

      const response = await GET(
        new NextRequest(
          "http://localhost/api/bulk/import?operationId=non-existent",
        ),
      );

      expect(response.status).toBe(404);
    });
  });
});
