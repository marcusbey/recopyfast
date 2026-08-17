import { POST, GET } from "@/app/api/bulk/export/route";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { parseCSV } from "@/lib/bulk/csv";

jest.mock("@supabase/ssr");

type QueryResult = { data?: unknown; error?: unknown };

/**
 * Same per-table query-builder stub as `import.test.ts`: the route touches
 * three tables with different chain shapes, and a single shared set of
 * `mockReturnThis` methods desynchronises as soon as one query consumes a
 * `mockResolvedValueOnce` meant for another.
 */
let resultsByTable: Record<string, QueryResult> = {};
const insertCalls: Array<{ table: string; payload: unknown }> = [];
const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];

const makeBuilder = (table: string, result: QueryResult) => {
  const settled = { data: null, error: null, ...result };
  const builder: Record<string, unknown> = {
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(settled).then(resolve, reject),
    single: jest.fn(() => Promise.resolve(settled)),
    insert: jest.fn((payload: unknown) => {
      insertCalls.push({ table, payload });
      return builder;
    }),
    eq: jest.fn((column: string, value: unknown) => {
      eqCalls.push({ table, column, value });
      return builder;
    }),
  };
  for (const method of ["select", "in", "gte", "order", "limit"]) {
    builder[method] = jest.fn(() => builder);
  }
  return builder;
};

const mockSupabase = {
  auth: { getUser: jest.fn() },
  from: jest.fn((table: string) =>
    makeBuilder(table, resultsByTable[table] ?? { data: null, error: null }),
  ),
};

(createServerClient as jest.Mock).mockReturnValue(mockSupabase);

const USER = { id: "user-123", email: "owner@example.com" };

const postRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/bulk/export", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

/**
 * A successful export returns a file body, not JSON. The `NextResponse` mock in
 * `jest.setup.js` hands back whatever body it was constructed with through
 * `json()`, so for these responses that call yields the raw string as written.
 */
const readFileBody = async (response: {
  json: () => Promise<unknown>;
}): Promise<string> => (await response.json()) as string;

/**
 * Values chosen to break a naive CSV writer: a comma inside a CSS selector
 * list (`.header, .hero` is ordinary CSS, not a contrived case), a quote and a
 * newline inside the content, and non-ASCII text.
 */
