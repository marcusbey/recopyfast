/**
 * @jest-environment node
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * s96 — the free tools render a stranger's page text, so none of it may reach
 * the DOM as markup. The one raw-HTML sink allowed under `src/app/tools` and
 * `src/components/tools` is JSON-LD built from our own constants and serialised
 * by `serializeJsonLd` (which escapes `<`). Anything else — a `<mark>` built as
 * a string, a "rich" excerpt — fails here.
 */

const ROOTS = ["src/app/tools", "src/components/tools"];
const JSON_LD_SINK =
  /dangerouslySetInnerHTML=\{\{\s*__html:\s*serializeJsonLd\(/;

/** The source without comments: a comment naming a sink runs nothing. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__tests__" ? [] : sourceFiles(full);
    }
    return /\.(tsx?|jsx?)$/.test(entry) ? [full] : [];
  });
}

describe("no raw HTML under the free tools", () => {
  const files = ROOTS.flatMap((root) =>
    sourceFiles(path.join(process.cwd(), root)),
  );

  it("finds the files it checks", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files.map((file) => [path.relative(process.cwd(), file), file]))(
    "%s uses dangerouslySetInnerHTML only for serialised JSON-LD",
    (_name, file) => {
      const source = code(file);
      const sinks = source.split("dangerouslySetInnerHTML").length - 1;
      const jsonLdSinks = (
        source.match(new RegExp(JSON_LD_SINK.source, "g")) ?? []
      ).length;

      expect(sinks).toBe(jsonLdSinks);
    },
  );

  it("never draws an <img> in a report component", () => {
    for (const file of files.filter((name) =>
      name.includes("components/tools"),
    )) {
      expect([file, /<img\b/.test(code(file))]).toEqual([file, false]);
    }
  });
});
