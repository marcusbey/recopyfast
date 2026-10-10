/**
 * The width, in CSS px, of the focus indicator a keyboard user actually sees:
 * the element's outline or its ring, whichever is wider (design system,
 * Motion and focus: a 2px `:focus-visible` outline globally, and components
 * add `ring-2 ring-offset-2`).
 *
 * Parsed here, in Node, from computed style strings, so it can be unit-tested
 * (`src/__tests__/e2e/focus-indicator.test.ts`). The s66a harness first read
 * the ring as the smallest `0px 0px 0px <n>px` spread. Tailwind v4 composes
 * five shadow layers and Chromium serialises the unused ones as
 * `rgba(0, 0, 0, 0) 0px 0px 0px 0px`, so the smallest spread was always 0 and
 * the ring could never count (s66a review m2). Reading both, and ignoring
 * transparent layers, keeps the check true if the global outline rule is ever
 * moved into a layer and a `focus-visible:outline-none` starts to win.
 */
export interface FocusStyle {
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  boxShadow: string;
}

interface ShadowLayer {
  color: string;
  inset: boolean;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
}

export function focusIndicatorWidth(style: FocusStyle): number {
  return Math.max(outlineWidth(style), ringWidth(style.boxShadow));
}

function outlineWidth(style: FocusStyle): number {
  if (style.outlineStyle === "none" || isTransparent(style.outlineColor)) {
    return 0;
  }
  return parseFloat(style.outlineWidth) || 0;
}

/**
 * The visible band of a ring: the outermost painted `0 0 0 <spread>` layer,
 * minus the next one in. With `ring-offset-2` that inner layer is the offset,
 * painted in the page colour over the ring, so `ring-2 ring-offset-2`
 * computes `… 0px 0px 0px 2px, … 0px 0px 0px 4px` and shows a 2px ring.
 */
function ringWidth(boxShadow: string): number {
  const spreads = shadowLayers(boxShadow)
    .filter(isPaintedRing)
    .map((layer) => layer.spread)
    .sort((a, b) => b - a);
  if (spreads.length === 0) return 0;
  return spreads[0] - (spreads[1] ?? 0);
}

function isPaintedRing(layer: ShadowLayer): boolean {
  return (
    !layer.inset &&
    layer.offsetX === 0 &&
    layer.offsetY === 0 &&
    layer.blur === 0 &&
    layer.spread > 0 &&
    !isTransparent(layer.color)
  );
}

function shadowLayers(boxShadow: string): ShadowLayer[] {
  if (boxShadow.trim() === "none") return [];
  return splitTopLevel(boxShadow).map(parseLayer);
}

/** Splits on commas outside parentheses: `rgb(1, 2, 3)` stays whole. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const LENGTH = /(?:^|\s)(-?\d*\.?\d+)px(?=\s|$)/g;

function parseLayer(layer: string): ShadowLayer {
  const lengths = Array.from(layer.matchAll(LENGTH), (match) =>
    Number(match[1]),
  );
  const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = lengths;
  const color = layer
    .replace(LENGTH, " ")
    .replace(/\binset\b/, " ")
    .trim();
  return {
    color,
    inset: /\binset\b/.test(layer),
    offsetX,
    offsetY,
    blur,
    spread,
  };
}

/**
 * `transparent`, a four-argument `rgba(r, g, b, 0)`, or any `…(… / 0)`
 * colour. Three-argument `rgb(255, 0, 0)` is opaque even though it ends in 0.
 */
function isTransparent(color: string): boolean {
  const value = color.trim();
  return (
    value === "transparent" ||
    /^rgba?\([^,()]+,[^,()]+,[^,()]+,\s*0(?:\.0+)?%?\s*\)$/.test(value) ||
    /\/\s*0(?:\.0+)?%?\s*\)$/.test(value)
  );
}
