/**
 * One scan, end to end (s96): robots.txt, the homepage, the sampled pages, the
 * lens, the report. Every request goes through `safeFetch` with ONE request
 * budget (24) and ONE deadline (20 s) for the whole scan, so no combination of
 * redirects, sitemaps and slow pages can exceed either.
 *
 * - robots.txt is read once per origin and obeyed for `RecopyFastToolsBot`
 *   (architect decision 3, `robots.ts`); it gates every hop, sitemap included.
 * - The homepage must succeed: its failure is the scan's failure, as a reason
 *   code the route turns into fixed copy.
 * - Sampled pages are fetched three at a time. A page that fails, is too large
 *   or is not reached before the deadline is listed as skipped with a reason,
 *   and the report says it is partial; it never fails the scan.
 * - The report's page list keeps the sampled order, so the same site reads the
 *   same way every time.
 */

import {
  extractPage,
  type ExtractedPage,
} from "@/lib/tools/extract/extract-page";
import {
  createRequestBudget,
  MAX_REQUESTS_PER_SCAN,
  safeFetch,
  type FetchFailureReason,
  type FetchPolicy,
  type SafeFetchOptions,
} from "@/lib/tools/fetch/safe-fetch";
import type { Resolver } from "@/lib/tools/fetch/validating-lookup";
import type { Lens } from "@/lib/tools/lens";
import {
  PAGE_SKIP_REASONS,
  reportPage,
  serializeReport,
  type ReportPage,
  type ToolReport,
} from "@/lib/tools/report/report-schema";
import { isDenylistedHost } from "./denylist";
import type { NormalizedScanUrl } from "./normalize-url";
import { createRobotsAuthorizer, MAX_ROBOTS_BYTES } from "./robots";
import { samplePages } from "./sample-pages";

export const SCAN_DEADLINE_MS = 20_000;
export const PAGE_CONCURRENCY = 3;
export { PAGE_SKIP_REASONS };

/** The reasons a scan as a whole can fail (the route's 422 `reason`). */
export type ScanFailureReason = Exclude<
  FetchFailureReason,
  "invalid_url" | "request_limit"
>;

export interface RunScanInput {
  tool: string;
  lens: Lens;
  url: NormalizedScanUrl;
  now: Date;
  denylist: readonly string[];
  /** Tests inject these; production passes nothing (strict defaults). */
  policy?: FetchPolicy;
  resolver?: Resolver;
  deadlineMs?: number;
}

export type RunScanResult =
  | { ok: true; report: ToolReport }
  | { ok: false; reason: ScanFailureReason };

function asScanFailure(reason: FetchFailureReason): ScanFailureReason {
  if (reason === "invalid_url") return "redirect_invalid";
  if (reason === "request_limit") return "timeout";
  return reason;
}

function skipReasonFor(reason: FetchFailureReason): string {
  if (reason === "timeout" || reason === "request_limit") {
    return PAGE_SKIP_REASONS.timeLimit;
  }
  if (reason === "too_large") return PAGE_SKIP_REASONS.tooLarge;
  if (reason === "robots_disallowed") return PAGE_SKIP_REASONS.robots;
  return PAGE_SKIP_REASONS.failed;
}

/** Runs `work` over `items` with at most `limit` in flight; results keep order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await work(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

type PageOutcome =
  | { status: "checked"; url: string; page: ExtractedPage }
  | { status: "skipped"; url: string; reason: string };

export async function runScan(input: RunScanInput): Promise<RunScanResult> {
  const deadline = input.now.getTime() + (input.deadlineMs ?? SCAN_DEADLINE_MS);
  const budget = createRequestBudget(MAX_REQUESTS_PER_SCAN);
  const isDenied = (hostname: string) =>
    isDenylistedHost(hostname, input.denylist);
  const base = {
    budget,
    policy: input.policy,
    resolver: input.resolver,
    isDenylistedHost: isDenied,
    deadline,
  };

  const authorizeUrl = createRobotsAuthorizer((robotsUrl) =>
    safeFetch(robotsUrl, {
      ...base,
      kind: "robots",
      maxBytes: MAX_ROBOTS_BYTES,
    }),
  );
  const fetchOptions = (kind: SafeFetchOptions["kind"]): SafeFetchOptions => ({
    ...base,
    kind,
    authorizeUrl,
  });

  const homepage = await safeFetch(input.url.href, fetchOptions("html"));
  if (!homepage.ok)
    return { ok: false, reason: asScanFailure(homepage.reason) };

  const extracted = extractPage(homepage.value.body, {
    url: homepage.value.url,
    headers: homepage.value.headers,
  });
  if (!extracted.ok) return { ok: false, reason: "too_large" };
  const home = extracted.page;

  let outcomes: PageOutcome[] = [];
  if (input.lens.pages.sample === "sitemap" && input.lens.pages.max > 1) {
    const sampled = await samplePages({
      finalUrl: home.url,
      fallbackLinks: home.sameHostLinks,
      max: input.lens.pages.max - 1,
      isAllowedPort: input.policy?.isAllowedPort,
      fetchSitemap: async (sitemapUrl) => {
        if (Date.now() >= deadline) return null;
        const result = await safeFetch(sitemapUrl, fetchOptions("sitemap"));
        return result.ok ? result.value.body : null;
      },
    });
    outcomes = await mapWithConcurrency(
      sampled.urls,
      PAGE_CONCURRENCY,
      async (url): Promise<PageOutcome> => {
        if (Date.now() >= deadline) {
          return {
            status: "skipped",
            url,
            reason: PAGE_SKIP_REASONS.timeLimit,
          };
        }
        const result = await safeFetch(url, fetchOptions("html"));
        if (!result.ok) {
          return {
            status: "skipped",
            url,
            reason: skipReasonFor(result.reason),
          };
        }
        const page = extractPage(result.value.body, {
          url: result.value.url,
          headers: result.value.headers,
        });
        return page.ok
          ? { status: "checked", url, page: page.page }
          : { status: "skipped", url, reason: PAGE_SKIP_REASONS.tooLarge };
      },
    );
  }

  const checkedPages = [
    home,
    ...outcomes.flatMap((outcome) =>
      outcome.status === "checked" ? [outcome.page] : [],
    ),
  ];
  const result = input.lens.analyze(checkedPages, {
    now: input.now,
    finalUrl: home.url,
    hostname: new URL(home.url).hostname,
  });

  const lensSkips = new Map(
    (result.skippedPages ?? []).map((skip) => [skip.url, skip.reason]),
  );
  const pages: ReportPage[] = [
    reportPage(
      home.url,
      lensSkips.has(home.url) ? "skipped" : "checked",
      lensSkips.get(home.url),
    ),
    ...outcomes.map((outcome) => {
      if (outcome.status === "skipped") {
        return reportPage(outcome.url, "skipped", outcome.reason);
      }
      const reason = lensSkips.get(outcome.page.url);
      return reportPage(
        outcome.page.url,
        reason ? "skipped" : "checked",
        reason,
      );
    }),
  ];

  return {
    ok: true,
    report: serializeReport({
      v: 1,
      tool: input.tool,
      url: input.url.href,
      finalUrl: home.url,
      scannedAt: input.now.toISOString(),
      summary: result.summary,
      findings: result.findings,
      pages,
      truncated: false,
    }),
  };
}
