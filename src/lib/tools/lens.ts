/**
 * The lens contract (s96, plan decision 6).
 *
 * A lens turns extracted pages into a summary and generic findings. Every tool
 * — Typo Finder now, CSP, outdated content, AI phrasing and alt text next —
 * produces the SAME `Finding` shape, so the report page renders all of them
 * with no per-tool renderer:
 *
 * - `before` + `match` + `after` is the sentence, `match` in a `<mark>`;
 * - `code` renders in `CodeBlock` (s97's directive lines);
 * - `imageSrc` renders as a "View image" LINK, never an `<img>`: a hotlinked
 *   image would hand every report viewer's IP address to the scanned site.
 *
 * Every field is capped here, at creation, and re-validated when a stored
 * report is read back (`report/report-schema.ts`). Page text is attacker-
 * chosen; these caps are the caps on what a stranger's page can put in front
 * of a reader.
 */

import type { ExtractedPage } from "@/lib/tools/extract/extract-page";
import {
  clampText,
  clampTextStart,
  collapseWhitespace,
  stripInvisibleCharacters,
} from "@/lib/tools/text";

export type Verdict = "pass" | "warn" | "fail" | "info" | "skipped";

export interface SummaryFact {
  label: string;
  value: string;
}

export interface LensSummary {
  headline: string;
  verdict: Verdict;
  /** At most 8. */
  facts: SummaryFact[];
  score?: number;
}

export interface Finding {
  page: string;
  kind: string;
  match: string;
  before: string;
  after: string;
  note?: string;
  suggestion?: string;
  code?: string;
  imageSrc?: string;
}

/** A page the lens read but chose not to check, with the reason shown. */
export interface SkippedPage {
  url: string;
  reason: string;
}

export interface LensResult {
  summary: LensSummary;
  findings: Finding[];
  skippedPages?: SkippedPage[];
  /**
   * True when `boundFindings` dropped findings past `MAX_FINDINGS`: the
   * summary counts them, the list does not, and the report must say so
   * (Devin review of 0c5c5e4).
   */
  findingsTruncated?: boolean;
}

export interface LensContext {
  now: Date;
  finalUrl: string;
  hostname: string;
}

export interface Lens {
  id: string;
  /** The catalogue slug this lens serves. */
  tool: string;
  pages: { max: number; sample: "none" | "sitemap" };
  analyze(pages: readonly ExtractedPage[], context: LensContext): LensResult;
}

export const MAX_FINDINGS = 40;
export const MAX_FACTS = 8;

export const FINDING_LIMITS = {
  match: 80,
  context: 120,
  note: 300,
  suggestion: 80,
  code: 1_000,
  imageSrc: 2_048,
} as const;

function cleanLine(text: string): string {
  return stripInvisibleCharacters(text).replace(
    /[\u0000-\u001f\u007f-\u009f]/g,
    " ",
  );
}

export interface FindingInput {
  page: string;
  kind: string;
  match: string;
  before: string;
  after: string;
  note?: string;
  suggestion?: string;
  code?: string;
  imageSrc?: string;
}

/**
 * A finding with every field cleaned and capped. `before` keeps its END and
 * `after` its START — the words beside the match are the ones that matter.
 */
export function createFinding(input: FindingInput): Finding {
  const finding: Finding = {
    page: input.page,
    kind: clampText(cleanLine(input.kind), 40),
    match: clampText(
      collapseWhitespace(cleanLine(input.match)),
      FINDING_LIMITS.match,
    ),
    before: clampTextStart(cleanLine(input.before), FINDING_LIMITS.context),
    after: clampText(cleanLine(input.after), FINDING_LIMITS.context),
  };
  if (input.note) {
    finding.note = clampText(
      collapseWhitespace(cleanLine(input.note)),
      FINDING_LIMITS.note,
    );
  }
  if (input.suggestion) {
    finding.suggestion = clampText(
      collapseWhitespace(cleanLine(input.suggestion)),
      FINDING_LIMITS.suggestion,
    );
  }
  if (input.code) {
    // Code keeps its line breaks; only the invisible characters go.
    finding.code = clampText(
      stripInvisibleCharacters(input.code),
      FINDING_LIMITS.code,
    );
  }
  if (input.imageSrc && isHttpsUrl(input.imageSrc)) {
    finding.imageSrc = input.imageSrc;
  }
  return finding;
}

export function isHttpsUrl(value: string): boolean {
  if (value.length > FINDING_LIMITS.imageSrc) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function pluralPages(count: number): string {
  return `Also on ${count} other page${count === 1 ? "" : "s"}.`;
}

/**
 * At most `MAX_FINDINGS`, with a finding repeated across pages (a footer's
 * typo, a logo's alt) collapsed into its first occurrence and a note saying on
 * how many other pages it also appears.
 */
export function boundFindings(
  findings: readonly Finding[],
  { dedupeKey }: { dedupeKey: (finding: Finding) => string },
): Finding[] {
  const order: string[] = [];
  const firstByKey = new Map<string, Finding>();
  const otherPages = new Map<string, Set<string>>();

  for (const finding of findings) {
    const key = dedupeKey(finding);
    const first = firstByKey.get(key);
    if (!first) {
      firstByKey.set(key, finding);
      otherPages.set(key, new Set());
      order.push(key);
      continue;
    }
    if (finding.page !== first.page) otherPages.get(key)?.add(finding.page);
  }

  return order.slice(0, MAX_FINDINGS).map((key) => {
    const first = firstByKey.get(key) as Finding;
    const others = otherPages.get(key)?.size ?? 0;
    if (others === 0) return first;
    const note = first.note
      ? `${first.note} ${pluralPages(others)}`
      : pluralPages(others);
    return { ...first, note: clampText(note, FINDING_LIMITS.note) };
  });
}
