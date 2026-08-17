import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BulkOperations } from "@/components/dashboard/BulkOperations";
import { MAX_IMPORT_BYTES } from "@/lib/bulk/constants";
import type { BulkImportRowResult } from "@/types";

/**
 * The component was imported by nothing, so none of this was ever exercised:
 * the history fetch asked `/api/bulk/import?siteId=`, a shape that endpoint has
 * never supported (it reads `operationId` only). It answered 400, the
 * `if (response.ok)` guard swallowed it, and the tab rendered "no operations" —
 * an outage presented as an empty account.
 *
 * These tests cover each state the design names: default, size-refused,
 * permission-refused, loading, error, all-success, partial-success and the
 * history tab's empty state.
 */

const OPERATIONS = [
  {
    id: "op-1",
    user_id: "user-1",
    site_id: "site-1",
    operation_type: "import",
    status: "completed",
    total_items: 12,
    processed_items: 12,
    failed_items: 0,
    configuration: {},
    result_data: {},
    error_log: [],
    created_at: "2026-02-01T10:00:00Z",
  },
];

type ImportOutcome = {
  status: number;
  body: unknown;
};

type Stub = {
  historyStatus?: number;
  historyBody?: unknown;
  exportStatus?: number;
  importOutcome?: ImportOutcome;
  /** Resolves the import response only when this promise settles. */
  importGate?: Promise<void>;
};

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)]),
  }) as unknown as Response;

const stubFetch = ({
  historyStatus = 200,
  historyBody = OPERATIONS,
  exportStatus = 200,
  importOutcome = {
    status: 200,
    body: {
      operation_id: "op-9",
      status: "completed",
      results: {
        total: 1,
        created: 1,
        updated: 0,
        skipped: 0,
        failed: 0,
        rows: [{ row: 1, elementId: "hero-1", outcome: "created" }],
      },
    },
  },
  importGate,
}: Stub = {}) => {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);

    // The real `GET /api/bulk/import` only understands `operationId`; asking it
    // for a site listing is a 400, which is what the old code did.
    if (url.startsWith("/api/bulk/import?siteId=")) {
      return jsonResponse(400, { error: "Missing operationId parameter" });
    }
    if (url.startsWith("/api/bulk/import?operationId=")) {
      return jsonResponse(200, { id: "op-9", status: "completed" });
    }
    if (url.startsWith("/api/bulk/export?siteId=")) {
      return jsonResponse(historyStatus, historyBody);
    }
    if (url === "/api/bulk/export") {
      return exportStatus === 200
        ? jsonResponse(200, [{ element_id: "hero-1" }])
        : jsonResponse(exportStatus, { error: "Export blew up" });
    }
    if (url === "/api/bulk/import") {
      if (importGate) await importGate;
      return jsonResponse(importOutcome.status, importOutcome.body);
    }

    return jsonResponse(200, {});
  });

  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const importResults = (rows: BulkImportRowResult[]) => ({
  status: 200,
  body: {
    operation_id: "op-9",
    status: "completed",
    results: {
      total: rows.length,
      created: rows.filter((row) => row.outcome === "created").length,
      updated: rows.filter((row) => row.outcome === "updated").length,
      skipped: rows.filter((row) => row.outcome === "skipped").length,
      failed: rows.filter((row) => row.outcome === "failed").length,
      rows,
    },
  },
});

const openTab = async (name: RegExp) => {
  await userEvent.click(screen.getByRole("tab", { name }));
};

const chooseFile = (file: File) => {
  const input = screen.getByLabelText(/select file/i);
  fireEvent.change(input, { target: { files: [file] } });
  return input as HTMLInputElement;
};

/**
 * Choosing a file is asynchronous now: the card reads it to measure the request
 * body it would send, so the submit button arms a tick after the change event
 * rather than with it. Tests that go on to submit have to wait for that, which
 * is also what an owner does.
 */
const chooseAcceptedFile = async (file: File) => {
  const input = chooseFile(file);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /import content/i }),
    ).toBeEnabled(),
  );
  return input;
};

const jsonFile = (name = "content.json") =>
  new File(
    [
      JSON.stringify([
        { element_id: "hero-1", selector: ".hero", current_content: "Hi" },
      ]),
    ],
    name,
    { type: "application/json" },
  );

