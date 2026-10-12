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

/** Sections: the index and everything below it, but see `FREE_TOOL_REPORT`. */
const SECTION_PREFIXES = ["/compare", "/tools", "/blog", "/docs"] as const;

/**
 * s96's free-tool reports, `/tools/<slug>/r/<id>`, and anything below a
 * tool's `r` segment: never measured (architect decision on the s96 merge,
 * 2026-10-12, ADR 063). A report renders text scraped off a stranger's site,
 * its URL is a capability — anyone holding it reads the report — and it runs
 * under the nonce policy (s96's ADR 062), which names no Google host. The
 * scan is measured where it starts, on the tool page (`ToolScanForm`).
 */
const FREE_TOOL_REPORT = /^\/tools\/[^/]+\/r(\/|$)/;

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
  if (FREE_TOOL_REPORT.test(path)) return false;
  return SECTION_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * May Google Analytics run here: the page the visitor is on (`pathname`) AND
 * the page the document was loaded as (`getDocumentPathname()`, null on the
 * server) both on the list (independent review F1).
 *
 * The CSP is the document's: the middleware picks it from the path the
 * browser requested, and a client navigation (`<Link>`, back/forward) changes
 * the URL but keeps the document and its policy. `/login` → "Terms" is still
 * the `/login` document under the nonce policy, whose `'strict-dynamic'`
 * would admit a script-inserted gtag.js whatever its host list says; a
 * `/settings` → `/` crossing keeps a static policy that names no Google host.
 * Neither may load anything.
 */
export function isAnalyticsPage(
  pathname: string | null | undefined,
  documentPathname: string | null | undefined,
): boolean {
  return isAnalyticsRoute(pathname) && isAnalyticsRoute(documentPathname);
}
