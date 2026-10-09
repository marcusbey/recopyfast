/**
 * @jest-environment node
 */

/**
 * s88 — /llms.txt tells AI search what the product is and where its pages are.
 *
 * PRD § Technical SEO and s17's criterion: AI search cites structured, hedged
 * sources, and llms.txt (llmstxt.org) is the map it reads. ADR 012 §4: the
 * comparison pages are listed from the same data the routes are built from, so
 * a new comparison appears here with no extra wiring.
 *
 * It is written for machines that quote it, so it may only say what the
 * homepage-truth tests let the homepage say: no A/B testing, no translation,
 * no "works everywhere", no money-back guarantee.
 */

jest.mock("@/lib/supabase/anon", () => ({
  createAnonClient: jest.fn(() => {
    throw new Error("no database in this suite");
  }),
}));

import { GET, dynamic } from "@/app/llms.txt/route";
import sitemap from "@/app/sitemap";
import { comparisonList } from "@/lib/compare/comparisons";
import { resolveSiteUrl } from "@/lib/seo/site-url";

const siteUrl = resolveSiteUrl();

async function body(): Promise<string> {
  return (await GET()).text();
}

/** Every `[label](url)` link target in the file. */
async function links(): Promise<string[]> {
  return Array.from((await body()).matchAll(/\]\(([^)\s]+)\)/g), (m) => m[1]);
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /llms.txt", () => {
  it("answers 200 with UTF-8 plain text, built once at build time", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(dynamic).toBe("force-static");
  });

  it("opens with the product name and a one-line summary", async () => {
    const [title, blank, summary] = (await body()).split("\n");

    expect(title).toBe("# ReCopyFast");
    expect(blank).toBe("");
    expect(summary).toMatch(/^> \S/);
  });

  it("links the product, install guide, agent brief, demo, try and legal pages", async () => {
    expect(await links()).toEqual(
      expect.arrayContaining([
        `${siteUrl}/`,
        `${siteUrl}/try`,
        `${siteUrl}/demo`,
        `${siteUrl}/docs/install`,
        `${siteUrl}/docs/install/agent-instructions.md`,
        `${siteUrl}/compare`,
        `${siteUrl}/privacy`,
        `${siteUrl}/terms`,
      ]),
    );
  });

  it("lists every comparison page, from the routes' own data", async () => {
    const linked = await links();

    for (const comparison of comparisonList) {
      expect(linked).toContain(`${siteUrl}/compare/${comparison.slug}`);
    }
  });

  it("links only absolute URLs on the configured origin", async () => {
    for (const url of await links()) {
      expect(url.startsWith(`${siteUrl}/`)).toBe(true);
    }
  });

  it("links no HTML page the sitemap does not submit", async () => {
    const submitted = new Set(
      (await sitemap()).map((entry) => new URL(entry.url).pathname),
    );
    const pages = (await links())
      .map((url) => new URL(url).pathname)
      .filter((path) => !path.endsWith(".md"));

    expect(pages.filter((path) => !submitted.has(path))).toEqual([]);
  });

  it("claims nothing the homepage may not claim", async () => {
    const text = (await body()).toLowerCase();

    for (const retired of [
      "a/b",
      "split test",
      "translat",
      "works everywhere",
      "any website",
      "money-back",
      "audit log",
      "role-based",
    ]) {
      expect([retired, text.includes(retired)]).toEqual([retired, false]);
    }
  });

  it("says what crawlers see, because it is written for them", async () => {
    // The comparison pages' delivery caveat: published edits are applied in
    // the browser, so a reader that does not run JavaScript sees the original
    // HTML. A machine-facing summary that hid it would be the false claim.
    expect(await body()).toMatch(/do not (run|render) JavaScript/i);
  });
});
