/**
 * A-1 — content discovery must store the customer's copy verbatim.
 *
 * The widget reports `element.textContent` — plain text, never markup
 * (public/embed/recopyfast.src.js:2363). POST /api/content/[siteId] pushes that
 * plain text through an *HTML* sanitizer and stores the HTML serialization into
 * `original_content`, `current_content` and `published_content`
 * (route.ts:188-200 -> site-auth.ts:195-197 -> content-sanitizer.ts:80-86).
 *
 * A sanitizer is the right tool for markup and the wrong tool for prose. Every
 * `<` a customer typed becomes `&lt;`, and anything that parses as a tag is
 * deleted along with the rest of the string:
 *
 *     "Setup in <2 minutes"                   -> "Setup in &lt;2 minutes"
 *     "Paste the <script> tag into your page" -> "Paste the "
 *
 * No edit, no login, no publish: the first visitor to load the page triggers
 * discovery, `ignoreDuplicates` makes the first write permanent, and
 * `hydrateStoredContent` then writes the mangled value back over the live page
 * with `target.textContent = content` (recopyfast.src.js:3239).
 *
 * WHY THIS SUITE DOES NOT REUSE THE EXISTING ROUTE TEST'S MOCKS.
 * `src/__tests__/api/content/[siteId]/route.test.ts:16` mocks
 * `sanitizeIncomingContent` as `jest.fn((value) => value)` — an identity
 * function. That mock asserts the defect away: it makes the route look
 * byte-faithful precisely because it replaces the component that is not. Here
 * only the three `authorize*` functions are stubbed; `sanitizeIncomingContent`
 * is `requireActual`, so the repo's own DOMPurify + BASIC_TEXT config runs.
 *
 * These are `test.failing`: they pass while the corruption exists and start
 * failing the moment discovery becomes lossless, which is the signal to delete
 * the marker.
 */

import { NextRequest } from "next/server";
import { POST } from "@/app/api/content/[siteId]/route";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  authorizeFirstPartySiteRequest,
  authorizeSiteRequest,
  authorizeSiteOrigin,
} from "@/lib/security/site-auth";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/site-auth", () => {
  const actual = jest.requireActual("@/lib/security/site-auth");
  return {
    __esModule: true,
    ...actual,
    // Authorization is not what this suite is about, and it needs a database.
    // `sanitizeIncomingContent` is deliberately NOT overridden.
    authorizeFirstPartySiteRequest: jest.fn(),
    authorizeSiteRequest: jest.fn(),
    authorizeSiteOrigin: jest.fn(),
  };
});

const SITE_ID = "site-123";

/** The route's own MAX_CONTENT_LENGTH (route.ts:11). */
const MAX_CONTENT_LENGTH = 2000;

interface StoredRow {
  site_id: string;
  element_id: string;
  selector: string;
  original_content: string;
  current_content: string;
  published_content: string;
  language: string;
  variant: string;
  metadata: { type: string };
}

let storedRows: StoredRow[] = [];

// Annotated explicitly: the chain methods return the object itself, which
// TypeScript cannot infer from a self-referential initializer (TS7022).
type MockServiceClient = {
  from: jest.Mock;
  select: jest.Mock;
  eq: jest.Mock;
  single: jest.Mock;
  upsert: jest.Mock;
};

const serviceClient: MockServiceClient = {
  from: jest.fn(() => serviceClient),
  select: jest.fn(() => serviceClient),
  eq: jest.fn(() => serviceClient),
  single: jest.fn(() =>
    Promise.resolve({ data: { id: SITE_ID }, error: null }),
  ),
  upsert: jest.fn((rows: StoredRow[]) => {
    storedRows = rows;
    return Promise.resolve({ error: null });
  }),
};

/**
 * POST a content map exactly as the widget builds it (selector, content, type)
 * and hand back the rows the route tried to persist.
 */
async function postContentMap(
  contentMap: Record<
    string,
    { selector: string; content: string; type: string }
  >,
): Promise<StoredRow[]> {
  storedRows = [];

  const request = new NextRequest(
    `https://recopyfast.com/api/content/${SITE_ID}`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer site-token",
        Origin: "https://example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(contentMap),
    },
  );

  const response = await POST(request, {
    params: Promise.resolve({ siteId: SITE_ID }),
  });

  // The route answers 200 while writing the wrong thing, which is exactly why
  // every assertion below is on the stored row and none is on the status.
  expect(response.status).toBe(200);

  return storedRows;
}

