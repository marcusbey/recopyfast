/**
 * A-14 — two pages sharing a layout share one content row.
 *
 * `computeStableElementId` is `'rcf-' + hashPath(structuralPath(element))`
 * (public/embed/recopyfast.src.js:819-824), and `structuralPath` is built from
 * tag names, same-tag sibling indices and the nearest author-written ancestor
 * `id` (:731-764). No URL. No pathname. No document identity of any kind. The
 * row key does not carry a page either — uniqueness on `content_elements` is
 * `(site_id, element_id, language, variant)`.
 *
 * So `/about` and `/pricing` rendered from one template produce byte-identical
 * ids for corresponding elements, and the consequences compound:
 *
 *   1. Whichever page a visitor loads first is discovered, and `ignoreDuplicates`
 *      on the upsert means the second page's real copy is never recorded.
 *   2. `hydrateStoredContent` then writes the first page's text over the second
 *      page's element, so `/pricing` starts displaying `/about`'s headline.
 *   3. Editing either one edits both, with no indication that it did.
 *   4. The dashboard shows one row where there should be several, so none of
 *      this is visible in the product.
 *
 * THESE TESTS RUN THE SHIPPED WIDGET. `recopyfast.src.js` is a browser IIFE
 * that reads `document.currentScript` at parse time and cannot be imported, so
 * the STABLE ELEMENT IDENTITY block is sliced out of the real file and
 * evaluated with `document` injected. A transcription of the hash into this
 * file would pass forever while the widget rotted; this cannot.
 *
 * The `test.failing` cases pass while ids are page-blind and fail the moment
 * the page becomes part of the identity, which is the signal to delete the
 * marker.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const WIDGET_SOURCE = path.join(
  process.cwd(),
  "public",
  "embed",
  "recopyfast.src.js",
);

const SECTION_BEGIN = "// STABLE ELEMENT IDENTITY";
const SECTION_END = "class ReCopyFast {";

type ComputeStableElementId = (element: Element) => string;

/**
 * Slice the identity helpers out of the shipped widget and bind them to a
 * specific document.
 *
 * `structuralPath` calls `document.getElementById` to settle duplicate-id
 * pages, so the block genuinely needs a document; passing it as a parameter
 * shadows the global one and lets a single test hold two independent pages at
 * once, which is the whole point here.
 */
function loadComputeStableElementId(doc: Document): ComputeStableElementId {
  const source = readFileSync(WIDGET_SOURCE, "utf8");
  const begin = source.indexOf(SECTION_BEGIN);
  const end = source.indexOf(SECTION_END);

  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `public/embed/recopyfast.src.js no longer contains the "${SECTION_BEGIN}" ` +
        `section ending at "${SECTION_END}", so the element-identity helpers ` +
        "cannot be extracted. Update this loader rather than transcribing them.",
    );
  }

  const block = source.slice(begin, end);
  return new Function("document", `${block}\n; return computeStableElementId;`)(
    doc,
  ) as ComputeStableElementId;
}

/** A page of the customer's site: same template, its own URL and its own copy. */
function renderPage(url: string, bodyHtml: string): Document {
  return new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    url,
  }).window.document;
}

/**
 * The shared layout. One `<main id="site-main">` wrapper, a heading, a lead
 * paragraph and a call to action — the shape of essentially every marketing
 * template.
 */
function marketingPage(heading: string, lead: string, cta: string) {
  return `
    <main id="site-main">
      <section class="hero">
        <h1>${heading}</h1>
        <p>${lead}</p>
        <a href="/signup">${cta}</a>
      </section>
    </main>
  `;
}

const ABOUT = renderPage(
  "https://acme.example.com/about",
  marketingPage(
    "About Acme",
    "We have been building tools since 2019.",
    "Meet the team",
  ),
);

const PRICING = renderPage(
  "https://acme.example.com/pricing",
  marketingPage(
    "Simple pricing",
    "Start free, upgrade when you grow.",
    "See plans",
  ),
);

const idOnAbout = loadComputeStableElementId(ABOUT);
const idOnPricing = loadComputeStableElementId(PRICING);

