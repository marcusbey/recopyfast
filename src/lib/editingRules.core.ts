/**
 * ReCopyFast editing rules — canonical implementation.
 *
 * This is the single source of truth for "what must be true of an element while
 * it is being edited". It is deliberately framework-free and DOM-only so that it
 * can run in two places from one copy:
 *
 *   1. the app (`src/lib/editingRules.ts` re-exports it),
 *   2. the embeddable widget (`scripts/build-embed.mjs` compiles this file and
 *      injects it into `public/embed/recopyfast.js` at the `@rcf-inject` marker).
 *
 * Nothing here may import from `react`, `next`, or anything else outside the
 * standard DOM lib — the widget is a classic script on a stranger's page.
 *
 * ---------------------------------------------------------------------------
 * THE RULES
 * ---------------------------------------------------------------------------
 * R1  Never restyle text that is already fine. Entering edit mode must not
 *     change font, size, weight, spacing, colour, alignment or box geometry.
 * R2  Never re-derive a style the browser can supply. Edit in place so the
 *     element keeps its cascade; do not copy computed styles onto a substitute.
 * R3  Never change the author's text colour. If text is unreadable, put a scrim
 *     *behind* it — recolouring the text is a visible design change.
 * R4  Only add a scrim when readability is not already proven, and then use the
 *     smallest one that provably works (see resolveScrim).
 * R5  Affordances must be layout-neutral: outline (never border), caret colour,
 *     ::selection. Nothing that participates in layout.
 * R6  Read text with textContent, never innerText — innerText returns the
 *     text-transform'd, whitespace-collapsed *rendering*, not the source.
 * R7  Geometry floors come from computed layout px, never getBoundingClientRect,
 *     which is contaminated by ancestor transform/zoom.
 */

/* ------------------------------------------------------------------ colour */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED_COLORS: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
  silver: { r: 192, g: 192, b: 192, a: 1 },
  navy: { r: 0, g: 0, b: 128, a: 1 },
  teal: { r: 0, g: 128, b: 128, a: 1 },
  olive: { r: 128, g: 128, b: 0, a: 1 },
  maroon: { r: 128, g: 0, b: 0, a: 1 },
  purple: { r: 128, g: 0, b: 128, a: 1 },
  yellow: { r: 255, g: 255, b: 0, a: 1 },
  orange: { r: 255, g: 165, b: 0, a: 1 },
};

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);

  if (ss === 0) {
    const v = Math.round(ll * 255);
    return { r: v, g: v, b: v };
  }

  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;

  const channel = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  return {
    r: Math.round(channel(hh + 1 / 3) * 255),
    g: Math.round(channel(hh) * 255),
    b: Math.round(channel(hh - 1 / 3) * 255),
  };
}

/**
 * Parse any colour a browser can hand back from getComputedStyle, plus the hex
 * and named forms an author may have written inline.
 *
 * Returns null for values that are not a colour ("none", "currentColor",
 * gradients) so callers can tell "no colour here" from "transparent black".
 */
