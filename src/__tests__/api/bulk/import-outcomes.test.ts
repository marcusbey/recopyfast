import { POST } from "@/app/api/bulk/import/route";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { MAX_DISCOVERED_TEXT_LENGTH } from "@/lib/security/discovered-text";

jest.mock("@supabase/ssr");
jest.mock("@/lib/supabase/service");
// Left real, the in-memory limiter counts every POST in this file into one
// bucket and the suite starts answering 429 once it outgrows the window.
jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));

type QueryResult = { data?: unknown; error?: unknown };

/**
 * The per-table query-builder stub of `import.test.ts`, extended with the one
 * thing the outcome pipeline needs and the simpler stub cannot express: a
 * lookup whose answer depends on which element is being looked up, and a write
 * that fails for one element and not the others.
 *
 * Without that, every row of an import gets the same answer, which is exactly
 * the shape of test that let "one bad row aborts the batch" survive.
 */
let existingElementIds: string[] = [];
let writeErrorByElementId: Record<string, { code?: string; message: string }> =
  {};

const contentWrites: Array<{
  kind: "insert" | "upsert";
  payload: Record<string, unknown>;
}> = [];
const operationInserts: Record<string, unknown>[] = [];
const operationUpdates: Record<string, unknown>[] = [];

const makeBuilder = (table: string) => {
  const filters: Record<string, unknown> = {};
  let settled: QueryResult = { data: null, error: null };

  const recordWrite = (
    kind: "insert" | "upsert",
    payload: Record<string, unknown>,
  ) => {
    if (table === "bulk_operations") {
      operationInserts.push(payload);
      return;
    }
    if (table !== "content_elements") return;

    contentWrites.push({ kind, payload });
    const failure = writeErrorByElementId[payload.element_id as string];
    if (failure) settled = { data: null, error: failure };
  };

  const builder: Record<string, unknown> = {
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(settled).then(resolve, reject),
    eq: jest.fn((column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    }),
    single: jest.fn(async () => {
      if (table === "site_permissions") {
        return { data: { permission: "admin" }, error: null };
      }
      if (table === "content_elements") {
        const elementId = filters.element_id as string;
        return existingElementIds.includes(elementId)
          ? { data: { id: `db-${elementId}` }, error: null }
          : { data: null, error: { code: "PGRST116", message: "No rows" } };
      }
      return settled;
    }),
    insert: jest.fn((payload: Record<string, unknown>) => {
      recordWrite("insert", payload);
      return builder;
    }),
    upsert: jest.fn((payload: Record<string, unknown>) => {
      recordWrite("upsert", payload);
      return builder;
    }),
    update: jest.fn((payload: Record<string, unknown>) => {
      if (table === "bulk_operations") operationUpdates.push(payload);
      return builder;
    }),
  };
  for (const method of ["select", "order", "limit"]) {
    builder[method] = jest.fn(() => builder);
  }
  return builder;
};

const mockSupabase = {
  auth: { getUser: jest.fn() },
  from: jest.fn((table: string) => makeBuilder(table)),
};

(createServerClient as jest.Mock).mockReturnValue(mockSupabase);

const postRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/bulk/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const importJSON = async (
  data: unknown,
  options: Record<string, boolean> = {
    overwrite_existing: true,
    create_missing_elements: true,
  },
) => {
  const response = await POST(
    postRequest({ site_id: "site-123", format: "json", data, options }),
  );
  return { response, body: await response.json() };
};

const importCSV = async (
  data: string,
  options: Record<string, boolean> = {
    overwrite_existing: true,
    create_missing_elements: true,
  },
) => {
  const response = await POST(
    postRequest({ site_id: "site-123", format: "csv", data, options }),
  );
  return { response, body: await response.json() };
};

const rpc = jest.fn();

