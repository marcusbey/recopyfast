import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import {
  ALT_TEXT_BODY,
  FIX_ON_PAGE_BODY,
  FIX_ON_PAGE_FOOTNOTE,
} from "@/lib/tools/cta-copy";
import { ToolCta } from "../ToolCta";

describe("ToolCta", () => {
  it("pins the fix-on-page copy, word for word", () => {
    expect(FIX_ON_PAGE_BODY).toBe(
      "Opens our free preview. On desktop, click the line on your own page and retype it. Only your tab changes, and nothing is saved. Install ReCopyFast to keep the change; visitors see it on their next page load.",
    );
    expect(FIX_ON_PAGE_FOOTNOTE).toBe(
      "Search engines that don't run JavaScript keep reading your original text. Fix search-critical copy in your site's source.",
    );
  });

  it("fix-on-page: opens /try with the UTMs, and signs up through a native anchor", () => {
    render(<ToolCta variant="fix-on-page" slug="website-spell-checker" />);

    expect(
      screen.getByRole("heading", { name: "Fix it on your live page" }),
    ).toBeInTheDocument();
    expect(screen.getByText(FIX_ON_PAGE_BODY)).toBeInTheDocument();
    expect(screen.getByText(FIX_ON_PAGE_FOOTNOTE)).toBeInTheDocument();
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual([
      "/try?utm_source=tools&utm_medium=free_tool&utm_campaign=website-spell-checker#install",
      "/signup?utm_source=tools&utm_medium=free_tool&utm_campaign=website-spell-checker",
    ]);
  });

  it("alt-text (s101): links sign-up and the install guide, and never /try", () => {
    render(<ToolCta variant="alt-text" slug="alt-text-checker" />);

    expect(
      screen.getByRole("heading", { name: "Fix alt text on your live page" }),
    ).toBeInTheDocument();
    expect(screen.getByText(ALT_TEXT_BODY)).toBeInTheDocument();
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "/signup?utm_source=tools&utm_medium=free_tool&utm_campaign=alt-text-checker",
      "/docs/install?utm_source=tools&utm_medium=free_tool&utm_campaign=alt-text-checker",
    ]);
    expect(hrefs.some((href) => href?.startsWith("/try"))).toBe(false);
  });

  it("draws every link as a native <a> — never a client-side Link into the app surface", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/tools/ToolCta.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/from "next\/link"/);
    expect(source).toMatch(/<a\b/);
  });

  it("never claims to edit titles, meta tags or what crawlers see", () => {
    const copy =
      `${FIX_ON_PAGE_BODY} ${FIX_ON_PAGE_FOOTNOTE} ${ALT_TEXT_BODY}`.toLowerCase();

    for (const claim of [
      "meta tag",
      "title tag",
      "seo boost",
      "google sees",
      "crawlers see your",
    ]) {
      expect(copy).not.toContain(claim);
    }
  });
});
