/**
 * @jest-environment node
 *
 * s66a AC 5 — every dialog is a frame, a body that scrolls, and nothing else.
 *
 * `DialogContent` used to be a padded, scrolling grid. A grid item keeps
 * `min-width: auto`, so one unwrapped 300-character snippet set the column to
 * 2,524 px inside a 588 px panel (s66 research, fact 1), on all 12 call sites.
 * The fix lives in the primitive, and it only holds if call sites stop
 * re-adding the layout the primitive took away: `overflow-y-auto` on the frame
 * brings back a second scroll region, `grid`/`gap-*` brings back the grid,
 * padding fights the header/body/footer insets.
 *
 * So, for every app-surface file that renders `<DialogContent`:
 * - it also renders `<DialogBody`, the one scroll region;
 * - the `className` it passes to `DialogContent` carries width only
 *   (`max-w-*` / `w-*`, any breakpoint prefix).
 *
 * A source scan cannot see a `<form>` that wraps body and footer without
 * `flex min-h-0 flex-1 flex-col`; the Playwright harness's single-scroll
 * assertion is the check for that (plan "where this could be wrong" 3).
 */

import {
  appSurfaceFiles,
  baseUtility,
  readSource,
  stripComments,
} from "./app-surface";

interface OpeningTag {
  line: number;
  text: string;
}

/** Each `<DialogContent …>` opening tag, read to its closing `>`. */
function dialogContentTags(code: string): OpeningTag[] {
  const tags: OpeningTag[] = [];
  for (const match of code.matchAll(/<DialogContent(?=[\s>/])/g)) {
    const start = match.index ?? 0;
    let depth = 0;
    let quote: string | null = null;
    let end = start;
    for (let index = start; index < code.length; index += 1) {
      const char = code[index];
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) {
        end = index;
        break;
      }
    }
    tags.push({
      line: code.slice(0, start).split("\n").length,
      text: code.slice(start, end + 1),
    });
  }
  return tags;
}

/** The class tokens a tag passes through `className`, from every literal in it. */
function classNameTokens(tag: string): string[] {
  const at = tag.indexOf("className=");
  if (at === -1) return [];
  const rest = tag.slice(at + "className=".length);
  let value = rest;
  if (rest.startsWith("{")) {
    let depth = 0;
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === "{") depth += 1;
      if (rest[index] === "}") depth -= 1;
      if (depth === 0) {
        value = rest.slice(0, index + 1);
        break;
      }
    }
  } else {
    const quote = rest[0];
    value = rest.slice(0, rest.indexOf(quote, 1) + 1);
  }
  const literals = Array.from(
    value.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g),
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
  return literals.join(" ").split(/\s+/).filter(Boolean);
}

const WIDTH_ONLY = /^(max-w-|w-)/;

function layoutViolations(tag: string): string[] {
  return classNameTokens(tag).filter(
    (token) => !WIDTH_ONLY.test(baseUtility(token)),
  );
}

describe("dialog structure (design system, Dialogs and sheets)", () => {
  const dialogFiles = appSurfaceFiles()
    .map((file) => ({ file, code: stripComments(readSource(file)) }))
    .filter(({ code }) => /<DialogContent(?=[\s>/])/.test(code));

  it("finds the reachable dialog call sites", () => {
    // 11 files, 12 call sites at s66a (sites/page.tsx has two).
    expect(dialogFiles.length).toBeGreaterThanOrEqual(11);
  });

  it("renders a DialogBody wherever it renders a DialogContent", () => {
    const missing = dialogFiles
      .filter(({ code }) => !/<DialogBody(?=[\s>/])/.test(code))
      .map(({ file }) => file);
    expect(missing).toEqual([]);
  });

  it("passes width only to DialogContent", () => {
    const violations = dialogFiles.flatMap(({ file, code }) =>
      dialogContentTags(code)
        .map((tag) => ({ tag, tokens: layoutViolations(tag.text) }))
        .filter(({ tokens }) => tokens.length > 0)
        .map(({ tag, tokens }) => `${file}:${tag.line} ${tokens.join(" ")}`),
    );
    expect(violations).toEqual([]);
  });

  describe("the parser (self-test)", () => {
    it.each([
      ['<DialogContent className="sm:max-w-md">', []],
      ['<DialogContent className="max-w-[40rem] w-full">', []],
      ["<DialogContent>", []],
      [
        '<DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">',
        ["max-h-[90vh]", "overflow-y-auto"],
      ],
      [
        '<DialogContent\n  className={cn("sm:max-w-md", "rounded-2xl p-6")}\n  onEscapeKeyDown={(e) => e.preventDefault()}\n>',
        ["rounded-2xl", "p-6"],
      ],
      ['<DialogContent className="grid gap-4 sm:max-w-md">', ["grid", "gap-4"]],
    ])("reads %s", (source, expected) => {
      const [tag] = dialogContentTags(source);
      expect(layoutViolations(tag.text)).toEqual(expected);
    });

    it("does not mistake an arrow function for the end of the tag", () => {
      const [tag] = dialogContentTags(
        '<DialogContent onInteractOutside={(e) => e.preventDefault()} className="p-4">',
      );
      expect(layoutViolations(tag.text)).toEqual(["p-4"]);
    });
  });
});
