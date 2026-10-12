/**
 * @jest-environment node
 */

/**
 * s96 — what a lens may read off a fetched page. parse5 builds a tree and
 * nothing else: no DOM, no script execution, no resource loading, by
 * construction. Every lens reads the `ExtractedPage` frozen here, so s97 (CSP)
 * and s101 (alt text) never edit this file.
 */

import {
  extractPage,
  MAX_BLOCK_CHARS,
  MAX_BLOCKS,
  MAX_ELEMENTS,
  MAX_IMAGES,
  MAX_TREE_DEPTH,
  type ExtractedPage,
} from "../extract-page";

const PAGE_URL = "https://example.com/about";

function extract(html: string, url = PAGE_URL): ExtractedPage {
  const result = extractPage(html, { url, headers: {} });
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.page;
}

function texts(page: ExtractedPage): string[] {
  return page.blocks.map((block) => block.text);
}

describe("visible text, by block", () => {
  it("keeps headings, paragraphs and list items as separate blocks, tagged", () => {
    const page = extract(
      "<h1>Welcome</h1><p>We fix copy.</p><ul><li>Fast</li><li>Honest</li></ul>",
    );

    expect(page.blocks).toEqual([
      { tag: "h1", text: "Welcome" },
      { tag: "p", text: "We fix copy." },
      { tag: "li", text: "Fast" },
      { tag: "li", text: "Honest" },
    ]);
  });

  it("merges inline elements into their block and collapses whitespace", () => {
    const page = extract(
      "<p>  We <strong>really</strong>\n\n <a href='/x'>fix</a> <em>copy</em>.<br>Every day.</p>",
    );

    expect(texts(page)).toEqual(["We really fix copy. Every day."]);
  });

  it("splits text around a nested block and resumes the outer one", () => {
    const page = extract("<div>Before <p>inside</p> after</div>");

    expect(page.blocks).toEqual([
      { tag: "div", text: "Before" },
      { tag: "p", text: "inside" },
      { tag: "div", text: "after" },
    ]);
  });

  it("decodes entities", () => {
    expect(
      texts(extract("<p>Fish &amp; chips &mdash; &#8220;fresh&#8221;</p>")),
    ).toEqual(["Fish & chips — “fresh”"]);
  });

  it.each([
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "math",
    "code",
    "pre",
    "kbd",
    "samp",
    "textarea",
    "select",
    "iframe",
    "object",
  ])("excludes <%s> content", (tag) => {
    const page = extract(`<p>Visible</p><${tag}>Hiddenword</${tag}>`);

    expect(texts(page).join(" ")).not.toContain("Hiddenword");
  });

  it.each([
    "<div hidden><p>Hiddenword</p></div>",
    '<div aria-hidden="true"><p>Hiddenword</p></div>',
    '<div style="display: none"><p>Hiddenword</p></div>',
    '<div style="color:red;visibility:hidden"><p>Hiddenword</p></div>',
  ])("excludes hidden content: %s", (markup) => {
    const page = extract(`<p>Visible</p>${markup}`);

    expect(texts(page)).toEqual(["Visible"]);
  });

  it("strips bidi controls, zero-width characters and soft hyphens", () => {
    const page = extract(
      "<p>spell\u00ading check\u200bed \u202eevil\u202c to\ufeffday \u2066x\u2069</p>",
    );

    expect(texts(page)).toEqual(["spelling checked evil today x"]);
  });

  it("strips the Arabic letter mark (U+061C) and the Mongolian vowel separator (U+180E)", () => {
    const page = extract("<p>spell\u061cing check\u180eed</p>");

    expect(texts(page)).toEqual(["spelling checked"]);
  });

  /**
   * s96 review round 2, nit 7: the hand-kept list missed default-ignorable
   * characters. Every Default_Ignorable_Code_Point and Bidi_Control is now
   * stripped, by Unicode property rather than by list.
   */
  it.each([
    ["U+034F combining grapheme joiner", "\u034f"],
    ["U+115F Hangul choseong filler", "\u115f"],
    ["U+3164 Hangul filler", "\u3164"],
    ["U+200D zero-width joiner (as before this PR)", "\u200d"],
    // Verification review of b6ad9ff, N1: a tag character outside a flag's
    // tag sequence is invisible and split "fresh" into the false typo "fre".
    ["a lone U+E0041 tag latin capital A", "\u{e0041}"],
    [
      "a tag sequence with no black flag before it",
      "\u{e0067}\u{e0062}\u{e007f}",
    ],
  ])("strips %s", (_label, character) => {
    const page = extract(`<p>spell${character}ing</p>`);

    expect(texts(page)).toEqual(["spelling"]);
  });

  /**
   * Verification review of e7bdd09, F2: the stripped text is what a report
   * SHOWS, and variation selectors and tag characters are part of how an
   * emoji or a flag renders — ❤️ became ❤ and the England flag a black flag.
   * U+FE00–FE0F and U+E0100–E01EF are kept, and tag characters inside a
   * flag's tag sequence (U+1F3F4, tags, U+E007F).
   */
  it.each([
    ["a red heart with VS16 (U+2764 U+FE0F)", "\u2764\ufe0f"],
    ["a keycap one (1 U+FE0F U+20E3)", "1\ufe0f\u20e3"],
    [
      "the England flag (U+1F3F4 + tags + U+E007F)",
      "\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}",
    ],
    ["an ideographic variation sequence (U+845B U+E0100)", "\u845b\u{e0100}"],
  ])("keeps %s intact", (_label, sequence) => {
    const page = extract(`<p>We love bread ${sequence} every day</p>`);

    expect(texts(page)).toEqual([`We love bread ${sequence} every day`]);
  });

  it("strips the tags after a black flag that no cancel tag ends, keeping the flag", () => {
    const page = extract(
      "<p>We love bread \u{1f3f4}\u{e0067}\u{e0062} every day</p>",
    );

    expect(texts(page)).toEqual(["We love bread \u{1f3f4} every day"]);
  });

  it("caps blocks, block length and the page's text", () => {
    const many = extract("<p>w</p>".repeat(MAX_BLOCKS + 50));
    const long = extract(`<p>${"word ".repeat(1_000)}</p>`);

    expect(many.blocks).toHaveLength(MAX_BLOCKS);
    expect(many.truncated).toBe(true);
    expect(long.blocks[0].text.length).toBeLessThanOrEqual(MAX_BLOCK_CHARS);

    const heavy = extract(`<p>${"a".repeat(1_500)}</p>`.repeat(400));
    const total = heavy.blocks.reduce(
      (sum, block) => sum + block.text.length,
      0,
    );
    expect(total).toBeLessThanOrEqual(200 * 1024);
    expect(heavy.truncated).toBe(true);
  });

  it("counts words, so a page that builds its text in JavaScript can say so", () => {
    expect(
      extract("<div id='root'></div><script>render()</script>").wordCount,
    ).toBe(0);
    expect(extract("<p>one two three</p>").wordCount).toBe(3);
  });
});

