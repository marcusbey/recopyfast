/**
 * @jest-environment node
 */

import { createFinding, MAX_FINDINGS } from "@/lib/tools/lens";
import {
  compactBytes,
  MAX_REPORT_BYTES,
  parseStoredReport,
  reportPage,
  serializeReport,
  type ToolReport,
} from "../report-schema";

const HOME = "https://example.com/";

function baseReport(overrides: Partial<ToolReport> = {}): ToolReport {
  return {
    v: 1,
    tool: "website-spell-checker",
    url: HOME,
    finalUrl: HOME,
    scannedAt: "2026-10-11T12:00:00.000Z",
    summary: {
      headline: "1 possible typo on 1 page of 1",
      verdict: "warn",
      facts: [{ label: "Pages checked", value: "1" }],
    },
    findings: [
      createFinding({
        page: HOME,
        kind: "typo",
        match: "recieve",
        before: "We ",
        after: " orders.",
        suggestion: "receive",
      }),
    ],
    pages: [{ url: HOME, status: "checked" }],
    truncated: false,
    ...overrides,
  };
}

/** The biggest findings the lens contract allows, in multibyte text. */
function maximalFinding(index: number) {
  return createFinding({
    page: `${HOME}${"p".repeat(1_900)}${index}`,
    kind: "typo",
    match: "é".repeat(80),
    before: "€".repeat(200),
    after: "日".repeat(200),
    note: "ü".repeat(400),
    suggestion: "ß".repeat(80),
    code: "c".repeat(1_000),
    imageSrc: `https://cdn.example/${"i".repeat(2_000)}`.slice(0, 2_048),
  });
}

describe("serializeReport", () => {
  it("round-trips a small report unchanged", () => {
    const report = baseReport();
    const stored = serializeReport(report);

    expect(stored).toEqual(report);
    expect(parseStoredReport(JSON.parse(JSON.stringify(stored)))).toEqual(
      report,
    );
  });

  it("keeps the compact JSON at most 12 KB by dropping findings from the end", () => {
    const findings = Array.from({ length: MAX_FINDINGS }, (_, index) =>
      maximalFinding(index),
    );
    const report = baseReport({ findings });
    expect(compactBytes(report)).toBeGreaterThan(MAX_REPORT_BYTES);

    const stored = serializeReport(report);

    expect(compactBytes(stored)).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    expect(stored.truncated).toBe(true);
    expect(stored.findings.length).toBeGreaterThan(0);
    expect(stored.findings[0]).toEqual(findings[0]);
    expect(MAX_REPORT_BYTES).toBe(12 * 1024);
  });

  it("drops skipped pages last-first if findings alone cannot make it fit", () => {
    const pages = [
      reportPage(HOME, "checked"),
      ...Array.from({ length: 11 }, (_, index) =>
        reportPage(
          `${HOME}${"x".repeat(500)}${index}`,
          "skipped",
          "r".repeat(300),
        ),
      ),
    ];
    const big = baseReport({
      findings: Array.from({ length: MAX_FINDINGS }, (_, index) =>
        maximalFinding(index),
      ),
      pages,
    });

    const stored = serializeReport(big);

    expect(compactBytes(stored)).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    expect(stored.pages[0]).toEqual(pages[0]);
  });
});

describe("parseStoredReport", () => {
  const valid = () =>
    JSON.parse(JSON.stringify(baseReport())) as Record<string, unknown>;

  it("accepts a valid stored report", () => {
    expect(parseStoredReport(valid())).not.toBeNull();
  });

  it.each([
    ["an unknown version", (r: Record<string, unknown>) => ({ ...r, v: 2 })],
    ["an extra key", (r: Record<string, unknown>) => ({ ...r, extra: 1 })],
    [
      "a missing key",
      (r: Record<string, unknown>) => {
        const copy = { ...r };
        delete copy.pages;
        return copy;
      },
    ],
    [
      "a bad tool slug",
      (r: Record<string, unknown>) => ({ ...r, tool: "../etc" }),
    ],
    [
      "a javascript: URL",
      (r: Record<string, unknown>) => ({ ...r, url: "javascript:alert(1)" }),
    ],
    [
      "a javascript: page",
      (r: Record<string, unknown>) => ({
        ...r,
        pages: [{ url: "javascript:alert(1)", status: "checked" }],
      }),
    ],
    [
      "a javascript: finding page",
      (r: Record<string, unknown>) => ({
        ...r,
        findings: [
          { ...(r.findings as object[])[0], page: "javascript:alert(1)" },
        ],
      }),
    ],
    [
      "an http: image source",
      (r: Record<string, unknown>) => ({
        ...r,
        findings: [
          { ...(r.findings as object[])[0], imageSrc: "http://cdn.test/a.png" },
        ],
      }),
    ],
    [
      "an oversized match",
      (r: Record<string, unknown>) => ({
        ...r,
        findings: [{ ...(r.findings as object[])[0], match: "m".repeat(81) }],
      }),
    ],
    [
      "an unknown finding key",
      (r: Record<string, unknown>) => ({
        ...r,
        findings: [{ ...(r.findings as object[])[0], html: "<b>x</b>" }],
      }),
    ],
    [
      "too many findings",
      (r: Record<string, unknown>) => ({
        ...r,
        findings: Array.from(
          { length: MAX_FINDINGS + 1 },
          () => (r.findings as object[])[0],
        ),
      }),
    ],
    [
      "an unknown verdict",
      (r: Record<string, unknown>) => ({
        ...r,
        summary: { ...(r.summary as object), verdict: "great" },
      }),
    ],
    [
      "too many facts",
      (r: Record<string, unknown>) => ({
        ...r,
        summary: {
          ...(r.summary as object),
          facts: Array.from({ length: 9 }, () => ({ label: "a", value: "b" })),
        },
      }),
    ],
    [
      "a non-boolean truncated",
      (r: Record<string, unknown>) => ({ ...r, truncated: "no" }),
    ],
    [
      "a bad date",
      (r: Record<string, unknown>) => ({ ...r, scannedAt: "yesterday" }),
    ],
  ])("refuses %s", (_case, mutate) => {
    expect(parseStoredReport(mutate(valid()))).toBeNull();
  });

  it("refuses prototype-shaped keys", () => {
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":true},"v":1,"tool":"website-spell-checker","url":"https://example.com/","finalUrl":"https://example.com/","scannedAt":"2026-10-11T12:00:00.000Z","summary":{"headline":"h","verdict":"pass","facts":[]},"findings":[],"pages":[],"truncated":false}',
    );

    expect(parseStoredReport(hostile)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([null, [], "report", 42])("refuses %p", (value) => {
    expect(parseStoredReport(value)).toBeNull();
  });

  it("strips invisible characters again on read", () => {
    const stored = valid();
    (stored.findings as Record<string, unknown>[])[0].after = " or\u202eders";

    expect(parseStoredReport(stored)?.findings[0].after).toBe(" orders");
  });
});

describe("reportPage", () => {
  it("shortens a very long page URL to its origin for display", () => {
    expect(reportPage(`${HOME}${"a".repeat(600)}`, "checked").url).toBe(HOME);
    expect(reportPage(`${HOME}about`, "skipped", "  why \n now ").reason).toBe(
      "why now",
    );
  });
});
