/**
 * @jest-environment node
 *
 * s70b — a row says where it is in words an owner understands.
 *
 * The old Content page titled every card with the element id the embed
 * assigned (`rcf-1gom2eazz3g`) and the CSS selector it recorded
 * (`div:nth-child(7) > div > button:nth-child(3) > span:nth-child(1)`). The
 * owner's verdict: "what is the content page about ??". The rows now read
 * "Hero · Main heading" under a "Homepage" band, from signals the row already
 * holds — no new embed bytes. The tables below are the design's
 * (docs/designs/s70-content-changes.md, "Human-readable location"), row for
 * row. Deep paths keep their first segment as well as the last two: Devin
 * review (PR #77) found that keeping only the last two gave
 * /products/alpha/setup and /services/alpha/setup the same band
 * ("… › Alpha › Setup"), and the full path beside it truncates on a phone.
 * The design's table was updated to match (Devin re-review N5).
 */

import { describeElement, describePage } from "../describe-location";

describe("describePage", () => {
  it.each([
    ["/", "Homepage"],
    ["/pricing", "Pricing"],
    ["/blog/how-we-ship", "Blog › How we ship"],
    ["/products/alpha/setup", "Products › Alpha › Setup"],
    ["/docs/a/b/c", "Docs › … › B › C"],
    [null, "Every page"],
  ])("labels %p as %p", (pagePath, label) => {
    expect(describePage(pagePath)).toBe(label);
  });

  it("shortens a 300-character path to its first segment and its last two", () => {
    const segments = Array.from({ length: 30 }, (_, index) => `part-${index}`);
    const longPath = `/${segments.join("/")}`.padEnd(300, "x");
    expect(longPath).toHaveLength(300);

    const label = describePage(longPath);

    expect(label.startsWith("Part 0 › … › Part 28 › ")).toBe(true);
    expect(label.split(" › ")).toHaveLength(4);
  });

  it.each([
    ["/products/alpha/setup", "/services/alpha/setup"],
    ["/products/alpha/x/setup", "/services/alpha/x/setup"],
    ["/blog/2024/launch", "/blog/2025/launch"],
  ])("tells %p from %p", (left, right) => {
    expect(describePage(left)).not.toBe(describePage(right));
  });
});