const oversizedFile = () => {
  const file = new File(["{}"], "huge.json", { type: "application/json" });
  // Faking `size` keeps the test fast: the refusal is about the number, and
  // materialising five megabytes in jsdom to prove it would not test more.
  Object.defineProperty(file, "size", { value: MAX_IMPORT_BYTES + 1 });
  return file;
};

/**
 * A CSV whose *file* is comfortably under the limit and whose *request body* is
 * not.
 *
 * The server measures the JSON envelope, so the two numbers differ: a CSV
 * travels as a JSON string, where every `"` is escaped to `\"` — two bytes for
 * one. Nothing here is faked; the file's size and the body's size are both
 * real, and the gap between them is the whole point.
 */
const QUOTE_COUNT = 2_200_000;

const envelopeOversizedFile = () =>
  new File(['"'.repeat(QUOTE_COUNT)], "quotes.csv", { type: "text/csv" });

describe("BulkOperations", () => {
  beforeAll(() => {
    global.URL.createObjectURL = jest.fn(() => "blob:mock");
    global.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("export tab", () => {
    /**
     * Every column `generateCSV` and `generateXML` write, not a selection of
     * them. The panel used to name five of the eleven — and `original_content`
     * was one of the six it left out, which is the column an owner then builds
     * a file without.
     */
    it("says what the exported file contains before anything is downloaded", async () => {
      stubFetch();

      render(<BulkOperations siteId="site-1" />);
      // The preview is the export tab's only list; the filter fields below it
      // legitimately mention the same words.
      const preview = within(screen.getByRole("tabpanel")).getByRole("list");

      for (const field of [
        /row id/i,
        /site id/i,
        /element id/i,
        /selector/i,
        /original content/i,
        /current content/i,
        /language/i,
        /variant/i,
        /metadata/i,
        /created/i,
        /last updated/i,
      ]) {
        expect(within(preview).getByText(field)).toBeInTheDocument();
      }
      expect(within(preview).getAllByRole("listitem")).toHaveLength(11);
    });

    it("confirms the download inline once the export succeeds", async () => {
      stubFetch();

      render(<BulkOperations siteId="site-1" />);
      await userEvent.click(
        screen.getByRole("button", { name: /export content/i }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /export ready/i,
      );
    });

    it("reports an export failure instead of failing silently", async () => {
      stubFetch({ exportStatus: 500 });

      render(<BulkOperations siteId="site-1" />);
      await userEvent.click(
        screen.getByRole("button", { name: /export content/i }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /export failed/i,
      );
    });
  });

  describe("import tab", () => {
    const openImport = async () => {
      render(<BulkOperations siteId="site-1" />);
      await openTab(/^import$/i);
    };

    it("refuses a file over the size limit before sending anything", async () => {
      const fetchMock = stubFetch();
      await openImport();

      const input = chooseFile(oversizedFile());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /import limit is 4 MB/i,
      );
      expect(input.value).toBe("");
      expect(
        screen.getByRole("button", { name: /import content/i }),
      ).toBeDisabled();
      expect(fetchMock).not.toHaveBeenCalledWith(
        "/api/bulk/import",
        expect.anything(),
      );
    });

    /**
     * The client and the server have to measure the *same quantity*, or the
     * shared constant guarantees nothing. The server measures the request body
     * (`req.text()` then `Buffer.byteLength`); checking `file.size` against the
     * same number is checking something strictly smaller, so a file can pass
     * here and be refused there — and above Vercel's 4.5 MB ceiling that
     * refusal is not even ours to phrase.
     *
     * This file is real: ~2.1 MB on disk, over 4 MB once escaped into the JSON
     * envelope.
     */
    it("refuses a file whose request body exceeds the limit even though the file does not", async () => {
      const fetchMock = stubFetch();
      await openImport();
      await userEvent.selectOptions(screen.getByLabelText(/format/i), "csv");

      const file = envelopeOversizedFile();
      expect(file.size).toBeLessThan(MAX_IMPORT_BYTES);

      const input = chooseFile(file);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /import limit is 4 MB/i,
      );
      expect(input.value).toBe("");
      expect(
        screen.getByRole("button", { name: /import content/i }),
      ).toBeDisabled();
      expect(fetchMock).not.toHaveBeenCalledWith(
        "/api/bulk/import",
        expect.anything(),
      );
    });

    it("does not offer XML, which the import route cannot read", async () => {
      stubFetch();
      await openImport();

      const format = screen.getByLabelText(/format/i);

      expect(within(format).queryByText(/xml/i)).not.toBeInTheDocument();
    });

    it("replaces the form with an explanation when the caller cannot import", async () => {
      stubFetch({
        importOutcome: {
          status: 403,
          body: { error: "Insufficient permissions" },
        },
      });
      await openImport();

      await chooseAcceptedFile(jsonFile());
      await userEvent.click(
        screen.getByRole("button", { name: /import content/i }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /you need edit access on this site/i,
      );
      expect(screen.queryByLabelText(/select file/i)).not.toBeInTheDocument();
    });

    it("shows the report's shape while the import is in flight", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      stubFetch({ importGate: gate });
      await openImport();

      await chooseAcceptedFile(jsonFile());
      await userEvent.click(
        screen.getByRole("button", { name: /import content/i }),
      );

      expect(
        await screen.findByTestId("import-report-skeleton"),
      ).toBeInTheDocument();

      release();
      await waitFor(() =>
        expect(
          screen.queryByTestId("import-report-skeleton"),
        ).not.toBeInTheDocument(),
      );
    });

    it("reports a full success without making the owner read every row", async () => {
      stubFetch({
        importOutcome: importResults([
          { row: 1, elementId: "hero-1", outcome: "created" },
          { row: 2, elementId: "hero-2", outcome: "created" },
        ]),
      });
      await openImport();

      await chooseAcceptedFile(jsonFile());
      await userEvent.click(
        screen.getByRole("button", { name: /import content/i }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /import complete/i,
      );
      // Nothing needs attention, so no row is shown until asked for.
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      await userEvent.click(
        screen.getByRole("button", { name: /show all 2/i }),
      );
      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    /**
     * The heart of the design: 3 bad rows out of 400 must read as "three things
     * to look at", not as an incident, and nobody should scroll past 397
     * identical rows to find them.
     */
    it("puts the rows that need attention first on a partial success", async () => {
      stubFetch({
        importOutcome: importResults([
          { row: 1, elementId: "hero-1", outcome: "created" },
          { row: 2, elementId: "hero-2", outcome: "created" },
          { row: 3, elementId: "hero-3", outcome: "updated" },
          {
            row: 4,
            elementId: "",
            outcome: "failed",
            detail: "Missing required field: element_id",
          },
        ]),
      });
      await openImport();

      await chooseAcceptedFile(jsonFile());
      await userEvent.click(
        screen.getByRole("button", { name: /import content/i }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /needs attention/i,
      );

      const metrics = screen.getByTestId("import-metrics");
      expect(
        within(metrics).getByText("Created").parentElement,
      ).toHaveTextContent("2");
      expect(
        within(metrics).getByText("Failed").parentElement,
      ).toHaveTextContent("1");

      // Created rows are hidden behind the disclosure; the other two are not.
      const table = screen.getByRole("table");
      expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2
      expect(within(table).queryByText("hero-1")).not.toBeInTheDocument();

      await userEvent.click(
        screen.getByRole("button", { name: /2 created rows hidden/i }),
      );
      expect(
        within(screen.getByRole("table")).getAllByRole("row"),
      ).toHaveLength(5);
    });
  });

  describe("operation history", () => {
    it("lists the site's past operations from the endpoint that supports a site listing", async () => {
      stubFetch();

      render(<BulkOperations siteId="site-1" />);

      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/bulk/export?siteId=site-1",
        ),
      );

      await openTab(/history/i);
      const panel = screen.getByRole("tabpanel");

      expect(await within(panel).findByText(/import/i)).toBeInTheDocument();
    });

    it("shows an empty state, not a blank box, when nothing has run yet", async () => {
      stubFetch({ historyBody: [] });

      render(<BulkOperations siteId="site-1" />);
      await openTab(/history/i);

      expect(
        await screen.findByText(/no imports or exports yet/i),
      ).toBeInTheDocument();
    });

    it("shows an error rather than an empty list when the listing fails", async () => {
      stubFetch({ historyStatus: 403, historyBody: { error: "nope" } });

      render(<BulkOperations siteId="site-1" />);
      await openTab(/history/i);

      const panel = screen.getByRole("tabpanel");
      expect(await within(panel).findByRole("alert")).toHaveTextContent(
        /do not have access/i,
      );
      expect(
        screen.queryByText(/no imports or exports yet/i),
      ).not.toBeInTheDocument();
    });
  });
});