export function parseCssColor(input: string | null | undefined): Rgba | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (
    !value ||
    value === "none" ||
    value === "currentcolor" ||
    value === "inherit"
  ) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, value)) {
    return { ...NAMED_COLORS[value] };
  }

  if (value.charAt(0) === "#") {
    const hex = value.slice(1);
    const expand = (c: string): number => parseInt(c + c, 16);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expand(hex[0]),
        g: expand(hex[1]),
        b: expand(hex[2]),
        a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  // rgb()/rgba() in both legacy comma and modern space syntax.
  const rgb = value.match(
    /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/,
  );
  if (rgb) {
    const chan = (raw: string): number =>
      raw.endsWith("%") ? (parseFloat(raw) / 100) * 255 : parseFloat(raw);
    const alpha = (raw: string | undefined): number =>
      raw === undefined
        ? 1
        : raw.endsWith("%")
          ? parseFloat(raw) / 100
          : parseFloat(raw);
    return {
      r: clamp(chan(rgb[1]), 0, 255),
      g: clamp(chan(rgb[2]), 0, 255),
      b: clamp(chan(rgb[3]), 0, 255),
      a: clamp(alpha(rgb[4]), 0, 1),
    };
  }

  const hsl = value.match(
    /^hsla?\(\s*([\d.-]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/,
  );
  if (hsl) {
    const { r, g, b } = hslToRgb(
      parseFloat(hsl[1]),
      parseFloat(hsl[2]) / 100,
      parseFloat(hsl[3]) / 100,
    );
    const rawAlpha = hsl[4];
    const a =
      rawAlpha === undefined
        ? 1
        : rawAlpha.endsWith("%")
          ? parseFloat(rawAlpha) / 100
          : parseFloat(rawAlpha);
    return { r, g, b, a: clamp(a, 0, 1) };
  }

  return null;
}

/** Source-over compositing of `top` onto an assumed-opaque `bottom`. */
export function compositeOver(top: Rgba, bottom: Rgba): Rgba {
  if (top.a >= 1) return { ...top };
  if (top.a <= 0) return { ...bottom };
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  };
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(color: Rgba): number {
  const linear = [color.r, color.g, color.b].map((raw) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG 2.1 contrast ratio between two opaque colours (1..21). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/* ---------------------------------------------------------------- backdrop */

export type BackdropKind = "solid" | "gradient" | "image" | "media" | "unknown";

export interface Backdrop {
  kind: BackdropKind;
  /** Best estimate of the painted colour behind the element's text. */
  color: Rgba;
  /**
   * True only when `color` is what the user will actually see. False for
   * photographic backgrounds, blend modes, filters and anything else whose
   * painted result cannot be derived from the cascade.
   */
  certain: boolean;
  /** Widest luminance excursion the real backdrop may have (gradients). */
  luminanceRange: [number, number];
  reason: string;
}

const TRANSPARENT_BG = /^rgba?\(0,\s*0,\s*0,\s*0\)$|^transparent$/i;

/** Pull every colour literal out of a gradient string, in stop order. */
function gradientStops(image: string): Rgba[] {
  const out: Rgba[] = [];
  const re = /(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(image)) !== null) {
    const parsed = parseCssColor(match[1]);
    if (parsed) out.push(parsed);
  }
  return out;
}

function isMediaBackdrop(el: Element, view: Window): boolean {
  // A video/canvas painted underneath sibling text is the classic hero
  // treatment; the element itself is transparent so the cascade says nothing.
  //
  // Direct children only, and only positioned ones. A descendant query would
  // match a <video> anywhere in the subtree, so a single video at the bottom of
  // a page would make *every* element on it report an unknowable backdrop.
  const children = el.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.tagName !== "VIDEO" && child.tagName !== "CANVAS") continue;
    const position = view.getComputedStyle(child).position;
    if (position === "absolute" || position === "fixed") return true;
  }
  return false;
}

/**
 * What is actually painted behind this element's text?
 *
 * Walks the ancestor chain compositing translucent layers, and reports honestly
 * when the answer cannot be known from CSS alone. Callers must branch on
 * `certain` — a confident-looking colour from a photographic backdrop is how
 * unreadable edit surfaces get shipped.
 */
export function resolveBackdrop(
  element: Element,
  view: Window = window,
): Backdrop {
  const layers: Rgba[] = [];
  let node: Element | null = element;
  let uncertainty: { kind: BackdropKind; reason: string } | null = null;
  let range: [number, number] | null = null;

  while (node && node.nodeType === 1) {
    const cs = view.getComputedStyle(node);

    // Effects we cannot predict the painted result of.
    if (!uncertainty) {
      if (cs.mixBlendMode && cs.mixBlendMode !== "normal") {
        uncertainty = {
          kind: "unknown",
          reason: "mix-blend-mode: " + cs.mixBlendMode,
        };
      } else if (cs.filter && cs.filter !== "none") {
        uncertainty = { kind: "unknown", reason: "filter: " + cs.filter };
      } else if (cs.backdropFilter && cs.backdropFilter !== "none") {
        uncertainty = { kind: "unknown", reason: "backdrop-filter" };
      }
    }

    const image = cs.backgroundImage;
    if (image && image !== "none") {
      if (/gradient/i.test(image)) {
        const stops = gradientStops(image);
        if (stops.length) {
          const lums = stops.map(relativeLuminance);
          range = [Math.min(...lums), Math.max(...lums)];
          // Average stop colour is the best single-colour stand-in.
          const avg = stops.reduce(
            (acc, s) => ({
              r: acc.r + s.r,
              g: acc.g + s.g,
              b: acc.b + s.b,
              a: acc.a + s.a,
            }),
            { r: 0, g: 0, b: 0, a: 0 },
          );
          const n = stops.length;
          layers.push({
            r: avg.r / n,
            g: avg.g / n,
            b: avg.b / n,
            a: Math.min(1, avg.a / n),
          });
        }
        if (!uncertainty)
          uncertainty = { kind: "gradient", reason: "background gradient" };
      } else if (!uncertainty) {
        uncertainty = { kind: "image", reason: "background-image" };
      }
      break;
    }

    if (isMediaBackdrop(node, view) && !uncertainty) {
      uncertainty = { kind: "media", reason: "video/canvas backdrop" };
      break;
    }

    const bg = cs.backgroundColor;
    if (bg && !TRANSPARENT_BG.test(bg)) {
      const parsed = parseCssColor(bg);
      if (parsed && parsed.a > 0) {
        // An ancestor's opacity dilutes everything it paints.
        const opacity = parseFloat(cs.opacity);
        const effective =
          !isNaN(opacity) && opacity < 1
            ? { ...parsed, a: parsed.a * opacity }
            : parsed;
        layers.push(effective);
        if (effective.a >= 1) break;
      }
    }

    node = node.parentElement;
  }

  // The page canvas is the final backstop.
  const canvasColor = pageCanvasColor(view);
  let composited = canvasColor;
  for (let i = layers.length - 1; i >= 0; i--) {
    composited = compositeOver(layers[i], composited);
  }

  if (uncertainty) {
    return {
      kind: uncertainty.kind,
      color: composited,
      certain: false,
      luminanceRange: range ?? [0, 1],
      reason: uncertainty.reason,
    };
  }

  const lum = relativeLuminance(composited);
  return {
    kind: "solid",
    color: composited,
    certain: true,
    luminanceRange: [lum, lum],
    reason: layers.length ? "composited background-color" : "page canvas",
  };
}

/** html/body background, falling back to white the way browsers do. */
function pageCanvasColor(view: Window): Rgba {
  const doc = view.document;
  for (const el of [doc.documentElement, doc.body]) {
    if (!el) continue;
    const bg = view.getComputedStyle(el).backgroundColor;
    if (bg && !TRANSPARENT_BG.test(bg)) {
      const parsed = parseCssColor(bg);
      if (parsed && parsed.a > 0) return compositeOver(parsed, WHITE);
    }
  }
  return WHITE;
}

/* ------------------------------------------------------------- readability */

/** WCAG 2.1 AA thresholds. Large text is >=24px, or >=18.66px when bold. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

export function requiredContrast(
  fontSizePx: number,
  fontWeight: number,
): number {
  const isLarge =
    fontSizePx >= 24 || (fontWeight >= 700 && fontSizePx >= 18.66);
  return isLarge ? AA_LARGE : AA_NORMAL;
}

export interface Readability {
  /** Ratio against the resolved backdrop, or null when text is not painted. */
  ratio: number | null;
  required: number;
  backdrop: Backdrop;
  /** rgba() string to paint behind the text, or null to change nothing. */
  scrim: string | null;
  /** Guaranteed worst-case ratio once `scrim` is applied. */
  guaranteed: number | null;
  reason: string;
}

