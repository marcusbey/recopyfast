/**
 * @jest-environment node
 */

/**
 * s96, architect decision 3 (2026-10-11): a site owner opts out of the free
 * tools the standard way — robots.txt (RFC 9309), for `RecopyFastToolsBot` or
 * for `*`. The env denylist stays as the operator's override.
 */

import { SCANNER_PRODUCT_TOKEN } from "@/lib/tools/fetch/safe-fetch";
import type { SafeFetchResult } from "@/lib/tools/fetch/safe-fetch";
import type { NormalizedScanUrl } from "../normalize-url";
import {
  createRobotsAuthorizer,
  isAllowedByRobots,
  parseRobots,
} from "../robots";

function allowed(robots: string, path: string): boolean {
  return isAllowedByRobots(parseRobots(robots, SCANNER_PRODUCT_TOKEN), path);
}

describe("parseRobots + isAllowedByRobots (RFC 9309)", () => {
  it("allows everything when robots.txt names no rule for us", () => {
    expect(allowed("", "/a")).toBe(true);
    expect(allowed("User-agent: Googlebot\nDisallow: /", "/a")).toBe(true);
  });

  it("obeys `*` when no group names our product token", () => {
    expect(allowed("User-agent: *\nDisallow: /", "/")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /private", "/private/x")).toBe(
      false,
    );
    expect(allowed("User-agent: *\nDisallow: /private", "/public")).toBe(true);
  });

  it("a group naming RecopyFastToolsBot replaces `*`, case-insensitively, version ignored", () => {
    const robots = [
      "User-agent: *",
      "Disallow: /",
      "",
      "user-agent: recopyfasttoolsbot/1.0",
      "Allow: /",
    ].join("\n");

    expect(allowed(robots, "/anything")).toBe(true);
    expect(
      allowed(
        "User-agent: *\nAllow: /\n\nUser-Agent: RecopyFastToolsBot\nDisallow: /",
        "/x",
      ),
    ).toBe(false);
  });

  it("merges every group that names us, and lets one group name several agents", () => {
    const robots = [
      "User-agent: OtherBot",
      "User-agent: RecopyFastToolsBot",
      "Disallow: /a",
      "",
      "User-agent: RecopyFastToolsBot",
      "Disallow: /b",
    ].join("\n");

    expect(allowed(robots, "/a/1")).toBe(false);
    expect(allowed(robots, "/b/1")).toBe(false);
    expect(allowed(robots, "/c")).toBe(true);
  });

  it("the longest matching rule wins, and allow wins a tie", () => {
    const robots =
      "User-agent: *\nDisallow: /shop\nAllow: /shop/public\nDisallow: /x\nAllow: /x";

    expect(allowed(robots, "/shop/cart")).toBe(false);
    expect(allowed(robots, "/shop/public/item")).toBe(true);
    expect(allowed(robots, "/x/y")).toBe(true);
  });

  it("supports `*` and the `$` end anchor", () => {
    const robots = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /*/draft/";

    expect(allowed(robots, "/files/a.pdf")).toBe(false);
    expect(allowed(robots, "/files/a.pdf.html")).toBe(true);
    expect(allowed(robots, "/blog/draft/post")).toBe(false);
    expect(allowed(robots, "/draft/post")).toBe(true);
  });

  it("an empty Disallow allows everything", () => {
    expect(allowed("User-agent: *\nDisallow:", "/")).toBe(true);
  });

  it("ignores comments, CRLF, unknown lines and rules before any user-agent", () => {
    const robots = [
      "Disallow: /orphan",
      "# a comment",
      "Sitemap: https://example.com/sitemap.xml",
      "User-agent: * # everyone",
      "Crawl-delay: 10",
      "Disallow: /tmp # temporary",
    ].join("\r\n");

    expect(allowed(robots, "/orphan")).toBe(true);
    expect(allowed(robots, "/tmp/file")).toBe(false);
  });

  it("never refuses /robots.txt itself", () => {
    expect(allowed("User-agent: *\nDisallow: /", "/robots.txt")).toBe(true);
  });

  it("matches non-ASCII rules against the percent-encoded path", () => {
    expect(allowed("User-agent: *\nDisallow: /café", "/caf%C3%A9/menu")).toBe(
      false,
    );
  });

  it("stays fast on pathological wildcard rules", () => {
    const robots = `User-agent: *\n${"Disallow: /*a*a*a*a*a*a*a*a*b$\n".repeat(2_000)}`;
    const parsed = parseRobots(robots, SCANNER_PRODUCT_TOKEN);
    const started = performance.now();

    expect(isAllowedByRobots(parsed, `/${"a".repeat(2_000)}`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("createRobotsAuthorizer", () => {
  const url = (href: string): NormalizedScanUrl => {
    const parsed = new URL(href);
    return { href, hostname: parsed.hostname, origin: parsed.origin };
  };

  function document(body: string, contentType = "text/plain"): SafeFetchResult {
    return {
      ok: true,
      value: { url: "", status: 200, contentType, body, headers: {} },
    };
  }

  it("refuses a disallowed path with `robots_disallowed`, reading each origin once", async () => {
    const fetched: string[] = [];
    const authorize = createRobotsAuthorizer(async (robotsUrl) => {
      fetched.push(robotsUrl);
      return document("User-agent: RecopyFastToolsBot\nDisallow: /private");
    });

    expect(await authorize(url("https://example.com/"))).toBeNull();
    expect(await authorize(url("https://example.com/private/a"))).toBe(
      "robots_disallowed",
    );
    expect(await authorize(url("https://www.example.com/private/a"))).toBe(
      "robots_disallowed",
    );
    expect(fetched).toEqual([
      "https://example.com/robots.txt",
      "https://www.example.com/robots.txt",
    ]);
  });

  it("a missing robots.txt (4xx) allows the scan", async () => {
    const authorize = createRobotsAuthorizer(async () => ({
      ok: false,
      reason: "http_status",
      bytesRead: 0,
      status: 404,
    }));

    expect(await authorize(url("https://example.com/"))).toBeNull();
  });

  it("a robots.txt served as HTML (a single-page app's fallback) is no robots.txt", async () => {
    const authorize = createRobotsAuthorizer(async () => ({
      ok: false,
      reason: "not_html",
      bytesRead: 0,
    }));

    expect(await authorize(url("https://example.com/"))).toBeNull();
  });

  it.each([
    [{ reason: "http_status", status: 503 }, "http_status"],
    [{ reason: "timeout" }, "timeout"],
    [{ reason: "too_large" }, "too_large"],
    [{ reason: "blocked_address" }, "blocked_address"],
  ] as const)(
    "an unreachable robots.txt (%p) refuses the scan, as RFC 9309 §2.3.1.4 asks",
    async (failure, reason) => {
      const authorize = createRobotsAuthorizer(async () => ({
        ok: false,
        bytesRead: 0,
        ...failure,
      }));

      expect(await authorize(url("https://example.com/"))).toBe(reason);
    },
  );

  it("never asks robots.txt about robots.txt", async () => {
    const authorize = createRobotsAuthorizer(async () => {
      throw new Error("must not fetch");
    });

    expect(await authorize(url("https://example.com/robots.txt"))).toBeNull();
  });
});
