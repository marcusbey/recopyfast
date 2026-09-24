/**
 * The public widget must turn a readable site-token refusal into one useful
 * warning while leaving the customer's authored copy untouched.
 *
 * The browser script is an IIFE, so this test slices hydrateStoredContent from
 * the source that is actually built and shipped. A transcription would let the
 * test stay green while the installed widget silently regressed.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = path.join(
  process.cwd(),
  "public",
  "embed",
  "recopyfast.src.js",
);

const METHOD_BEGIN = "    async hydrateStoredContent() {";
const NEXT_METHOD = "    setupMutationObserver() {";

interface FakeWidget {
  elements: Map<
    string,
    { element: { textContent: string }; originalContent: string }
  >;
  canReachStagingContent: () => boolean;
  editorTokenQuery: () => string;
  editorAuthHeaders: () => Record<string, string>;
  applyContentToElement: jest.Mock;
  hasWarnedSiteTokenRefusal: boolean;
  hydrateStoredContent: () => Promise<void>;
}

function loadHydrateStoredContent(
  fetch: jest.Mock,
  warn: jest.Mock,
): FakeWidget["hydrateStoredContent"] {
  const source = readFileSync(WIDGET_SOURCE, "utf8");
  const begin = source.indexOf(METHOD_BEGIN);
  const end = source.indexOf(NEXT_METHOD, begin);

  if (begin === -1 || end < begin) {
    throw new Error(
      "public/embed/recopyfast.src.js no longer exposes hydrateStoredContent " +
        "in the shape this loader slices. Update the loader instead of " +
        "transcribing the method.",
    );
  }

  const block = source.slice(begin, end);
  return new Function(
    "RECOPYFAST_API",
    "SITE_ID",
    "SITE_TOKEN",
    "fetch",
    "console",
    `return { ${block} }.hydrateStoredContent;`,
  )("https://recopyfast.test/api", "site-123", "revoked-token", fetch, {
    warn,
    log: jest.fn(),
  }) as FakeWidget["hydrateStoredContent"];
}

function makeWidget(fetch: jest.Mock, warn: jest.Mock): FakeWidget {
  return {
    elements: new Map([
      [
        "rcf-headline",
        {
          element: { textContent: "Authored headline" },
          originalContent: "Authored headline",
        },
      ],
    ]),
    canReachStagingContent: () => false,
    editorTokenQuery: () => "",
    editorAuthHeaders: () => ({}),
    applyContentToElement: jest.fn(),
    hasWarnedSiteTokenRefusal: false,
    hydrateStoredContent: loadHydrateStoredContent(fetch, warn),
  };
}

describe("widget handling of a refused site token", () => {
  it("warns once with the dashboard recovery action and preserves authored copy", async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: jest.fn().mockResolvedValue({
        error: "Invalid site token",
        code: "site_token_invalid",
      }),
    });
    const warn = jest.fn();
    const widget = makeWidget(fetch, warn);

    await widget.hydrateStoredContent();
    await widget.hydrateStoredContent();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("regenerate your snippet in the dashboard"),
    );
    expect(widget.applyContentToElement).not.toHaveBeenCalled();
    expect(widget.elements.get("rcf-headline")?.element.textContent).toBe(
      "Authored headline",
    );
  });

  it("uses the same recovery warning for a missing installed token", async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: jest.fn().mockResolvedValue({
        error: "Missing site token",
        code: "site_token_missing",
      }),
    });
    const warn = jest.fn();
    const widget = makeWidget(fetch, warn);

    await widget.hydrateStoredContent();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("regenerate your snippet in the dashboard"),
    );
  });
});
