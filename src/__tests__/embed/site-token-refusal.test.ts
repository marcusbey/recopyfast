/**
 * The public widget must leave the customer's authored copy untouched when a
 * site token is refused. The server response remains structured and readable,
 * but the widget cannot afford story-specific handling inside its byte budget.
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
    hydrateStoredContent: loadHydrateStoredContent(fetch, warn),
  };
}

describe("widget handling of a refused site token", () => {
  it("preserves authored copy without adding a token-specific warning", async () => {
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

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "ReCopyFast: could not load saved content (HTTP 401); showing the page as authored.",
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("regenerate your snippet in the dashboard"),
    );
    expect(widget.applyContentToElement).not.toHaveBeenCalled();
    expect(widget.elements.get("rcf-headline")?.element.textContent).toBe(
      "Authored headline",
    );
  });

  it("preserves authored copy for a missing installed token", async () => {
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
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("regenerate your snippet in the dashboard"),
    );
    expect(widget.applyContentToElement).not.toHaveBeenCalled();
    expect(widget.elements.get("rcf-headline")?.element.textContent).toBe(
      "Authored headline",
    );
  });
});
