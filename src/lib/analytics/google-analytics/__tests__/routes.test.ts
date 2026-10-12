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
    // s96's report pages, `/tools/<slug>/r/<id>`.
    "/tools/broken-links/r/0b1f3c2e-1111-4111-8111-111111111111",
    "/blog",
    "/blog/some-post",
    "/docs",
    "/docs/install",
  ])("is true for the public marketing page %s", (pathname) => {
    expect(isAnalyticsRoute(pathname)).toBe(true);
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
