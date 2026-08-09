/**
 * Unit coverage for what content discovery may store (A-1).
 *
 * The route suites drive this module through an HTTP handler, which is the right
 * place to prove the customer's copy survives the round trip but a clumsy one for
 * the branches that decide *why* something is refused — a control character or a
 * length overrun reads as an opaque 400 from out there. These are the same
 * decisions asserted directly.
 *
 * Control characters are built with `String.fromCharCode` rather than written as
 * escapes so the fixtures cannot be mangled by anything that reformats this file,
 * and so the boundaries (0x1f/0x20, 0x9f/0xa0) are legible as numbers.
 */

import {
  MAX_DISCOVERED_TEXT_LENGTH,
  MAX_ELEMENT_ID_LENGTH,
  MAX_SELECTOR_LENGTH,
  validateDiscoveredElement,
  validateDiscoveredText,
  validateElementId,
} from "@/lib/security/discovered-text";

const NUL = String.fromCharCode(0x00);
const BACKSPACE = String.fromCharCode(0x08);
const UNIT_SEPARATOR = String.fromCharCode(0x1f); // last C0
const SPACE = String.fromCharCode(0x20); // first printable
const DEL = String.fromCharCode(0x7f); // first C1
const APC = String.fromCharCode(0x9f); // last C1
const NBSP = String.fromCharCode(0xa0); // first printable above C1
const TAB = String.fromCharCode(0x09);
const LINE_FEED = String.fromCharCode(0x0a);
const CARRIAGE_RETURN = String.fromCharCode(0x0d);

describe("validateDiscoveredText", () => {
  it("returns ordinary copy verbatim", () => {
    const content = "Ship content edits without a deploy.";

    expect(validateDiscoveredText(content)).toEqual({
      ok: true,
      value: content,
    });
  });

  it("returns copy an HTML sanitizer would have rewritten, verbatim", () => {
    // The A-1 defect in one assertion: this is prose, not markup.
    const content = "Setup in <2 minutes — paste the <script> tag & go";

    expect(validateDiscoveredText(content)).toEqual({
      ok: true,
      value: content,
    });
  });

  it("accepts an empty string", () => {
    expect(validateDiscoveredText("")).toEqual({ ok: true, value: "" });
  });

  describe("control characters", () => {
    // Tab, newline and carriage return are what a multi-line text node is made
    // of, so they are content and not control.
    it("keeps tab, line feed and carriage return verbatim", () => {
      const content = `Heading${LINE_FEED}Body${TAB}indented${CARRIAGE_RETURN}end`;

      expect(validateDiscoveredText(content)).toEqual({
        ok: true,
        value: content,
      });
    });

    it.each([
      ["NUL (0x00)", NUL],
      ["backspace (0x08)", BACKSPACE],
      ["unit separator (0x1f, last C0)", UNIT_SEPARATOR],
      ["DEL (0x7f, first C1)", DEL],
      ["APC (0x9f, last C1)", APC],
    ])("rejects %s", (_label, character) => {
      const result = validateDiscoveredText(`before${character}after`);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toBe(
        "content contains control characters",
      );
    });

    // The characters immediately outside each range are ordinary text and must
    // not be caught by the boundary comparisons.
    it.each([
      ["space (0x20)", SPACE],
      ["non-breaking space (0xa0)", NBSP],
    ])("accepts %s", (_label, character) => {
      const content = `before${character}after`;

      expect(validateDiscoveredText(content)).toEqual({
        ok: true,
        value: content,
      });
    });
  });

  describe("length", () => {
    it("accepts text exactly at the cap", () => {
      const content = "A".repeat(MAX_DISCOVERED_TEXT_LENGTH);

      expect(validateDiscoveredText(content)).toEqual({
        ok: true,
        value: content,
      });
    });

    it("refuses text one character past the cap, and says by how much", () => {
      const content = "A".repeat(MAX_DISCOVERED_TEXT_LENGTH + 1);

      const result = validateDiscoveredText(content);

      expect(result.ok).toBe(false);
      // The number is in the message because the caller cannot see the cap.
      expect(result.ok === false && result.error).toContain(
        String(MAX_DISCOVERED_TEXT_LENGTH),
      );
      expect(result.ok === false && result.error).toContain(
        String(content.length),
      );
    });
  });

  it.each([
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", { toString: () => "text" }],
    ["an array", ["text"]],
  ])("refuses %s rather than coercing it", (_label, value) => {
    const result = validateDiscoveredText(value);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(
      "content must be a string",
    );
  });
});

describe("validateElementId", () => {
  it("accepts the id the widget generates", () => {
    expect(validateElementId("rcf-1k3j4h5")).toEqual({
      ok: true,
      value: "rcf-1k3j4h5",
    });
  });

  it.each([
    ["an empty string", ""],
    ["a number", 7],
    ["null", null],
  ])("refuses %s", (_label, value) => {
    const result = validateElementId(value);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(
      "element id must be a non-empty string",
    );
  });

  it("refuses an id past the cap", () => {
    const result = validateElementId("a".repeat(MAX_ELEMENT_ID_LENGTH + 1));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(
      String(MAX_ELEMENT_ID_LENGTH),
    );
  });

  it("refuses an id carrying a control character", () => {
    const result = validateElementId(`rcf-${NUL}abc`);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(
      "element id contains control characters",
    );
  });
});

describe("validateDiscoveredElement", () => {
  const entry = {
    selector: "#main > section:nth-of-type(2) > h1",
    content: "Setup in <2 minutes",
    type: "h1",
  };

  it("accepts a full entry and hands back every field", () => {
    expect(validateDiscoveredElement(entry)).toEqual({
      ok: true,
      value: entry,
    });
  });

  it("accepts an entry with no type, because the column is optional", () => {
    // scripts/qa-journey.mjs reports exactly this shape.
    const { selector, content } = entry;

    expect(validateDiscoveredElement({ selector, content })).toEqual({
      ok: true,
      value: { selector, content },
    });
  });

  it("accepts a custom element name as the type", () => {
    const result = validateDiscoveredElement({ ...entry, type: "my-widget" });

    expect(result.ok).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "h1"],
    ["an array", [{ content: "x" }]],
  ])("refuses %s as an entry", (_label, value) => {
    const result = validateDiscoveredElement(value);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("entry must be an object");
  });

  describe("selector", () => {
    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["an object", { nodeName: "H1" }],
    ])("refuses a %s selector", (_label, selector) => {
      const result = validateDiscoveredElement({ ...entry, selector });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toBe(
        "selector must be a non-empty string",
      );
    });

    it("refuses a selector past the cap", () => {
      const result = validateDiscoveredElement({
        ...entry,
        selector: "d".repeat(MAX_SELECTOR_LENGTH + 1),
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toContain(
        String(MAX_SELECTOR_LENGTH),
      );
    });

    it("refuses a selector carrying a control character", () => {
      const result = validateDiscoveredElement({
        ...entry,
        selector: `h1${NUL}`,
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toBe(
        "selector contains control characters",
      );
    });
  });

  describe("type", () => {
    it.each([
      ["uppercase", "H1"],
      ["spaced", "h1 onclick"],
      ["a number", 1],
      ["an object", {}],
      ["too long", "a".repeat(33)],
      ["leading digit", "1h"],
    ])("refuses a %s type", (_label, type) => {
      const result = validateDiscoveredElement({ ...entry, type });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toBe(
        "type must be an HTML tag name",
      );
    });
  });

  it("passes a content failure through, naming content", () => {
    const result = validateDiscoveredElement({
      ...entry,
      content: `copy${NUL}`,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(
      "content contains control characters",
    );
  });
});
