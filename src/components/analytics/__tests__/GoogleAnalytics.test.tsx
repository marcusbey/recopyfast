/**
 * s107 — the shell in the root layout: the runtime (its own chunk) is mounted
 * only with a configured measurement id AND on an allowlisted path. Everywhere
 * else nothing renders and nothing is fetched, not even our own chunk.
 */

import React from "react";
import { render, screen } from "@testing-library/react";

let mockPathname = "/";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

jest.mock("next/dynamic", () => () => {
  const Runtime = ({ measurementId }: { measurementId: string }) => (
    <div data-testid="ga-runtime" data-measurement-id={measurementId} />
  );
  return Runtime;
});

import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";

const saved = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

beforeEach(() => {
  mockPathname = "/";
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123456";
});

afterAll(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  else process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = saved;
});

describe("GoogleAnalytics (shell)", () => {
  it.each([
    "/",
    "/compare/webflow-editor",
    "/tools/website-maintenance-cost",
    "/privacy",
  ])("mounts the runtime on %s with the configured id", (pathname) => {
    mockPathname = pathname;
    render(<GoogleAnalytics />);

    expect(screen.getByTestId("ga-runtime")).toHaveAttribute(
      "data-measurement-id",
      "G-TEST123456",
    );
  });

  it("renders nothing without a measurement id (every preview)", () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

    const { container } = render(<GoogleAnalytics />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with a malformed id", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "UA-1234-1";

    const { container } = render(<GoogleAnalytics />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    "/dashboard",
    "/dashboard/sites",
    "/settings",
    "/login",
    "/signup",
    "/edit",
    "/auth/callback",
    "/api/pricing",
    "/embed/recopyfast.js",
    "/try/rcf-try.js",
  ])("renders nothing on %s", (pathname) => {
    mockPathname = pathname;

    const { container } = render(<GoogleAnalytics />);

    expect(container).toBeEmptyDOMElement();
  });
});