/**
 * Smallest scrim alpha that guarantees `target` contrast for `text` against ANY
 * possible backdrop colour.
 *
 * With scrim colour S at alpha a over an unknown backdrop B, the painted result
 * is a*S + (1-a)*B. Luminance is monotonic per channel, so the worst case over
 * all B is attained at B = black or B = white; checking both extremes bounds
 * every backdrop in between. Binary search is exact enough at 1/256 steps and
 * costs ~8 iterations.
 *
 * Returns null when no alpha below `maxAlpha` can do it (e.g. mid-grey text,
 * which is unreadable against something no matter what we put behind it).
 */
export function solveScrimAlpha(
  text: Rgba,
  scrim: Rgba,
  target: number,
  maxAlpha = 0.92,
): number | null {
  const worstCase = (alpha: number): number => {
    let worst = Infinity;
    for (const extreme of [BLACK, WHITE]) {
      const painted = compositeOver({ ...scrim, a: alpha }, extreme);
      worst = Math.min(worst, contrastRatio(text, painted));
    }
    return worst;
  };

  if (worstCase(maxAlpha) < target) return null;

  let lo = 0;
  let hi = maxAlpha;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (worstCase(mid) >= target) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi * 256) / 256;
}

function rgbaString(c: Rgba): string {
  return (
    "rgba(" +
    Math.round(c.r) +
    ", " +
    Math.round(c.g) +
    ", " +
    Math.round(c.b) +
    ", " +
    Math.round(c.a * 1000) / 1000 +
    ")"
  );
}