function storedFor(rows: StoredRow[], elementId: string): StoredRow {
  const row = rows.find((candidate) => candidate.element_id === elementId);
  if (!row) {
    throw new Error(`no row was persisted for element ${elementId}`);
  }
  return row;
}

describe("POST /api/content/[siteId] discovery fidelity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});

    (
      createServiceRoleClient as jest.MockedFunction<
        typeof createServiceRoleClient
      >
    ).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    (
      authorizeFirstPartySiteRequest as jest.MockedFunction<
        typeof authorizeFirstPartySiteRequest
      >
    ).mockResolvedValue(null);
    (
      authorizeSiteRequest as jest.MockedFunction<typeof authorizeSiteRequest>
    ).mockResolvedValue({
      site: { id: SITE_ID, domain: "example.com", api_key: "api-key" },
      allowedOrigin: "https://example.com",
    });
    (
      authorizeSiteOrigin as jest.MockedFunction<typeof authorizeSiteOrigin>
    ).mockResolvedValue({
      site: { id: SITE_ID, domain: "example.com" },
      allowedOrigin: "https://example.com",
    } as unknown as Awaited<ReturnType<typeof authorizeSiteOrigin>>);

    serviceClient.from.mockReturnValue(serviceClient);
    serviceClient.select.mockReturnValue(serviceClient);
    serviceClient.eq.mockReturnValue(serviceClient);
    serviceClient.single.mockResolvedValue({
      data: { id: SITE_ID },
      error: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Sanity: this suite is only meaningful if the real sanitizer is in play.
  // If someone re-introduces an identity mock, this fails first and says why.
  it("runs the repository's real sanitizer, not an identity stub", async () => {
    const rows = await postContentMap({
      "rcf-probe": { selector: "p", content: "a < b", type: "text" },
    });

    expect(storedFor(rows, "rcf-probe").original_content).not.toBe("a < b");
  });

  describe("plain text containing an angle bracket", () => {
    // Every one of these is ordinary marketing copy. None is markup.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["rcf-setup", "Setup in <2 minutes"],
      ["rcf-discount", "Save <50% today"],
      ["rcf-inequality", "Latency < 100ms and uptime > 99.9%"],
    ];

    // GUARD for each case below. `test.failing` passes on ANY throw, including
    // a broken import, a typo in the fixture or a mock that stopped matching
    // the route — so each marked test needs an unmarked sibling that drives the
    // identical input through the identical path and asserts something that is
    // true whether or not the defect exists. If a guard fails, the marked test
    // beside it proves nothing.
    it.each(cases)(
      "persists a row for %s at all",
      async (elementId, content) => {
        const rows = await postContentMap({
          [elementId]: { selector: "p", content, type: "text" },
        });
        const row = storedFor(rows, elementId);

        expect(row.site_id).toBe(SITE_ID);
        expect(row.element_id).toBe(elementId);
        expect(typeof row.original_content).toBe("string");
      },
    );

    test.failing.each(cases)(
      "stores %s verbatim",
      async (elementId, content) => {
        const rows = await postContentMap({
          [elementId]: { selector: "p", content, type: "text" },
        });

        expect(storedFor(rows, elementId).original_content).toBe(content);
      },
    );
  });

  describe("plain text a parser mistakes for a tag", () => {
    // These do not merely get escaped — the "tag" and everything after the
    // opening bracket is deleted, so the customer loses the sentence.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["rcf-install", "Paste the <script> tag into your page"],
      ["rcf-markup", "Use <div> tags to group content"],
      ["rcf-pricing", "Plans & <pricing>"],
    ];

    // GUARD for each case below.
    it.each(cases)(
      "persists a row for %s at all",
      async (elementId, content) => {
        const rows = await postContentMap({
          [elementId]: { selector: "p", content, type: "text" },
        });
        const row = storedFor(rows, elementId);

        expect(row.site_id).toBe(SITE_ID);
        expect(row.element_id).toBe(elementId);
        expect(typeof row.original_content).toBe("string");
      },
    );

    test.failing.each(cases)(
      "does not truncate %s at the bracket",
      async (elementId, content) => {
        const rows = await postContentMap({
          [elementId]: { selector: "p", content, type: "text" },
        });

        expect(storedFor(rows, elementId).original_content).toBe(content);
      },
    );
  });

  // GUARD for the three-column test below.
  it("writes all three content columns on the same row", async () => {
    const rows = await postContentMap({
      "rcf-headline": {
        selector: "h1",
        content: "Setup in <2 minutes",
        type: "text",
      },
    });
    const row = storedFor(rows, "rcf-headline");

    // Trivially true either way: the route populates all three, and they agree
    // with each other. Whether the value is the customer's is the marked test.
    expect(row.original_content).toBe(row.current_content);
    expect(row.current_content).toBe(row.published_content);
  });

  test.failing(
    "writes the same verbatim value to all three content columns",
    async () => {
      // original_content is the restore target. Poisoning it means version
      // history cannot recover the customer's real copy either — the damage
      // survives a rollback.
      const content = "Setup in <2 minutes";

      const rows = await postContentMap({
        "rcf-headline": { selector: "h1", content, type: "text" },
      });
      const row = storedFor(rows, "rcf-headline");

      expect(row.original_content).toBe(content);
      expect(row.current_content).toBe(content);
      expect(row.published_content).toBe(content);
    },
  );

  // GUARD for the length-cap test below.
  it("persists a row for an over-length paragraph", async () => {
    const rows = await postContentMap({
      "rcf-longform": {
        selector: "p",
        content: "A".repeat(2500),
        type: "text",
      },
    });
    const row = storedFor(rows, "rcf-longform");

    // The write happens either way — the question the marked test asks is how
    // much of the paragraph survived it.
    expect(row.element_id).toBe("rcf-longform");
    expect(row.original_content.length).toBeGreaterThan(0);
  });

  test.failing("keeps a paragraph longer than the length cap", async () => {
    // 2500 characters of plain prose. The route truncates to 2000 before
    // sanitizing (route.ts:187-191), silently discarding a fifth of the
    // customer's paragraph with no error and no flag on the row.
    const content = "A".repeat(2500);
    expect(content.length).toBeGreaterThan(MAX_CONTENT_LENGTH);

    const rows = await postContentMap({
      "rcf-longform": { selector: "p", content, type: "text" },
    });

    expect(storedFor(rows, "rcf-longform").original_content).toBe(content);
  });

  // GUARD for the mid-entity test below.
  it("persists a row for a string that straddles the cap", async () => {
    const content = `${"A".repeat(MAX_CONTENT_LENGTH - 1)}<b>bold</b> tail`;
    const rows = await postContentMap({
      "rcf-mid-entity": { selector: "p", content, type: "text" },
    });

    expect(storedFor(rows, "rcf-mid-entity").element_id).toBe("rcf-mid-entity");
  });

  test.failing(
    "does not cut mid-entity when truncation and escaping combine",
    async () => {
      // Truncation runs BEFORE sanitizing, so the cut can land inside what the
      // sanitizer is about to expand. Here the 2000-character prefix ends on a
      // bare `<`, which then becomes `&lt;` — a row that is both shorter than
      // the customer wrote and longer than the cap they were truncated to.
      const content = `${"A".repeat(MAX_CONTENT_LENGTH - 1)}<b>bold</b> tail`;

      const rows = await postContentMap({
        "rcf-mid-entity": { selector: "p", content, type: "text" },
      });
      const stored = storedFor(rows, "rcf-mid-entity").original_content;

      expect(stored).toBe(content);
    },
  );

  // Not a defect — the counterexample. Copy with no angle bracket survives, so
  // the failures above are attributable to the sanitizer and to nothing else in
  // the request path.
  it("stores ordinary copy unchanged", async () => {
    const content = "Ship content edits without a deploy.";

    const rows = await postContentMap({
      "rcf-plain": { selector: "p", content, type: "text" },
    });

    expect(storedFor(rows, "rcf-plain").original_content).toBe(content);
  });
});
