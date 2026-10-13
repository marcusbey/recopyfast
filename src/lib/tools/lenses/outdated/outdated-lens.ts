/**
 * The Outdated Website Checker's deterministic lens (s99).
 *
 * Findings retain the generic s96 shape. Severity exists only while the lens
 * builds its summary: the report renderer needs no new schema or tool-specific
 * branch. Counts are taken from distinct keys before the forty-finding display
 * cap, so a repeated footer counts once and a truncated report stays honest.
 */

import type { ExtractedPage } from "@/lib/tools/extract/extract-page";
import {
  boundFindings,
  type Finding,
  type Lens,
  type LensContext,
  type LensResult,
  type SkippedPage,
  type SummaryFact,
} from "@/lib/tools/lens";
import { getDictionary, type Dictionary } from "../typos/dictionary";
import { isOutdatedLensEnglishPage } from "./language-evidence";
import {
  analyzeOutdatedBlock,
  type RuleFinding,
  type RuleLevel,
} from "./rules";

export const OUTDATED_TOOL_SLUG = "outdated-website-checker";
export const NOT_ENGLISH_MESSAGE =
  "This page doesn't look like it's written in English, so it wasn't checked.";

interface OrderedFinding extends RuleFinding {
  order: readonly [page: number, block: number, character: number];
}

const KIND_LABELS = [
  ["past-date-upcoming", "Past dates still presented as upcoming"],
  ["dated-prices", "Dated prices, menus and schedules"],
  ["past-future-tense", "Past-year announcements"],
  ["seasonal-promo-past-year", "Past-year seasonal promotions"],
  ["seasonal-promo-out-of-season", "Out-of-season promotions"],
  ["stale-updated", "Old update labels"],
] as const;

function findingKey(finding: Finding): string {
  return [
    finding.kind,
    finding.match.toLowerCase(),
    finding.before,
    finding.after,
  ].join("|");
}

function pluralLines(count: number, verb: "look" | "may"): string {
  if (verb === "look") {
    return `${count} ${count === 1 ? "line looks" : "lines look"} out of date`;
  }
  return `${count} ${count === 1 ? "line may" : "lines may"} need review`;
}

function cleanHeadline(pagesChecked: number): string {
  return `No clearly out-of-date lines on the ${pagesChecked} ${
    pagesChecked === 1 ? "page" : "pages"
  } we checked`;
}

export function analyzeOutdated(
  pages: readonly ExtractedPage[],
  context: LensContext,
  dictionary: Dictionary = getDictionary(),
): LensResult {
  const checked: { page: ExtractedPage; pageIndex: number }[] = [];
  const skipped: SkippedPage[] = [];

  pages.forEach((page, pageIndex) => {
    if (!isOutdatedLensEnglishPage(page, dictionary)) {
      skipped.push({ url: page.url, reason: NOT_ENGLISH_MESSAGE });
      return;
    }
    checked.push({ page, pageIndex });
  });

  const ordered: OrderedFinding[] = [];
  for (const { page, pageIndex } of checked) {
    page.blocks.forEach((block, blockIndex) => {
      for (const result of analyzeOutdatedBlock(
        block.text,
        page.url,
        context.now,
      )) {
        ordered.push({
          ...result,
          order: [pageIndex, blockIndex, result.start],
        });
      }
    });
  }
  ordered.sort(
    (left, right) =>
      left.order[0] - right.order[0] ||
      left.order[1] - right.order[1] ||
      left.order[2] - right.order[2],
  );

  const distinctByKey = new Map<string, OrderedFinding>();
  for (const result of ordered) {
    const key = findingKey(result.finding);
    if (!distinctByKey.has(key)) distinctByKey.set(key, result);
  }
  const distinct = [...distinctByKey.values()];
  const findings = boundFindings(
    ordered.map((result) => result.finding),
    { dedupeKey: findingKey },
  );

  const countKind = (kind: string) =>
    distinct.filter((result) => result.finding.kind === kind).length;
  const countLevel = (level: RuleLevel) =>
    distinct.filter((result) => result.level === level).length;
  const staleCopyright = countKind("copyright-year");
  const graceCopyright = countKind("copyright-year-grace");
  const facts: SummaryFact[] = [
    { label: "Pages checked", value: String(checked.length) },
    {
      label: "Copyright years",
      value: `${staleCopyright} stale · ${graceCopyright} January grace`,
    },
    ...KIND_LABELS.map(([kind, label]) => ({
      label,
      value: String(countKind(kind)),
    })),
  ];

  const staleCount = countLevel("stale");
  const reviewCount = countLevel("warn") + countLevel("info");
  const summary =
    checked.length === 0
      ? {
          headline: "No English pages were checked",
          verdict: "skipped" as const,
          facts,
        }
      : staleCount > 0
        ? {
            headline: pluralLines(staleCount, "look"),
            verdict: "fail" as const,
            facts,
          }
        : reviewCount > 0
          ? {
              headline: pluralLines(reviewCount, "may"),
              verdict: "warn" as const,
              facts,
            }
          : {
              headline: cleanHeadline(checked.length),
              verdict: "pass" as const,
              facts,
            };

  return {
    summary,
    findings,
    findingsTruncated: distinct.length > findings.length,
    skippedPages: skipped,
  };
}

export const outdatedLens: Lens = {
  id: "outdated",
  tool: OUTDATED_TOOL_SLUG,
  pages: { sample: "sitemap", max: 10 },
  analyze: (pages, context) => analyzeOutdated(pages, context),
};
