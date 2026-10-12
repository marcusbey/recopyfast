/**
 * robots.txt, honoured for the scanner's own product token (s96, architect
 * decision 3, 2026-10-11).
 *
 * The opt-out a site owner already knows. A group naming `RecopyFastToolsBot`
 * applies; otherwise the `*` group; otherwise nothing is disallowed. Matching
 * follows RFC 9309: groups naming us are merged, the longest matching rule
 * wins, `allow` wins a tie, `*` matches any run and a trailing `$` anchors,
 * and `/robots.txt` itself is always allowed.
 *
 * Fetch outcomes, per RFC 9309 §2.3.1:
 * - 2xx text → parsed;
 * - 4xx ("unavailable") → no rules, the scan proceeds;
 * - a non-text answer (a single-page app serving its HTML shell for every
 *   path) → treated as no robots.txt;
 * - a redirect to a domain whose per-target cap is spent (`target_limited`)
 *   → treated as no robots.txt, as RFC 9309 allows when redirects cannot be
 *   followed; the other domain receives nothing (s96 review round 2, minor 3);
 * - anything else — 5xx, timeout, refused address, too large ("unreachable")
 *   → the scan is REFUSED with that same reason. RFC 9309 says to assume
 *   complete disallow; reporting the real reason (not "robots.txt says no")
 *   keeps the message true.
 *
 * Each origin's robots.txt is read once per scan, through the same guarded
 * fetcher and request budget as the pages.
 *
 * Wildcard rules are matched segment by segment with `indexOf` — greedy
 * leftmost matching is exact for `*`-only patterns — never with a regular
 * expression built from the file, which a hostile robots.txt could make
 * backtrack.
 */

import type {
  FetchFailureReason,
  SafeFetchResult,
} from "@/lib/tools/fetch/safe-fetch";
import { SCANNER_PRODUCT_TOKEN } from "@/lib/tools/fetch/safe-fetch";
import type { NormalizedScanUrl } from "./normalize-url";

export const MAX_ROBOTS_BYTES = 512 * 1024;
const MAX_RULES = 1_000;
const MAX_PATTERN_LENGTH = 512;

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: RobotsRule[];
}

/** Percent-encodes what a URL path would carry encoded (RFC 9309 §2.2.2). */
function encodePattern(pattern: string): string {
  return pattern.replace(/[^\x21-\x7e]/gu, (character) =>
    encodeURIComponent(character),
  );
}

/** The rules that apply to `productToken`, from a robots.txt body. */
export function parseRobots(body: string, productToken: string): RobotsRule[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let isCollectingAgents = false;

  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!isCollectingAgents || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      isCollectingAgents = true;
      const agent = value.split(/[\s/]/)[0].toLowerCase();
      if (agent) current.agents.push(agent);
      continue;
    }

    if (key === "allow" || key === "disallow") {
      isCollectingAgents = false;
      if (!current || !value || current.rules.length >= MAX_RULES) continue;
      current.rules.push({
        allow: key === "allow",
        pattern: encodePattern(value.slice(0, MAX_PATTERN_LENGTH)),
      });
      continue;
    }
    // Sitemap, Crawl-delay and the rest neither add rules nor end a group.
  }

  const token = productToken.toLowerCase();
  const ours = groups.filter((group) => group.agents.includes(token));
  const chosen =
    ours.length > 0
      ? ours
      : groups.filter((group) => group.agents.includes("*"));
  return chosen.flatMap((group) => group.rules).slice(0, MAX_RULES);
}

/** Does `pattern` (with `*` and a trailing `$`) match the start of `path`? */
function patternMatches(pattern: string, path: string): boolean {
  const isAnchored = pattern.endsWith("$");
  const body = isAnchored ? pattern.slice(0, -1) : pattern;
  const segments = body.split("*");

  const first = segments[0];
  if (!path.startsWith(first)) return false;
  if (segments.length === 1) {
    return isAnchored ? path.length === first.length : true;
  }

  let position = first.length;
  const last = segments[segments.length - 1];
  for (let index = 1; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!segment) continue;
    const found = path.indexOf(segment, position);
    if (found === -1) return false;
    position = found + segment.length;
  }

  if (isAnchored) {
    return path.length - last.length >= position && path.endsWith(last);
  }
  return last === "" || path.indexOf(last, position) !== -1;
}

export function isAllowedByRobots(
  rules: readonly RobotsRule[],
  path: string,
): boolean {
  if (path === "/robots.txt") return true;

  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!patternMatches(rule.pattern, path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

/** Fetches `<origin>/robots.txt` through the guarded fetcher. */
export type RobotsFetcher = (robotsUrl: string) => Promise<SafeFetchResult>;

type RobotsVerdict =
  | { kind: "rules"; rules: RobotsRule[] }
  | { kind: "refused"; reason: FetchFailureReason };

/**
 * The fetcher's `authorizeUrl` for one scan: answers null (go ahead) or the
 * reason to refuse, reading each origin's robots.txt at most once.
 */
export function createRobotsAuthorizer(
  fetchRobots: RobotsFetcher,
  productToken: string = SCANNER_PRODUCT_TOKEN,
): (url: NormalizedScanUrl) => Promise<FetchFailureReason | null> {
  const verdicts = new Map<string, Promise<RobotsVerdict>>();

  const verdictFor = (origin: string): Promise<RobotsVerdict> => {
    let verdict = verdicts.get(origin);
    if (!verdict) {
      verdict = fetchRobots(`${origin}/robots.txt`).then(
        (result): RobotsVerdict => {
          if (result.ok) {
            return {
              kind: "rules",
              rules: parseRobots(result.value.body, productToken),
            };
          }
          const isUnavailable =
            (result.reason === "http_status" &&
              result.status !== undefined &&
              result.status >= 400 &&
              result.status < 500) ||
            result.reason === "not_html" ||
            result.reason === "target_limited";
          return isUnavailable
            ? { kind: "rules", rules: [] }
            : { kind: "refused", reason: result.reason };
        },
      );
      verdicts.set(origin, verdict);
    }
    return verdict;
  };

  return async (url) => {
    const { pathname } = new URL(url.href);
    if (pathname === "/robots.txt") return null;
    const verdict = await verdictFor(url.origin);
    if (verdict.kind === "refused") return verdict.reason;
    return isAllowedByRobots(verdict.rules, pathname)
      ? null
      : "robots_disallowed";
  };
}
