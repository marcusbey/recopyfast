/**
 * A-1 — content discovery stores the customer's copy verbatim.
 *
 * The widget reports `element.textContent` — plain text, never markup
 * (public/embed/recopyfast.src.js:2363). POST /api/content/[siteId] used to push
 * that plain text through an *HTML* sanitizer and store the HTML serialization
 * into `original_content`, `current_content` and `published_content`
 * (route.ts:188-200 -> site-auth.ts:195-197 -> content-sanitizer.ts:80-86).
 *
 * A sanitizer is the right tool for markup and the wrong tool for prose. Every
 * `<` a customer typed became `&lt;`, and anything that parsed as a tag was
 * deleted along with the rest of the string:
 *
 *     "Setup in <2 minutes"                   -> "Setup in &lt;2 minutes"
 *     "Paste the <script> tag into your page" -> "Paste the "
 *
 * No edit, no login, no publish: the first visitor to load the page triggers
 * discovery, `ignoreDuplicates` makes the first write permanent, and
 * `hydrateStoredContent` then writes the mangled value back over the live page
 * with `target.textContent = content` (recopyfast.src.js:3246).
 *
 * The route now validates the text instead of rewriting it
 * (@/lib/security/discovered-text): a string that cannot be stored is refused
 * with a 400, and a string that can be is stored unchanged.
 *
 * WHY THIS SUITE DOES NOT REUSE THE EXISTING ROUTE TEST'S MOCKS.
 * `src/__tests__/api/content/[siteId]/route.test.ts` used to mock
 * `sanitizeIncomingContent` as `jest.fn((value) => value)` — an identity
 * function. That mock asserted the defect away: it made the route look
 * byte-faithful precisely because it replaced the component that was not. Here
 * only the three `authorize*` functions are stubbed; everything the route does
 * to the customer's text is the shipped implementation.
 */

import { NextRequest } from "next/server";
import { POST } from "@/app/api/content/[siteId]/route";
import { MAX_DISCOVERED_TEXT_LENGTH } from "@/lib/security/discovered-text";
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
    // Nothing on the content path is overridden.
    authorizeFirstPartySiteRequest: jest.fn(),
    authorizeSiteRequest: jest.fn(),
    authorizeSiteOrigin: jest.fn(),
  };
});

const SITE_ID = "site-123";

/**
 * The paragraph length the route used to truncate at, which is what made this a
 * data-loss defect rather than a formatting one. Kept as the fixture size for
 * the over-length cases below: ordinary prose at this length must survive whole.
 */
const FORMER_TRUNCATION_POINT = 2000;

interface StoredRow {
  site_id: string;
  element_id: string;
  selector: string;
  original_content: string;
  current_content: string;
  published_content: string;
  language: string;
  variant: string;
  metadata: { type?: string };
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

type ContentMap = Record<
  string,
  { selector: string; content: unknown; type?: string }
>;

/**
 * POST a body exactly as the widget builds it, and hand back the answer.
 *
 * Typed `unknown` rather than `ContentMap`: several cases below are about what the
 * route does with a body that is not a content map at all.
 */
async function post(contentMap: unknown) {
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

  return POST(request, { params: Promise.resolve({ siteId: SITE_ID }) });
}

/** POST a map the route must accept, and hand back the rows it persisted. */
async function postContentMap(contentMap: ContentMap): Promise<StoredRow[]> {
  const response = await post(contentMap);

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

  // Sanity: this suite is only meaningful if the shipped validator is in play.
  // Storing text verbatim is indistinguishable from doing nothing at all, so the
  // proof that the real content path runs is that it still refuses what it must.
  // If someone stubs it out, this fails first and says why.
  it("runs the repository's real validator, not an identity stub", async () => {
    const response = await post({
      "rcf-probe": { selector: "p", content: 42, type: "text" },
    });

    expect(response.status).toBe(400);
    expect(serviceClient.upsert).not.toHaveBeenCalled();
  });

  describe("plain text containing an angle bracket", () => {
    // Every one of these is ordinary marketing copy. None is markup.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["rcf-setup", "Setup in <2 minutes"],
      ["rcf-discount", "Save <50% today"],
      ["rcf-inequality", "Latency < 100ms and uptime > 99.9%"],
    ];

    // Independent of the fidelity assertion below: the row is written at all, so
    // a failure there is about what was stored and not about the write.
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

    it.each(cases)("stores %s verbatim", async (elementId, content) => {
      const rows = await postContentMap({
        [elementId]: { selector: "p", content, type: "text" },
      });

      expect(storedFor(rows, elementId).original_content).toBe(content);
    });
  });

