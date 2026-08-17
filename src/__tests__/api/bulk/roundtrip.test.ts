import { POST as EXPORT } from "@/app/api/bulk/export/route";
import { POST as IMPORT } from "@/app/api/bulk/import/route";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@supabase/ssr");
jest.mock("@/lib/supabase/service");
jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));

/**
 * AC3, the criterion the story names explicitly: an exported file re-imported
 * unchanged produces zero content differences.
 *
 * This is an integration-shaped test on purpose — export route out, import
 * route back in, in-process. Unit tests on either half passed for months while
 * the pair was broken, because the writer quoted its fields and the reader
 * split on `,` with no quote awareness. Only running one into the other catches
 * that class of disagreement.
 *
 * The fixture values are the ones that broke it: a comma inside a CSS selector
 * list, a comma inside the copy, an embedded double quote, an embedded newline
 * and non-ASCII text.
 *
 * And `<`, `>`, `&` and quotes, which is the second thing that broke it and the
 * more expensive one. This file used to say the fixture carried no
 * HTML-special characters "because the write path sanitizes content
 * deliberately … that transformation is not what this test is about". That was
 * scoping the test around the bug: content discovery stores the customer's
 * `textContent` verbatim (see `src/lib/security/discovered-text.ts`, bug A-1),
 * so an ordinary landing page's copy reaches this table with a live `<` in it,
 * and the import path ran it through an HTML sanitizer. `"Setup in <2 minutes
 * — Paste the <script> tag"` came back as `"Setup in &lt;2 minutes — Paste
 * the "` — rewritten and truncated, on the one feature whose entire promise is
 * that an export and a re-import change nothing.
 */
const SOURCE_ROWS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    site_id: "site-123",
    element_id: "hero-1",
    selector: ".header, .hero",
    original_content: "Original copy",
    current_content: 'Prix : 12 € — she said "yes", twice\nand again',
    language: "en",
    variant: "default",
    metadata: { type: "text" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    site_id: "site-123",
    element_id: "footer-1",
    selector: ".footer",
    original_content: "",
    current_content: "  Footer copy with trailing space  ",
    language: "fr",
    variant: "mobile",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
  {
    // Ordinary marketing copy off an ordinary landing page. Every character
    // here is one a customer types on purpose.
    id: "33333333-3333-3333-3333-333333333333",
    site_id: "site-123",
    element_id: "install-steps-1",
    selector: "#install > p",
    original_content: "R&D <notes> — draft",
    current_content: "Setup in <2 minutes — Paste the <script> tag",
    language: "en",
    variant: "default",
    metadata: { type: "p" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    site_id: "site-123",
    element_id: "pricing-note-1",
    selector: ".pricing > small",
    original_content: "",
    current_content: 'Plans & pricing: "Pro" > "Starter" — 5 seats & up',
    language: "en",
    variant: "default",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
];

const contentWrites: Record<string, unknown>[] = [];

const makeBuilder = (table: string) => {
  const filters: Record<string, unknown> = {};
  const settled = {
    data: table === "content_elements" ? SOURCE_ROWS : null,
    error: null,
  };

  const builder: Record<string, unknown> = {
    then: (
      resolve: (value: unknown) => unknown,
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
      // The import's existence lookup, answered from the same rows the export
      // was generated from: re-importing an export always targets rows that
      // already exist, which is what makes it an overwrite rather than a
      // create.
      const match = SOURCE_ROWS.find(
        (row) =>
          row.element_id === filters.element_id &&
          row.language === filters.language &&
          row.variant === filters.variant,
      );
      return match
        ? { data: { id: match.id }, error: null }
        : { data: null, error: { code: "PGRST116", message: "No rows" } };
    }),
    upsert: jest.fn((payload: Record<string, unknown>) => {
      if (table === "content_elements") contentWrites.push(payload);
      return builder;
    }),
    insert: jest.fn((payload: Record<string, unknown>) => {
      if (table === "content_elements") contentWrites.push(payload);
      return builder;
    }),
    update: jest.fn(() => builder),
  };
  for (const method of ["select", "in", "gte", "order", "limit"]) {
    builder[method] = jest.fn(() => builder);
  }
  return builder;
};

const mockSupabase = {
  auth: { getUser: jest.fn() },
  from: jest.fn((table: string) => makeBuilder(table)),
};

(createServerClient as jest.Mock).mockReturnValue(mockSupabase);

const request = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

/** The export route answers with a file body; the mock returns it via json(). */
const readFileBody = async (response: {
  json: () => Promise<unknown>;
}): Promise<string> => (await response.json()) as string;

const exportSite = async (format: "json" | "csv") => {
  const response = await EXPORT(
    request("/api/bulk/export", { site_id: "site-123", format }),
  );
  expect(response.status).toBe(200);
  return readFileBody(response);
};

describe("bulk export → import round trip", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    contentWrites.length = 0;
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "owner@example.com" } },
    });
    (createServiceRoleClient as jest.Mock).mockReturnValue({
      rpc: jest.fn(async () => ({ data: "version-1", error: null })),
    });
    (enforceRateLimit as jest.Mock).mockResolvedValue(null);
  });

  it.each(["json", "csv"] as const)(
    "re-imports its own %s export with zero content differences",
    async (format) => {
      const exported = await exportSite(format);

      const response = await IMPORT(
        request("/api/bulk/import", {
          site_id: "site-123",
          format,
          data: format === "json" ? JSON.parse(exported) : exported,
          options: { overwrite_existing: true, create_missing_elements: true },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      // Every row comes back as an update of the row it came from — nothing
      // failed, nothing was skipped, nothing was created by accident.
      expect(body.results).toMatchObject({
        total: SOURCE_ROWS.length,
        created: 0,
        updated: SOURCE_ROWS.length,
        skipped: 0,
        failed: 0,
      });

      expect(contentWrites).toHaveLength(SOURCE_ROWS.length);
      SOURCE_ROWS.forEach((source, index) => {
        expect(contentWrites[index]).toMatchObject({
          site_id: source.site_id,
          element_id: source.element_id,
          selector: source.selector,
          current_content: source.current_content,
          published_content: source.current_content,
          original_content: source.original_content,
          language: source.language,
          variant: source.variant,
          metadata: source.metadata,
        });
      });
    },
  );
});
