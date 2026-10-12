/**
 * @jest-environment node
 */

/**
 * s107 — the one list of pages Google Analytics may run on.
 *
 * GA is a third-party script. The dashboard renders text scraped off
 * customers' pages and the auth pages take credentials (ADR 059), so the
 * question "may GA run here?" has exactly one answer, asked by the client
 * component AND by the middleware that writes the CSP. Anything not listed is
 * off — a new page has to be added on purpose.
 */

import { isAnalyticsRoute } from "@/lib/analytics/google-analytics/routes";
import { usesNoncePolicy } from "@/lib/security/content-security-policy";

describe("isAnalyticsRoute", () => {
  it.each([
    "/",
    "/try",
    "/pricing",
    "/privacy",
    "/terms",
    "/demo",
    "/compare",
    "/compare/webflow-editor",
    "/tools",
    "/tools/website-maintenance-cost",
    "/blog",
    "/blog/some-post",
    "/docs",
    "/docs/install",
  ])("is true for the public marketing page %s", (pathname) => {
    expect(isAnalyticsRoute(pathname)).toBe(true);
  });

  /**
   * s96's free-tool reports, `/tools/<slug>/r/<id>`: architect decision on
   * the s96 merge, 2026-10-12 (ADR 063 §Consequences). A report renders text
   * scraped off a stranger's site, its URL is a capability (anyone holding it
   * reads the report), and it runs under the nonce policy (s96's ADR 062),
   * whose CSP names no Google host. No analytics there, nor on anything below
   * a tool's `r` segment. The scan itself is measured on the tool page.
   */
  it.each([
    "/tools/website-spell-checker/r/6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c",
    "/tools/website-spell-checker/r/6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c/",
    "/tools/website-spell-checker/r",
    "/tools/website-spell-checker/r/",
    "/tools/website-spell-checker/r/not-a-uuid/deeper",
  ])("is false for the free-tool report path %s", (pathname) => {
    expect(isAnalyticsRoute(pathname)).toBe(false);
  });

  it.each([
    "/tools/website-spell-checker",
    "/tools/website-spell-checker/",
    "/tools/report",
    "/tools/r",
  ])("still covers the tool pages: %s", (pathname) => {
    expect(isAnalyticsRoute(pathname)).toBe(true);
  });

  it("never overlaps the nonce (app) policy", () => {
    const samples = [
      "/",
      "/dashboard",
      "/dashboard/sites",
      "/login",
      "/signup",
      "/edit",
      "/tools",
      "/tools/website-spell-checker",
      "/tools/website-spell-checker/r/6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c",
      "/tools/website-spell-checker/r/6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c/",
      "/compare/webflow-editor",
      "/blog/post",
      "/docs/install",
      "/try",
    ];
    for (const pathname of samples) {
      expect([
        pathname,
        isAnalyticsRoute(pathname) && usesNoncePolicy(pathname),
      ]).toEqual([pathname, false]);
    }
  });

  it.each(["/blog/", "/privacy/", "/compare/webflow-editor/"])(
    "tolerates a trailing slash: %s",
    (pathname) => {
      expect(isAnalyticsRoute(pathname)).toBe(true);
    },
  );

  it.each([
    // The app surface (nonce policy) and account pages.
    "/dashboard",
    "/dashboard/sites",
    "/dashboard/billing",
    "/settings",
    "/edit",
    "/edit/anything",
    "/login",
    "/signup",
    "/auth/callback",
    "/auth/confirm",
    "/auth/error",
    // Every API route, including the public ones.
    "/api/pricing",
    "/api/published/0b1f3c2e-1111-4111-8111-111111111111",
    // The widget and the /try runtime run on third-party pages.
    "/embed/recopyfast.js",
    "/try/rcf-try.js",
    "/try/anything-else",
    // The init script itself, and crawler files.
    "/analytics/gtag-init.js",
    "/robots.txt",
    "/sitemap.xml",
    "/llms.txt",
    "/monitoring",
  ])("is false for %s", (pathname) => {
    expect(isAnalyticsRoute(pathname)).toBe(false);
  });

  it.each([
    "/compareX",
    "/compare-tools",
    "/blogs",
    "/tools-and-more",
    "/docsx",
    "/trying",
    "/pricing/annual",
    "/privacy/extra",
    "/terms-of-use",
    "/demo/extra",
  ])("is segment-exact, so %s is false", (pathname) => {
    expect(isAnalyticsRoute(pathname)).toBe(false);
  });

  it.each(["", "blog", "//blog", "/blog/../dashboard", "/%2e%2e/dashboard"])(
    "refuses a malformed path: %j",
    (pathname) => {
      expect(isAnalyticsRoute(pathname)).toBe(false);
    },
  );

  it("refuses null and undefined (usePathname can be null)", () => {
    expect(isAnalyticsRoute(null)).toBe(false);
    expect(isAnalyticsRoute(undefined)).toBe(false);
  });
});