  describe("plain text a parser mistakes for a tag", () => {
    // These did not merely get escaped — the "tag" and everything after the
    // opening bracket was deleted, so the customer lost the sentence.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["rcf-install", "Paste the <script> tag into your page"],
      ["rcf-markup", "Use <div> tags to group content"],
      ["rcf-pricing", "Plans & <pricing>"],
    ];

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

    it.each(cases)(
      "does not truncate %s at the bracket",
      async (elementId, content) => {
        const rows = await postContentMap({
          [elementId]: { selector: "p", content, type: "text" },
        });

        expect(storedFor(rows, elementId).original_content).toBe(content);
      },
    );
  });

  it("writes all three content columns on the same row", async () => {
    const rows = await postContentMap({
      "rcf-headline": {
        selector: "h1",
        content: "Setup in <2 minutes",
        type: "text",
      },
    });
    const row = storedFor(rows, "rcf-headline");

    expect(row.original_content).toBe(row.current_content);
    expect(row.current_content).toBe(row.published_content);
  });

  it("writes the same verbatim value to all three content columns", async () => {
    // original_content is the restore target. Poisoning it meant version
    // history could not recover the customer's real copy either — the damage
    // survived a rollback.
    const content = "Setup in <2 minutes";

    const rows = await postContentMap({
      "rcf-headline": { selector: "h1", content, type: "text" },
    });
    const row = storedFor(rows, "rcf-headline");

    expect(row.original_content).toBe(content);
    expect(row.current_content).toBe(content);
    expect(row.published_content).toBe(content);
  });

  it("persists a row for an over-length paragraph", async () => {
    const rows = await postContentMap({
      "rcf-longform": {
        selector: "p",
        content: "A".repeat(2500),
        type: "text",
      },
    });
    const row = storedFor(rows, "rcf-longform");

    expect(row.element_id).toBe("rcf-longform");
    expect(row.original_content.length).toBeGreaterThan(0);
  });

  it("keeps a paragraph longer than the old truncation point", async () => {
    // 2500 characters of plain prose. The route truncated to 2000 before
    // sanitizing (route.ts:187-191), silently discarding a fifth of the
    // customer's paragraph with no error and no flag on the row.
    const content = "A".repeat(2500);
    expect(content.length).toBeGreaterThan(FORMER_TRUNCATION_POINT);

    const rows = await postContentMap({
      "rcf-longform": { selector: "p", content, type: "text" },
    });

    expect(storedFor(rows, "rcf-longform").original_content).toBe(content);
  });

  it("persists a row for a string that straddles the old cut", async () => {
    const content = `${"A".repeat(FORMER_TRUNCATION_POINT - 1)}<b>bold</b> tail`;
    const rows = await postContentMap({
      "rcf-mid-entity": { selector: "p", content, type: "text" },
    });

    expect(storedFor(rows, "rcf-mid-entity").element_id).toBe("rcf-mid-entity");
  });

  it("does not cut mid-entity when truncation and escaping combine", async () => {
    // Truncation ran BEFORE sanitizing, so the cut could land inside what the
    // sanitizer was about to expand. Here the 2000-character prefix ended on a
    // bare `<`, which then became `&lt;` — a row both shorter than the customer
    // wrote and longer than the cap they were truncated to.
    const content = `${"A".repeat(FORMER_TRUNCATION_POINT - 1)}<b>bold</b> tail`;

    const rows = await postContentMap({
      "rcf-mid-entity": { selector: "p", content, type: "text" },
    });
    const stored = storedFor(rows, "rcf-mid-entity").original_content;

    expect(stored).toBe(content);
  });

  // The length limit that replaced truncation. It refuses rather than repairs:
  // a truncated string is indistinguishable from copy the customer wrote, and
  // the write is permanent.
  it("refuses text past the storage limit instead of cutting it", async () => {
    const response = await post({
      "rcf-oversize": {
        selector: "p",
        content: "A".repeat(MAX_DISCOVERED_TEXT_LENGTH + 1),
        type: "text",
      },
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("rcf-oversize");
    expect(serviceClient.upsert).not.toHaveBeenCalled();
  });

  it("stores text exactly at the storage limit", async () => {
    const content = "A".repeat(MAX_DISCOVERED_TEXT_LENGTH);

    const rows = await postContentMap({
      "rcf-at-limit": { selector: "p", content, type: "text" },
    });

    expect(storedFor(rows, "rcf-at-limit").original_content).toBe(content);
  });

  it("refuses the whole map when one element is unstorable", async () => {
    // All-or-nothing on purpose: persisting the elements that validated and
    // dropping the rest is the silent partial write this defect was made of.
    const response = await post({
      "rcf-good": { selector: "h1", content: "Fine", type: "text" },
      "rcf-bad": {
        selector: "p",
        content: "A".repeat(MAX_DISCOVERED_TEXT_LENGTH + 1),
        type: "text",
      },
    });

    expect(response.status).toBe(400);
    expect(serviceClient.upsert).not.toHaveBeenCalled();
  });

  /**
   * `content` is not the only field that reaches the service-role upsert. The
   * element id keys it, and `selector` is `NOT NULL` in the schema — so a request
   * that omits or mistypes either used to be answered by Postgres, as a 500, long
   * after the route had already decided to write it.
   */
  describe("the rest of the row", () => {
    it.each([
      ["null", null],
      ["an array", [{ selector: "h1", content: "seeded", type: "h1" }]],
      ["a string", "not a map"],
      ["a number", 7],
    ])("refuses %s as the content map, without a 500", async (_label, body) => {
      const response = await post(body);

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe(
        "Content map must be an object",
      );
      expect(serviceClient.upsert).not.toHaveBeenCalled();
    });

    it.each([
      ["a string", "just the copy"],
      ["null", null],
    ])("refuses %s as an entry", async (_label, entry) => {
      const response = await post({ "rcf-headline": entry });

      expect(response.status).toBe(400);
      expect(serviceClient.upsert).not.toHaveBeenCalled();
    });

    it.each([
      ["a missing selector", { content: "copy", type: "h1" }],
      ["a non-string selector", { selector: 42, content: "copy", type: "h1" }],
      ["an empty selector", { selector: "", content: "copy", type: "h1" }],
      [
        "a junk type",
        { selector: "h1", content: "copy", type: "h1 onclick=x" },
      ],
      ["a non-string type", { selector: "h1", content: "copy", type: {} }],
    ])("refuses %s, naming the element", async (_label, entry) => {
      const response = await post({ "rcf-headline": entry });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("rcf-headline");
      expect(serviceClient.upsert).not.toHaveBeenCalled();
    });

    it("refuses an over-long element id without echoing it back", async () => {
      const elementId = "a".repeat(300);

      const response = await post({
        [elementId]: { selector: "h1", content: "copy", type: "h1" },
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      // Reflecting an unbounded caller-supplied key into the response body is how
      // a refusal becomes an amplifier.
      expect(String(body.error)).not.toContain(elementId);
      expect(serviceClient.upsert).not.toHaveBeenCalled();
    });

    it("accepts a report that carries no type at all", async () => {
      // scripts/qa-journey.mjs reports `{ content, selector }` and nothing else,
      // and `metadata` defaults to `{}` in the schema, so a missing type is a
      // legitimate report rather than a malformed one.
      const rows = await postContentMap({
        "rcf-headline": { selector: "h1", content: "Original headline" },
      });
      const row = storedFor(rows, "rcf-headline");

      expect(row.original_content).toBe("Original headline");
      expect(row.metadata).toEqual({});
    });

    it("keeps the type when the widget sends one", async () => {
      const rows = await postContentMap({
        "rcf-headline": { selector: "h1", content: "copy", type: "h1" },
      });

      expect(storedFor(rows, "rcf-headline").metadata).toEqual({ type: "h1" });
    });
  });

  // Not a defect — the counterexample. Copy with no angle bracket survived even
  // before the fix, so the failures above were attributable to the sanitizer and
  // to nothing else in the request path.
  it("stores ordinary copy unchanged", async () => {
    const content = "Ship content edits without a deploy.";

    const rows = await postContentMap({
      "rcf-plain": { selector: "p", content, type: "text" },
    });

    expect(storedFor(rows, "rcf-plain").original_content).toBe(content);
  });
});
