/**
 * The pages Google Analytics may run on (s107, ADR 063). The only list.
 *
 * Asked by the client component (`GoogleAnalytics`, whether to load anything)
 * and by the middleware (whether the page's CSP names Google's hosts), so the
 * two cannot disagree. Everything not listed is off: the app surface (the
 * dashboard renders text scraped off customers' pages; /login, /signup and
 * /edit take credentials — ADR 059), /settings, /auth/*, every API route, the
 * widget under /embed and the /try runtime, which run on third-party pages.
 *
 * Segment-exact, like `usesNoncePolicy`: `/blog` and `/blog/x`, never
 * `/blogs`. A new public page joins by being added here, on purpose.
 */

/** Whole pages, nothing below them. `/try` never includes `/try/rcf-try.js`. */
const EXACT_PATHS = new Set([
  "/",
  "/try",
  "/pricing",
  "/privacy",
  "/terms",
  "/demo",
]);

/** Sections: the index and everything below it (s96's /tools reports too). */
const SECTION_PREFIXES = ["/compare", "/tools", "/blog", "/docs"] as const;

export function isAnalyticsRoute(pathname: string | null | undefined): boolean {
  if (!pathname || !pathname.startsWith("/") || pathname.startsWith("//")) {
    return false;
  }
  // A dot segment or an encoded one is never a page this list means. Next
  // normalises real navigations before they get here; refusing is cheaper
  // than reasoning about what a crafted path resolves to.
  if (/(^|\/)\.\.?(\/|$)|%2e|%2f/i.test(pathname)) return false;

  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  if (EXACT_PATHS.has(path)) return true;
  return SECTION_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
