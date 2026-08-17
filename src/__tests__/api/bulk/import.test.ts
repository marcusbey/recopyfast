import { POST, GET } from "@/app/api/bulk/import/route";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { MAX_IMPORT_BYTES } from "@/lib/bulk/constants";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@supabase/ssr");
// The route takes one `create_content_version` snapshot after a batch (ADR 008)
// through the service-role client. Without this mock the suite builds a real
// supabase-js client and puts an HTTP call on the wire mid-test.
jest.mock("@/lib/supabase/service");
// Left real, the limiter would count every POST in this file into one bucket
// and start answering 429 partway through the suite.
jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));

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
    (createServiceRoleClient as jest.Mock).mockReturnValue({
      rpc: jest.fn(async () => ({ data: "version-1", error: null })),
    });
    (enforceRateLimit as jest.Mock).mockResolvedValue(null);
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
      // Deliberate behaviour change (story s05): the response reports one
      // outcome per row — created / updated / skipped / failed — instead of a
      // successful/failed pair plus a bag of error strings, because "a
      // malformed row fails that row alone" is not expressible in the old
      // shape.
      expect(result.results).toEqual({
        total: 1,
        created: 1,
        updated: 0,
        skipped: 0,
        failed: 0,
        rows: [{ row: 1, elementId: "header-1", outcome: "created" }],
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

    /**
     * Nothing capped the body before this. A file big enough to matter was
     * parsed in full — and a `bulk_operations` row was already written by then,
     * so the refusal, when it came, looked like a failed import rather than a
     * request that was never accepted.
     */
    it("refuses a body over the size limit before parsing it", async () => {
      resultsByTable.site_permissions = { data: { permission: "admin" } };

      const response = await POST(
        postRequest({
          site_id: "site-123",
          format: "json",
          data: [
            { ...jsonElement, current_content: "x".repeat(MAX_IMPORT_BYTES) },
          ],
          options: permissive,
        }),
      );
      const result = await response.json();

      expect(response.status).toBe(413);
      expect(result.error).toMatch(/limit/i);
      // No operation row, no writes: the request never got that far.
      expect(insertCalls).toHaveLength(0);
      expect(upsertCalls).toHaveLength(0);
    });

    it("accepts a body under the size limit", async () => {
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
      // Same deliberate shape change as above: `successful` became the four
      // outcome counts.
      expect(result.results.created).toBe(1);
    });

    /**
     * A malformed row used to abort the whole batch: both parsers threw on the
     * first bad item, before any per-item error accumulation existed, so a
     * 400-row file with one typo imported nothing and answered 500.
     */
    it("imports the valid rows when one JSON row is malformed", async () => {
      resultsByTable.site_permissions = { data: { permission: "admin" } };

      const response = await POST(
        postRequest({
          site_id: "site-123",
          format: "json",
          data: [
            jsonElement,
            { selector: ".broken", current_content: "no element id" },
            { ...jsonElement, element_id: "header-2" },
          ],
          options: permissive,
        }),
      );
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.results.failed).toBe(1);
      // The two well-formed rows are still written.
      expect(upsertCalls).toHaveLength(2);
    });

    it("imports the valid rows when one CSV row is malformed", async () => {
      resultsByTable.site_permissions = { data: { permission: "admin" } };

      const response = await POST(
        postRequest({
          site_id: "site-123",
          format: "csv",
          data: [
            "element_id,selector,current_content",
            "header-1,.header,Hello",
            ",.broken,missing element id",
            "header-2,.header-2,World",
          ].join("\n"),
          options: permissive,
        }),
      );
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.results.failed).toBe(1);
      expect(upsertCalls).toHaveLength(2);
    });

    /**
     * Deliberate behaviour change (story s05, review fix): a file the server
     * cannot read is the caller's problem, so it answers 400 and names the
     * reason. It used to answer 500 "Failed to process bulk import" — an
     * "our fault" status carrying no clue which column was missing, for a
     * request that was never well-formed.
     */
    it("refuses the whole file with 400 when a required CSV header is missing", async () => {
      resultsByTable.site_permissions = { data: { permission: "admin" } };

      const response = await POST(
        postRequest({
          site_id: "site-123",
          format: "csv",
          data: "element_id,selector\nheader-1,.header",
          options: permissive,
        }),
      );
      const result = await response.json();

      // No row can be blamed for a missing column, so the file is refused
      // whole and nothing is written.
      expect(response.status).toBe(400);
      expect(result.error).toContain("current_content");
      expect(upsertCalls).toHaveLength(0);
      expect(
        insertCalls.filter((call) => "element_id" in (call as object)),
      ).toHaveLength(0);
      // The operation row is still closed out as failed — an import that was
      // started and refused is not an import still running.
      expect(updateCalls[0]).toMatchObject({ status: "failed" });
    });

    it("should return 400 when the payload does not match the declared format", async () => {
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

      expect(response.status).toBe(400);
      expect(result.error).toContain("array");
      // The operation row is marked failed before the refusal is answered.
      expect(updateCalls[0]).toMatchObject({ status: "failed" });
    });

    /**
     * `options` is optional in practice — a hand-rolled curl or a script that
     * omits it is a 400 at worst. It used to be a 500: the route read
     * `options.create_missing_elements` off `undefined` mid-batch, after the
     * `bulk_operations` row had already been written as "running".
     */
    it("defaults the options rather than throwing when the key is absent", async () => {
      resultsByTable.site_permissions = { data: { permission: "admin" } };

      const response = await POST(
        postRequest({
          site_id: "site-123",
          format: "json",
          data: [jsonElement],
        }),
      );
      const result = await response.json();

      expect(response.status).toBe(200);
      // Every flag defaults off, so nothing is written and the row says why.
      expect(result.results).toMatchObject({
        total: 1,
        created: 0,
        updated: 0,
        skipped: 1,
        failed: 0,
      });
      expect(upsertCalls).toHaveLength(0);
    });

    it("rejects a non-object options value with 400", async () => {
      resultsByTable.site_permissions = { data: { permission: "admin" } };

      const response = await POST(
        postRequest({
          site_id: "site-123",
          format: "json",
          data: [jsonElement],
          options: "yes please",
        }),
      );

      expect(response.status).toBe(400);
      expect(insertCalls).toHaveLength(0);
    });

    /**
     * AGENTS.md: "Rate limit before authorization. Auth itself costs a `sites`
     * lookup, so a limiter behind it never sees the flood." This endpoint
     * accepts a multi-megabyte body and ends in a service-role RPC, so the
     * limiter is the first thing in the handler and nothing else runs when it
     * fires.
     */
    it("refuses without reading the body when the rate limiter fires", async () => {
      resultsByTable.site_permissions = { data: { permission: "admin" } };
      (enforceRateLimit as jest.Mock).mockResolvedValue(
        NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
      );

      const response = await POST(
        postRequest({
          site_id: "site-123",
          format: "json",
          data: [jsonElement],
          options: permissive,
        }),
      );

      expect(response.status).toBe(429);
      expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
      expect(insertCalls).toHaveLength(0);
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
