/**
 * @jest-environment node
 *
 * The census behind host-page-globals.test.ts: no bare use, anywhere in the
 * widget, of a name a host page can shadow. A page's top-level `let open` /
 * `const history` / `let addEventListener` … is visible to every classic
 * script on the page, so a BARE `open(…)` in the widget reaches the page's
 * binding and the TypeError lands in the host page's window (non-negotiable
 * #4). `window.open` cannot be shadowed. A byte-saving pass removed `window.`
 * once already (s76 review fix pass 1); this is the line it would have to
 * delete to do it again.
 *
 * Node, not jsdom: this is static analysis of the source, and ESLint needs
 * `structuredClone`, which jest's jsdom environment does not provide.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { FlatCompat } from "@eslint/eslintrc";
import { Linter } from "eslint";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

/**
 * The names a host page can shadow with a top-level `let` / `const` / `class`.
 *
 * `location` is deliberately absent: it is [LegacyUnforgeable] on Window, so
 * a page's top-level `let`/`const`/`class location` is a SyntaxError and
 * `var location` binds nothing new (measured in Chromium 145 and WebKit 26 —
 * the s76 plan, decision 13). Listing it would demand 13 `window.` prefixes
 * that defend against nothing, paid for in embed bytes.
 */
const SHADOWABLE_GLOBALS = [
  "open",
  "history",
  "addEventListener",
  "removeEventListener",
  "localStorage",
  "sessionStorage",
];

/**
 * TOMBSTONE — s76 verification. The census used to be a regex over the source
 * with the comments cut out first, and it was blind three ways: the comment
 * stripper read the `/*` in `// … /api/editor/*` as the start of a block
 * comment and deleted real code up to the next `*\/` (lines 188–216 and
 * 997–1199 of the widget, 232 lines, were never checked); its guards against
 * object keys (`(?!\s*:)`) and member access (no `.` before the name) also
 * hid `a ? open : b` and `...history`; and it flagged a parameter that
 * shadows the name. ESLint's scope analysis answers the actual question —
 * does this identifier resolve to the global scope? — for a classic browser
 * script, which is what the widget is. A source that does not parse comes
 * back as its parse error, so the census cannot pass by reading nothing.
 */
const BROWSER_SCRIPT = [
  ...new FlatCompat({ baseDirectory: process.cwd() }).env({ browser: true }),
  {
    languageOptions: { ecmaVersion: "latest", sourceType: "script" },
    rules: { "no-restricted-globals": ["error", ...SHADOWABLE_GLOBALS] },
  },
] as Linter.Config[];

/** Every bare reference to a shadowable global, as "<line>: <name>". */
function bareUses(source: string): string[] {
  const lines = source.split("\n");
  return new Linter({ configType: "flat" })
    .verify(source, BROWSER_SCRIPT)
    .map(
      (message) =>
        `${message.line}: ${
          message.ruleId && message.endColumn
            ? lines[message.line - 1].slice(
                message.column - 1,
                message.endColumn - 1,
              )
            : message.message
        }`,
    );
}

describe("the census", () => {
  it.each([
    [
      "a use after a line comment naming a path that ends in /*",
      "(function () {\n  // client for /api/editor/*\n  open('x');\n  /** a doc comment */\n})();",
      ["3: open"],
    ],
    [
      "a ternary operand",
      "(function () {\n  const f = Math.random() ? open : null;\n  return f;\n})();",
      ["2: open"],
    ],
    [
      "a spread",
      "(function () {\n  return [...history];\n})();",
      ["2: history"],
    ],
    [
      "each of the six names",
      "(function () {\n  open; history; addEventListener; removeEventListener; localStorage; sessionStorage;\n})();",
      [
        "2: open",
        "2: history",
        "2: addEventListener",
        "2: removeEventListener",
        "2: localStorage",
        "2: sessionStorage",
      ],
    ],
    [
      "nothing that is not a use of the page's global scope",
      "(function () {\n  window.open('x'); window.history.back();\n  const o = { history: 1, open() { return 'open'; } };\n  function f(localStorage) { return localStorage; }\n  location.reload();\n  return [o, f];\n})();",
      [],
    ],
    [
      "a source that does not parse, as its parse error",
      "(function () {\n  open(;\n})();",
      ["2: Parsing error: Unexpected token ;"],
    ],
  ])("finds %s", (_label, source, expected) => {
    expect(bareUses(source)).toEqual(expected);
  });
});

describe("the widget source", () => {
  it("names every shadowable global through window", () => {
    expect(bareUses(WIDGET_SOURCE)).toEqual([]);
  });
});
