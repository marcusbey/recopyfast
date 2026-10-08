/**
 * @jest-environment node
 *
 * s66a AC 4 — the two global CSS bugs, pinned in the stylesheet itself.
 *
 * (a) The `* { border-color: var(--line) }` reset was unlayered. Unlayered
 *     declarations outrank everything inside `@layer utilities`, so it beat
 *     every Tailwind border-colour utility in the app: `border-input` computed
 *     to `--line`, and input boundaries drew at 1.45:1 (dark) and 1.34:1
 *     (light) against the 3:1 that `input.tsx` claims (s66 research, fact 4a).
 * (b) `bg-popover` / `text-popover-foreground` had no theme token, so every
 *     dropdown and Select menu was transparent (fact 4b).
 *
 * It also pins ADR 050's two radius tokens, and that the legacy scale and the
 * marketing helpers are untouched: marketing keeps `--radius` and its scale,
 * `.surface-interactive`, `.text-display` and `.text-title` exactly as they are
 * on main (plan, "Run interdicts").
 *
 * Plain text parsing on purpose: the assertions are about where a rule sits
 * (inside or outside a layer), which a computed-style test cannot see.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(
  path.join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

interface Block {
  prelude: string;
  body: string;
}

/** Top-level blocks of a stylesheet (or of a block body), comments removed. */
function blocks(source: string): Block[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const result: Block[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if (char === "{") {
      if (depth === 0) bodyStart = index + 1;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        result.push({
          prelude: code.slice(preludeStart, bodyStart - 1).trim(),
          body: code.slice(bodyStart, index),
        });
        preludeStart = index + 1;
      }
    } else if (char === ";" && depth === 0) {
      preludeStart = index + 1;
    }
  }
  return result;
}

const selectors = (prelude: string) =>
  prelude.split(",").map((selector) => selector.trim());

const declares = (body: string, property: string, value?: string) =>
  new RegExp(
    `(^|[;{\\s])${property}\\s*:\\s*${value ? value.replace(/[()]/g, "\\$&") : "[^;]+"}\\s*;`,
  ).test(body);

describe("globals.css", () => {
  const topLevel = blocks(css);

  it("has no unlayered `*` rule that sets border-color", () => {
    const unlayered = topLevel.filter(
      (block) =>
        !block.prelude.startsWith("@") &&
        selectors(block.prelude).includes("*") &&
        declares(block.body, "border-color"),
    );
    expect(unlayered).toEqual([]);
  });

  it("puts the border reset inside @layer base", () => {
    const base = topLevel.find((block) => block.prelude === "@layer base");
    expect(base).toBeDefined();
    const reset = blocks((base as Block).body).find(
      (block) =>
        selectors(block.prelude).join(",") ===
        "*,::after,::before,::backdrop,::file-selector-button",
    );
    expect(reset).toBeDefined();
    expect(declares((reset as Block).body, "border-color", "var(--line)")).toBe(
      true,
    );
  });

  describe("@theme inline", () => {
    const theme = topLevel.find((block) => block.prelude === "@theme inline");

    it.each([
      ["--color-popover", "var(--surface-card)"],
      ["--color-popover-foreground", "var(--text-strong)"],
      ["--radius-control", "2px"],
      ["--radius-container", "0px"],
    ])("defines %s: %s", (property, value) => {
      expect(theme).toBeDefined();
      expect(declares((theme as Block).body, property, value)).toBe(true);
    });
  });

  it("squares the skeleton with the container token", () => {
    const skeleton = topLevel.find((block) => block.prelude === ".skeleton");
    expect(skeleton).toBeDefined();
    expect(
      declares(
        (skeleton as Block).body,
        "border-radius",
        "var(--radius-container)",
      ),
    ).toBe(true);
  });

  /*
   * Marketing still uses these (ADR 050). Each literal is copied byte for
   * byte from main; a change here repaints the marketing surface.
   */
  it.each([
    ["--radius", "  --radius: 0.75rem;\n"],
    [
      "the legacy radius scale",
      [
        "  --radius-xs: calc(var(--radius) - 8px);",
        "  --radius-sm: calc(var(--radius) - 6px);",
        "  --radius-md: calc(var(--radius) - 3px);",
        "  --radius-lg: var(--radius);",
        "  --radius-xl: calc(var(--radius) + 4px);",
        "  --radius-2xl: calc(var(--radius) + 10px);",
      ].join("\n"),
    ],
    [
      ".surface-interactive",
      [
        ".surface-interactive {",
        "  transition:",
        "    transform var(--dur) var(--ease-out),",
        "    box-shadow var(--dur) var(--ease-out),",
        "    border-color var(--dur) var(--ease-out),",
        "    background-color var(--dur) var(--ease-out);",
        "}",
        "",
        ".surface-interactive:hover {",
        "  transform: translateY(-1px);",
        "  border-color: color-mix(in oklab, var(--accent-solid) 32%, var(--line));",
        "  box-shadow: var(--shadow-md);",
        "}",
        "",
        ".surface-interactive:active {",
        "  transform: translateY(0) scale(0.995);",
        "  box-shadow: var(--shadow-xs);",
        "}",
      ].join("\n"),
    ],
    [
      ".text-display",
      [
        ".text-display {",
        "  font-size: clamp(1.625rem, 1.35rem + 1.1vw, 2rem);",
        "  font-weight: 600;",
        "  line-height: 1.12;",
        "  letter-spacing: -0.023em;",
        "  color: var(--text-strong);",
        "}",
      ].join("\n"),
    ],
    [
      ".text-title",
      [
        ".text-title {",
        "  font-size: 1.0625rem;",
        "  font-weight: 600;",
        "  line-height: 1.35;",
        "  letter-spacing: -0.012em;",
        "  color: var(--text-strong);",
        "}",
      ].join("\n"),
    ],
  ])("keeps %s byte-identical to main", (_name, literal) => {
    expect(css).toContain(literal);
  });
});
