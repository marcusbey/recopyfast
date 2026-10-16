/**
 * The path the current DOCUMENT was loaded on (s107, independent review F1,
 * ADR 063). Null on the server.
 *
 * The middleware chooses the Content-Security-Policy from the path the
 * browser requested, once per document. A client navigation changes
 * `location` and `usePathname()`, never the document, so neither says which
 * policy the page runs under. This does, read once when the module is first
 * evaluated — through the root layout, at hydration, before any client
 * navigation can happen:
 *
 * 1. the navigation entry's URL, which `history.pushState` never rewrites
 *    (checked in Chromium and WebKit);
 * 2. failing that (no entry, no API, a name that is not a URL),
 *    `location.pathname` at that same moment.
 */

function readDocumentPathname(): string {
  try {
    const [entry] = performance.getEntriesByType("navigation");
    if (entry && typeof entry.name === "string") {
      return new URL(entry.name).pathname;
    }
  } catch {
    // No Performance API, or an entry name that is not a URL: fall through.
  }
  return window.location.pathname;
}

const DOCUMENT_PATHNAME: string | null =
  typeof window === "undefined" ? null : readDocumentPathname();

export function getDocumentPathname(): string | null {
  return DOCUMENT_PATHNAME;
}
