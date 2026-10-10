/**
 * @jest-environment jsdom
 *
 * s66b1 AC 3 — the page keeps its frame in every state; s70b moved it.
 *
 * The Content page had three early returns (loading, error, ready), each
 * repeating a local 30/700 header, so the title's style could drift per
 * state. It renders one `PageShell` around a state-switched body. The layout
 * harness only ever sees the ready state, so the per-state count lives here:
 * one h1 inside the shell's header, whatever the fetches did.
 *
 * Moved from content-page-shell.test.tsx when s70b turned the Content page
 * into Changes (`/dashboard/content` now redirects to `/dashboard/changes`).
 * The three assertions are kept; the title is "Changes", and the one read is
 * GET /api/content/changes (the page no longer calls GET /api/sites).
 */
import { cleanup, render, screen } from "@testing-library/react";
import ChangesPage from "@/app/dashboard/changes/page";

const SITE = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Working Co",
  domain: "working.example.com",
  permission: "admin",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi(changesResponse: () => Response | Promise<Response>): void {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/content/changes")) return changesResponse();
    throw new Error(`unexpected request: ${url}`);
  }) as unknown as typeof fetch;
}

function expectOneChangesTitle(): void {
  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveAccessibleName("Changes");
  expect(headings[0].closest("[data-page-header]")).not.toBeNull();
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Changes page frame", () => {
  it("renders one h1 while loading", async () => {
    // Never answers, so the page stays in its loading state.
    mockApi(() => new Promise<Response>(() => {}));
    render(<ChangesPage />);

    expect(
      await screen.findByRole("status", { name: "Loading changes" }),
    ).toBeInTheDocument();
    expectOneChangesTitle();
  });

  it("renders one h1 when the changes cannot be read", async () => {
    mockApi(() => jsonResponse({ error: "Failed to load changes" }, 500));
    render(<ChangesPage />);

    expect(
      await screen.findByText("Changes could not be loaded."),
    ).toBeInTheDocument();
    expectOneChangesTitle();
  });

  it("renders one h1 when the changes are on screen", async () => {
    mockApi(() =>
      jsonResponse({
        sites: [SITE],
        rows: [
          {
            id: "row-1",
            siteId: SITE.id,
            elementId: "rcf-el-1",
            pagePath: "/",
            elementType: "p",
            selector: "main > p",
            language: "en",
            variant: "default",
            original: "Element number 1",
            live: "Element number 1, changed",
            draft: null,
            state: "published",
            changedAt: "2026-10-08T10:00:00.000Z",
            changedBy: null,
            createdAt: "2026-09-28T09:00:00.000Z",
          },
        ],
        total: 1,
        counts: { pending: 0, published: 1, original: 0 },
        nextOffset: null,
      }),
    );
    render(<ChangesPage />);

    expect(
      await screen.findByText("Element number 1, changed"),
    ).toBeInTheDocument();
    expectOneChangesTitle();
  });
});
