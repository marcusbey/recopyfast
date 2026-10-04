import React from "react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { metadata } from "@/app/layout";
import manifest from "@/app/manifest";
import OpenGraphImage, { alt } from "@/app/opengraph-image";

/**
 * s50 — the search result, the install prompt and the social card describe
 * the product the same way the page does.
 *
 * They said "Universal CMS Layer" and "Transform any website into an editable
 * platform". Neither is true: a site whose Content Security Policy blocks the
 * script cannot run it, and the product ships no content model. These strings
 * are also the first thing a visitor reads, in a search result or a shared
 * link, before they ever reach the corrected homepage.
 */

jest.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// ImageResponse renders to a PNG through satori, which jsdom cannot run. The
// card's text is the part that can be wrong, so keep the element it was given.
jest.mock("next/og", () => ({
  ImageResponse: jest.fn((element: ReactElement) => ({ element })),
}));

const TITLE = "ReCopyFast - Edit your website copy in place";
const DESCRIPTION =
  "Make the copy on the site you already built editable with two small script placements.";

describe("site metadata", () => {
  it("titles the site by what it does", () => {
    expect((metadata.title as { default: string }).default).toBe(TITLE);
    expect(metadata.openGraph?.title).toBe(TITLE);
    expect(metadata.twitter?.title).toBe(TITLE);
  });

  it("describes the two-placement installation on the site you already built", () => {
    expect(metadata.description).toBe(DESCRIPTION);
    expect(metadata.openGraph?.description).toBe(DESCRIPTION);
    expect(metadata.twitter?.description).toBe(DESCRIPTION);
    expect(metadata.keywords).not.toContain("headless CMS");
  });

  it("keeps the manifest in step", () => {
    expect(manifest().name).toBe(TITLE);
    expect(manifest().description).toBe(DESCRIPTION);
  });

  it("draws the same line on the social card", () => {
    expect(alt).toBe(`ReCopyFast - ${DESCRIPTION}`);

    const { element } = OpenGraphImage() as unknown as {
      element: ReactElement;
    };
    const { container } = render(element);

    expect(container.textContent).toContain(DESCRIPTION);
    expect(container.textContent).not.toMatch(/any website/i);
  });
});
