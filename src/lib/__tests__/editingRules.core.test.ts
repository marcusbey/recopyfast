import {
  AA_LARGE,
  AA_NON_TEXT,
  AA_NORMAL,
  BLACK,
  WHITE,
  compositeOver,
  contrastRatio,
  hasMarkupChildren,
  measureLayoutFloor,
  parseCssColor,
  pickAffordanceColor,
  readEditableText,
  relativeLuminance,
  requiredContrast,
  solveScrimAlpha,
  whenFontsReady,
} from "../editingRules.core";
import type { Rgba } from "../editingRules.core";

/**
 * These helpers decide what edit mode does to a stranger's page: whether a
 * scrim appears, what colour the caret is, and what text is round-tripped back
 * into the CMS. Getting any of them wrong is a visible defacement of a customer
 * site, so each rule is pinned to a concrete expected value here.
 */

const GREY: Rgba = { r: 128, g: 128, b: 128, a: 1 };

describe("parseCssColor", () => {
  describe("values that are not a colour", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["whitespace", "   "],
      ["none", "none"],
      ["currentColor", "currentColor"],
      ["inherit", "inherit"],
      ["a gradient", "linear-gradient(#fff, #000)"],
      ["a bare keyword", "revert"],
    ])(
      "returns null for %s so callers can tell it apart from transparent",
      (_label, input) => {
        expect(parseCssColor(input)).toBeNull();
      },
    );

    it("distinguishes transparent from an absent colour", () => {
      expect(parseCssColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(parseCssColor("none")).toBeNull();
    });
  });

  describe("named colours", () => {
    it("parses a named colour", () => {
      expect(parseCssColor("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    });

    it("is case insensitive and tolerates surrounding whitespace", () => {
      expect(parseCssColor("  NAVY ")).toEqual({ r: 0, g: 0, b: 128, a: 1 });
    });

    it("does not resolve inherited Object.prototype keys as colours", () => {
      expect(parseCssColor("constructor")).toBeNull();
      expect(parseCssColor("toString")).toBeNull();
    });

    it("returns a copy so callers cannot mutate the shared table", () => {
      const first = parseCssColor("red") as Rgba;
      first.r = 0;

      expect(parseCssColor("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    });
  });

  describe("hex", () => {
    it("expands 3-digit hex", () => {
      expect(parseCssColor("#f0a")).toEqual({ r: 255, g: 0, b: 170, a: 1 });
    });

    it("expands 4-digit hex including the alpha nibble", () => {
      expect(parseCssColor("#f0af")).toEqual({ r: 255, g: 0, b: 170, a: 1 });
      expect(parseCssColor("#0000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    it("parses 6-digit hex", () => {
      expect(parseCssColor("#1d4ed8")).toEqual({
        r: 0x1d,
        g: 0x4e,
        b: 0xd8,
        a: 1,
      });
    });

    it("parses 8-digit hex alpha", () => {
      expect(parseCssColor("#00000080")?.a).toBeCloseTo(128 / 255, 5);
    });

    it("rejects hex of an unsupported length", () => {
      expect(parseCssColor("#12345")).toBeNull();
      expect(parseCssColor("#1")).toBeNull();
    });
  });

  describe("rgb()/rgba()", () => {
    it("parses legacy comma syntax", () => {
      expect(parseCssColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    });

    it("parses the modern space/slash syntax browsers return", () => {
      expect(parseCssColor("rgb(1 2 3 / 0.5)")).toEqual({
        r: 1,
        g: 2,
        b: 3,
        a: 0.5,
      });
    });

    it("parses an alpha given as a percentage", () => {
      expect(parseCssColor("rgba(0, 0, 0, 50%)")?.a).toBeCloseTo(0.5, 5);
    });

    it("parses percentage channels", () => {
      expect(parseCssColor("rgb(100%, 0%, 50%)")).toEqual({
        r: 255,
        g: 0,
        b: 127.5,
        a: 1,
      });
    });

    it("clamps out-of-range channels and alpha", () => {
      expect(parseCssColor("rgba(300, 2, 3, 4)")).toEqual({
        r: 255,
        g: 2,
        b: 3,
        a: 1,
      });
    });
  });

  describe("hsl()/hsla()", () => {
    it("parses a saturated hue", () => {
      expect(parseCssColor("hsl(0, 100%, 50%)")).toEqual({
        r: 255,
        g: 0,
        b: 0,
        a: 1,
      });
    });

    it("treats zero saturation as grey", () => {
      expect(parseCssColor("hsl(210, 0%, 50%)")).toEqual({
        r: 128,
        g: 128,
        b: 128,
        a: 1,
      });
    });

    it("normalises a negative hue", () => {
      expect(parseCssColor("hsl(-120, 100%, 50%)")).toEqual(
        parseCssColor("hsl(240, 100%, 50%)"),
      );
    });

    it("accepts the deg suffix and a slash alpha", () => {
      expect(parseCssColor("hsl(120deg 100% 25% / 0.4)")).toEqual({
        r: 0,
        g: 128,
        b: 0,
        a: 0.4,
      });
    });

    it("accepts a percentage alpha", () => {
      expect(parseCssColor("hsla(0, 100%, 50%, 25%)")?.a).toBeCloseTo(0.25, 5);
    });

    it("handles lightness above the midpoint", () => {
      expect(parseCssColor("hsl(0, 100%, 75%)")).toEqual({
        r: 255,
        g: 128,
        b: 128,
        a: 1,
      });
    });
  });
});

describe("compositeOver", () => {
  it("returns the top colour when it is opaque", () => {
    expect(compositeOver(WHITE, BLACK)).toEqual(WHITE);
  });

  it("returns the bottom colour when the top is fully transparent", () => {
    expect(compositeOver({ r: 255, g: 0, b: 0, a: 0 }, BLACK)).toEqual(BLACK);
  });

  it("blends proportionally and yields an opaque result", () => {
    expect(compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE)).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
      a: 1,
    });
  });

  it("does not mutate either input", () => {
    const top = { r: 10, g: 20, b: 30, a: 0.5 };
    const bottom = { r: 40, g: 50, b: 60, a: 1 };

    compositeOver(top, bottom);

    expect(top).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(bottom).toEqual({ r: 40, g: 50, b: 60, a: 1 });
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 6);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 6);
  });

  it("weights green most heavily, then red, then blue", () => {
    const red = relativeLuminance({ r: 255, g: 0, b: 0, a: 1 });
    const green = relativeLuminance({ r: 0, g: 255, b: 0, a: 1 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255, a: 1 });

    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
    expect(green).toBeCloseTo(0.7152, 4);
  });

  it("uses the linear ramp below the sRGB threshold", () => {
    // c <= 0.03928 takes the c/12.92 branch rather than the gamma curve.
    expect(relativeLuminance({ r: 5, g: 5, b: 5, a: 1 })).toBeCloseTo(
      5 / 255 / 12.92,
      6,
    );
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black against white", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
  });

  it("is 1:1 for a colour against itself", () => {
    expect(contrastRatio(GREY, GREY)).toBeCloseTo(1, 10);
  });

  it("is symmetric in its arguments", () => {
    expect(contrastRatio(GREY, WHITE)).toBeCloseTo(
      contrastRatio(WHITE, GREY),
      10,
    );
  });
});

describe("requiredContrast", () => {
  it("requires the normal-text ratio for body copy", () => {
    expect(requiredContrast(16, 400)).toBe(AA_NORMAL);
  });

  it("relaxes to the large-text ratio at 24px regardless of weight", () => {
    expect(requiredContrast(24, 400)).toBe(AA_LARGE);
  });

  it("relaxes at 18.66px only when the text is bold", () => {
    expect(requiredContrast(18.66, 700)).toBe(AA_LARGE);
    expect(requiredContrast(18.66, 600)).toBe(AA_NORMAL);
  });

  it("still requires the normal ratio just below the large-text size", () => {
    expect(requiredContrast(23.9, 400)).toBe(AA_NORMAL);
    expect(requiredContrast(18.65, 700)).toBe(AA_NORMAL);
  });
});

describe("solveScrimAlpha", () => {
  it("finds an alpha that works against a black and a white backdrop alike", () => {
    const alpha = solveScrimAlpha(WHITE, BLACK, AA_NORMAL);

    expect(alpha).not.toBeNull();
    if (alpha === null) return;

    for (const extreme of [BLACK, WHITE]) {
      const painted = compositeOver({ ...BLACK, a: alpha }, extreme);
      expect(contrastRatio(WHITE, painted)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it("returns the smallest alpha it can, not the maximum", () => {
    const alpha = solveScrimAlpha(WHITE, BLACK, AA_NORMAL) as number;

    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(0.92);
  });

  it("needs a heavier scrim for a stricter target", () => {
    const relaxed = solveScrimAlpha(WHITE, BLACK, AA_LARGE) as number;
    const strict = solveScrimAlpha(WHITE, BLACK, AA_NORMAL) as number;

    expect(strict).toBeGreaterThan(relaxed);
  });

  it("quantises the alpha to 1/256 steps", () => {
    const alpha = solveScrimAlpha(WHITE, BLACK, AA_NORMAL) as number;

    expect(Number.isInteger(alpha * 256)).toBe(true);
  });

  it("gives up rather than returning an alpha that does not work", () => {
    // Mid-grey text cannot be rescued: any scrim light enough to contrast with
    // it on one extreme fails on the other.
    expect(solveScrimAlpha(GREY, WHITE, AA_NORMAL)).toBeNull();
  });

  it("succeeds for the same text once the target is relaxed", () => {
    expect(solveScrimAlpha(GREY, WHITE, AA_LARGE)).not.toBeNull();
  });

  it("respects a lowered maxAlpha ceiling", () => {
    expect(solveScrimAlpha(WHITE, BLACK, AA_NORMAL, 0.05)).toBeNull();
  });
});

describe("pickAffordanceColor", () => {
  it("keeps the first candidate that clears the non-text minimum", () => {
    expect(pickAffordanceColor(["#000000", "#ffffff"], WHITE)).toBe("#000000");
  });

  it("skips a candidate that would be invisible on the backdrop", () => {
    // White-on-white is 1:1; the second candidate is the first usable one.
    expect(pickAffordanceColor(["#ffffff", "#000000"], WHITE)).toBe("#000000");
  });

  it("ignores candidates that are not parseable colours", () => {
    expect(pickAffordanceColor(["not-a-color", "#000000"], WHITE)).toBe(
      "#000000",
    );
  });

  it("falls back to black when nothing works on a light backdrop", () => {
    expect(pickAffordanceColor(["#7f7f7f"], GREY)).toBe("#000000");
  });

  it("falls back to white when nothing works on a dark backdrop", () => {
    expect(pickAffordanceColor(["#010101"], BLACK)).toBe("#ffffff");
  });

  it("falls back when handed no candidates at all", () => {
    expect(pickAffordanceColor([], BLACK)).toBe("#ffffff");
  });

  it("honours a custom minimum ratio", () => {
    const backdrop: Rgba = { r: 200, g: 200, b: 200, a: 1 };

    // #6a6a6a clears 3:1 against #c8c8c8 (3.23:1) but not a demand for 10:1.
    expect(pickAffordanceColor(["#6a6a6a"], backdrop, AA_NON_TEXT)).toBe(
      "#6a6a6a",
    );
    expect(pickAffordanceColor(["#6a6a6a"], backdrop, 10)).toBe("#000000");
  });
});

describe("readEditableText", () => {
  function element(html: string, style = ""): Element {
    const host = document.createElement("div");
    host.innerHTML = html;
    const el = host.firstElementChild as HTMLElement;
    if (style) el.setAttribute("style", style);
    document.body.appendChild(host);
    return el;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reads the value of an input", () => {
    const input = document.createElement("input");
    input.value = "  spaced  ";

    expect(readEditableText(input)).toBe("  spaced  ");
  });

  it("reads the value of a textarea", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "line one\nline two";

    expect(readEditableText(textarea)).toBe("line one\nline two");
  });

  it("trims surrounding whitespace for normally-wrapped text", () => {
    expect(readEditableText(element("<p>\n  Hello world\n</p>"))).toBe(
      "Hello world",
    );
  });

  it("returns the source text, not the rendered transform", () => {
    // text-transform: uppercase must not be baked into what we save, or the
    // author's casing is destroyed on the first round trip.
    const el = element("<h1>Shipping fast</h1>", "text-transform: uppercase");

    expect(readEditableText(el)).toBe("Shipping fast");
  });

  it("preserves indentation when white-space is preserved", () => {
    const el = element("<pre>  indented\n</pre>", "white-space: pre");

    expect(readEditableText(el)).toBe("  indented\n");
  });

  it("returns an empty string for an element with no text", () => {
    expect(readEditableText(element("<p></p>"))).toBe("");
  });
});

describe("hasMarkupChildren", () => {
  function element(html: string): Element {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.firstElementChild as Element;
  }

  it("is false for plain text", () => {
    expect(hasMarkupChildren(element("<p>just text</p>"))).toBe(false);
  });

  it("is false when the only children are line breaks", () => {
    expect(hasMarkupChildren(element("<p>a<br>b<br>c</p>"))).toBe(false);
  });

  it("is true when replacing the text would flatten inline markup", () => {
    expect(hasMarkupChildren(element("<p>a <strong>b</strong></p>"))).toBe(
      true,
    );
    expect(hasMarkupChildren(element('<p><a href="#">link</a></p>'))).toBe(
      true,
    );
  });

  it("is true when a break sits alongside real markup", () => {
    expect(hasMarkupChildren(element("<p>a<br><em>b</em></p>"))).toBe(true);
  });
});

describe("measureLayoutFloor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function element(style: string): Element {
    const el = document.createElement("div");
    el.setAttribute("style", style);
    document.body.appendChild(el);
    return el;
  }

  it("flags inline participation so no height floor is imposed", () => {
    expect(measureLayoutFloor(element("display: inline")).inline).toBe(true);
    expect(measureLayoutFloor(element("display: contents")).inline).toBe(true);
    expect(measureLayoutFloor(element("display: block")).inline).toBe(false);
  });

  it("reports a numeric height floor even when layout is unresolved", () => {
    const floor = measureLayoutFloor(element("display: block"));

    expect(Number.isNaN(floor.minHeight)).toBe(false);
    expect(floor.minHeight).toBeGreaterThanOrEqual(0);
  });

  it("flags white-space modes where leading space is significant", () => {
    expect(
      measureLayoutFloor(element("white-space: pre")).preservesWhitespace,
    ).toBe(true);
    expect(
      measureLayoutFloor(element("white-space: pre-wrap")).preservesWhitespace,
    ).toBe(true);
    expect(
      measureLayoutFloor(element("white-space: normal")).preservesWhitespace,
    ).toBe(false);
  });

  it("carries the writing mode and direction through", () => {
    const floor = measureLayoutFloor(element("direction: rtl"));

    expect(floor.direction).toBe("rtl");
    expect(typeof floor.writingMode).toBe("string");
  });
});

describe("whenFontsReady", () => {
  function viewWith(fonts: unknown): Window {
    return {
      document: { fonts },
      setTimeout: globalThis.setTimeout.bind(globalThis),
    } as unknown as Window;
  }

  it("resolves immediately when the document exposes no font set", async () => {
    await expect(whenFontsReady(viewWith(undefined))).resolves.toBeUndefined();
  });

  it("resolves immediately when fonts have already loaded", async () => {
    const ready = jest.fn();

    await expect(
      whenFontsReady(
        viewWith({
          status: "loaded",
          get ready() {
            ready();
            return new Promise(() => {});
          },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(ready).not.toHaveBeenCalled();
  });

  it("waits for pending fonts to settle", async () => {
    const view = viewWith({
      status: "loading",
      ready: Promise.resolve({}),
    });

    await expect(whenFontsReady(view)).resolves.toBeUndefined();
  });

  it("gives up after the timeout so a stalled font cannot wedge edit mode", async () => {
    jest.useFakeTimers();
    try {
      const view = viewWith({
        status: "loading",
        ready: new Promise(() => {}),
      });

      const pending = whenFontsReady(view, 50);
      jest.advanceTimersByTime(50);

      await expect(pending).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
