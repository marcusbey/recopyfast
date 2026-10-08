/**
 * @jest-environment jsdom
 *
 * s66b1 AC 3 — the Content page keeps its frame in every state.
 *
 * It had three early returns (loading, error, ready), each repeating a local
 * 30/700 header, so the title's style could drift per state. It now renders
 * one `PageShell` around a state-switched body. The layout harness only ever
 * sees the ready state, so the per-state count lives here: one h1, "Content",
 * inside the shell's header, whatever the fetches did.
 *
 * Fetch mocks follow content-load-states.test.tsx.
 */
import { cleanup, render, screen } from "@testing-library/react";
import ContentPage from "@/app/dashboard/content/page";

const SITE = {
  id: "site-a",
  name: "Working Co",
  domain: "working.example.com",
  siteToken: "token-a",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi(sitesResponse: () => Response | Promise<Response>): void {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/sites")) return sitesResponse();
    if (url.startsWith(`/api/content/${SITE.id}`)) {
      return jsonResponse([
        {
          id: `${SITE.id}-el-1`,
          site_id: SITE.id,
          element_id: "rcf-el-1",
          selector: "#rcf-el-1",
          original_content: "Element number 1",
          current_content: "Element number 1",
          published_content: "Element number 1",
          language: "en",
          variant: "default",
          page_path: null,
          metadata: { type: "text" },
          updated_at: "2026-08-01T10:00:00.000Z",
        },
      ]);
    }
    throw new Error(`unexpected request: ${url}`);
  }) as unknown as typeof fetch;
}

function expectOneContentTitle(): void {
  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveAccessibleName("Content");
  expect(headings[0].closest("[data-page-header]")).not.toBeNull();
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Content page frame", () => {
  it("renders one h1 while loading", async () => {
    // Never answers, so the page stays in its loading state.
    mockApi(() => new Promise<Response>(() => {}));
    render(<ContentPage />);

    expect(
      await screen.findByRole("status", { name: "Loading content" }),
    ).toBeInTheDocument();
    expectOneContentTitle();
  });

  it("renders one h1 when the site list cannot be read", async () => {
    mockApi(() => jsonResponse({ error: "permission denied" }, 500));
    render(<ContentPage />);

    expect(
      await screen.findByText("Failed to load content"),
    ).toBeInTheDocument();
    expectOneContentTitle();
  });

  it("renders one h1 when the content is on screen", async () => {
    mockApi(() => jsonResponse({ sites: [SITE] }));
    render(<ContentPage />);

    expect(await screen.findByText("Element number 1")).toBeInTheDocument();
    expectOneContentTitle();
  });
});
