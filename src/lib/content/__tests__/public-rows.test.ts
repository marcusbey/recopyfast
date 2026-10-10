/**
 * s65a — the one public-row allow-list.
 *
 * The unauthenticated snapshot route (ADR 046) serves exactly what the
 * widget-authorized `GET /api/content/[siteId]` serves. These tests pin the
 * three things that make that true at the row level: the column list is the
 * same bytes as that route's select, the mapping is the same transform, and a
 * row carrying a private column is refused rather than trimmed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PUBLIC_CONTENT_COLUMNS,
  toPublicRows,
  type PublicContentSourceRow,
} from "@/lib/content/public-rows";

function sourceRow(
  overrides: Partial<PublicContentSourceRow> = {},
): PublicContentSourceRow {
  return {
    id: "row-1",
    site_id: "site-1",
    element_id: "hero-title",
    selector: "h1",
    published_content: "Published headline",
    original_content: "Authored headline",
    language: "en",
    variant: "default",
    page_path: "/pricing",
    metadata: { type: "h1" },
    published_at: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("PUBLIC_CONTENT_COLUMNS", () => {
  it("is byte-identical to both selects of the authenticated content GET", () => {
    // The authenticated GET keeps its inline projection until s65c. If either
    // string drifts, the two public reads stop serving the same fields.
    const routeSource = readFileSync(
      path.join(process.cwd(), "src/app/api/content/[siteId]/route.ts"),
      "utf8",
    );
    const selects = routeSource.match(/\.select\(\s*"([^"]+)"/g) ?? [];
    const gettingColumns = selects
      .map((call) => /"([^"]+)"/.exec(call)?.[1])
      .filter((columns) => columns?.includes("published_content"));

    expect(gettingColumns).toEqual([
      PUBLIC_CONTENT_COLUMNS,
      PUBLIC_CONTENT_COLUMNS,
    ]);
  });

  it("names no private column", () => {
    const columns = PUBLIC_CONTENT_COLUMNS.split(",").map((column) =>
      column.trim(),
    );

    for (const privateColumn of [
      "staging_content",
      "staging_updated_at",
      "staging_updated_by",
      "published_by",
      "current_content",
    ]) {
      expect(columns).not.toContain(privateColumn);
    }
  });
});

describe("toPublicRows", () => {
  it("serves published content as current_content", () => {
    expect(toPublicRows([sourceRow()])).toEqual([
      {
        ...sourceRow(),
        current_content: "Published headline",
      },
    ]);
  });

  it("falls back to original_content, then to an empty string", () => {
    const rows = toPublicRows([
      sourceRow({ id: "a", published_content: null }),
      sourceRow({ id: "b", published_content: null, original_content: null }),
    ]);

    expect(rows?.map((row) => row.current_content)).toEqual([
      "Authored headline",
      "",
    ]);
  });

  it("strips staging attributes and keeps every other metadata key", () => {
    const [row] =
      toPublicRows([
        sourceRow({
          metadata: {
            type: "a",
            attributes: { href: "/live" },
            staging_attributes: { href: "/unpublished-destination" },
            translatedFrom: "en",
            aiGenerated: true,
            tokensUsed: 12,
          },
        }),
      ]) ?? [];

    expect(row.metadata).toEqual({
      type: "a",
      attributes: { href: "/live" },
      translatedFrom: "en",
      aiGenerated: true,
      tokensUsed: 12,
    });
  });

  it("does not mutate the row it was given", () => {
    const metadata = { staging_attributes: { href: "/draft" } };
    const input = sourceRow({ metadata });

    toPublicRows([input]);

    expect(input.metadata).toBe(metadata);
    expect(metadata).toEqual({ staging_attributes: { href: "/draft" } });
  });

  it.each([null, ["not", "an", "object"], "text"])(
    "serves non-object metadata (%p) as an empty object, like the content GET",
    (metadata) => {
      const [row] = toPublicRows([sourceRow({ metadata })]) ?? [];

      expect(row.metadata).toEqual({});
    },
  );

  it.each(["staging_content", "staging_updated_at", "published_by"])(
    "refuses the whole result when a row carries %s",
    (privateField) => {
      const leaking = {
        ...sourceRow(),
        [privateField]: "private",
      } as PublicContentSourceRow;

      expect(toPublicRows([sourceRow({ id: "clean" }), leaking])).toBeNull();
    },
  );

  it("rebuilds rows from the allow-list, dropping unknown columns", () => {
    const widened = {
      ...sourceRow(),
      api_key: "secret",
    } as PublicContentSourceRow;

    const [row] = toPublicRows([widened]) ?? [];

    expect(Object.keys(row).sort()).toEqual(
      [
        ...PUBLIC_CONTENT_COLUMNS.split(",").map((column) => column.trim()),
        "current_content",
      ].sort(),
    );
  });

  it("maps an empty page to an empty list", () => {
    expect(toPublicRows([])).toEqual([]);
  });
});