/**
 * Decide whether an element needs help to be readable while it is edited, and
 * what the minimum intervention is.
 *
 * The bias is aggressively toward doing nothing: an unnecessary scrim is a
 * visible design change, which is exactly what we are trying to eliminate.
 */
export function assessReadability(
  element: Element,
  view: Window = window,
): Readability {
  const cs = view.getComputedStyle(element);
  const backdrop = resolveBackdrop(element, view);
  const fontSize = parseFloat(cs.fontSize) || 16;
  const fontWeight = parseInt(cs.fontWeight, 10) || 400;
  const required = requiredContrast(fontSize, fontWeight);

  // Gradient-clipped text has no `color`; the glyphs are painted by the
  // background. Nothing we put behind them helps, and a scrim would wreck the
  // effect. The author owns this one.
  const fillColor = (
    cs as CSSStyleDeclaration & { webkitTextFillColor?: string }
  ).webkitTextFillColor;
  const clipsToText =
    /text/.test(cs.backgroundClip || "") ||
    /text/.test(
      (cs as CSSStyleDeclaration & { webkitBackgroundClip?: string })
        .webkitBackgroundClip || "",
    );
  const textIsTransparent =
    (fillColor && TRANSPARENT_BG.test(fillColor)) ||
    TRANSPARENT_BG.test(cs.color);

  if (clipsToText || textIsTransparent) {
    return {
      ratio: null,
      required,
      backdrop,
      scrim: null,
      guaranteed: null,
      reason:
        "glyphs are painted by the background (background-clip: text); left untouched",
    };
  }

  const text = parseCssColor(cs.color);
  if (!text) {
    return {
      ratio: null,
      required,
      backdrop,
      scrim: null,
      guaranteed: null,
      reason: "text colour unreadable from CSS",
    };
  }

  // A translucent text colour composites against the backdrop too.
  const paintedText = text.a < 1 ? compositeOver(text, backdrop.color) : text;

  /**
   * Both polarities are tried, not just the one "opposite" the text.
   *
   * Choosing darken-vs-lighten from the text's own luminance fails for
   * mid-luminance text: grey text has no headroom upward (it would need a
   * backdrop brighter than white) but plenty downward. Solving both and taking
   * the cheaper winner costs one extra binary search and turns several
   * "impossible" cases into small scrims.
   */
  const pickScrim = (
    solve: (scrim: Rgba) => number | null,
  ): { color: Rgba; alpha: number } | null => {
    let best: { color: Rgba; alpha: number } | null = null;
    for (const candidate of [BLACK, WHITE]) {
      const alpha = solve(candidate);
      if (alpha === null) continue;
      if (!best || alpha < best.alpha) best = { color: candidate, alpha };
    }
    return best;
  };

  if (backdrop.certain) {
    const ratio = contrastRatio(paintedText, backdrop.color);
    if (ratio >= required) {
      return {
        ratio,
        required,
        backdrop,
        scrim: null,
        guaranteed: ratio,
        reason: "already legible; nothing changed",
      };
    }
    // Known backdrop: solve against the real colour, not the worst case.
    const chosen = pickScrim((scrim) =>
      solveKnownScrimAlpha(paintedText, scrim, backdrop.color, required),
    );
    if (chosen === null) {
      return {
        ratio,
        required,
        backdrop,
        scrim: null,
        guaranteed: null,
        reason: "no scrim can rescue this colour pair",
      };
    }
    const painted = compositeOver(
      { ...chosen.color, a: chosen.alpha },
      backdrop.color,
    );
    return {
      ratio,
      required,
      backdrop,
      scrim: rgbaString({ ...chosen.color, a: chosen.alpha }),
      guaranteed: contrastRatio(paintedText, painted),
      reason:
        "measured " +
        ratio.toFixed(2) +
        ":1 below " +
        required +
        ":1; minimum scrim applied",
    };
  }

  // Backdrop unknowable. If even the worst case clears the bar, do nothing.
  const worstKnown = Math.min(
    contrastRatio(paintedText, BLACK),
    contrastRatio(paintedText, WHITE),
  );
  if (worstKnown >= required) {
    return {
      ratio: null,
      required,
      backdrop,
      scrim: null,
      guaranteed: worstKnown,
      reason:
        "legible against any backdrop (" +
        backdrop.reason +
        "); nothing changed",
    };
  }

  const unknownScrim = pickScrim((scrim) =>
    solveScrimAlpha(paintedText, scrim, required),
  );
  if (unknownScrim === null) {
    return {
      ratio: null,
      required,
      backdrop,
      scrim: null,
      guaranteed: null,
      reason: "no scrim can guarantee " + required + ":1",
    };
  }
  return {
    ratio: null,
    required,
    backdrop,
    scrim: rgbaString({ ...unknownScrim.color, a: unknownScrim.alpha }),
    guaranteed: required,
    reason:
      backdrop.reason +
      " is unmeasurable; smallest scrim that guarantees " +
      required +
      ":1 applied",
  };
}

