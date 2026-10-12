/**
 * s107 — the shell in the root layout: the runtime (its own chunk, fetched
 * with a plain dynamic `import()` after hydration) is loaded and mounted only
 * with a configured measurement id AND on an allowlisted path AND in a
 * document that was itself loaded on an allowlisted path (independent review
 * F1: the CSP is the document's, and a client navigation keeps it). Everywhere
 * else nothing renders and nothing is fetched, not even our own chunk.
 *
 * Why not `next/dynamic`: through it the runtime's first render ran as one
 * 63 ms task and the s17 comparison gate's TBT went over 200 ms (PR #94). The
 * shell mounts the runtime inside `startTransition`, so React renders it in
 * yielding slices.
 */

import React from "react";
import { render, screen } from "@testing-library/react";

let mockPathname = "/";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

let mockDocumentPathname: string | null = "/";
jest.mock("@/lib/analytics/google-analytics/document-path", () => ({
  getDocumentPathname: () => mockDocumentPathname,
}));

const mockLoadRuntime = jest.fn(async () => {
  const Runtime = ({ measurementId }: { measurementId: string }) => (
    <div data-testid="ga-runtime" data-measurement-id={measurementId} />
  );
  return Runtime;
});
jest.mock("@/components/analytics/load-runtime", () => ({
  loadGoogleAnalyticsRuntime: () => mockLoadRuntime(),
}));

import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";

const saved = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

beforeEach(() => {
  mockLoadRuntime.mockClear();
  mockPathname = "/";
  mockDocumentPathname = "/";
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123456";
});

afterAll(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  else process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = saved;
});

/** Lets the dynamic import and the transition settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("GoogleAnalytics (shell)", () => {
  it.each([
    "/",
    "/compare/webflow-editor",
    "/tools/website-maintenance-cost",
    "/privacy",
  ])(
    "loads and mounts the runtime on %s with the configured id",
    async (pathname) => {
      mockPathname = pathname;
      render(<GoogleAnalytics />);

      expect(await screen.findByTestId("ga-runtime")).toHaveAttribute(
        "data-measurement-id",
        "G-TEST123456",
      );
    },
  );

  it("renders nothing during the first render (prerender), so nothing ships in the HTML", () => {
    const { container } = render(<GoogleAnalytics />);

    expect(container).toBeEmptyDOMElement();
  });

  it("unmounts the runtime when a client navigation leaves the allowlist", async () => {
    const { rerender } = render(<GoogleAnalytics />);
    await screen.findByTestId("ga-runtime");

    mockPathname = "/dashboard";
    rerender(<GoogleAnalytics />);

    expect(screen.queryByTestId("ga-runtime")).toBeNull();
  });

  it("fetches the runtime once, however many allowlisted pages follow", async () => {
    const { rerender } = render(<GoogleAnalytics />);
    await screen.findByTestId("ga-runtime");

    mockPathname = "/blog";
    rerender(<GoogleAnalytics />);
    await settle();

    expect(mockLoadRuntime).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/dashboard", "G-TEST123456"],
    ["/dashboard/sites", "G-TEST123456"],
    ["/settings", "G-TEST123456"],
    ["/login", "G-TEST123456"],
    ["/signup", "G-TEST123456"],
    ["/edit", "G-TEST123456"],
    ["/auth/callback", "G-TEST123456"],
    ["/api/pricing", "G-TEST123456"],
    ["/embed/recopyfast.js", "G-TEST123456"],
    ["/try/rcf-try.js", "G-TEST123456"],
    ["/", undefined],
    ["/", "UA-1234-1"],
  ])(
    "%s with id %s: renders nothing and never fetches the runtime",
    async (pathname, id) => {
      mockPathname = pathname;
      if (id === undefined) delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
      else process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = id;

      const { container } = render(<GoogleAnalytics />);
      await settle();

      expect(container).toBeEmptyDOMElement();
      expect(mockLoadRuntime).not.toHaveBeenCalled();
    },
  );

  /**
   * Independent review F1 (major). `/login` → "Terms" is a client navigation:
   * the URL says /terms, the document is still /login's, under the nonce
   * policy, whose 'strict-dynamic' would admit a script-inserted gtag.js.
   * A static document loaded off the allowlist (/settings, /auth/error) has a
   * policy without Google's hosts. Neither may fetch the runtime.
   */
  it.each([
    ["/terms", "/login"],
    ["/privacy", "/signup"],
    ["/", "/edit"],
    ["/docs/install", "/dashboard/sites/abc"],
    ["/tools", "/tools/website-spell-checker/r/6f1c2b9e"],
    ["/", "/settings"],
    ["/", "/auth/error"],
  ])(
    "on %s in a document loaded as %s: renders nothing and never fetches the runtime",
    async (pathname, documentPathname) => {
      mockPathname = pathname;
      mockDocumentPathname = documentPathname;

      const { container } = render(<GoogleAnalytics />);
      await settle();

      expect(container).toBeEmptyDOMElement();
      expect(mockLoadRuntime).not.toHaveBeenCalled();
    },
  );

  it("never fetches it in an app document, however the visitor moves between pages", async () => {
    mockDocumentPathname = "/login";
    mockPathname = "/login";
    const { container, rerender } = render(<GoogleAnalytics />);

    for (const pathname of ["/terms", "/login", "/privacy", "/"]) {
      mockPathname = pathname;
      rerender(<GoogleAnalytics />);
      await settle();
    }

    expect(container).toBeEmptyDOMElement();
    expect(mockLoadRuntime).not.toHaveBeenCalled();
  });

  it("does not render until the document's path is known (null on the server)", async () => {
    mockDocumentPathname = null;

    const { container } = render(<GoogleAnalytics />);
    await settle();

    expect(container).toBeEmptyDOMElement();
    expect(mockLoadRuntime).not.toHaveBeenCalled();
  });
});
