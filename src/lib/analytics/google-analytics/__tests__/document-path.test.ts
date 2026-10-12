/**
 * s107, independent review F1 — the path the DOCUMENT was loaded on.
 *
 * The CSP is chosen by the middleware from the path the browser requested,
 * once per document. A client navigation changes `location` (and
 * `usePathname()`) but not the document, so neither of those can say which
 * policy the page runs under. Read once: the navigation entry, which
 * `history.pushState` never rewrites; failing that, `location.pathname` at
 * the moment this module first ran — at hydration, through the root layout,
 * before any client navigation could happen.
 */

type DocumentPath =
  typeof import("@/lib/analytics/google-analytics/document-path");

const realGetEntriesByType = performance.getEntriesByType;

function navigationEntries(entries: Array<{ name: unknown }> | Error): void {
  performance.getEntriesByType = jest.fn(() => {
    if (entries instanceof Error) throw entries;
    return entries as unknown as PerformanceEntryList;
  }) as typeof performance.getEntriesByType;
}

/** A fresh module, evaluated now, as the browser does at hydration. */
async function loadModule(): Promise<DocumentPath> {
  let loaded: DocumentPath | undefined;
  await jest.isolateModulesAsync(async () => {
    loaded = await import("@/lib/analytics/google-analytics/document-path");
  });
  if (!loaded) throw new Error("document-path did not load");
  return loaded;
}

afterEach(() => {
  performance.getEntriesByType = realGetEntriesByType;
  window.history.replaceState(null, "", "/");
});

describe("getDocumentPathname", () => {
  it("is the navigation entry's path, whatever client navigations did since", async () => {
    navigationEntries([{ name: "http://localhost/login?next=%2Fdashboard" }]);
    window.history.pushState(null, "", "/terms");

    const { getDocumentPathname } = await loadModule();

    expect(getDocumentPathname()).toBe("/login");
  });

  it("without a navigation entry, is the path when the module first ran — not the current one", async () => {
    navigationEntries([]);
    window.history.pushState(null, "", "/login");

    const { getDocumentPathname } = await loadModule();
    window.history.pushState(null, "", "/terms");

    expect(getDocumentPathname()).toBe("/login");
  });

  it.each([
    ["an entry whose name is not a URL", [{ name: "document" }]],
    ["an entry without a name", [{ name: undefined }]],
    ["an API that throws", new Error("not supported")],
  ])("falls back to the load-time path on %s", async (_case, entries) => {
    navigationEntries(entries as Array<{ name: unknown }> | Error);
    window.history.pushState(null, "", "/signup");

    const { getDocumentPathname } = await loadModule();
    window.history.pushState(null, "", "/privacy");

    expect(getDocumentPathname()).toBe("/signup");
  });
});
