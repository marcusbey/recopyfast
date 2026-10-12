/**
 * The stored report, version 1 (s96, plan decision 7).
 *
 * WRITE: `serializeReport` keeps the COMPACT JSON at most 12 KB
 * (`Buffer.byteLength`, so multibyte text counts as the bytes it is) by
 * dropping findings from the end and setting `truncated`. The DB CHECK is
 * 16 KB on `report::text`, which prints a space after every `:` and `,`; the
 * 4 KB between the two is the headroom, and
 * `src/__tests__/db/tool-reports-privileges.test.ts` inserts the largest
 * report this module can produce.
 *
 * READ: `parseStoredReport` re-validates every row before the report page
 * renders it — shape, caps, `http(s)` page URLs, `https` image sources, no
 * unknown or prototype keys — and strips invisible characters again. A row
 * that fails is a logged 404, never a rendered page: a bug in an older writer,
 * or a row someone edited by hand, must not reach a reader as markup or as a
 * `javascript:` link.
 */

import {
  createFinding,
  FINDING_LIMITS,
  isHttpsUrl,
  MAX_FACTS,
  MAX_FINDINGS,
  type Finding,
  type LensSummary,
  type SummaryFact,
  type Verdict,
} from "@/lib/tools/lens";
import { TOOL_SLUG_PATTERN } from "@/lib/tools/catalogue";
import {
  clampText,
  collapseWhitespace,
  stripInvisibleCharacters,
} from "@/lib/tools/text";

export const REPORT_VERSION = 1;
export const MAX_REPORT_BYTES = 12 * 1024;
export const MAX_REPORT_PAGES = 12;
export const MAX_PAGE_URL_LENGTH = 2_048;
export const MAX_REPORT_PAGE_URL_LENGTH = 512;
const MAX_HEADLINE = 300;
const MAX_FACT_TEXT = 120;
const MAX_REASON = 300;

const VERDICTS: readonly Verdict[] = [
  "pass",
  "warn",
  "fail",
  "info",
  "skipped",
];
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Why a sampled page is listed as skipped. Shown on the report as is. */
export const PAGE_SKIP_REASONS = {
  timeLimit: "Not reached within the scan's time limit.",
  tooLarge: "Larger or more complex than the scanner reads.",
  robots: "This site's robots.txt asks automated tools not to read this page.",
  failed: "We couldn't fetch this page.",
} as const;

export interface ReportPage {
  url: string;
  status: "checked" | "skipped";
  reason?: string;
}

export interface ToolReport {
  v: typeof REPORT_VERSION;
  tool: string;
  url: string;
  finalUrl: string;
  scannedAt: string;
  summary: LensSummary;
  findings: Finding[];
  pages: ReportPage[];
  truncated: boolean;
}

export function compactBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/**
 * The report as it will be stored: findings dropped from the end until the
 * compact JSON fits 12 KB, `truncated` set when any were.
 */
export function serializeReport(report: ToolReport): ToolReport {
  let kept: ToolReport = { ...report, findings: [...report.findings] };
  if (compactBytes(kept) <= MAX_REPORT_BYTES) return kept;

  kept = { ...kept, truncated: true };
  // Drop findings one by one from the end: the earliest (the homepage's)
  // matter most, and 40 findings make this loop cheap.
  while (kept.findings.length > 0 && compactBytes(kept) > MAX_REPORT_BYTES) {
    kept = { ...kept, findings: kept.findings.slice(0, -1) };
  }
  // The page list is bounded too, but with long URLs it can still be large;
  // skipped pages go first, then the oldest of the rest.
  while (kept.pages.length > 1 && compactBytes(kept) > MAX_REPORT_BYTES) {
    const skipped = kept.pages
      .map((page) => page.status)
      .lastIndexOf("skipped");
    const drop = skipped > 0 ? skipped : kept.pages.length - 1;
    kept = { ...kept, pages: kept.pages.filter((_, index) => index !== drop) };
  }
  return kept;
}

// ---------------------------------------------------------------- reading

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Plain,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  if (keys.some((key) => FORBIDDEN_KEYS.has(key))) return false;
  const allowed = new Set([...required, ...optional]);
  return (
    keys.every((key) => allowed.has(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  return stripInvisibleCharacters(value);
}

function isWebUrl(value: unknown, max = MAX_PAGE_URL_LENGTH): value is string {
  if (typeof value !== "string" || value.length > max) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function readFact(value: unknown): SummaryFact | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["label", "value"]))
    return null;
  const label = readText(value.label, MAX_FACT_TEXT);
  const text = readText(value.value, MAX_FACT_TEXT);
  return label !== null && text !== null ? { label, value: text } : null;
}

