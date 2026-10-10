/**
 * @jest-environment node
 */
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
 *
 * s67 — the build minifies each literal's CSS (scripts/build-embed.mjs,
 * `minifyStyleLiterals`). The indentation and newlines inside these strings were
 * the same kind of dead weight as the comments: string bytes esbuild's JS
 * minifier cannot touch, ~500 gz of them, which is what funds SPA support.
 *
 * The node environment is deliberate: esbuild's API refuses to run under jsdom
 * (its `TextEncoder` invariant fails across the jsdom realm), and nothing here
 * needs a DOM.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { transform } from "esbuild";

const EMBED_DIR = path.join(process.cwd(), "public", "embed");
const SOURCE = readFileSync(path.join(EMBED_DIR, "recopyfast.src.js"), "utf8");
const BUILT = readFileSync(path.join(EMBED_DIR, "recopyfast.js"), "utf8");

/**
 * Every stylesheet assigned to `textContent` — the widget's injected styles.
 *
 * Backticks in the source. In the artifact the CSS is minified first, and
 * esbuild then prints a template literal holding no newline as an ordinary
 * quoted string (`s.textContent=".a{…}"`, or single quotes when the CSS holds a
 * double quote), so those forms are matched too. The same assignment spelling
 * also carries ~90 UI labels, so a literal only counts as a stylesheet when it
 * holds a declaration block (`{…:…}`) — an emoji escape like `"\u{1F4E7}"` has
 * braces but no declaration.
 */
function styleLiterals(text: string): string[] {
  return Array.from(
    text.matchAll(/textContent\s*=\s*(?:`([^`]*)`|"([^"]*)"|'([^']*)')/g),
    (match) => match[1] ?? match[2] ?? match[3],
  ).filter((css) => /\{[^{}]*:[^{}]*\}/.test(css));
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

describe("the artifact customers load", () => {
  it("ships each style literal minified, exactly as esbuild minifies its source CSS", async () => {
    const source = styleLiterals(SOURCE);
    const built = styleLiterals(BUILT);

    expect(built).toHaveLength(source.length);
    for (const [index, css] of source.entries()) {
      const { code } = await transform(css, { loader: "css", minify: true });
      expect(built[index]).toBe(code.trim());
    }
  });
});
