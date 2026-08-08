/**
 * @jest-environment jsdom
 *
 * Two ways the Content page could tell a customer something untrue.
 *
 * 1. A total failure to read the site list rendered "Register a site and add
 *    content elements to see them here" — the empty state, which is a claim
 *    about the account, not about the request. `fetchSites` caught the failure
 *    and returned `[]`, and an empty site list is exactly what an account with
 *    no sites looks like. The customer was told they had nothing, with no way
 *    to retry.
 *
 * 2. A retry that comes back with fewer elements left `currentPage` where it
 *    was. Page 2 of a list that is now one page long renders no cards at all,
 *    under the words "Page 2 of 1".
 *
 * Both are about what the page says when the data underneath it changes shape.
 */
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContentPage from "@/app/dashboard/content/page";

const SITE = {
  id: "site-a",
  name: "Working Co",
  domain: "working.example.com",
  siteToken: "token-a",
};

/** The exact words of the two states that must not be confused for each other. */
const EMPTY_STATE =
  "Register a site and add content elements to see them here.";
const ERROR_STATE = "Failed to load content";

function contentRow(index: number) {
  const content = `Element number ${index}`;
  return {
    id: `${SITE.id}-el-${index}`,
    site_id: SITE.id,
    element_id: `rcf-el-${index}`,
    selector: `#rcf-el-${index}`,
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
 * A second site whose content read always fails, so `SiteFailureNotice` — and
 * with it the only "Try Again" button that exists while the page is otherwise
 * working — is on screen for the retry test.
 */
const FAILING_SITE = {
  id: "site-b",
  name: "Broken Co",
  domain: "broken.example.com",
  siteToken: "token-b",
};

/**
 * @param sitesResponse what `/api/sites` answers.
 * @param rowCount how many content rows the working site has. Read at request
 * time, so a test can shrink the list between the first load and a retry.
 */
function mockApi(
  sitesResponse: () => Response,
  rowCount: () => number = () => 0,
): void {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith("/api/sites")) {
      return sitesResponse();
    }
    if (url.startsWith(`/api/content/${SITE.id}`)) {
      return jsonResponse(
        Array.from({ length: rowCount() }, (_, i) => contentRow(i + 1)),
      );
    }
    if (url.startsWith(`/api/content/${FAILING_SITE.id}`)) {
      return jsonResponse(
        { error: "row-level security denied this read" },
        500,
      );
    }
    throw new Error(`unexpected request: ${url}`);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Content page when the site list cannot be read", () => {
  /* Guards the two tests below: they assert the empty state is absent, which a
     page that had stopped rendering anything would also satisfy. */
  it("still shows the empty state when the account genuinely has no sites", async () => {
    mockApi(() => jsonResponse({ sites: [] }));
    render(<ContentPage />);

    expect(await screen.findByText(EMPTY_STATE)).toBeInTheDocument();
    expect(screen.queryByText(ERROR_STATE)).toBeNull();
  });

  it("reports a refused read as a failure, not as an empty account", async () => {
    mockApi(() => jsonResponse({ error: "permission denied" }, 500));
    render(<ContentPage />);

    expect(await screen.findByText(ERROR_STATE)).toBeInTheDocument();
    expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeEnabled();
    expect(screen.queryByText(EMPTY_STATE)).toBeNull();
  });

  it("reports a body that is not a site list as a failure too", async () => {
    // A 200 carrying the wrong shape is the same event as a 500 for this page:
    // it does not know how many sites the account has.
    mockApi(() => jsonResponse({ ok: true }));
    render(<ContentPage />);

    expect(await screen.findByText(ERROR_STATE)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_STATE)).toBeNull();
  });
});

describe("Content page pagination after the list shrinks", () => {
  it("clamps the current page to the pages that still exist", async () => {
    const user = userEvent.setup();
    let rowCount = 15; // two pages at ten per page
    mockApi(
      () => jsonResponse({ sites: [SITE, FAILING_SITE] }),
      () => rowCount,
    );

    render(<ContentPage />);
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    // The eleventh element — proof page 2 is really rendered, so the assertion
    // after the retry is about the clamp and not about a page that never moved.
    expect(screen.getByText("Element number 11")).toBeInTheDocument();

    // A retry that finds fewer elements than last time.
    rowCount = 3;
    await user.click(screen.getByRole("button", { name: /try again/i }));

    // Without the clamp `currentPage` stays at 2, and the slice that starts at
    // the eleventh element of a three-element list is empty — so the page
    // renders "No content found" over content it is holding.
    await waitFor(() =>
      expect(screen.getByText("Element number 1")).toBeInTheDocument(),
    );
    expect(screen.queryByText("No content found")).toBeNull();
  });
});