/** As solveScrimAlpha, but the backdrop colour is known so no worst case is needed. */
function solveKnownScrimAlpha(
  text: Rgba,
  scrim: Rgba,
  backdrop: Rgba,
  target: number,
  maxAlpha = 0.92,
): number | null {
  const at = (alpha: number): number =>
    contrastRatio(text, compositeOver({ ...scrim, a: alpha }, backdrop));

  if (at(maxAlpha) < target) return null;

  let lo = 0;
  let hi = maxAlpha;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) >= target) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi * 256) / 256;
}

/* ------------------------------------------------------------- affordances */

export interface Affordances {
  /**
   * Polarity of the surface the element sits on. Exposed explicitly so callers
   * never have to sniff it back out of one of the colour strings.
   */
  backdropIsLight: boolean;
  caretColor: string;
  selectionBackground: string;
  selectionColor: string;
  outlineColor: string;
  /** Chrome (toolbars, counters) rendered off the element. */
  chromeBackground: string;
  chromeText: string;
  chromeBorder: string;
}

/**
 * Affordance colours derived from the backdrop the element actually sits on.
 *
 * These paint *around* and *through* the text (caret, selection, outline) and
 * never replace it, so they can be tuned freely without violating R1.
 */
export function resolveAffordances(
  element: Element,
  view: Window = window,
): Affordances {
  const backdrop = resolveBackdrop(element, view);
  const isLight = relativeLuminance(backdrop.color) > 0.45;

  return isLight
    ? {
        backdropIsLight: true,
        caretColor: "#1d4ed8",
        selectionBackground: "rgba(59, 130, 246, 0.28)",
        selectionColor: "inherit",
        outlineColor: "rgba(37, 99, 235, 0.9)",
        chromeBackground: "rgba(15, 23, 42, 0.92)",
        chromeText: "#e2e8f0",
        chromeBorder: "rgba(255, 255, 255, 0.14)",
      }
    : {
        backdropIsLight: false,
        caretColor: "#93c5fd",
        selectionBackground: "rgba(147, 197, 253, 0.38)",
        selectionColor: "inherit",
        outlineColor: "rgba(147, 197, 253, 0.9)",
        chromeBackground: "rgba(248, 250, 252, 0.94)",
        chromeText: "#1e293b",
        chromeBorder: "rgba(15, 23, 42, 0.14)",
      };
}

