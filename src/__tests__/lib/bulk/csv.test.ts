import { encodeCSVRow, parseCSV } from "@/lib/bulk/csv";

/**
 * The export route has always quoted and escaped its CSV fields; the import
 * route split every line on `,` with no quote awareness at all. Any exported
 * value containing a comma, a quote or a line break therefore came back from a
 * round trip in the wrong columns — the concrete threat to "an exported file
 * re-imported unchanged produces zero content differences". These tests pin the
 * two halves of the codec against each other so they can never drift apart
 * again.
 */
describe("bulk CSV codec", () => {
  describe("encodeCSVRow → parseCSV round trip", () => {
    const pathological: Array<[string, string]> = [
      ["a comma", "Prices, discounts and more"],
      ["a bare double quote", 'He said "hello" loudly'],
      ["an embedded newline", "First line\nSecond line"],
      ["an embedded CRLF", "First line\r\nSecond line"],
      ["unicode", "Prix : 12 € — déjà vu ✓ 日本語"],
      ["a leading space", "  padded value  "],
      ["an empty value", ""],
      ["a lone quote and comma together", 'a,"b'],
    ];

    it.each(pathological)("survives %s unchanged", (_label, value) => {
      const encoded = encodeCSVRow(["header-1", ".header", value, "en"]);

      const parsed = parseCSV(encoded);

      expect(parsed).toEqual([["header-1", ".header", value, "en"]]);
    });

    it("keeps multi-row files aligned when a field contains a newline", () => {
      const rows = [
        ["element_id", "current_content"],
        ["a", "one\ntwo"],
        ["b", "plain"],
      ];

      const csv = rows.map(encodeCSVRow).join("\n");

      expect(parseCSV(csv)).toEqual(rows);
    });
  });

  describe("encodeCSVRow", () => {
    it("leaves a field with no special character unquoted", () => {
      expect(encodeCSVRow(["header-1", "en", "default"])).toBe(
        "header-1,en,default",
      );
    });

    it("quotes and doubles embedded quotes", () => {
      expect(encodeCSVRow(['say "hi"'])).toBe('"say ""hi"""');
    });
  });

  describe("parseCSV", () => {
    it("returns no data rows for a header-only file", () => {
      const parsed = parseCSV("element_id,selector,current_content");

      expect(parsed).toHaveLength(1);
      expect(parsed.slice(1)).toEqual([]);
    });

    it("ignores the trailing newline instead of emitting an empty row", () => {
      const parsed = parseCSV("element_id,selector\nheader-1,.header\n");

      expect(parsed).toEqual([
        ["element_id", "selector"],
        ["header-1", ".header"],
      ]);
    });

    it("returns an empty result for an empty file", () => {
      expect(parseCSV("")).toEqual([]);
      expect(parseCSV("\n\n")).toEqual([]);
    });

    it("preserves empty trailing fields", () => {
      expect(parseCSV("a,b,\n")).toEqual([["a", "b", ""]]);
    });

    it("splits rows on CRLF as well as LF", () => {
      expect(parseCSV("a,b\r\nc,d")).toEqual([
        ["a", "b"],
        ["c", "d"],
      ]);
    });
  });
});
