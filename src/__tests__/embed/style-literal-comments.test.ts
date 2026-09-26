/**
 * s39 — no CSS comment ships inside the widget's style literals.
 *
 * The widget's CSS lives in template literals assigned to `style.textContent`.
 * esbuild strips JavaScript comments when it minifies, but a comment inside a
 * string is string content: it went out, byte for byte, to every visitor of
 * every customer site. Twelve of them did, and moving them out of the strings
 * was measured at −446 gz on the bundle — which is what paid for the "All
 * sites" control in the same story, against a gate that had 5 bytes of widget
 * headroom left.
 *
 * The explanations were kept, as JS comments directly above each literal. This
 * test is what stops the next edit from putting one back inside: the artifact
 * is checked because it is what customers download, and the source because it
 * is what the next build will ship.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const EMBED_DIR = path.join(process.cwd(), "public", "embed");
const SOURCE = readFileSync(path.join(EMBED_DIR, "recopyfast.src.js"), "utf8");
const BUILT = readFileSync(path.join(EMBED_DIR, "recopyfast.js"), "utf8");

/** Every `textContent = \`…\`` literal — the widget's injected stylesheets. */
function styleLiterals(text: string): string[] {
  return Array.from(text.matchAll(/textContent\s*=\s*`([^`]*)`/g)).map(
    (match) => match[1],
  );
}

describe.each([
  ["the artifact customers load", BUILT],
  ["the source the next build ships", SOURCE],
])("%s", (_label, text) => {
  it("still has its style literals, so the next assertion looks at something", () => {
    expect(styleLiterals(text).length).toBeGreaterThanOrEqual(5);
    expect(styleLiterals(text).join("")).toContain("#rcf-editor-banner");
  });

  it("carries no CSS comment inside any of them", () => {
    const offenders = styleLiterals(text).flatMap(
      (css) => css.match(/\/\*[\s\S]*?\*\//g) ?? [],
    );

    expect(offenders).toEqual([]);
  });
});