describe("element ids across two pages of one template", () => {
  // The premise. If these ever stop matching, the pages below are no longer
  // "the same template" and the failing tests would be meaningless.
  it("confirms the two pages really do share a structure and differ in copy", () => {
    expect(ABOUT.querySelector("h1")?.textContent).not.toBe(
      PRICING.querySelector("h1")?.textContent,
    );
    expect(ABOUT.querySelector("#site-main")).not.toBeNull();
    expect(PRICING.querySelector("#site-main")).not.toBeNull();
  });

  const sharedElements: ReadonlyArray<readonly [string, string]> = [
    ["the headline", "h1"],
    ["the lead paragraph", ".hero p"],
    ["the call to action", ".hero a"],
  ];

  // GUARD for each case below. `test.failing` passes on ANY throw — a slicing
  // loader that stopped matching the widget, a selector that matches nothing —
  // so each marked test needs an unmarked sibling running the identical
  // extraction on the identical elements and asserting only that it produced
  // well-formed ids.
  it.each(sharedElements)(
    "computes a well-formed id for %s on both pages",
    (_label, selector) => {
      const about = ABOUT.querySelector(selector);
      const pricing = PRICING.querySelector(selector);

      expect(about).not.toBeNull();
      expect(pricing).not.toBeNull();
      expect(idOnAbout(about as Element)).toMatch(/^rcf-[a-z0-9]+$/);
      expect(idOnPricing(pricing as Element)).toMatch(/^rcf-[a-z0-9]+$/);
    },
  );

  test.failing.each(sharedElements)(
    "gives %s a different id on /about than on /pricing",
    (_label, selector) => {
      const about = ABOUT.querySelector(selector);
      const pricing = PRICING.querySelector(selector);

      expect(about).not.toBeNull();
      expect(pricing).not.toBeNull();

      expect(idOnAbout(about as Element)).not.toBe(
        idOnPricing(pricing as Element),
      );
    },
  );

  // GUARD for the distinct-rows test below.
  it("computes an id for all six elements across the two pages", () => {
    const ids: string[] = [];

    for (const selector of ["h1", ".hero p", ".hero a"]) {
      ids.push(idOnAbout(ABOUT.querySelector(selector) as Element));
      ids.push(idOnPricing(PRICING.querySelector(selector) as Element));
    }

    // Six computations that all succeeded. How many are *distinct* is the
    // marked test — this only proves the loader and selectors are sound.
    expect(ids).toHaveLength(6);
    expect(ids.every((id) => id.startsWith("rcf-"))).toBe(true);
  });

  test.failing("keeps every element of the two pages in distinct rows", () => {
    // The product-level statement: a site with two templated pages and three
    // editable elements each has six things to edit, not three. Today the set
    // collapses to three, and the dashboard shows exactly that.
    const ids = new Set<string>();

    for (const selector of ["h1", ".hero p", ".hero a"]) {
      ids.add(idOnAbout(ABOUT.querySelector(selector) as Element));
      ids.add(idOnPricing(PRICING.querySelector(selector) as Element));
    }

    expect(ids.size).toBe(6);
  });

  // GUARD for the hydration test below.
  it("has a headline with its own text on each page", () => {
    const aboutHeadline = ABOUT.querySelector("h1") as Element;
    const pricingHeadline = PRICING.querySelector("h1") as Element;

    // The premise of the marked test: two real headlines, each with copy of
    // its own, and an id computed for both.
    expect(aboutHeadline.textContent).toBe("About Acme");
    expect(pricingHeadline.textContent).toBe("Simple pricing");
    expect(idOnAbout(aboutHeadline)).toMatch(/^rcf-/);
    expect(idOnPricing(pricingHeadline)).toMatch(/^rcf-/);
  });

  test.failing("does not let /about's copy be served on /pricing", () => {
    // The visitor-facing consequence. `/about` is discovered first, so its
    // headline is what the row holds; `hydrateStoredContent` skips only when
    // `content === elementData.originalContent` (recopyfast.src.js:3322), and
    // "About Acme" is not "Simple pricing", so it is applied every time.
    const discovered = new Map<string, string>();

    const aboutHeadline = ABOUT.querySelector("h1") as Element;
    discovered.set(
      idOnAbout(aboutHeadline),
      aboutHeadline.textContent as string,
    );

    const pricingHeadline = PRICING.querySelector("h1") as Element;
    const storedForPricing = discovered.get(idOnPricing(pricingHeadline));

    // Either there is no row under that id yet — correct, the pages are
    // different — or the row belongs to this page. Anything else overwrites
    // the customer's live headline.
    expect(storedForPricing ?? pricingHeadline.textContent).toBe(
      pricingHeadline.textContent,
    );
  });
});

describe("identity properties the current scheme does hold", () => {
  // Not defects. These pin the behaviour a page-scoped id must not break, so
  // the fix cannot be "hash the URL and the text together" — that would
  // reintroduce the churn the scheme was built to eliminate.

  it("is stable across two renders of the same page", () => {
    const first = renderPage(
      "https://acme.example.com/about",
      marketingPage("About Acme", "Lead.", "CTA"),
    );
    const second = renderPage(
      "https://acme.example.com/about",
      marketingPage("About Acme", "Lead.", "CTA"),
    );

    expect(
      loadComputeStableElementId(first)(first.querySelector("h1") as Element),
    ).toBe(
      loadComputeStableElementId(second)(second.querySelector("h1") as Element),
    );
  });

  it("does not change when the copy is edited", () => {
    // The product's whole premise: an id that moved when the words changed
    // would orphan the row on the first save.
    const before = renderPage(
      "https://acme.example.com/about",
      marketingPage("About Acme", "Lead.", "CTA"),
    );
    const after = renderPage(
      "https://acme.example.com/about",
      marketingPage("About Acme, rewritten", "New lead.", "New CTA"),
    );

    expect(
      loadComputeStableElementId(before)(before.querySelector("h1") as Element),
    ).toBe(
      loadComputeStableElementId(after)(after.querySelector("h1") as Element),
    );
  });

  it("separates two same-tag siblings within one page", () => {
    const doc = renderPage(
      "https://acme.example.com/blog",
      `<main id="site-main"><ul><li>First</li><li>Second</li></ul></main>`,
    );
    const compute = loadComputeStableElementId(doc);
    const items = doc.querySelectorAll("li");

    expect(compute(items[0])).not.toBe(compute(items[1]));
  });

  it("honours an author-supplied data-rcf-id verbatim", () => {
    // The documented escape hatch, and the only workaround a customer has for
    // the collision above today.
    const doc = renderPage(
      "https://acme.example.com/pricing",
      `<main id="site-main"><h1 data-rcf-id="pricing-headline">Simple pricing</h1></main>`,
    );

    expect(
      loadComputeStableElementId(doc)(doc.querySelector("h1") as Element),
    ).toBe("pricing-headline");
  });
});