function readSummary(value: unknown): LensSummary | null {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ["headline", "verdict", "facts"], ["score"])
  ) {
    return null;
  }
  const headline = readText(value.headline, MAX_HEADLINE);
  if (headline === null) return null;
  if (!VERDICTS.includes(value.verdict as Verdict)) return null;
  if (!Array.isArray(value.facts) || value.facts.length > MAX_FACTS)
    return null;
  const facts = value.facts.map(readFact);
  if (facts.some((fact) => fact === null)) return null;
  const summary: LensSummary = {
    headline,
    verdict: value.verdict as Verdict,
    facts: facts as SummaryFact[],
  };
  if (value.score !== undefined) {
    if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
      return null;
    }
    if (value.score < 0 || value.score > 100) return null;
    summary.score = value.score;
  }
  return summary;
}

const FINDING_REQUIRED = ["page", "kind", "match", "before", "after"] as const;
const FINDING_OPTIONAL = ["note", "suggestion", "code", "imageSrc"] as const;

function readFinding(value: unknown): Finding | null {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, FINDING_REQUIRED, FINDING_OPTIONAL)
  ) {
    return null;
  }
  if (!isWebUrl(value.page)) return null;
  const strings: [string, number][] = [
    ["kind", 40],
    ["match", FINDING_LIMITS.match],
    ["before", FINDING_LIMITS.context],
    ["after", FINDING_LIMITS.context],
  ];
  for (const [key, max] of strings) {
    if (readText(value[key], max) === null) return null;
  }
  const optional: [string, number][] = [
    ["note", FINDING_LIMITS.note],
    ["suggestion", FINDING_LIMITS.suggestion],
    ["code", FINDING_LIMITS.code],
  ];
  for (const [key, max] of optional) {
    if (value[key] !== undefined && readText(value[key], max) === null)
      return null;
  }
  if (value.imageSrc !== undefined) {
    if (typeof value.imageSrc !== "string" || !isHttpsUrl(value.imageSrc))
      return null;
  }
  // Rebuilt through the same constructor the writer used, so every cap and
  // every character rule applies again on the way out.
  return createFinding(value as unknown as Finding);
}

function readPage(value: unknown): ReportPage | null {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, ["url", "status"], ["reason"])
  ) {
    return null;
  }
  if (!isWebUrl(value.url)) return null;
  if (value.status !== "checked" && value.status !== "skipped") return null;
  const page: ReportPage = { url: value.url, status: value.status };
  if (value.reason !== undefined) {
    const reason = readText(value.reason, MAX_REASON);
    if (reason === null) return null;
    page.reason = collapseWhitespace(reason);
  }
  return page;
}

/** A validated copy of a stored report, or null when anything is off. */
export function parseStoredReport(value: unknown): ToolReport | null {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, [
      "v",
      "tool",
      "url",
      "finalUrl",
      "scannedAt",
      "summary",
      "findings",
      "pages",
      "truncated",
    ])
  ) {
    return null;
  }
  if (value.v !== REPORT_VERSION) return null;
  if (typeof value.tool !== "string" || !TOOL_SLUG_PATTERN.test(value.tool))
    return null;
  if (!isWebUrl(value.url) || !isWebUrl(value.finalUrl)) return null;
  if (
    typeof value.scannedAt !== "string" ||
    Number.isNaN(Date.parse(value.scannedAt))
  ) {
    return null;
  }
  if (typeof value.truncated !== "boolean") return null;

  const summary = readSummary(value.summary);
  if (!summary) return null;

  if (!Array.isArray(value.findings) || value.findings.length > MAX_FINDINGS)
    return null;
  const findings = value.findings.map(readFinding);
  if (findings.some((finding) => finding === null)) return null;

  if (!Array.isArray(value.pages) || value.pages.length > MAX_REPORT_PAGES)
    return null;
  const pages = value.pages.map(readPage);
  if (pages.some((page) => page === null)) return null;

  return {
    v: REPORT_VERSION,
    tool: value.tool,
    url: value.url,
    finalUrl: value.finalUrl,
    scannedAt: value.scannedAt,
    summary,
    findings: findings as Finding[],
    pages: pages as ReportPage[],
    truncated: value.truncated,
  };
}

/** A page entry for the report: URL shortened for display, reason capped. */
export function reportPage(
  url: string,
  status: ReportPage["status"],
  reason?: string,
): ReportPage {
  const page: ReportPage = {
    url:
      url.length > MAX_REPORT_PAGE_URL_LENGTH ? new URL(url).origin + "/" : url,
    status,
  };
  if (reason) page.reason = clampText(collapseWhitespace(reason), MAX_REASON);
  return page;
}