describe("/api/bulk/import per-row outcomes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    existingElementIds = [];
    writeErrorByElementId = {};
    contentWrites.length = 0;
    operationInserts.length = 0;
    operationUpdates.length = 0;
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "owner@example.com" } },
    });
    rpc.mockResolvedValue({ data: "version-1", error: null });
    (createServiceRoleClient as jest.Mock).mockReturnValue({ rpc });
    (enforceRateLimit as jest.Mock).mockResolvedValue(null);
  });

  it("reports created, updated and failed rows in source-file order", async () => {
    existingElementIds = ["existing-1"];
    writeErrorByElementId = {
      "boom-1": { message: "permission denied for table content_elements" },
    };

    const { response, body } = await importJSON([
      { element_id: "new-1", selector: ".new", current_content: "Fresh copy" },
      {
        element_id: "existing-1",
        selector: ".old",
        current_content: "Updated copy",
      },
      { selector: ".broken", current_content: "no element id" },
      { element_id: "boom-1", selector: ".boom", current_content: "Doomed" },
    ]);

    expect(response.status).toBe(200);
    expect(body.results.rows).toEqual([
      { row: 1, elementId: "new-1", outcome: "created" },
      { row: 2, elementId: "existing-1", outcome: "updated" },
      {
        row: 3,
        elementId: "",
        outcome: "failed",
        detail: "Missing required field: element_id",
      },
      {
        row: 4,
        elementId: "boom-1",
        outcome: "failed",
        detail: expect.stringContaining("permission denied"),
      },
    ]);
    expect(body.results).toMatchObject({
      total: 4,
      created: 1,
      updated: 1,
      skipped: 0,
      failed: 2,
    });
  });

  /**
   * An existing element with "overwrite existing" off used to be attempted,
   * rejected by the unique constraint, and counted as a failure. It is a
   * deliberate skip, and the report has to read like one.
   */
  it("skips rather than fails when an option forbids the write", async () => {
    existingElementIds = ["existing-1"];

    const { body } = await importJSON(
      [
        {
          element_id: "existing-1",
          selector: ".old",
          current_content: "Ignored",
        },
        {
          element_id: "missing-1",
          selector: ".missing",
          current_content: "Ignored",
        },
      ],
      { overwrite_existing: false, create_missing_elements: false },
    );

    expect(body.results.rows).toEqual([
      {
        row: 1,
        elementId: "existing-1",
        outcome: "skipped",
        detail: "Element already exists and 'overwrite existing' is off",
      },
      {
        row: 2,
        elementId: "missing-1",
        outcome: "skipped",
        detail: "Element id not found and 'create missing elements' is off",
      },
    ]);
    expect(body.results).toMatchObject({
      total: 2,
      created: 0,
      updated: 0,
      skipped: 2,
      failed: 0,
    });
    expect(contentWrites).toHaveLength(0);
  });

  /**
   * The import path used to run `sanitizeHTML(..., "RICH_TEXT")` over these
   * columns. They hold the customer's `textContent`, written back to their page
   * with `target.textContent` and rendered in the dashboard through JSX — text
   * on every consumer path, never markup. Sanitizing it was bug A-1
   * (`src/lib/security/discovered-text.ts`), which AGENTS.md carries as a
   * standing rule, and it reached this route by a different door.
   *
   * The round-trip test proves the export→import pair; this one pins the write
   * itself, so a "defence in depth" sanitizer added back here fails
   * immediately rather than three files away.
   */
  it("stores the customer's copy byte-for-byte, angle brackets and all", async () => {
    const content = "Setup in <2 minutes — Paste the <script> tag & go";

    await importJSON([
      {
        element_id: "install-1",
        selector: "#install",
        original_content: "R&D <notes>",
        current_content: content,
      },
    ]);

    expect(contentWrites[0].payload).toMatchObject({
      current_content: content,
      published_content: content,
      original_content: "R&D <notes>",
    });
  });

  /**
   * The other half of "refuse, never repair": a value that is not storable
   * text is answered with a reason at its own row, and the rows around it are
   * still written. A repair here would be permanent and indistinguishable from
   * copy the customer wrote.
   */
  it("fails only the row whose content is not storable text", async () => {
    const { body } = await importJSON([
      { element_id: "ok-1", selector: ".ok", current_content: "Fine copy" },
      {
        element_id: "bad-1",
        selector: ".bad",
        current_content: "Null byte\u0000 inside",
      },
      { element_id: "ok-2", selector: ".ok2", current_content: "Also fine" },
    ]);

    expect(body.results.rows).toEqual([
      { row: 1, elementId: "ok-1", outcome: "created" },
      {
        row: 2,
        elementId: "bad-1",
        outcome: "failed",
        detail: expect.stringContaining("control characters"),
      },
      { row: 3, elementId: "ok-2", outcome: "created" },
    ]);
    expect(contentWrites).toHaveLength(2);
  });

  /**
   * AC3 is "an exported file re-imported unchanged produces zero content
   * differences" — so the invariant is that anything the column can already
   * hold must still round-trip. `content_elements.current_content` is an
   * unbounded `TEXT` and nothing that writes it caps its length: not
   * `bulk/update`'s set/append, not `staging/content` PUT, not `v1/content`
   * POST. Importing discovery's 20,000-character ceiling here would refuse a
   * row that any of those three wrote and this feature exported cleanly.
   *
   * The bound that does apply to an import is `MAX_IMPORT_BYTES`, measured on
   * the whole body before it is parsed.
   */
  it("stores content past discovery's length ceiling, which this column has never had", async () => {
    const long = `${"a".repeat(MAX_DISCOVERED_TEXT_LENGTH)}b`;

    const { response, body } = await importJSON([
      { element_id: "long-1", selector: ".long", current_content: long },
    ]);

    expect(response.status).toBe(200);
    expect(body.results.rows).toEqual([
      { row: 1, elementId: "long-1", outcome: "created" },
    ]);
    expect(contentWrites[0].payload.current_content).toBe(long);
  });

  /**
   * `original_content` is the served fallback when `published_content` is null
   * (`api/content/[siteId]/route.ts:308`) and the last `COALESCE` arm in
   * `create_content_version`. A three-column file — element id, selector,
   * current content, the exact minimum the Import tab advertises — used to
   * write `original_content: ""` over whatever was there, permanently.
   *
   * Absent means "not mentioned", not "set this to empty". Blanking is only
   * correct when the column is present in the file and deliberately empty.
   */
  describe("original_content", () => {
    it("leaves an existing value untouched when the file omits the column", async () => {
      existingElementIds = ["existing-1"];

      const { body } = await importCSV(
        [
          "element_id,selector,current_content",
          "existing-1,.hero,Updated copy",
        ].join("\n"),
      );

      expect(body.results.rows).toEqual([
        { row: 1, elementId: "existing-1", outcome: "updated" },
      ]);
      expect(contentWrites[0].payload).not.toHaveProperty("original_content");
    });

    it("leaves it unset on a created row the file says nothing about", async () => {
      const { body } = await importJSON([
        { element_id: "new-1", selector: ".new", current_content: "Fresh" },
      ]);

      expect(body.results.rows[0].outcome).toBe("created");
      expect(contentWrites[0].payload).not.toHaveProperty("original_content");
    });

    /**
     * The round trip this story creates walks straight into this case. A
     * three-column import leaves `original_content` NULL; the JSON export is
     * `select("*")`, so it writes that NULL out verbatim; re-importing that file
     * hands `original_content: null` back to the parser. Without the null guard
     * every such row fails with "content must be a string" — the export the
     * feature just produced would not re-import.
     */
    it("treats a JSON null as absent, the way the raw-row export writes it", async () => {
      existingElementIds = ["existing-1"];

      const { body } = await importJSON([
        {
          element_id: "existing-1",
          selector: ".hero",
          current_content: "Updated copy",
          original_content: null,
        },
      ]);

      expect(body.results.rows).toEqual([
        { row: 1, elementId: "existing-1", outcome: "updated" },
      ]);
      expect(contentWrites[0].payload).not.toHaveProperty("original_content");
    });

    it("writes an empty value when the column is present and deliberately empty", async () => {
      existingElementIds = ["existing-1"];

      await importCSV(
        [
          "element_id,selector,original_content,current_content",
          "existing-1,.hero,,Updated copy",
        ].join("\n"),
      );

      expect(contentWrites[0].payload.original_content).toBe("");
    });

    it("writes the value the file carries when the column is present", async () => {
      await importJSON([
        {
          element_id: "new-1",
          selector: ".new",
          original_content: "R&D <notes>",
          current_content: "Fresh",
        },
      ]);

      expect(contentWrites[0].payload.original_content).toBe("R&D <notes>");
    });
  });

  /**
   * The same rule, on the column three lines away in the same payload. The loss
   * is milder than `original_content`'s — `metadata` carries display hints, not
   * the value the site serves — but "absent means leave it alone" is a uniform
   * rule about files, not a per-column severity judgement. A reader finding one
   * column protected and its neighbour not has no way to tell whether that was
   * reasoned or missed.
   */
  describe("metadata", () => {
    it("leaves an existing value untouched when the file omits the column", async () => {
      existingElementIds = ["existing-1"];

      const { body } = await importCSV(
        [
          "element_id,selector,current_content",
          "existing-1,.hero,Updated copy",
        ].join("\n"),
      );

      expect(body.results.rows).toEqual([
        { row: 1, elementId: "existing-1", outcome: "updated" },
      ]);
      expect(contentWrites[0].payload).not.toHaveProperty("metadata");
    });

    it("leaves it unset on a created row the file says nothing about", async () => {
      const { body } = await importJSON([
        { element_id: "new-1", selector: ".new", current_content: "Fresh" },
      ]);

      expect(body.results.rows[0].outcome).toBe("created");
      expect(contentWrites[0].payload).not.toHaveProperty("metadata");
    });

    it("treats a JSON null as absent, the way the raw-row export writes it", async () => {
      existingElementIds = ["existing-1"];

      await importJSON([
        {
          element_id: "existing-1",
          selector: ".hero",
          current_content: "Updated copy",
          metadata: null,
        },
      ]);

      expect(contentWrites[0].payload).not.toHaveProperty("metadata");
    });

    it("writes an empty object when the column is present and deliberately empty", async () => {
      existingElementIds = ["existing-1"];

      await importCSV(
        [
          "element_id,selector,current_content,metadata",
          "existing-1,.hero,Updated copy,",
        ].join("\n"),
      );

      expect(contentWrites[0].payload.metadata).toEqual({});
    });

    it("writes the value the file carries when the column is present", async () => {
      await importJSON([
        {
          element_id: "new-1",
          selector: ".new",
          current_content: "Fresh",
          metadata: { type: "h1" },
        },
      ]);

      expect(contentWrites[0].payload.metadata).toEqual({ type: "h1" });
    });
  });

  /**
   * AC7 — "imported changes appear in version history as normal, revertible
   * edits". `VersionHistoryPanel` reads `content_versions`, which only the
   * `create_content_version` RPC writes; a direct write to `content_elements`
   * left no trace there at all. Per ADR 008 the batch takes one snapshot after
   * the fact rather than routing every row through staging.
   */
  describe("version history snapshot", () => {
    it("takes exactly one snapshot when at least one row was applied", async () => {
      existingElementIds = ["existing-1"];

      await importJSON([
        {
          element_id: "new-1",
          selector: ".new",
          current_content: "Fresh copy",
        },
        {
          element_id: "existing-1",
          selector: ".old",
          current_content: "Updated copy",
        },
      ]);

      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("create_content_version", {
        p_site_id: "site-123",
        p_created_by: "owner@example.com",
        p_description: expect.stringContaining("Bulk import"),
        // ADR 024. `content_versions.change_type` is constrained to
        // ('manual','style_apply','language_switch','theme_apply','restore','bulk_edit')
        // — `bulk_edit` is the value that exists; `bulk_import` would violate
        // the CHECK and the history the snapshot exists to write would stay
        // silently empty. The status registry had to be corrected to match
        // (it was keyed `bulk`, which the column can never hold): see
        // `src/__tests__/components/dashboard/VersionTimelineItem.test.tsx`
        // for the render that proves the label, which this test cannot.
        p_change_type: "bulk_edit",
      });
    });

    it("takes no snapshot when nothing was applied", async () => {
      existingElementIds = ["existing-1"];

      await importJSON(
        [
          {
            element_id: "existing-1",
            selector: ".old",
            current_content: "Ignored",
          },
        ],
        { overwrite_existing: false, create_missing_elements: false },
      );

      expect(rpc).not.toHaveBeenCalled();
    });

    it("still reports the import when the snapshot itself fails", async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: "snapshot exploded" },
      });

      const { response, body } = await importJSON([
        {
          element_id: "new-1",
          selector: ".new",
          current_content: "Fresh copy",
        },
      ]);

      // The row is already written. Answering "import failed" here would be a
      // lie the owner would act on by importing the file a second time.
      expect(response.status).toBe(200);
      expect(body.results.created).toBe(1);
    });
  });

  it("records the outcome counts on the bulk operation row", async () => {
    existingElementIds = [];

    await importJSON([
      { element_id: "new-1", selector: ".new", current_content: "Fresh copy" },
    ]);

    expect(operationUpdates[0]).toMatchObject({
      status: "completed",
      total_items: 1,
      processed_items: 1,
      failed_items: 0,
    });
  });
});