describe("describeElement", () => {
  it.each([
    // page_path · selector · type → band · location (the design's examples)
    ["/", "#root > main > section.hero > h1", "h1", "Hero · Main heading"],
    [
      "/pricing",
      "#pricing > div.grid > div:nth-child(2) > button",
      "button",
      // The place is the page itself, so it is dropped.
      "Button",
    ],
    [
      "/",
      "#root > main > div.cta > button > span",
      "span",
      "Call to action · Button label",
    ],
    ["/", "body > header > nav > a:nth-child(3)", "a", "Navigation · Link"],
    ["/blog/how-we-ship", "article > p:nth-child(4)", "p", "Paragraph"],
    // The mockup's extra row: a framework root is never a place.
    ["/docs/a/b/c", "#__next > main > h2", "h2", "Heading"],
  ])("%s · %s · %s reads %p", (pagePath, selector, elementType, expected) => {
    expect(
      describeElement({
        selector,
        elementType,
        elementId: "rcf-1gom2eazz3g",
        pageLabel: describePage(pagePath),
      }),
    ).toBe(expected);
  });

  it("lets an author id win over the element: hero-title reads Hero title", () => {
    expect(
      describeElement({
        selector: '[data-rcf-id="hero-title"]',
        elementType: "h2",
        elementId: "hero-title",
        pageLabel: describePage(null),
      }),
    ).toBe("Hero title");
  });

  it.each([
    ["h1", "Main heading"],
    ["h2", "Heading"],
    ["h3", "Subheading"],
    ["h6", "Subheading"],
    ["p", "Paragraph"],
    ["li", "List item"],
    ["button", "Button"],
    ["a", "Link"],
    ["img", "Image"],
    ["label", "Form label"],
    ["td", "Table cell"],
    ["th", "Table cell"],
    ["span", "Text"],
  ])("names a %s as %p", (elementType, label) => {
    expect(
      describeElement({
        selector: `article > ${elementType}`,
        elementType,
        elementId: "rcf-x",
        pageLabel: "Homepage",
      }),
    ).toBe(label);
  });

  it("reads a span inside a link as Link text", () => {
    expect(
      describeElement({
        selector: "article > a.more > span",
        elementType: "span",
        elementId: "rcf-x",
        pageLabel: "Homepage",
      }),
    ).toBe("Link text");
  });

  it("reads an opted-in container as Content block", () => {
    expect(
      describeElement({
        selector: "article > div[data-rcf-content]",
        elementType: "div",
        elementId: "rcf-x",
        pageLabel: "Homepage",
      }),
    ).toBe("Content block");
  });

  it("falls back to the selector's last tag when the row has no type", () => {
    expect(
      describeElement({
        selector: "body > footer > p:nth-child(2)",
        elementType: null,
        elementId: "rcf-x",
        pageLabel: "Homepage",
      }),
    ).toBe("Footer · Paragraph");
  });

  it("gives Text for an empty selector and an unknown type", () => {
    expect(
      describeElement({
        selector: "",
        elementType: "marquee",
        elementId: "rcf-x",
        pageLabel: "Homepage",
      }),
    ).toBe("Text");
    expect(
      describeElement({
        selector: "",
        elementType: undefined,
        elementId: "",
        pageLabel: "Homepage",
      }),
    ).toBe("Text");
  });

  it("uses an anchoring id as the place, humanized", () => {
    expect(
      describeElement({
        selector: "#site-footer > div > p",
        elementType: "p",
        elementId: "rcf-x",
        pageLabel: "Homepage",
      }),
    ).toBe("Site footer · Paragraph");
  });

  it("names FAQ, features and the other fixed class words", () => {
    const placeOf = (className: string) =>
      describeElement({
        selector: `main > section.${className} > p`,
        elementType: "p",
        elementId: "rcf-x",
        pageLabel: "Homepage",
      });

    expect(placeOf("faq")).toBe("FAQ · Paragraph");
    expect(placeOf("features")).toBe("Features · Paragraph");
    expect(placeOf("testimonials")).toBe("Testimonials · Paragraph");
    expect(placeOf("grid")).toBe("Paragraph");
  });

  /**
   * The point of the module: whatever the embed recorded, an owner never sees
   * an element id or a selector. Every shape the embed's `generateSelector`
   * produces, plus author ids that try to smuggle selector syntax in.
   */
  it("never outputs rcf-, >, :nth or #", () => {
    const cases: Array<{
      selector: string;
      elementType: string | null;
      elementId: string;
      pagePath: string | null;
    }> = [
      {
        selector:
          "div:nth-child(7) > div > button:nth-child(3) > span:nth-child(1)",
        elementType: "span",
        elementId: "rcf-1gom2eazz3g",
        pagePath: "/",
      },
      {
        selector: "#rcf-hero > h1",
        elementType: "h1",
        elementId: "rcf-v6di4rh42g",
        pagePath: "/",
      },
      {
        selector: '[data-rcf-id="a>b#c:nth-child(2)"]',
        elementType: "p",
        elementId: "a>b#c:nth-child(2)",
        pagePath: null,
      },
      {
        selector: "#__next > header > a > img",
        elementType: "img",
        elementId: "rcf-12v7zi61en4",
        pagePath: "/changelog",
      },
      {
        selector: "#pricing > div.grid > div:nth-child(2) > button",
        elementType: "button",
        elementId: "rcf-lr2vlhxvk0",
        pagePath: "/#section:nth-child(1)",
      },
    ];

    for (const { selector, elementType, elementId, pagePath } of cases) {
      const pageLabel = describePage(pagePath);
      const location = describeElement({
        selector,
        elementType,
        elementId,
        pageLabel,
      });
      for (const output of [pageLabel, location]) {
        expect(output).not.toMatch(/rcf-|>|:nth|#/);
        expect(output.trim()).not.toBe("");
      }
    }
  });
});