describe("identity and head metadata", () => {
  it("reads title, lang, site name, generator, meta CSPs and meta refresh", () => {
    const page = extract(`<!doctype html><html lang="en-GB"><head>
      <title>  Acme   Bakery </title>
      <meta property="og:site_name" content="Acme">
      <meta name="generator" content="WordPress 6.5">
      <meta http-equiv="Content-Security-Policy" content="default-src 'self'">
      <meta http-equiv="content-security-policy" content="script-src 'none'">
      <meta http-equiv="refresh" content="0; url=/new">
      </head><body><p>Hi</p></body></html>`);

    expect(page).toMatchObject({
      title: "Acme Bakery",
      lang: "en-gb",
      siteName: "Acme",
      generator: "WordPress 6.5",
      metaCsp: ["default-src 'self'", "script-src 'none'"],
      metaRefresh: "0; url=/new",
    });
  });

  it("defaults the absent fields to null and empty lists", () => {
    const page = extract("<p>Hi</p>");

    expect(page).toMatchObject({
      title: "",
      lang: null,
      siteName: null,
      generator: null,
      metaCsp: [],
      metaRefresh: null,
      baseUrl: PAGE_URL,
    });
  });
});

describe("images", () => {
  it("separates an absent alt (null) from an empty one, and resolves sources", () => {
    const page = extract(`
      <img src="/a.png">
      <img src="b.png" alt="">
      <img data-src="https://cdn.test/c.png" alt="Logo" width="120" height="40">
      <img srcset="/d-1x.png 1x, /d-2x.png 2x" alt="D" role="presentation" aria-hidden="true">
      <img src="data:image/png;base64,AAAA">
    `);

    expect(page.images).toEqual([
      expect.objectContaining({ src: "https://example.com/a.png", alt: null }),
      expect.objectContaining({ src: "https://example.com/b.png", alt: "" }),
      expect.objectContaining({
        src: "https://cdn.test/c.png",
        alt: "Logo",
        width: 120,
        height: 40,
      }),
      expect.objectContaining({
        src: "https://example.com/d-1x.png",
        role: "presentation",
        ariaHidden: true,
      }),
      expect.objectContaining({ src: "data:image/png" }),
    ]);
  });

  it("knows whether an image sits in a link, and whether that link has text", () => {
    const page = extract(`
      <a href="/home"><img src="/logo.png" alt=""></a>
      <a href="/shop"><img src="/cart.png" alt=""> Shop</a>
      <img src="/plain.png" alt="x">
    `);

    expect(
      page.images.map(({ inLink, linkHasText }) => ({ inLink, linkHasText })),
    ).toEqual([
      { inLink: true, linkHasText: false },
      { inLink: true, linkHasText: true },
      { inLink: false, linkHasText: false },
    ]);
  });

  it("caps images", () => {
    expect(
      extract('<img src="/x.png">'.repeat(MAX_IMAGES + 10)).images,
    ).toHaveLength(MAX_IMAGES);
  });
});