const AWKWARD_ELEMENT = {
  id: "row-1",
  site_id: "site-123",
  element_id: "hero-1",
  selector: ".header, .hero",
  original_content: "Original, with comma",
  current_content: 'Prix : 12 € — he said "hi"\nsecond line',
  language: "en",
  variant: "default",
  metadata: { type: "text" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const PLAIN_ELEMENT = {
  id: "row-2",
  site_id: "site-123",
  element_id: "footer-1",
  selector: ".footer",
  original_content: "Footer",
  current_content: "Footer copy",
  language: "fr",
  variant: "mobile",
  metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const seedSite = (permission: string | null) => {
  resultsByTable.site_permissions = permission
    ? { data: { permission } }
    : { data: null };
  resultsByTable.content_elements = {
    data: [AWKWARD_ELEMENT, PLAIN_ELEMENT],
  };
};

describe("/api/bulk/export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resultsByTable = {};
    insertCalls.length = 0;
    eqCalls.length = 0;
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: USER } });
  });

  describe("POST", () => {
    it("exports every documented field as JSON", async () => {
      seedSite("admin");

      const response = await POST(
        postRequest({ site_id: "site-123", format: "json" }),
      );
      const exported = JSON.parse(await readFileBody(response));

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toContain(
        "attachment",
      );
      expect(exported).toHaveLength(2);
      expect(exported[0]).toMatchObject({
        element_id: AWKWARD_ELEMENT.element_id,
        selector: AWKWARD_ELEMENT.selector,
        current_content: AWKWARD_ELEMENT.current_content,
        language: AWKWARD_ELEMENT.language,
        variant: AWKWARD_ELEMENT.variant,
      });
    });

    it("exports every documented field as CSV", async () => {
      seedSite("admin");

      const response = await POST(
        postRequest({ site_id: "site-123", format: "csv" }),
      );
      const csv = await readFileBody(response);
      const [headers] = parseCSV(csv);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/csv");
      for (const column of [
        "element_id",
        "selector",
        "current_content",
        "language",
        "variant",
      ]) {
        expect(headers).toContain(column);
      }
    });

    /**
     * The half of the round-trip guarantee that lives in the writer: every
     * column is quoted when it needs to be, not just the three that used to be.
     * A comma in `selector` shifted every later column by one.
     */
    it("produces CSV whose every column parses back to the source value", async () => {
      seedSite("admin");

      const response = await POST(
        postRequest({ site_id: "site-123", format: "csv" }),
      );
      const rows = parseCSV(await readFileBody(response));
      const [headers, ...dataRows] = rows;
      const columnOf = (row: string[], name: string) =>
        row[headers.indexOf(name)];

      expect(dataRows).toHaveLength(2);
      for (const [index, source] of [
        AWKWARD_ELEMENT,
        PLAIN_ELEMENT,
      ].entries()) {
        const row = dataRows[index];
        expect(columnOf(row, "element_id")).toBe(source.element_id);
        expect(columnOf(row, "selector")).toBe(source.selector);
        expect(columnOf(row, "current_content")).toBe(source.current_content);
        expect(columnOf(row, "original_content")).toBe(source.original_content);
        expect(columnOf(row, "language")).toBe(source.language);
        expect(columnOf(row, "variant")).toBe(source.variant);
        expect(JSON.parse(columnOf(row, "metadata"))).toEqual(source.metadata);
      }
    });

    it.each(["view", "edit", "admin"])(
      "allows a caller with %s permission",
      async (permission) => {
        seedSite(permission);

        const response = await POST(
          postRequest({ site_id: "site-123", format: "json" }),
        );

        expect(response.status).toBe(200);
      },
    );

    it("refuses a caller with no permission row on the site", async () => {
      seedSite(null);

      const response = await POST(
        postRequest({ site_id: "site-123", format: "json" }),
      );

      expect(response.status).toBe(403);
    });

    it("refuses an unauthenticated caller", async () => {
      seedSite("admin");
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const response = await POST(
        postRequest({ site_id: "site-123", format: "json" }),
      );

      expect(response.status).toBe(401);
    });

    it("returns 400 when required fields are missing", async () => {
      const response = await POST(postRequest({ format: "json" }));

      expect(response.status).toBe(400);
    });

    it("records the export as a bulk operation", async () => {
      seedSite("admin");

      await POST(postRequest({ site_id: "site-123", format: "json" }));

      expect(
        insertCalls.filter((call) => call.table === "bulk_operations"),
      ).toHaveLength(1);
    });
  });

  /**
   * This listing is what the dashboard's History tab reads. It was reachable by
   * nobody while the component was mounted nowhere, and it checked only that
   * the caller was signed in — any authenticated user could read any site's
   * operation history by guessing a site id. Mounting a UI in front of it is
   * what makes that reachable, so the permission check lands with the wiring.
   */
  describe("GET", () => {
    const getRequest = (query: string) =>
      new NextRequest(`http://localhost/api/bulk/export${query}`);

    const OPERATIONS = [
      { id: "op-1", operation_type: "import", status: "completed" },
      { id: "op-2", operation_type: "export", status: "completed" },
      { id: "op-3", operation_type: "batch_update", status: "failed" },
    ];

    it("returns 400 without a siteId", async () => {
      const response = await GET(getRequest(""));

      expect(response.status).toBe(400);
    });

    it("returns 401 for an unauthenticated caller", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const response = await GET(getRequest("?siteId=site-123"));

      expect(response.status).toBe(401);
    });

    it("returns 403 for a caller with no permission row on the site", async () => {
      resultsByTable.site_permissions = { data: null };
      resultsByTable.bulk_operations = { data: OPERATIONS };

      const response = await GET(getRequest("?siteId=site-123"));

      expect(response.status).toBe(403);
    });

    it.each(["view", "edit", "admin"])(
      "lists import, export and batch-update history for a %s caller",
      async (permission) => {
        resultsByTable.site_permissions = { data: { permission } };
        resultsByTable.bulk_operations = { data: OPERATIONS };

        const response = await GET(getRequest("?siteId=site-123"));
        const operations = await response.json();

        expect(response.status).toBe(200);
        expect(
          operations.map((operation: { id: string }) => operation.id),
        ).toEqual(["op-1", "op-2", "op-3"]);
        // The History tab shows every kind of bulk operation, so the listing
        // must not narrow itself to exports the way it used to.
        expect(
          eqCalls.filter(
            (call) =>
              call.table === "bulk_operations" &&
              call.column === "operation_type",
          ),
        ).toEqual([]);
        expect(eqCalls).toContainEqual({
          table: "bulk_operations",
          column: "site_id",
          value: "site-123",
        });
      },
    );
  });
});
