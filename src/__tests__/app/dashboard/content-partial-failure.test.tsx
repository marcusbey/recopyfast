/**
 * @jest-environment jsdom
 *
 * A-31 — one failing site blanks the entire Content page.
 *
 * `src/app/dashboard/content/page.tsx:149-159` fans out over every site with
 * `Promise.all`. That rejects on the first failure and throws away the results
 * that already resolved, and the catch sets a page-level `error` which
 * short-circuits the whole render at `:223-246`.
 *
 * The F-4 fix traded "shows nothing, says you have none" for "shows nothing,
 * names one site" — an improvement in honesty, not in reach. A customer with
 * two sites, one of them broken, still cannot get at the content of the one
 * that works.
 *
 * The failure below is the ordinary one: a single site's content read is
 * refused, the rest of the account is fine.
 */
import { render, screen, cleanup } from "@testing-library/react";
import ContentPage from "@/app/dashboard/content/page";

const SITE_A = {
  id: "site-a",
  name: "Working Co",
  domain: "working.example.com",
  siteToken: "token-a",
};
const SITE_B = {
  id: "site-b",
  name: "Broken Co",
  domain: "broken.example.com",
  siteToken: "token-b",
};

/** Unique strings, so an assertion cannot be satisfied by page furniture. */
const CONTENT_A = "Dinner is served from six";
const CONTENT_B = "Book a table for two";
const FAILURE_DETAIL = "row-level security denied this read";

function contentRow(siteId: string, elementId: string, content: string) {
  return {
    id: `${siteId}-${elementId}`,
    site_id: siteId,
    element_id: elementId,
    selector: `#${elementId}`,
    original_content: content,
    current_content: content,
    published_content: content,
    language: "en",
    variant: "default",
    metadata: { type: "text" },
    updated_at: "2026-08-01T10:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * @param siteBFails whether site B's content read is refused. Site A always
 * resolves — that is the content the page is meant to keep showing.
 */
function mockContentApi(siteBFails: boolean): void {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith("/api/sites")) {
      return jsonResponse({ sites: [SITE_A, SITE_B] });
    }
    if (url.startsWith(`/api/content/${SITE_A.id}`)) {
      return jsonResponse([contentRow(SITE_A.id, "rcf-hero", CONTENT_A)]);
    }
    if (url.startsWith(`/api/content/${SITE_B.id}`)) {
      return siteBFails
        ? jsonResponse({ error: FAILURE_DETAIL }, 500)
        : jsonResponse([contentRow(SITE_B.id, "rcf-cta", CONTENT_B)]);
    }
    throw new Error(`unexpected request: ${url}`);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Content page with one failing site", () => {
  /* Guards the test below: `test.failing` passes on any failure, a render that
     throws included, so the working path has to be asserted on its own. */
  it("lists every site's content when all of them resolve", async () => {
    mockContentApi(false);
    render(<ContentPage />);

    expect(await screen.findByText(CONTENT_A)).toBeInTheDocument();
    expect(screen.getByText(CONTENT_B)).toBeInTheDocument();
  });

  it("keeps the working site's content and reports the failing one per site", async () => {
    mockContentApi(true);
    render(<ContentPage />);

    // The point of the finding: site A's content is already in hand.
    expect(await screen.findByText(CONTENT_A)).toBeInTheDocument();

    // Site B's failure is still reported, with its reason, beside it.
    expect(
      screen.getByText(new RegExp(FAILURE_DETAIL, "i")),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(SITE_B.name))).toBeInTheDocument();

    // ...and not as the page-level state that replaces everything else.
    expect(screen.queryByText("Failed to load content")).toBeNull();
  });
});
