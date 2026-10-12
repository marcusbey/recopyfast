/**
 * @jest-environment node
 */

/**
 * s96 — which pages beyond the homepage a multi-page lens reads. The sitemap
 * is read with a linear scanner, never an XML parser: no DTD, no entity
 * expansion, no billion-laughs.
 */

import {
  MAX_SAMPLED_PAGES,
  readSitemapLocations,
  samplePages,
  selectPages,
} from "../sample-pages";

const HOME = "https://example.com/";

function urlset(...locs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((loc) => `  <url><loc>${loc}</loc></url>`).join("\n")}
</urlset>`;
}

describe("readSitemapLocations", () => {
  it("reads <loc> values, trimmed, with the five XML entities decoded", () => {
    expect(
      readSitemapLocations(
        urlset(" https://example.com/a ", "https://example.com/b?x=1&amp;y=2"),
      ),
    ).toEqual({
      isIndex: false,
      locations: ["https://example.com/a", "https://example.com/b?x=1&y=2"],
    });
  });

  it("recognises a sitemap index", () => {
    const index = `<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>`;

    expect(readSitemapLocations(index)).toEqual({
      isIndex: true,
      locations: ["https://example.com/s1.xml"],
    });
  });

  it("unwraps CDATA and reads a plain-text sitemap line by line", () => {
    expect(
      readSitemapLocations(urlset("<![CDATA[https://example.com/c]]>"))
        .locations,
    ).toEqual(["https://example.com/c"]);
    expect(
      readSitemapLocations("https://example.com/x\nhttps://example.com/y\n")
        .locations,
    ).toEqual(["https://example.com/x", "https://example.com/y"]);
  });

  it("leaves a DOCTYPE's entities inert — nothing is expanded", () => {
    const hostile = `<?xml version="1.0"?>
<!DOCTYPE urlset [<!ENTITY lol "lollollollollollol"><!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<urlset><url><loc>&xxe;</loc></url><url><loc>&lol;</loc></url></urlset>`;

    expect(readSitemapLocations(hostile).locations).toEqual(["&xxe;", "&lol;"]);
  });

  it("reads a 2 MB pathological sitemap in under a second", () => {
    const unclosed = "<loc>".repeat(420_000);
    const nested = `<loc>${"<loc>".repeat(200_000)}</loc>`.repeat(2);

    for (const body of [unclosed, nested]) {
      const started = performance.now();
      readSitemapLocations(body);
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });
});

describe("selectPages", () => {
  it("keeps the final host only, drops non-HTML files and the homepage, dedupes", () => {
    const pages = selectPages(
      [
        HOME,
        "https://example.com/about",
        "https://example.com/about#team",
        "https://example.com/about?ref=1",
        "https://www.example.com/elsewhere",
        "https://other.test/x",
        "https://example.com/brochure.pdf",
        "https://example.com/photo.JPG",
        "javascript:alert(1)",
        "https://example.com:8443/odd",
        "not a url",
      ],
      HOME,
    );

    expect(pages).toEqual(["https://example.com/about"]);
  });

  it("puts shallow pages first, then shorter paths, and keeps at most nine", () => {
    const candidates = [
      "https://example.com/blog/2024/a-very-long-post-name",
      "https://example.com/blog/2024/post",
      "https://example.com/services/web-design",
      "https://example.com/contact",
      "https://example.com/about-us",
      "https://example.com/faq",
      "https://example.com/blog",
      "https://example.com/team",
      "https://example.com/pricing",
      "https://example.com/careers",
      "https://example.com/locations",
    ];

    const pages = selectPages(candidates, HOME);

    expect(pages).toHaveLength(MAX_SAMPLED_PAGES);
    expect(MAX_SAMPLED_PAGES).toBe(9);
    expect(pages.slice(0, 3)).toEqual([
      "https://example.com/faq",
      "https://example.com/blog",
      "https://example.com/team",
    ]);
    expect(pages).not.toContain(
      "https://example.com/blog/2024/a-very-long-post-name",
    );
  });
});

describe("samplePages", () => {
  it("reads <final origin>/sitemap.xml and returns its pages", async () => {
    const fetched: string[] = [];
    const result = await samplePages({
      finalUrl: "https://example.com/home",
      fallbackLinks: ["https://example.com/from-links"],
      fetchSitemap: async (url) => {
        fetched.push(url);
        return urlset("https://example.com/a", "https://example.com/b");
      },
    });

    expect(fetched).toEqual(["https://example.com/sitemap.xml"]);
    expect(result).toEqual({
      source: "sitemap",
      urls: ["https://example.com/a", "https://example.com/b"],
    });
  });

  it("follows exactly one same-host child of a sitemap index", async () => {
    const fetched: string[] = [];
    const result = await samplePages({
      finalUrl: HOME,
      fallbackLinks: [],
      fetchSitemap: async (url) => {
        fetched.push(url);
        if (url.endsWith("/sitemap.xml")) {
          return `<sitemapindex>
            <sitemap><loc>https://cdn.other.test/s0.xml</loc></sitemap>
            <sitemap><loc>https://example.com/s1.xml</loc></sitemap>
            <sitemap><loc>https://example.com/s2.xml</loc></sitemap>
          </sitemapindex>`;
        }
        return urlset("https://example.com/from-child");
      },
    });

    expect(fetched).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/s1.xml",
    ]);
    expect(result.urls).toEqual(["https://example.com/from-child"]);
  });

  it("never follows an index inside an index", async () => {
    const fetched: string[] = [];
    const result = await samplePages({
      finalUrl: HOME,
      fallbackLinks: ["https://example.com/linked"],
      fetchSitemap: async (url) => {
        fetched.push(url);
        return `<sitemapindex><sitemap><loc>https://example.com/deeper-${fetched.length}.xml</loc></sitemap></sitemapindex>`;
      },
    });

    expect(fetched).toHaveLength(2);
    expect(result).toEqual({
      source: "links",
      urls: ["https://example.com/linked"],
    });
  });

  it("falls back to the homepage's same-host links when there is no sitemap", async () => {
    const result = await samplePages({
      finalUrl: HOME,
      fallbackLinks: [
        "https://example.com/services",
        "https://example.com/contact",
      ],
      fetchSitemap: async () => null,
    });

    expect(result).toEqual({
      source: "links",
      urls: ["https://example.com/contact", "https://example.com/services"],
    });
  });
});