describe("<base href>", () => {
  it("resolves relative image and link URLs against it", () => {
    const page = extract(
      '<base href="https://example.com/sub/"><a href="page">x</a><img src="i.png">',
    );

    expect(page.baseUrl).toBe("https://example.com/sub/");
    expect(page.images[0].src).toBe("https://example.com/sub/i.png");
    expect(page.sameHostLinks).toEqual(["https://example.com/sub/page"]);
  });

  it("ignores a non-web <base href>", () => {
    expect(extract('<base href="javascript:alert(1)"><p>x</p>').baseUrl).toBe(
      PAGE_URL,
    );
  });
});

describe("scripts, styles, root attributes and links", () => {
  it("keeps script sources and ids, stylesheet hrefs and html/body attributes", () => {
    const page = extract(`<html data-wf-site="abc" class="w-mod-js"><head>
      <script src="/_next/static/chunk.js"></script>
      <script id="__NEXT_DATA__" type="application/json">{}</script>
      <link rel="stylesheet" href="/site.css">
      </head><body class="home"><p>x</p></body></html>`);

    expect(page.scriptSrcs).toEqual([
      "https://example.com/_next/static/chunk.js",
    ]);
    expect(page.scriptIds).toEqual(["__NEXT_DATA__"]);
    expect(page.stylesheetHrefs).toEqual(["https://example.com/site.css"]);
    expect(page.rootAttributes).toEqual([
      { element: "html", name: "data-wf-site", value: "abc" },
      { element: "html", name: "class", value: "w-mod-js" },
      { element: "body", name: "class", value: "home" },
    ]);
  });

  it("keeps same-host http(s) links only, without fragment or query, deduplicated", () => {
    const page = extract(`
      <a href="/pricing">a</a>
      <a href="/pricing#plans">b</a>
      <a href="https://example.com/team?ref=1">c</a>
      <a href="https://other.test/">d</a>
      <a href="mailto:hi@example.com">e</a>
      <a href="javascript:void(0)">f</a>
    `);

    expect(page.sameHostLinks).toEqual([
      "https://example.com/pricing",
      "https://example.com/team",
    ]);
  });
});

describe("hostile and huge input", () => {
  it.each([
    "<p>unclosed <b>bold <i>italic",
    "</p></div></body></html>",
    "<<<<>>>>",
    "\u0000\u0001\u0002binary￿\ud800",
    "<!-- unterminated comment",
    "<svg><foreignObject><p>x</p></foreignObject></svg>",
  ])("never throws on %p", (html) => {
    expect(() => extract(html)).not.toThrow();
  });

  it("walks the deepest document it accepts without recursing", () => {
    const page = extract(
      `${"<span>".repeat(MAX_TREE_DEPTH - 3)}deep words here`,
    );

    expect(page.blocks.map((block) => block.text)).toEqual(["deep words here"]);
  });

  /**
   * Each of these took parse5 seconds to minutes unbounded (measured
   * 2026-10-11, Node 24.14): the tree-construction algorithm rescans the
   * stack of open elements, or a tag's attribute list, on every token.
   */
  it.each([
    ["nested <div>", "<div>".repeat(400_000)],
    ["nested <ul><li>", "<ul><li>".repeat(230_000)],
    ["nested <dl><dt>", "<dl><dt>".repeat(230_000)],
    ["<b><div> misnesting", "<b><div>".repeat(230_000)],
    ["unmatched </b> under <i>", "<i></b>".repeat(290_000)],
    [
      "<span> end tags that never close a <div>",
      ("<span>".repeat(1_000) + "<div>" + "</span>".repeat(1_000)).repeat(160),
    ],
    ["nested <template><div>", "<template><div>".repeat(130_000)],
    ["flat element flood", "<i></i>".repeat(300_000)],
  ])("refuses %s as too complex, quickly", (_name, html) => {
    const started = performance.now();
    const result = extractPage(html, { url: PAGE_URL, headers: {} });

    expect(result).toEqual({ ok: false, reason: "too_complex" });
    expect(performance.now() - started).toBeLessThan(2_500);
  });

  it("stops parsing once its time budget is spent (one tag with 40,000 distinct attributes)", () => {
    let attributes = "";
    for (let index = 0; index < 40_000; index += 1) attributes += ` a${index}`;
    const started = performance.now();

    const result = extractPage(`<div${attributes}>x</div>`, {
      url: PAGE_URL,
      headers: {},
      parseBudgetMs: 100,
    });

    expect(result).toEqual({ ok: false, reason: "too_complex" });
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  it("caps depth at 512 and elements at 100,000", () => {
    expect(MAX_TREE_DEPTH).toBe(512);
    expect(MAX_ELEMENTS).toBe(100_000);
  });

  it("extracts a 2 MB page in under 2 s", () => {
    const html = `<html><body>${"<p>Plain words in a paragraph of text.</p>".repeat(
      Math.ceil((2 * 1024 * 1024) / 42),
    )}</body></html>`;
    expect(html.length).toBeGreaterThanOrEqual(2 * 1024 * 1024);

    const started = performance.now();
    extract(html);

    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