/* ---------------------------------------------------------------- geometry */

export interface LayoutFloor {
  /** Untransformed layout height in px — safe to use as a min-height floor. */
  minHeight: number;
  /** True when the element participates in inline layout (no height floor). */
  inline: boolean;
  /** Preserving white-space means leading/trailing space is significant. */
  preservesWhitespace: boolean;
  writingMode: string;
  direction: string;
}

/**
 * R7: measure from computed layout, not getBoundingClientRect.
 *
 * getBoundingClientRect returns the *visual* box, which an ancestor
 * transform/zoom has already scaled. Feeding that back in as a min-width
 * multiplies the element by the scale factor every time it is edited — the
 * exact bug this replaces.
 */
export function measureLayoutFloor(
  element: Element,
  view: Window = window,
): LayoutFloor {
  const cs = view.getComputedStyle(element);
  const display = cs.display;
  const inline =
    display === "inline" || display === "ruby" || display === "contents";

  return {
    minHeight: parseFloat(cs.height) || 0,
    inline,
    preservesWhitespace: /^(pre|pre-wrap|break-spaces)$/.test(cs.whiteSpace),
    writingMode: cs.writingMode,
    direction: cs.direction,
  };
}

/* -------------------------------------------------------------------- text */

/**
 * R6: the editable source text.
 *
 * innerText is the *rendered* text: it applies text-transform, so an uppercase
 * heading round-trips as "SHIPPING FAST" and permanently destroys the author's
 * "Shipping fast". It also collapses whitespace, which corrupts <pre> blocks.
 * textContent is the source of truth in every case.
 */
export function readEditableText(
  element: Element,
  view: Window = window,
): string {
  const el = element as HTMLInputElement | HTMLTextAreaElement;
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    return el.value ?? "";
  }

  const raw = element.textContent ?? "";
  const cs = view.getComputedStyle(element);
  // Trimming a <pre> block silently eats the author's indentation.
  return /^(pre|pre-wrap|break-spaces)$/.test(cs.whiteSpace) ? raw : raw.trim();
}

/** True when replacing the text would flatten author markup (<strong>, <a>, …). */
export function hasMarkupChildren(element: Element): boolean {
  for (let i = 0; i < element.children.length; i++) {
    const tag = element.children[i].tagName;
    if (tag !== "BR") return true;
  }
  return false;
}

/* ------------------------------------------------------------ font loading */

/**
 * Resolve once the document's fonts have settled.
 *
 * Metrics read before a web font lands describe the fallback face, so anything
 * derived from them (capacity estimates, overflow checks) is wrong by however
 * much the two faces differ. Never blocks longer than `timeoutMs` — a font that
 * never arrives must not wedge edit mode.
 */
export function whenFontsReady(
  view: Window = window,
  timeoutMs = 3000,
): Promise<void> {
  const fonts = (view.document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts || fonts.status === "loaded") return Promise.resolve();

  return Promise.race([
    fonts.ready.then(() => undefined),
    new Promise<void>((resolve) => view.setTimeout(resolve, timeoutMs)),
  ]);
}
